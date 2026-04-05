#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { EnvAuthProvider } from "./auth/env.js";
import { VaultAuthProvider } from "./auth/vault.js";
import { AzureADAuthProvider } from "./auth/azure-ad.js";
import { FileAuditLogger } from "./audit/file.js";
import { AwsProvider } from "./providers/aws/provider.js";
import { AzureProvider } from "./providers/azure/provider.js";
import type { AuthProvider } from "./interfaces/auth.js";
import type { AuditLogger } from "./interfaces/audit.js";
import type { CloudProvider } from "./interfaces/cloud-provider.js";
import type { Config } from "./config.js";
import { resolve } from "node:path";

async function main() {
  const config = loadConfig();

  const auth = buildAuth(config);
  const audit = buildAudit(config);
  const { providers, providerConfigs } = buildProviders(config, auth);

  const server = createServer({ providers, providerConfigs, audit, config });

  if (config.transport === "http") {
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    // Streamable HTTP transport will be wired here once we add the HTTP layer
    console.error(
      `[cloud-pilot] Streamable HTTP transport on ${config.http.host}:${config.http.port} — not yet implemented, falling back to stdio`,
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  console.error(`[cloud-pilot] Server started (transport: ${config.transport})`);
  console.error(
    `[cloud-pilot] Providers: ${Array.from(providers.keys()).join(", ") || "none"}`,
  );
}

function buildAuth(config: Config): AuthProvider {
  switch (config.auth.type) {
    case "vault": {
      const vc = config.auth.vault;
      if (!vc?.address || !vc.roleId || !vc.secretId) {
        throw new Error(
          "Vault auth requires address, roleId, and secretId. Set in config or VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID env vars.",
        );
      }
      return new VaultAuthProvider({
        address: vc.address,
        roleId: vc.roleId,
        secretId: vc.secretId,
        secretPath: vc.secretPath,
      });
    }
    case "azure-ad": {
      const ac = config.auth.azureAd;
      if (!ac?.tenantId || !ac.clientId || !ac.clientSecret) {
        throw new Error(
          "Azure AD auth requires tenantId, clientId, and clientSecret. Set in config or AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET env vars.",
        );
      }
      return new AzureADAuthProvider({
        tenantId: ac.tenantId,
        clientId: ac.clientId,
        clientSecret: ac.clientSecret,
      });
    }
    case "env":
      return new EnvAuthProvider();
    default:
      throw new Error(`Auth type "${config.auth.type}" is not yet implemented`);
  }
}

function buildAudit(config: Config): AuditLogger {
  switch (config.audit.type) {
    case "file":
      return new FileAuditLogger(resolve(config.audit.path));
    case "console":
      return {
        name: "console",
        async log(entry) {
          console.error(`[audit] ${JSON.stringify(entry)}`);
        },
      };
    default:
      throw new Error(`Audit type "${config.audit.type}" is not yet implemented`);
  }
}

function buildProviders(
  config: Config,
  auth: AuthProvider,
): {
  providers: Map<string, CloudProvider>;
  providerConfigs: Map<string, Config["providers"][number]>;
} {
  const providers = new Map<string, CloudProvider>();
  const providerConfigs = new Map<string, Config["providers"][number]>();

  for (const pc of config.providers) {
    switch (pc.type) {
      case "aws":
        providers.set("aws", new AwsProvider(pc, auth, resolve("specs/aws")));
        providerConfigs.set("aws", pc);
        break;
      case "azure":
        providers.set(
          "azure",
          new AzureProvider(pc, auth, resolve("specs/azure"), pc.subscriptionId),
        );
        providerConfigs.set("azure", pc);
        break;
    }
  }

  return { providers, providerConfigs };
}

main().catch((err) => {
  console.error("[cloud-pilot] Fatal error:", err);
  process.exit(1);
});
