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
import { GcpProvider } from "./providers/gcp/provider.js";
import { AlibabaProvider } from "./providers/alibaba/provider.js";
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

    // Rate limiter: simple sliding window per IP
    const rateMap = new Map<string, { count: number; resetAt: number }>();
    const rateLimit = config.http.rateLimitPerMinute;

    const httpServer = createHttpServer((req, res) => {
      const start = Date.now();
      const clientIp =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        "unknown";

      // CORS headers
      const origin = req.headers.origin ?? "*";
      const allowedOrigins = config.http.corsOrigins;
      const corsOrigin =
        allowedOrigins.includes("*") || allowedOrigins.includes(origin)
          ? origin
          : "";
      if (corsOrigin) {
        res.setHeader("Access-Control-Allow-Origin", corsOrigin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id");
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      }

      // Preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check (no auth required)
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            providers: Array.from(providers.keys()),
            uptime: process.uptime(),
          }),
        );
        return;
      }

      // API key auth (if configured)
      if (config.http.apiKey) {
        const authHeader = req.headers.authorization;
        const providedKey =
          authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : req.headers["x-api-key"] as string | undefined;

        if (providedKey !== config.http.apiKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          console.error(
            `[cloud-pilot] 401 ${req.method} ${req.url} from ${clientIp}`,
          );
          return;
        }
      }

      // Rate limiting
      const now = Date.now();
      let bucket = rateMap.get(clientIp);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + 60000 };
        rateMap.set(clientIp, bucket);
      }
      bucket.count++;
      if (bucket.count > rateLimit) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Rate limit exceeded" }));
        console.error(
          `[cloud-pilot] 429 ${req.method} ${req.url} from ${clientIp}`,
        );
        return;
      }

      // Request logging
      res.on("finish", () => {
        const duration = Date.now() - start;
        console.error(
          `[cloud-pilot] ${res.statusCode} ${req.method} ${req.url} ${duration}ms ${clientIp}`,
        );
      });

      // MCP endpoint
      if (req.url === "/mcp" || req.url === "/") {
        transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    // Clean up stale rate limit entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [ip, bucket] of rateMap) {
        if (now >= bucket.resetAt) rateMap.delete(ip);
      }
    }, 300000).unref();

    httpServer.listen(config.http.port, config.http.host, () => {
      console.error(
        `[cloud-pilot] Streamable HTTP listening on http://${config.http.host}:${config.http.port}/mcp`,
      );
      if (config.http.apiKey) {
        console.error("[cloud-pilot] API key auth: enabled");
      }
      console.error(
        `[cloud-pilot] Rate limit: ${rateLimit} req/min per IP`,
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
      case "gcp": {
        const localDir = resolve("specs/gcp");
        const specIndex = await buildDynamicIndex("gcp", localDir, config, cache, fetcher);

        providers.set(
          "gcp",
          new GcpProvider(pc, auth, specIndex, pc.subscriptionId),
        );
        providerConfigs.set("gcp", pc);
        break;
      }
      case "alibaba": {
        const localDir = resolve("specs/alibaba");
        const specIndex = await buildDynamicIndex("alibaba", localDir, config, cache, fetcher);

        providers.set("alibaba", new AlibabaProvider(pc, auth, specIndex));
        providerConfigs.set("alibaba", pc);
        break;
      }
    }
  }

  return { providers, providerConfigs };
}

async function buildDynamicIndex(
  provider: "aws" | "azure" | "gcp" | "alibaba",
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
