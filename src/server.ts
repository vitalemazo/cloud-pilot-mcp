// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudProvider } from "./interfaces/cloud-provider.js";
import type { AuditLogger } from "./interfaces/audit.js";
import type { Config } from "./config.js";
import { handleSearch } from "./tools/search.js";
import { handleExecute } from "./tools/execute.js";
import { buildInstructions, registerPersonaResources, registerPersonaPrompts } from "./persona/index.js";

interface ServerDeps {
  providers: Map<string, CloudProvider>;
  providerConfigs: Map<string, Config["providers"][number]>;
  audit: AuditLogger;
  config: Config;
}

export function createServer(deps: ServerDeps): McpServer {
  const providerNames = Array.from(deps.providers.keys());
  const providerEnum = providerNames.length > 0 ? providerNames : ["aws"];

  // Build persona instructions
  let instructions: string | undefined;
  if (deps.config.persona.enabled) {
    instructions = deps.config.persona.instructionsOverride
      ?? buildInstructions(providerNames, deps.providerConfigs);
    if (deps.config.persona.additionalGuidance) {
      instructions += `\n\n## Additional Guidance\n\n${deps.config.persona.additionalGuidance}`;
    }
  }

  const server = new McpServer(
    { name: "cloud-pilot", version: "0.1.0" },
    instructions ? { instructions } : undefined,
  );

  server.tool(
    "search",
    "Search cloud provider API specifications to discover available operations, their parameters, and response schemas. " +
      "As a Senior Cloud Platform Engineer, always search before executing to understand the full API surface. " +
      "Use specific service scopes when possible to get more relevant results. " +
      "Consider searching for related operations (security, monitoring, IAM) alongside your primary operation.",
    {
      provider: z.enum(providerEnum as [string, ...string[]]).describe("Cloud provider to search"),
      query: z
        .string()
        .describe("Search query, e.g. 'list EC2 instances' or 'S3 bucket policy'"),
      service: z
        .string()
        .optional()
        .describe("Specific service to scope the search, e.g. 'ec2', 's3'"),
    },
    async (args) => handleSearch(args, deps.providers, deps.audit),
  );

  server.tool(
    "execute",
    "Execute JavaScript code in a sandboxed environment with access to cloud APIs via sdk.request({ service, action, params }). " +
      "Use console.log() for output. Follow engineering best practices: verify current state before modifying, " +
      "IMPORTANT: You MUST use dryRun=true first for ALL mutating operations (create, update, delete). " +
      "The server enforces this — mutating calls without a prior dry-run will be rejected. " +
      "Dry-run validates against the cloud provider (AWS EC2 uses native DryRun), shows impact summaries, " +
      "and tracks session resources for rollback planning. " +
      "Handle errors gracefully and log what you intend to do.",
    {
      provider: z.enum(providerEnum as [string, ...string[]]).describe("Cloud provider to use"),
      code: z
        .string()
        .describe(
          "JavaScript code to execute. Use sdk.request({ service, action, params }) to call cloud APIs. Use console.log() for output.",
        ),
      dryRun: z
        .boolean()
        .default(false)
        .describe("If true, validates and logs the request without executing it"),
    },
    async (args) =>
      handleExecute(args, deps.providers, deps.providerConfigs, deps.audit, deps.config),
  );

  // Register persona resources and prompts
  if (deps.config.persona.enabled && deps.config.persona.enableResources) {
    registerPersonaResources(server, deps.providers, deps.providerConfigs);
  }

  if (deps.config.persona.enabled && deps.config.persona.enablePrompts) {
    registerPersonaPrompts(server, providerNames);
  }

  return server;
}
