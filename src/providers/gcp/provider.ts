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
  search(
    query: string,
    service?: string,
  ): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
}

const MUTATING_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

export class GcpProvider implements CloudProvider {
  name = "gcp" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: SpecIndex;
  private projectId: string;

  constructor(
    config: ProviderConfig,
    auth: AuthProvider,
    specIndex: SpecIndex,
    projectId?: string,
  ) {
    this.config = config;
    this.auth = auth;
    this.specIndex = specIndex;
    this.projectId =
      projectId ?? process.env.GCP_PROJECT_ID ?? "";
  }

  async searchSpec(
    query: string,
    service?: string,
  ): Promise<OperationSpec[]> {
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

    // Action format: "METHOD https://compute.googleapis.com/compute/v1/projects/{project}/..."
    // or just a path: "GET /compute/v1/projects/{project}/zones/{zone}/instances"
    const { method, url, body } = this.parseAction(service, action, params);

    this.enforceSafetyMode(method);

    const creds = await this.auth.getCredentials("gcp" as "aws" | "azure");
    const token =
      (creds as unknown as { gcp?: { accessToken?: string } }).gcp
        ?.accessToken ??
      process.env.GCP_ACCESS_TOKEN;

    if (!token) {
      return {
        success: false,
        error:
          "GCP access token not available. Set GCP_ACCESS_TOKEN or configure auth.",
      };
    }

    const start = Date.now();
    try {
      const fetchOpts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      };

      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
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
          error: `GCP ${service}:${action} returned ${res.status}`,
          data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: { httpStatus: res.status, duration },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata: { duration: Date.now() - start },
      };
    }
  }

  private parseAction(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): { method: string; url: string; body: Record<string, unknown> | null } {
    const parts = action.match(
      /^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i,
    );
    const method = parts ? parts[1].toUpperCase() : "GET";
    let url = parts ? parts[2] : action;

    // If relative path, prepend the service base URL
    if (url.startsWith("/")) {
      url = `https://${service}.googleapis.com${url}`;
    }

    // Resolve path params
    url = url.replace(/\{project\}/g, this.projectId);
    url = url.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const val = params[key];
      return val != null ? String(val) : `{${key}}`;
    });

    const body: Record<string, unknown> = {};
    if (params.body && typeof params.body === "object") {
      Object.assign(body, params.body);
    }

    return {
      method,
      url,
      body: Object.keys(body).length > 0 ? body : null,
    };
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
    if (
      this.config.mode === "read-only" &&
      MUTATING_METHODS.includes(method)
    ) {
      throw new Error(
        `HTTP method "${method}" is mutating but provider is in read-only mode`,
      );
    }
  }
}
