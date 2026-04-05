// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudProvider } from "./interfaces/cloud-provider.js";
import type { AuditLogger } from "./interfaces/audit.js";
import type { Config } from "./config.js";
import { handleSearch } from "./tools/search.js";
import { handleExecute } from "./tools/execute.js";

interface ServerDeps {
  providers: Map<string, CloudProvider>;
  providerConfigs: Map<string, Config["providers"][number]>;
  audit: AuditLogger;
  config: Config;
}

export function createServer(deps: ServerDeps): McpServer {
  const providerNames = Array.from(deps.providers.keys());
  const providerEnum = providerNames.length > 0 ? providerNames : ["aws"];

  const server = new McpServer({
    name: "cloud-pilot",
    version: "0.1.0",
  });

  server.tool(
    "search",
    "Search cloud provider API specifications to discover available operations, their parameters, and response schemas",
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
    "Execute JavaScript code in a sandboxed environment with access to cloud APIs via sdk.request({ service, action, params })",
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

  return server;
}
