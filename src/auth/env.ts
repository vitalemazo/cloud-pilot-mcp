// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { AuthProvider, CloudCredentials, CloudProviderType } from "../interfaces/auth.js";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { DefaultAzureCredential } from "@azure/identity";
import { GoogleAuth } from "google-auth-library";
import { DefaultCredentialsProvider } from "@alicloud/credentials";

/**
 * Default auth provider that auto-discovers credentials from all available sources:
 *
 * AWS:     env vars → ~/.aws/credentials → ~/.aws/config (SSO/profiles) → IMDS/ECS
 * Azure:   env vars → az CLI → managed identity → VS Code / PowerShell
 * GCP:     env vars → gcloud CLI (~/.config/gcloud) → metadata server
 * Alibaba: env vars → ~/.alibabacloud/credentials → ~/.aliyun/config.json → ECS RAM role
 */
export class EnvAuthProvider implements AuthProvider {
  name = "env";

  private awsProvider = fromNodeProviderChain();
  private azureCredential = new DefaultAzureCredential();
  private gcpAuth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  private alibabaProvider = DefaultCredentialsProvider.builder().build();

  async getCredentials(provider: CloudProviderType): Promise<CloudCredentials> {
    switch (provider) {
      case "aws":
        return this.getAwsCredentials();
      case "azure":
        return this.getAzureCredentials();
      case "gcp":
        return this.getGcpCredentials();
      case "alibaba":
        return this.getAlibabaCredentials();
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private async getAwsCredentials(): Promise<CloudCredentials> {
    try {
      const creds = await this.awsProvider();
      return {
        provider: "aws",
        aws: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
          region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
        },
        expiresAt: creds.expiration,
      };
    } catch (err) {
      throw new Error(
        `AWS credentials not found. Ensure one of: ` +
        `AWS CLI configured (aws configure / aws sso login), ` +
        `env vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), ` +
        `or instance profile attached. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async getAzureCredentials(): Promise<CloudCredentials> {
    try {
      const token = await this.azureCredential.getToken(
        "https://management.azure.com/.default",
      );
      return {
        provider: "azure",
        azure: {
          tenantId: process.env.AZURE_TENANT_ID ?? "",
          clientId: process.env.AZURE_CLIENT_ID ?? "",
          accessToken: token.token,
          subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
        },
        expiresAt: new Date(token.expiresOnTimestamp),
      };
    } catch (err) {
      throw new Error(
        `Azure credentials not found. Ensure one of: ` +
        `Azure CLI logged in (az login), ` +
        `env vars (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET), ` +
        `or managed identity configured. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async getGcpCredentials(): Promise<CloudCredentials> {
    try {
      const client = await this.gcpAuth.getClient();
      const tokenResponse = await client.getAccessToken();
      const projectId = await this.gcpAuth.getProjectId().catch(() => undefined);

      if (!tokenResponse.token) {
        throw new Error("No access token returned");
      }

      return {
        provider: "gcp",
        gcp: {
          accessToken: tokenResponse.token,
          projectId: projectId ?? process.env.GCP_PROJECT_ID,
        },
      };
    } catch (err) {
      throw new Error(
        `GCP credentials not found. Ensure one of: ` +
        `gcloud CLI logged in (gcloud auth application-default login), ` +
        `env var GOOGLE_APPLICATION_CREDENTIALS pointing to a service account key, ` +
        `or metadata server available. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async getAlibabaCredentials(): Promise<CloudCredentials> {
    try {
      const creds = await this.alibabaProvider.getCredentials();

      if (!creds.accessKeyId || !creds.accessKeySecret) {
        throw new Error("No access key returned");
      }

      return {
        provider: "alibaba",
        alibaba: {
          accessKeyId: creds.accessKeyId,
          accessKeySecret: creds.accessKeySecret,
          securityToken: creds.securityToken || undefined,
          region: process.env.ALIBABA_CLOUD_REGION ?? process.env.ALIBABA_REGION ?? "cn-hangzhou",
        },
      };
    } catch (err) {
      throw new Error(
        `Alibaba Cloud credentials not found. Ensure one of: ` +
        `aliyun CLI configured (aliyun configure), ` +
        `env vars (ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET), ` +
        `credentials file (~/.alibabacloud/credentials), ` +
        `or ECS RAM role attached. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  isExpired(creds: CloudCredentials): boolean {
    if (!creds.expiresAt) return false;
    // Refresh 5 minutes before actual expiration
    const buffer = 5 * 60 * 1000;
    return Date.now() >= creds.expiresAt.getTime() - buffer;
  }
}
