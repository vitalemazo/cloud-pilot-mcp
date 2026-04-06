// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
  ServiceMetadata,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";
import type { AwsCredentialIdentity, Provider as CredentialProvider } from "@aws-sdk/types";

export interface SpecIndex {
  search(query: string, service?: string): Promise<OperationSpec[]> | OperationSpec[];
  listServices(): string[];
  getOperation?(service: string, operation: string): OperationSpec | null | Promise<OperationSpec | null>;
}

const MUTATING_PREFIXES = [
  "Create", "Delete", "Put", "Update", "Modify", "Remove",
  "Terminate", "Stop", "Start", "Reboot", "Run", "Attach",
  "Detach", "Associate", "Disassociate", "Enable", "Disable",
  "Register", "Deregister", "Tag", "Untag", "Set", "Revoke",
  "Authorize", "Grant",
];

// Static mapping from botocore service name → { serviceId, npm package suffix }.
// serviceId comes from botocore metadata.serviceId.
// Package name = @aws-sdk/client-{suffix}
// Client class = serviceId.replaceAll(' ', '').replace(/v(\d)/g, 'V$1') + 'Client'
const SERVICE_ID_MAP: Record<string, { serviceId: string; pkg: string }> = {
  ec2:              { serviceId: "EC2",                          pkg: "ec2" },
  s3:              { serviceId: "S3",                            pkg: "s3" },
  sts:             { serviceId: "STS",                           pkg: "sts" },
  iam:             { serviceId: "IAM",                           pkg: "iam" },
  rds:             { serviceId: "RDS",                           pkg: "rds" },
  lambda:          { serviceId: "Lambda",                        pkg: "lambda" },
  ecs:             { serviceId: "ECS",                           pkg: "ecs" },
  elbv2:           { serviceId: "Elastic Load Balancing v2",     pkg: "elastic-load-balancing-v2" },
  autoscaling:     { serviceId: "Auto Scaling",                  pkg: "auto-scaling" },
  cloudwatch:      { serviceId: "CloudWatch",                    pkg: "cloudwatch" },
  logs:            { serviceId: "CloudWatch Logs",               pkg: "cloudwatch-logs" },
  cloudformation:  { serviceId: "CloudFormation",                pkg: "cloudformation" },
  route53:         { serviceId: "Route 53",                      pkg: "route-53" },
  sns:             { serviceId: "SNS",                           pkg: "sns" },
  sqs:             { serviceId: "SQS",                           pkg: "sqs" },
  dynamodb:        { serviceId: "DynamoDB",                      pkg: "dynamodb" },
  secretsmanager:  { serviceId: "Secrets Manager",               pkg: "secrets-manager" },
  kms:             { serviceId: "KMS",                           pkg: "kms" },
  elasticache:     { serviceId: "ElastiCache",                   pkg: "elasticache" },
  eks:             { serviceId: "EKS",                           pkg: "eks" },
};

// Derive the Client class name from a serviceId.
// "Elastic Load Balancing v2" → "ElasticLoadBalancingV2Client"
function serviceIdToClientClass(serviceId: string): string {
  return serviceId
    .replaceAll(" ", "")
    .replace(/v(\d)/g, "V$1")
    + "Client";
}

// Cache for instantiated SDK clients (keyed by "service:region")
const clientCache = new Map<string, unknown>();

export class AwsProvider implements CloudProvider {
  name = "aws" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: SpecIndex;

  // Cache for resolved serviceId from dynamic specs
  private serviceIdCache = new Map<string, { serviceId: string; pkg: string }>();

