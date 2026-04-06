// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
  ServiceMetadata,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";
import { signRequest } from "./signer.js";
import { XMLParser } from "fast-xml-parser";

export interface SpecIndex {
  search(query: string, service?: string): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
  getOperation?(service: string, operation: string): OperationSpec | null | Promise<OperationSpec | null>;
}

const MUTATING_PREFIXES = [
  "Create", "Delete", "Put", "Update", "Modify", "Remove",
  "Terminate", "Stop", "Start", "Reboot", "Run", "Attach",
  "Detach", "Associate", "Disassociate", "Enable", "Disable",
  "Register", "Deregister", "Tag", "Untag", "Set", "Revoke",
  "Authorize", "Grant",
];

// AWS XML uses <item> and <member> as list wrappers. Forcing them to always
// be arrays means a parent like <reservationSet><item>...</item></reservationSet>
// parses as { reservationSet: { item: [...] } }. The unwrapListTags post-pass
// then collapses { item: [...] } into just [...] on the parent key.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (name: string) => name === "item" || name === "member",
});

// Recursively unwrap objects whose only key is "item" or "member" into
// their parent, converting { someSet: { item: [...] } } → { someSet: [...] }.
function unwrapListTags(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(unwrapListTags);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const processed = unwrapListTags(value);
    if (typeof processed === "object" && processed !== null && !Array.isArray(processed)) {
      const keys = Object.keys(processed);
      if (keys.length === 1 && (keys[0] === "item" || keys[0] === "member")) {
        result[key] = (processed as Record<string, unknown>)[keys[0]];
        continue;
      }
    }
    result[key] = processed;
  }
  return result;
}

function parseXml(xml: string): Record<string, unknown> {
  const raw = xmlParser.parse(xml) as Record<string, unknown>;
  return unwrapListTags(raw) as Record<string, unknown>;
}

