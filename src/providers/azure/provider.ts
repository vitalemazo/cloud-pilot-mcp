// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";

export interface SpecIndex {
  search(query: string, service?: string): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
}

const MUTATING_METHODS = ["PUT", "POST", "DELETE", "PATCH"];

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

    const creds = await this.auth.getCredentials("azure");
    if (!creds.azure?.accessToken) {
      return {
        success: false,
        error: "Azure access token not available. Run: az login",
      };
    }

    const token = creds.azure.accessToken;
    if (!this.subscriptionId && creds.azure.subscriptionId) {
      this.subscriptionId = creds.azure.subscriptionId;
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
      const fetchOpts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      };

      if (body && ["PUT", "POST", "PATCH"].includes(method)) {
        fetchOpts.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);
      const data = res.headers.get("content-type")?.includes("json")
        ? await res.json()
        : await res.text();
      const duration = Date.now() - start;

      if (!res.ok) {
        return {
          success: false,
          error: `Azure ${service}:${action} returned ${res.status}`,
          data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: res.headers.get("x-ms-request-id") ?? undefined,
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
