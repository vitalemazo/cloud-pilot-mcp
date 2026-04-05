import type { AuthProvider, CloudCredentials } from "../interfaces/auth.js";

export class EnvAuthProvider implements AuthProvider {
  name = "env";

  async getCredentials(provider: "aws" | "azure"): Promise<CloudCredentials> {
    if (provider === "aws") {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const region = process.env.AWS_REGION ?? "us-east-1";

      if (!accessKeyId || !secretAccessKey) {
        throw new Error(
          "AWS credentials not found in environment. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
        );
      }

      return {
        provider: "aws",
        aws: {
          accessKeyId,
          secretAccessKey,
          sessionToken: process.env.AWS_SESSION_TOKEN,
          region,
        },
      };
    }

    if (provider === "azure") {
      const tenantId = process.env.AZURE_TENANT_ID;
      const clientId = process.env.AZURE_CLIENT_ID;
      const clientSecret = process.env.AZURE_CLIENT_SECRET;

      if (!tenantId || !clientId) {
        throw new Error(
          "Azure credentials not found in environment. Set AZURE_TENANT_ID and AZURE_CLIENT_ID.",
        );
      }

      return {
        provider: "azure",
        azure: {
          tenantId,
          clientId,
          clientSecret,
        },
      };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  isExpired(_creds: CloudCredentials): boolean {
    if (!_creds.expiresAt) return false;
    return new Date() >= _creds.expiresAt;
  }
}
