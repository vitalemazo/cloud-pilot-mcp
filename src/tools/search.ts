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

  try {
    const results = await cloudProvider.searchSpec(args.query, args.service);

    await audit.log({
      timestamp: new Date().toISOString(),
      tool: "search",
      provider: args.provider as "aws" | "azure",
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
      provider: args.provider as "aws" | "azure",
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
