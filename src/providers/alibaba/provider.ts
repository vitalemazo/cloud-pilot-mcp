// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";
import { signAlibabaRequest } from "./signer.js";

export interface SpecIndex {
  search(
    query: string,
    service?: string,
  ): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
}

const MUTATING_PREFIXES = [
  "Create", "Delete", "Modify", "Remove", "Stop", "Start",
  "Reboot", "Run", "Attach", "Detach", "Release", "Allocate",
  "Associate", "Disassociate", "Enable", "Disable", "Tag", "Untag",
];

export class AlibabaProvider implements CloudProvider {
  name = "alibaba" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: SpecIndex;

  constructor(
    config: ProviderConfig,
    auth: AuthProvider,
    specIndex: SpecIndex,
  ) {
    this.config = config;
    this.auth = auth;
    this.specIndex = specIndex;
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
    this.enforceSafetyMode(action);

    const creds = await this.auth.getCredentials("alibaba");
    if (!creds.alibaba?.accessKeyId || !creds.alibaba?.accessKeySecret) {
      return {
        success: false,
        error:
          "Alibaba Cloud credentials not available. Run: aliyun configure",
      };
    }
    const { accessKeyId, accessKeySecret, securityToken } = creds.alibaba;
    const region = this.config.region ?? creds.alibaba.region ?? "cn-hangzhou";

    // Alibaba RPC-style: POST to endpoint with action in header, params as query string
    const endpoint = `https://${service.toLowerCase()}.${region}.aliyuncs.com`;
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) queryParams.set(key, String(value));
    }
    const url = queryParams.toString()
      ? `${endpoint}/?${queryParams.toString()}`
      : `${endpoint}/`;

    const reqHeaders: Record<string, string> = {
      "x-acs-action": action,
      "x-acs-version": params._version as string ?? "2014-05-26",
      "content-type": "application/json",
    };
    if (securityToken) {
      reqHeaders["x-acs-security-token"] = securityToken;
    }

    const headers = signAlibabaRequest({
      method: "POST",
      url,
      headers: reqHeaders,
      body: "",
      accessKeyId,
      accessKeySecret,
    });

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
      });

      const data = res.headers.get("content-type")?.includes("json")
        ? await res.json()
        : await res.text();
      const duration = Date.now() - start;

      if (!res.ok) {
        return {
          success: false,
          error: `Alibaba ${service}:${action} returned ${res.status}`,
          data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: res.headers.get("x-acs-request-id") ?? undefined,
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

  private enforceSafetyMode(action: string): void {
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
