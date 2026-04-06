// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CloudProvider } from "../interfaces/cloud-provider.js";
import type { AuditLogger } from "../interfaces/audit.js";

interface SearchArgs {
  provider: string;
  query: string;
  service?: string;
}

export async function handleSearch(
  args: SearchArgs,
  providers: Map<string, CloudProvider>,
  audit: AuditLogger,
) {
  const start = Date.now();
  const cloudProvider = providers.get(args.provider);

  if (!cloudProvider) {
    const available = Array.from(providers.keys());
    const setupHints: Record<string, string> = {
      aws: "Install AWS CLI and run: aws configure (or aws sso login)",
      azure: "Install Azure CLI and run: az login",
      gcp: "Install gcloud CLI and run: gcloud auth application-default login",
      alibaba: "Install aliyun CLI and run: aliyun configure",
    };
    const hint = setupHints[args.provider] ?? "Check cloud-pilot config.yaml";
    const lines = [
      `Provider "${args.provider}" is not available.`,
      ``,
      `To fix: ${hint}`,
      `Then ensure "${args.provider}" is listed under "providers" in config.yaml and restart the server.`,
    ];
    if (available.length > 0) {
      lines.push(``, `Available providers: ${available.join(", ")}`);
    } else {
      lines.push(
        ``,
        `No providers are currently configured. This usually means provider initialization failed silently during startup.`,
        ``,
        `Common causes:`,
        `- Config file not found (check CLOUD_PILOT_CONFIG env var or ensure config.yaml is in the working directory)`,
        `- Credentials not available (expired Vault token, missing CLI auth, wrong secret key names)`,
        `- Vault secretPath missing "data/" prefix for KV v2 (use "secret/data/..." not "secret/...")`,
        ``,
        `Check server stderr logs for "[cloud-pilot] WARNING: Failed to initialize provider" messages.`,
        `See: https://github.com/vitalemazo/cloud-pilot-mcp#troubleshooting`,
      );
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      isError: true,
    };
  }

  try {
    const results = await cloudProvider.searchSpec(args.query, args.service);

    await audit.log({
      timestamp: new Date().toISOString(),
      tool: "search",
      provider: args.provider,
      service: args.service,
      dryRun: false,
      success: true,
      durationMs: Date.now() - start,
    });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No operations found matching "${args.query}"${args.service ? ` in service ${args.service}` : ""}.\nAvailable services: ${cloudProvider.listServices().join(", ")}`,
          },
        ],
      };
    }

    const formatted = results.map((op) => {
      const params = op.inputParams
        .filter((p) => p.required)
        .map((p) => `  - ${p.name} (${p.type}, required)${p.description ? `: ${p.description}` : ""}`)
        .join("\n");

      return [
        `## ${op.service}.${op.operation}`,
        `${op.description}`,
        `Method: ${op.httpMethod}`,
        params ? `Required params:\n${params}` : "No required params",
      ].join("\n");
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} matching operations:\n\n${formatted.join("\n\n---\n\n")}`,
        },
      ],
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await audit.log({
      timestamp: new Date().toISOString(),
      tool: "search",
      provider: args.provider,
      service: args.service,
      dryRun: false,
      success: false,
      error,
      durationMs: Date.now() - start,
    });

    return {
      content: [{ type: "text" as const, text: `Search failed: ${error}` }],
      isError: true,
    };
  }
}
