import type {
  CloudProvider,
  CloudProviderCallResult,
  OperationSpec,
} from "../../interfaces/cloud-provider.js";
import type { AuthProvider } from "../../interfaces/auth.js";
import type { ProviderConfig } from "../../config.js";
import { AwsSpecIndex } from "./specs.js";
import { signRequest } from "./signer.js";

const MUTATING_PREFIXES = [
  "Create", "Delete", "Put", "Update", "Modify", "Remove",
  "Terminate", "Stop", "Start", "Reboot", "Run", "Attach",
  "Detach", "Associate", "Disassociate", "Enable", "Disable",
  "Register", "Deregister", "Tag", "Untag", "Set", "Revoke",
  "Authorize", "Grant",
];

export class AwsProvider implements CloudProvider {
  name = "aws" as const;
  private config: ProviderConfig;
  private auth: AuthProvider;
  private specIndex: AwsSpecIndex;

  constructor(config: ProviderConfig, auth: AuthProvider, specsDir: string) {
    this.config = config;
    this.auth = auth;
    this.specIndex = new AwsSpecIndex(specsDir);
    this.specIndex.loadAll();
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

    const creds = await this.auth.getCredentials("aws");
    if (!creds.aws) {
      return { success: false, error: "No AWS credentials available" };
    }

    const endpoint = `https://${service}.${creds.aws.region}.amazonaws.com`;
    const body = JSON.stringify(params);

    const headers = signRequest({
      method: "POST",
      url: endpoint,
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": action,
      },
      body,
      accessKeyId: creds.aws.accessKeyId,
      secretAccessKey: creds.aws.secretAccessKey,
      sessionToken: creds.aws.sessionToken,
      region: creds.aws.region,
      service,
    });

    const start = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
      });

      const data = await res.json();
      const duration = Date.now() - start;

      if (!res.ok) {
        return {
          success: false,
          error: `AWS ${service}:${action} returned ${res.status}`,
          data,
          metadata: { httpStatus: res.status, duration },
        };
      }

      return {
        success: true,
        data,
        metadata: {
          requestId: res.headers.get("x-amz-request-id") ?? undefined,
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
