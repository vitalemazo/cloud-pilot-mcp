// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { AuthProvider, CloudCredentials, CloudProviderType } from "../interfaces/auth.js";

interface VaultConfig {
  address: string;
  roleId: string;
  secretId: string;
  secretPath: string;
}

export class VaultAuthProvider implements AuthProvider {
  name = "vault";
  private config: VaultConfig;
  private token: string | null = null;

  constructor(config: VaultConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<string> {
    const res = await fetch(`${this.config.address}/v1/auth/approle/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role_id: this.config.roleId,
        secret_id: this.config.secretId,
      }),
    });

    if (!res.ok) {
      throw new Error(`Vault AppRole login failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { auth: { client_token: string } };
    this.token = body.auth.client_token;
    return this.token;
  }

  private async readSecret(path: string): Promise<Record<string, string>> {
    const token = this.token ?? (await this.authenticate());

    const res = await fetch(`${this.config.address}/v1/${path}`, {
      headers: { "X-Vault-Token": token },
    });

    if (!res.ok) {
      throw new Error(`Vault read ${path} failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { data: { data: Record<string, string> } };
    return body.data.data;
  }

  async getCredentials(provider: CloudProviderType): Promise<CloudCredentials> {
    const secretPath = `${this.config.secretPath}/${provider}`;
    const data = await this.readSecret(secretPath);

    switch (provider) {
      case "aws":
        return {
          provider: "aws",
          aws: {
            accessKeyId: data.access_key_id,
            secretAccessKey: data.secret_access_key,
            sessionToken: data.session_token,
            region: data.region ?? "us-east-1",
          },
        };
      case "azure":
        return {
          provider: "azure",
          azure: {
            tenantId: data.tenant_id,
            clientId: data.client_id,
            clientSecret: data.client_secret,
            subscriptionId: data.subscription_id,
          },
        };
      case "gcp":
        return {
          provider: "gcp",
          gcp: {
            accessToken: data.access_token,
            projectId: data.project_id,
          },
        };
      case "alibaba":
        return {
          provider: "alibaba",
          alibaba: {
            accessKeyId: data.access_key_id,
            accessKeySecret: data.access_key_secret,
            securityToken: data.security_token,
            region: data.region ?? "cn-hangzhou",
          },
        };
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  isExpired(creds: CloudCredentials): boolean {
    if (!creds.expiresAt) return false;
    return new Date() >= creds.expiresAt;
  }

  async refresh(creds: CloudCredentials): Promise<CloudCredentials> {
    return this.getCredentials(creds.provider);
  }
}
