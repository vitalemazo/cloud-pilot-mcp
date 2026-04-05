import type { CloudProvider } from "../interfaces/cloud-provider.js";
import type { AuditLogger } from "../interfaces/audit.js";
import type { Config } from "../config.js";
import { createApiBridge } from "../sandbox/api-bridge.js";
import { executeInSandbox } from "../sandbox/runtime.js";

interface ExecuteArgs {
  provider: string;
  code: string;
  dryRun?: boolean;
}

export async function handleExecute(
  args: ExecuteArgs,
  providers: Map<string, CloudProvider>,
  providerConfigs: Map<string, Config["providers"][number]>,
  audit: AuditLogger,
  config: Config,
) {
  const start = Date.now();
  const cloudProvider = providers.get(args.provider);
  const providerConfig = providerConfigs.get(args.provider);

  if (!cloudProvider || !providerConfig) {
    const available = Array.from(providers.keys()).join(", ");
    return {
      content: [
        {
          type: "text" as const,
          text: `Provider "${args.provider}" not configured. Available: ${available}`,
        },
      ],
      isError: true,
    };
  }

  const dryRun = args.dryRun ?? false;

  const bridge = createApiBridge({
    provider: cloudProvider,
    config: providerConfig,
    audit,
    dryRun,
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
      output.unshift("[DRY RUN] No actual API calls were made.\n");
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
      provider: args.provider as "aws" | "azure",
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