// Flatten params into query string key=value pairs for AWS query protocol.
// Handles nested objects and arrays using the dot-notation AWS expects.
// EC2 protocol uses Key.N, standard query protocol uses Key.member.N.
function flattenParams(
  params: Record<string, unknown>,
  prefix = "",
  useMemberTag = false,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPrefix = useMemberTag
          ? `${fullKey}.member.${i + 1}`
          : `${fullKey}.${i + 1}`;
        if (typeof value[i] === "object" && value[i] !== null) {
          Object.assign(result, flattenParams(value[i] as Record<string, unknown>, itemPrefix, useMemberTag));
        } else {
          result[itemPrefix] = String(value[i]);
        }
      }
    } else if (typeof value === "object") {
      Object.assign(result, flattenParams(value as Record<string, unknown>, fullKey, useMemberTag));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

export class AwsProvider implements CloudProvider {
  name = "aws" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: SpecIndex;
  // Cache service metadata to avoid repeated spec lookups
  private metadataCache = new Map<string, ServiceMetadata>();

  // Track which services need global endpoints (learned from failures)
  private globalEndpointServices = new Set<string>();

  constructor(config: ProviderConfig, auth: AuthProvider, specIndex: SpecIndex) {
    this.config = config;
    this.auth = auth;
    this.specIndex = specIndex;
  }

  async searchSpec(query: string, service?: string): Promise<OperationSpec[]> {
    return this.specIndex.search(query, service);
  }

  listServices(): string[] {
    return this.specIndex.listServices();
  }

  async call(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<CloudProviderCallResult> {
    this.enforceAllowlist(service, action);

    const creds = await this.auth.getCredentials("aws");
    if (!creds.aws) {
      return { success: false, error: "No AWS credentials available" };
    }

    // Resolve service metadata (protocol, targetPrefix, etc.)
    const meta = await this.resolveMetadata(service, action);
    const protocol = meta?.protocol ?? "json";
    const region = creds.aws.region;
    const endpointPrefix = meta?.endpointPrefix ?? service;

    switch (protocol) {
      case "ec2":
      case "query":
        return this.callQueryProtocol(
          endpointPrefix, service, action, params, meta, creds.aws, region,
        );
      case "json":
        return this.callJsonProtocol(
          endpointPrefix, service, action, params, meta, creds.aws, region,
        );
      case "rest-json":
        // rest-json uses path-based routing, but for simple calls we can
        // fall back to JSON protocol with POST. Full path template support
        // would require parsing the spec's http.requestUri.
        return this.callJsonProtocol(
          endpointPrefix, service, action, params, meta, creds.aws, region,
        );
      case "rest-xml":
        return this.callRestXmlProtocol(
          endpointPrefix, service, action, params, meta, creds.aws, region,
        );
      default:
        return this.callJsonProtocol(
          endpointPrefix, service, action, params, meta, creds.aws, region,
        );
    }
  }

  private resolveEndpoint(endpointPrefix: string, region: string): string {
    if (this.globalEndpointServices.has(endpointPrefix)) {
      return `https://${endpointPrefix}.amazonaws.com`;
    }
    return `https://${endpointPrefix}.${region}.amazonaws.com`;
  }

  // Wraps a fetch call with automatic global endpoint fallback.
  // If the regional endpoint fails with a DNS/connection error,
  // retries with the global endpoint and remembers for future calls.
  private async fetchWithFallback(
    endpointPrefix: string,
    region: string,
    doFetch: (endpoint: string) => Promise<Response>,
  ): Promise<Response> {
    const endpoint = this.globalEndpointServices.has(endpointPrefix)
      ? `https://${endpointPrefix}.amazonaws.com`
      : `https://${endpointPrefix}.${region}.amazonaws.com`;

    try {
      return await doFetch(endpoint);
    } catch (err) {
      // If regional endpoint failed with a connection error, try global
      const msg = err instanceof Error ? err.message : "";
      if (
        !this.globalEndpointServices.has(endpointPrefix) &&
        (msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("getaddrinfo"))
      ) {
        const globalEndpoint = `https://${endpointPrefix}.amazonaws.com`;
        try {
          const res = await doFetch(globalEndpoint);
          // Remember this service uses global endpoint
          this.globalEndpointServices.add(endpointPrefix);
          return res;
        } catch {
          // Global also failed, throw original error
        }
      }
      throw err;
    }
  }

  private async callQueryProtocol(
    endpointPrefix: string,
    service: string,
    action: string,
    params: Record<string, unknown>,
    meta: ServiceMetadata | undefined,
    creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string },
    region: string,
  ): Promise<CloudProviderCallResult> {
    const apiVersion = meta?.apiVersion ?? "";

    // EC2 protocol uses Key.N, standard query uses Key.member.N
    const useMemberTag = (meta?.protocol ?? "query") !== "ec2";
    const flatParams = flattenParams(params, "", useMemberTag);
    const queryParts: string[] = [
      `Action=${encodeURIComponent(action)}`,
      `Version=${encodeURIComponent(apiVersion)}`,
    ];
    for (const [k, v] of Object.entries(flatParams)) {
      queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    const body = queryParts.join("&");

    const start = Date.now();
    try {
      // Use endpointPrefix for signing — it matches AWS's expected signing
      // service name (e.g. "elasticloadbalancing" not "elbv2")
      const signingService = endpointPrefix;

      const res = await this.fetchWithFallback(endpointPrefix, region, async (endpoint) => {
        const headers = await signRequest({
          method: "POST",
          url: endpoint,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          },
          body,
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
          region,
          service: signingService,
        });
        return fetch(endpoint, { method: "POST", headers, body });
      });

      const text = await res.text();
      const duration = Date.now() - start;

      // Parse XML response
      const data = parseXml(text);

      // Extract the result from the response wrapper
      // AWS wraps responses in <ActionResponse><ActionResult>...</ActionResult></ActionResponse>
      const responseKey = `${action}Response`;
      const resultKey = `${action}Result`;
      const unwrapped =
        (data[responseKey] as Record<string, unknown>)?.[resultKey] ??
        data[responseKey] ??
        data;

      if (!res.ok) {
        // Try to extract error info
        const errorInfo = (data as Record<string, unknown>).Error ??
          ((data as Record<string, unknown>).Response as Record<string, unknown>)?.Errors;
        return {
          success: false,
          error: `AWS ${service}:${action} returned ${res.status}`,
          data: errorInfo ?? data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data: unwrapped,
        metadata: {
          requestId: res.headers.get("x-amz-request-id") ?? undefined,
          httpStatus: res.status,
          duration,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: { duration: Date.now() - start },
      };
    }
  }

  private async callRestXmlProtocol(
    endpointPrefix: string,
    service: string,
    action: string,
    params: Record<string, unknown>,
    meta: ServiceMetadata | undefined,
    creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string },
    region: string,
  ): Promise<CloudProviderCallResult> {
    // REST-XML services (S3, CloudFront, Route53) use HTTP method + path
    // to identify the operation. For listing operations, use GET with
    // params as query string. For operations on specific resources,
    // the resource identifier goes in the path.
    const method = "GET";
    const path = "/";
    const body = "";

    // Build query string from params (if any)
    const queryParts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

    const signingService = endpointPrefix;
    const start = Date.now();
    try {
      const res = await this.fetchWithFallback(endpointPrefix, region, async (endpoint) => {
        const fullUrl = `${endpoint}${path}${queryString}`;
        const headers = await signRequest({
          method,
          url: fullUrl,
          headers: {},
          body,
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
          region,
          service: signingService,
        });
        return fetch(fullUrl, { method, headers });
      });

      const text = await res.text();
      const duration = Date.now() - start;
      const data = parseXml(text);

      if (!res.ok) {
        const errorInfo = (data as Record<string, unknown>).Error ?? data;
        return {
          success: false,
          error: `AWS ${service}:${action} returned ${res.status}`,
          data: errorInfo,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: res.headers.get("x-amz-request-id") ?? undefined,
          httpStatus: res.status,
          duration,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: { duration: Date.now() - start },
      };
    }
  }

  private async callJsonProtocol(
    endpointPrefix: string,
    service: string,
    action: string,
    params: Record<string, unknown>,
    meta: ServiceMetadata | undefined,
    creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string },
    region: string,
  ): Promise<CloudProviderCallResult> {
    const body = JSON.stringify(params);
    const jsonVersion = meta?.jsonVersion ?? "1.1";
    const targetPrefix = meta?.targetPrefix ?? "";
    const target = targetPrefix ? `${targetPrefix}.${action}` : action;

    const signingService = endpointPrefix;
    const start = Date.now();
    try {
      const res = await this.fetchWithFallback(endpointPrefix, region, async (endpoint) => {
        const headers = await signRequest({
          method: "POST",
          url: endpoint,
          headers: {
            "Content-Type": `application/x-amz-json-${jsonVersion}`,
            "X-Amz-Target": target,
          },
          body,
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
          region,
          service: signingService,
        });
        return fetch(endpoint, { method: "POST", headers, body });
      });

      const data = await res.json();
      const duration = Date.now() - start;

      if (!res.ok) {
        return {
          success: false,
          error: `AWS ${service}:${action} returned ${res.status}`,
          data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: res.headers.get("x-amz-request-id") ?? undefined,
          httpStatus: res.status,
          duration,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: { duration: Date.now() - start },
      };
    }
  }

  private async resolveMetadata(
    service: string,
    action: string,
  ): Promise<ServiceMetadata | undefined> {
    // Check cache first
    if (this.metadataCache.has(service)) {
      return this.metadataCache.get(service);
    }

    // Try to get metadata from the spec index
    if (this.specIndex.getOperation) {
      const spec = await this.specIndex.getOperation(service, action);
      if (spec?.serviceMetadata) {
        this.metadataCache.set(service, spec.serviceMetadata);
        return spec.serviceMetadata;
      }
    }

    return undefined;
  }

  private enforceAllowlist(service: string, action: string): void {
    if (
      this.config.allowedServices.length > 0 &&
      !this.config.allowedServices.includes(service)
    ) {
      throw new Error(
        `Service "${service}" is not in the allowed list: [${this.config.allowedServices.join(", ")}]`,
      );
    }

    const fullAction = `${service}:${action}`;
    if (this.config.blockedActions.includes(fullAction)) {
      throw new Error(`Action "${fullAction}" is explicitly blocked`);
    }

    if (this.config.mode === "read-only") {
      const isMutating = MUTATING_PREFIXES.some((p) => action.startsWith(p));
      if (isMutating) {
        throw new Error(
          `Action "${action}" is mutating but provider is in read-only mode`,
        );
      }
    }
  }
}
