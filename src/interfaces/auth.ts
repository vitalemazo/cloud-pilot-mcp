// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type CloudProviderType = "aws" | "azure" | "gcp" | "alibaba";

export interface CloudCredentials {
  provider: CloudProviderType;
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
  };
  azure?: {
    tenantId: string;
    clientId: string;
    clientSecret?: string;
    accessToken?: string;
    subscriptionId?: string;
  };
  gcp?: {
    accessToken: string;
    projectId?: string;
  };
  alibaba?: {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken?: string;
    region: string;
  };
  expiresAt?: Date;
}

export interface AuthProvider {
  name: string;
  getCredentials(provider: CloudProviderType): Promise<CloudCredentials>;
  isExpired(creds: CloudCredentials): boolean;
  refresh?(creds: CloudCredentials): Promise<CloudCredentials>;
}
