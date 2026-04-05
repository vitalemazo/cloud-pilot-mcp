// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { AuthProvider, CloudCredentials, CloudProviderType } from "../interfaces/auth.js";

interface AzureADConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class AzureADAuthProvider implements AuthProvider {
  name = "azure-ad";
  private config: AzureADConfig;
  private cachedToken: { token: string; expiresAt: Date } | null = null;

  constructor(config: AzureADConfig) {
    this.config = config;
  }

  async getCredentials(provider: CloudProviderType): Promise<CloudCredentials> {
    if (provider !== "azure") {
      throw new Error("AzureADAuthProvider only supports Azure credentials");
    }

    const token = await this.getToken();

    return {
      provider: "azure",
      azure: {
        tenantId: this.config.tenantId,
        clientId: this.config.clientId,
        accessToken: token.token,
      },
      expiresAt: token.expiresAt,
    };
  }

  isExpired(creds: CloudCredentials): boolean {
    if (!creds.expiresAt) return false;
    // Refresh 5 minutes before expiry
    const buffer = 5 * 60 * 1000;
    return new Date().getTime() >= creds.expiresAt.getTime() - buffer;
  }

  async refresh(_creds: CloudCredentials): Promise<CloudCredentials> {
    this.cachedToken = null;
    return this.getCredentials("azure");
  }

  private async getToken(): Promise<{ token: string; expiresAt: Date }> {
    if (this.cachedToken && new Date() < this.cachedToken.expiresAt) {
      return this.cachedToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: "https://management.azure.com/.default",
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Azure AD token request failed: ${res.status} ${res.statusText} — ${errBody}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      token: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };

    return this.cachedToken;
  }
}