  constructor(config: ProviderConfig, auth: AuthProvider, specIndex: SpecIndex) {
    this.config = config;
    this.auth = auth;
    this.specIndex = specIndex;
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
    this.enforceAllowlist(service, action);

    const start = Date.now();

    try {
      // Resolve the SDK package info for this service
      const info = await this.resolveServiceInfo(service, action);
      if (!info) {
        return {
          success: false,
          error: `No AWS SDK client available for service "${service}". ` +
            `Install @aws-sdk/client-${service} and add it to SERVICE_ID_MAP, ` +
            `or check that the service name is correct.`,
          metadata: { duration: Date.now() - start },
        };
      }

      // Dynamic import of the SDK client package
      const pkgName = `@aws-sdk/client-${info.pkg}`;
      let mod: Record<string, unknown>;
      try {
        mod = await import(pkgName) as Record<string, unknown>;
      } catch {
        return {
          success: false,
          error: `AWS SDK package "${pkgName}" is not installed. ` +
            `Run: npm install ${pkgName}`,
          metadata: { duration: Date.now() - start },
        };
      }

      // Get or create client
      const creds = await this.auth.getCredentials("aws");
      if (!creds.aws) {
        return { success: false, error: "No AWS credentials available" };
      }
      const region = creds.aws.region;
      const client = await this.getClient(mod, info.serviceId, region);

      // Construct the Command
      const commandName = `${action}Command`;
      const CommandClass = mod[commandName] as (new (params: unknown) => unknown) | undefined;
      if (!CommandClass) {
        return {
          success: false,
          error: `Command "${commandName}" not found in ${pkgName}. ` +
            `Available commands can be found in the AWS SDK documentation.`,
          metadata: { duration: Date.now() - start },
        };
      }

      const command = new CommandClass(params);

      // Execute
      const sendFn = (client as { send: (cmd: unknown) => Promise<unknown> }).send.bind(client);
      const result = await sendFn(command) as Record<string, unknown>;

      // Extract metadata and clean response
      const metadata = result.$metadata as { requestId?: string; httpStatusCode?: number } | undefined;
      const duration = Date.now() - start;

      // Remove SDK internal fields from response data
      const data = { ...result };
      delete data.$metadata;

      return {
        success: true,
        data,
        metadata: {
          requestId: metadata?.requestId,
          httpStatus: metadata?.httpStatusCode,
          duration,
        },
      };
    } catch (err) {
      const duration = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);

      // Extract AWS error metadata if available
      const awsErr = err as { $metadata?: { requestId?: string; httpStatusCode?: number }; name?: string; Code?: string };
      return {
        success: false,
        error: awsErr.name ? `${awsErr.name}: ${error}` : error,
        data: awsErr.Code ? { Code: awsErr.Code } : undefined,
        metadata: {
          requestId: awsErr.$metadata?.requestId,
          httpStatus: awsErr.$metadata?.httpStatusCode,
          duration,
        },
      };
    }
  }

  // Get or create a cached SDK client for a service
  private async getClient(
    mod: Record<string, unknown>,
    serviceId: string,
    region: string,
  ): Promise<unknown> {
    const cacheKey = `${serviceId}:${region}`;
    if (clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey)!;
    }

    const clientClassName = serviceIdToClientClass(serviceId);
    const ClientClass = mod[clientClassName] as (new (config: unknown) => unknown) | undefined;
    if (!ClientClass) {
      throw new Error(`Client class "${clientClassName}" not found in SDK package`);
    }

    // Bridge AuthProvider credentials to AWS SDK credential provider
    const credentialProvider: CredentialProvider<AwsCredentialIdentity> = async () => {
      const creds = await this.auth.getCredentials("aws");
      if (!creds.aws) throw new Error("No AWS credentials available");
      return {
        accessKeyId: creds.aws.accessKeyId,
        secretAccessKey: creds.aws.secretAccessKey,
        sessionToken: creds.aws.sessionToken,
        expiration: creds.expiresAt,
      };
    };

    const client = new ClientClass({
      region,
      credentials: credentialProvider,
    });

    clientCache.set(cacheKey, client);
    return client;
  }

  // Resolve service name to SDK package info, using static map first,
  // then falling back to dynamic spec resolution.
  private async resolveServiceInfo(
    service: string,
    action: string,
  ): Promise<{ serviceId: string; pkg: string } | null> {
    // Check static map first
    if (SERVICE_ID_MAP[service]) {
      return SERVICE_ID_MAP[service];
    }

    // Check dynamic cache
    if (this.serviceIdCache.has(service)) {
      return this.serviceIdCache.get(service)!;
    }

    // Try to resolve from spec index (botocore metadata has serviceId)
    if (this.specIndex.getOperation) {
      const spec = await this.specIndex.getOperation(service, action);
      if (spec?.serviceMetadata?.serviceId) {
        const serviceId = spec.serviceMetadata.serviceId;
        const pkg = serviceId.toLowerCase().replaceAll(" ", "-");
        const info = { serviceId, pkg };
        this.serviceIdCache.set(service, info);
        return info;
      }
    }

    return null;
  }

  private enforceAllowlist(service: string, action: string): void {
    if (
      this.config.allowedServices.length > 0 &&
      !this.config.allowedServices.includes(service)
    ) {
      throw new Error(
        `Service "${service}" is not in the allowed list: [${this.config.allowedServices.join(", ")}]`,
      );
    }

    const fullAction = `${service}:${action}`;
    if (this.config.blockedActions.includes(fullAction)) {
      throw new Error(`Action "${fullAction}" is explicitly blocked`);
    }

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
