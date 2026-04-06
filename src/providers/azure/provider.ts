// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";
import {
  createPipelineFromOptions,
  createPipelineRequest,
  createDefaultHttpClient,
  bearerTokenAuthenticationPolicy,
} from "@azure/core-rest-pipeline";
import type { Pipeline, HttpClient } from "@azure/core-rest-pipeline";
import { DefaultAzureCredential } from "@azure/identity";

export interface SpecIndex {
  search(query: string, service?: string): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
}

const MUTATING_METHODS = ["PUT", "POST", "DELETE", "PATCH"];

// Default API versions per service. Used when the action URL doesn't include
// an explicit api-version query param.
const AZURE_API_VERSIONS: Record<string, string> = {
  compute: "2024-07-01",
  storage: "2023-05-01",
  network: "2024-03-01",
  sql: "2023-08-01",
  web: "2024-04-01",
  keyvault: "2023-07-01",
  monitor: "2024-02-01",
  containerservice: "2024-09-01",
  resources: "2024-07-01",
};

export class AzureProvider implements CloudProvider {
  name = "azure" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: SpecIndex;
  private subscriptionId: string;
  private pipeline: Pipeline;
  private httpClient: HttpClient;

  constructor(
    config: ProviderConfig,
    auth: AuthProvider,
    specIndex: SpecIndex,
    subscriptionId?: string,
  ) {
    this.config = config;
    this.auth = auth;
    this.specIndex = specIndex;
    this.subscriptionId =
      subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID ?? "";

    // Build Azure REST pipeline with automatic auth, retry, and throttling.
    // bearerTokenAuthenticationPolicy handles token acquisition, caching,
    // refresh, and Continuous Access Evaluation (CAE) challenges.
    this.pipeline = createPipelineFromOptions({});
    this.pipeline.addPolicy(
      bearerTokenAuthenticationPolicy({
        credential: new DefaultAzureCredential(),
        scopes: ["https://management.azure.com/.default"],
      }),
      { phase: "Sign" },
    );
    this.httpClient = createDefaultHttpClient();
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
    this.enforceAllowlist(service);

    const { method, path, body, queryParams } = parseAzureAction(action, params);

    this.enforceSafetyMode(method);

    // Resolve subscription ID from auth if not set
    if (!this.subscriptionId) {
      const creds = await this.auth.getCredentials("azure");
      if (creds.azure?.subscriptionId) {
        this.subscriptionId = creds.azure.subscriptionId;
      }
    }

    const apiVersion =
      (queryParams.get("api-version") as string) ??
      AZURE_API_VERSIONS[service] ??
      "2024-07-01";
    queryParams.set("api-version", apiVersion);

    const resolvedPath = path
      .replace("{subscriptionId}", this.subscriptionId)
      .replace(/\{([^}]+)\}/g, (_match, key: string) => {
        const val = params[key];
        return val != null ? String(val) : `{${key}}`;
      });

    const qs = queryParams.toString();
    const url = `https://management.azure.com${resolvedPath}${qs ? `?${qs}` : ""}`;

    const start = Date.now();
    try {
      const request = createPipelineRequest({ url, method: method as "GET" | "PUT" | "POST" | "DELETE" | "PATCH" | "HEAD" });
      request.headers.set("Content-Type", "application/json");

      if (body && ["PUT", "POST", "PATCH"].includes(method)) {
        request.body = JSON.stringify(body);
      }

      // Pipeline handles auth, retry on 429/throttling, and transient errors
      const response = await this.pipeline.sendRequest(this.httpClient, request);
      const duration = Date.now() - start;

      const data = response.headers.get("content-type")?.includes("json") && response.bodyAsText
        ? JSON.parse(response.bodyAsText)
        : response.bodyAsText ?? "";

      if (response.status >= 400) {
        return {
          success: false,
          error: `Azure ${service}:${action} returned ${response.status}`,
          data,
          metadata: {
            requestId: response.headers.get("x-ms-request-id") ?? undefined,
            httpStatus: response.status,
            duration,
          },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: response.headers.get("x-ms-request-id") ?? undefined,
          httpStatus: response.status,
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

  private enforceAllowlist(service: string): void {
    if (
      this.config.allowedServices.length > 0 &&
      !this.config.allowedServices.includes(service)
    ) {
      throw new Error(
        `Service "${service}" is not in the allowed list: [${this.config.allowedServices.join(", ")}]`,
      );
    }
  }

  private enforceSafetyMode(method: string): void {
    if (this.config.mode === "read-only" && MUTATING_METHODS.includes(method)) {
      throw new Error(
        `HTTP method "${method}" is mutating but provider is in read-only mode`,
      );
    }
  }
}

function parseAzureAction(
  action: string,
  params: Record<string, unknown>,
): {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  queryParams: URLSearchParams;
} {
  // Action format: "METHOD /path" e.g. "GET /subscriptions/{subscriptionId}/providers/Microsoft.Compute/virtualMachines"
  // Or just a path (defaults to GET)
  const parts = action.match(/^(GET|PUT|POST|DELETE|PATCH|HEAD)\s+(.+)$/i);
  const method = parts ? parts[1].toUpperCase() : "GET";
  const path = parts ? parts[2] : action;

  const queryParams = new URLSearchParams();
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === "body" && typeof value === "object" && value !== null) {
      Object.assign(body, value);
    } else if (key.startsWith("$query.")) {
      queryParams.set(key.slice(7), String(value));
    }
    // Path params are resolved in the call() method
  }

  return {
    method,
    path,
    body: Object.keys(body).length > 0 ? body : null,
    queryParams,
  };
}
