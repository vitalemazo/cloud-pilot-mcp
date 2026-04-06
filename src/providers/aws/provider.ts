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

// Lightweight XML-to-object parser for AWS query/ec2 protocol responses.
// Handles flat and nested elements. Not a full XML parser — covers the
// subset returned by AWS query-style APIs.
function parseXml(xml: string): Record<string, unknown> {
  function parseNode(s: string): unknown {
    const result: Record<string, unknown> = {};
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let match: RegExpExecArray | null;
    let found = false;

    // eslint-disable-next-line no-cond-assign
    while ((match = tagRe.exec(s)) !== null) {
      found = true;
      const [, tag, inner] = match;
      const parsed = parseNode(inner);

      // If the tag already exists, convert to array
      if (result[tag] !== undefined) {
        if (!Array.isArray(result[tag])) {
          result[tag] = [result[tag]];
        }
        (result[tag] as unknown[]).push(parsed);
      } else {
        result[tag] = parsed;
      }
    }

    // If no child tags found, return as string value
    if (!found) {
      return s.trim();
    }

    // Unwrap <item> or <member> arrays (common AWS pattern)
    for (const key of Object.keys(result)) {
      const val = result[key];
      if (
        typeof val === "object" &&
        val !== null &&
        !Array.isArray(val) &&
        ("item" in (val as Record<string, unknown>) || "member" in (val as Record<string, unknown>))
      ) {
        const items = (val as Record<string, unknown>).item ?? (val as Record<string, unknown>).member;
        result[key] = Array.isArray(items) ? items : [items];
      }
    }

    return result;
  }

  // Strip XML declaration and find the root element
  const stripped = xml.replace(/<\?xml[^?]*\?>\s*/, "");
  const rootMatch = stripped.match(/<(\w+)[\s>]/);
  if (!rootMatch) return {};

  const parsed = parseNode(stripped);
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

// Flatten params into query string key=value pairs for AWS query protocol.
// Handles nested objects and arrays using the dot-notation AWS expects.
function flattenParams(
  params: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPrefix = `${fullKey}.${i + 1}`;
        if (typeof value[i] === "object" && value[i] !== null) {
          Object.assign(result, flattenParams(value[i] as Record<string, unknown>, itemPrefix));
        } else {
          result[itemPrefix] = String(value[i]);
        }
      }
    } else if (typeof value === "object") {
      Object.assign(result, flattenParams(value as Record<string, unknown>, fullKey));
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
    const regionalEndpoint = `https://${endpointPrefix}.${region}.amazonaws.com`;
    const endpoint = this.globalEndpointServices.has(endpointPrefix)
      ? `https://${endpointPrefix}.amazonaws.com`
      : regionalEndpoint;

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

    // Build query-string body
    const flatParams = flattenParams(params);
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
      const res = await this.fetchWithFallback(endpointPrefix, region, (endpoint) => {
        const headers = signRequest({
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
          service,
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

    const start = Date.now();
    try {
      const res = await this.fetchWithFallback(endpointPrefix, region, (endpoint) => {
        const fullUrl = `${endpoint}${path}${queryString}`;
        const headers = signRequest({
          method,
          url: fullUrl,
          headers: {},
          body,
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
          region,
          service,
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

    const start = Date.now();
    try {
      const res = await this.fetchWithFallback(endpointPrefix, region, (endpoint) => {
        const headers = signRequest({
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
          service,
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
