// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CloudProvider } from "../interfaces/cloud-provider.js";
import type { AuditLogger } from "../interfaces/audit.js";
import type { Config } from "../config.js";
import { createApiBridge } from "../sandbox/api-bridge.js";
import { executeInSandbox } from "../sandbox/runtime.js";
import { SessionChangeset } from "../session/changeset.js";

interface ExecuteArgs {
  provider: string;
  code: string;
  dryRun?: boolean;
}

// Per-session changeset tracker. Keyed by a sessionId-like identifier.
// In practice, each MCP session gets its own server instance, so we use
// the provider name as the key (one changeset per provider per session).
const sessionChangesets = new Map<string, SessionChangeset>();

function getChangeset(provider: string, sessionId?: string): SessionChangeset {
  const key = sessionId ? `${sessionId}:${provider}` : provider;
  if (!sessionChangesets.has(key)) {
    sessionChangesets.set(key, new SessionChangeset());
  }
  return sessionChangesets.get(key)!;
}

export async function handleExecute(
  args: ExecuteArgs,
  providers: Map<string, CloudProvider>,
  providerConfigs: Map<string, Config["providers"][number]>,
  audit: AuditLogger,
  config: Config,
  sessionId?: string,
) {
  const start = Date.now();
  const cloudProvider = providers.get(args.provider);
  const providerConfig = providerConfigs.get(args.provider);

  if (!cloudProvider || !providerConfig) {
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

  const dryRun = args.dryRun ?? false;
  const changeset = getChangeset(args.provider, sessionId);

  const bridge = createApiBridge({
    provider: cloudProvider,
    config: providerConfig,
    audit,
    dryRun,
    sessionId,
    changeset,
  });

  try {
    const result = await executeInSandbox(args.code, bridge, {
      memoryLimitMB: config.sandbox.memoryLimitMB,
      timeoutMs: config.sandbox.timeoutMs,
    });

    const output = [
      result.success ? "Execution completed successfully." : `Execution failed: ${result.error}`,
    ];

    if (result.logs.length > 0) {
      output.push(`\nConsole output:\n${result.logs.join("\n")}`);
    }

    if (result.output !== null && result.output !== undefined) {
      output.push(
        `\nReturn value:\n${typeof result.output === "object" ? JSON.stringify(result.output, null, 2) : String(result.output)}`,
      );
    }

    if (dryRun) {
      output.unshift("[DRY RUN] Validated without executing.\n");

      // Level 4: Append session summary after dry-run
      const summary = changeset.formatSessionSummary();
      if (summary !== "No resources created or modified in this session.") {
        output.push(`\n${summary}`);
      }
    } else if (changeset.getResources().length > 0) {
      // After real execution, show updated session state
      output.push(`\n${changeset.formatSessionSummary()}`);
    }

    return {
      content: [{ type: "text" as const, text: output.join("\n") }],
      isError: !result.success,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await audit.log({
      timestamp: new Date().toISOString(),
      tool: "execute",
      provider: args.provider,
      dryRun,
      success: false,
      error,
      durationMs: Date.now() - start,
    });

    return {
      content: [{ type: "text" as const, text: `Sandbox execution failed: ${error}` }],
      isError: true,
    };
  }
}
