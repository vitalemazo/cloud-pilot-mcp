// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface CloudCredentials {
  provider: "aws" | "azure";
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
  };
  expiresAt?: Date;
}

export interface AuthProvider {
  name: string;
  getCredentials(provider: "aws" | "azure"): Promise<CloudCredentials>;
  isExpired(creds: CloudCredentials): boolean;
  refresh?(creds: CloudCredentials): Promise<CloudCredentials>;
}
