#!/usr/bin/env node

import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { EnvAuthProvider } from "./auth/env.js";
import { VaultAuthProvider } from "./auth/vault.js";
import { AzureADAuthProvider } from "./auth/azure-ad.js";
import { FileAuditLogger } from "./audit/file.js";
import { AwsProvider } from "./providers/aws/provider.js";
import { AzureProvider } from "./providers/azure/provider.js";
import { AwsSpecIndex } from "./providers/aws/specs.js";
import { AzureSpecIndex } from "./providers/azure/specs.js";
import { DynamicSpecIndex } from "./specs/dynamic-spec-index.js";
import { SpecCache } from "./specs/spec-cache.js";
import { SpecFetcher } from "./specs/spec-fetcher.js";
import type { AuthProvider } from "./interfaces/auth.js";
import type { AuditLogger } from "./interfaces/audit.js";
import type { CloudProvider } from "./interfaces/cloud-provider.js";
import type { Config } from "./config.js";
import { resolve } from "node:path";

async function main() {
  const config = loadConfig();

  const auth = buildAuth(config);
  const audit = buildAudit(config);
  const { providers, providerConfigs } = await buildProviders(config, auth);

  const server = createServer({ providers, providerConfigs, audit, config });

  if (config.transport === "http") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);

    const httpServer = createHttpServer((req, res) => {
      // Health check endpoint
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", providers: Array.from(providers.keys()) }));
        return;
      }

      // MCP endpoint
      if (req.url === "/mcp" || req.url === "/") {
        transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(config.http.port, config.http.host, () => {
      console.error(
        `[cloud-pilot] Streamable HTTP listening on http://${config.http.host}:${config.http.port}/mcp`,
      );
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  console.error(`[cloud-pilot] Server started (transport: ${config.transport})`);
  console.error(
    `[cloud-pilot] Providers: ${Array.from(providers.keys()).join(", ") || "none"}`,
  );
  console.error(
    `[cloud-pilot] Dynamic specs: ${config.specs.dynamic ? "enabled" : "disabled"}`,
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

async function buildProviders(
  config: Config,
  auth: AuthProvider,
): Promise<{
  providers: Map<string, CloudProvider>;
  providerConfigs: Map<string, Config["providers"][number]>;
}> {
  const providers = new Map<string, CloudProvider>();
  const providerConfigs = new Map<string, Config["providers"][number]>();

  // Shared infrastructure for dynamic spec loading
  const cache = new SpecCache(config.specs.cacheDir);
  const fetcher = new SpecFetcher();

  for (const pc of config.providers) {
    switch (pc.type) {
      case "aws": {
        const localDir = resolve("specs/aws");
        const specIndex = config.specs.dynamic
          ? await buildDynamicIndex("aws", localDir, config, cache, fetcher)
          : buildStaticAwsIndex(localDir);

        providers.set("aws", new AwsProvider(pc, auth, specIndex));
        providerConfigs.set("aws", pc);
        break;
      }
      case "azure": {
        const localDir = resolve("specs/azure");
        const specIndex = config.specs.dynamic
          ? await buildDynamicIndex("azure", localDir, config, cache, fetcher)
          : buildStaticAzureIndex(localDir);

        providers.set(
          "azure",
          new AzureProvider(pc, auth, specIndex, pc.subscriptionId),
        );
        providerConfigs.set("azure", pc);
        break;
      }
    }
  }

  return { providers, providerConfigs };
}

async function buildDynamicIndex(
  provider: "aws" | "azure",
  localSpecsDir: string,
  config: Config,
  cache: SpecCache,
  fetcher: SpecFetcher,
): Promise<DynamicSpecIndex> {
  const bundledPath = resolve(`data/${provider}-catalog.json`);
  const index = new DynamicSpecIndex({
    provider,
    config: config.specs,
    cache,
    fetcher,
    localSpecsDir,
    bundledCatalogPath: bundledPath,
  });
  await index.initialize();
  return index;
}

function buildStaticAwsIndex(specsDir: string) {
  const index = new AwsSpecIndex(specsDir);
  index.loadAll();
  return index;
}

function buildStaticAzureIndex(specsDir: string) {
  const index = new AzureSpecIndex(specsDir);
  index.loadAll();
  return index;
}

main().catch((err) => {
  console.error("[cloud-pilot] Fatal error:", err);
  process.exit(1);
});
