// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { AuditLogger } from "../interfaces/audit.js";
import type { Config } from "../config.js";
import type { TofuWorkspaceManager } from "../tofu/workspace.js";
import { lookupProvider, searchProviders } from "../tofu/registry.js";

interface TofuArgs {
  subcommand: string;
  workspace: string;
  hcl?: string;
  filename?: string;
  providers?: string[];
  resource?: string;
  id?: string;
}

export async function handleTofu(
  args: TofuArgs,
  tofu: TofuWorkspaceManager,
  audit: AuditLogger,
  config: Config,
) {
  const start = Date.now();

  // Check if tofu binary is available
  const available = await tofu.isAvailable();
  if (!available) {
    return {
      content: [{
        type: "text" as const,
        text: [
          `OpenTofu binary not found.`,
          ``,
          `Install OpenTofu: https://opentofu.org/docs/intro/install/`,
          ``,
          `Or in Docker, add to your Dockerfile:`,
          `  RUN curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method standalone`,
        ].join("\n"),
      }],
      isError: true,
    };
  }

  try {
    await audit.log({
      timestamp: new Date().toISOString(),
      tool: "tofu",
      provider: (args.providers ?? ["aws"])[0],
      action: args.subcommand,
      params: { workspace: args.workspace, resource: args.resource, id: args.id },
      dryRun: args.subcommand === "plan",
      success: true,
      durationMs: 0,
    });

    switch (args.subcommand) {
      case "init":
        return await handleInit(args, tofu);
      case "plan":
        return await handlePlan(args, tofu);
      case "apply":
        return await handleApply(args, tofu);
      case "destroy":
        return await handleDestroy(args, tofu);
      case "import":
        return await handleImport(args, tofu);
      case "state":
        return await handleState(args, tofu);
      case "output":
        return await handleOutput(args, tofu);
      case "show":
        return await handleShow(args, tofu);
      case "write":
        return await handleWrite(args, tofu);
      case "read":
        return await handleRead(args, tofu);
      case "workspaces":
        return await handleListWorkspaces(tofu);
      case "registry":
        return await handleRegistry(args);
      default:
        return {
          content: [{
            type: "text" as const,
            text: `Unknown subcommand "${args.subcommand}". ` +
              `Available: init, write, plan, apply, destroy, import, state, output, show, workspaces, registry`,
          }],
          isError: true,
        };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `OpenTofu error: ${error}` }],
      isError: true,
    };
  }
}

async function handleInit(args: TofuArgs, tofu: TofuWorkspaceManager) {
  const result = await tofu.init(args.workspace, args.providers ?? ["aws"]);
  return formatResult("init", args.workspace, result);
}

async function handlePlan(args: TofuArgs, tofu: TofuWorkspaceManager) {
  // If HCL provided, write it first
  if (args.hcl) {
    tofu.writeHCL(args.workspace, args.filename ?? "main.tf", args.hcl, args.providers ?? ["aws"]);
  }

  const result = await tofu.plan(args.workspace);
  const lines = [`[PLAN] Workspace: ${args.workspace}`, ``];

  if (result.planSummary) {
    lines.push(
      `Summary: ${result.planSummary.add} to add, ` +
      `${result.planSummary.change} to change, ` +
      `${result.planSummary.destroy} to destroy.`,
      ``,
    );
  }

  lines.push(result.output);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: !result.success,
  };
}

async function handleApply(args: TofuArgs, tofu: TofuWorkspaceManager) {
  // If HCL provided, write it first
  if (args.hcl) {
    tofu.writeHCL(args.workspace, args.filename ?? "main.tf", args.hcl, args.providers ?? ["aws"]);
  }

  const result = await tofu.apply(args.workspace);
  return formatResult("apply", args.workspace, result);
}

async function handleDestroy(args: TofuArgs, tofu: TofuWorkspaceManager) {
  const result = await tofu.destroy(args.workspace);
  return formatResult("destroy", args.workspace, result);
}

async function handleImport(args: TofuArgs, tofu: TofuWorkspaceManager) {
  if (!args.resource || !args.id) {
    return {
      content: [{
        type: "text" as const,
        text: `import requires "resource" (e.g., "aws_vpc.main") and "id" (e.g., "vpc-0abc123") parameters.`,
      }],
      isError: true,
    };
  }
  const result = await tofu.import(args.workspace, args.resource, args.id);
  return formatResult("import", args.workspace, result);
}

async function handleState(args: TofuArgs, tofu: TofuWorkspaceManager) {
  if (args.resource) {
    const result = await tofu.stateShow(args.workspace, args.resource);
    return formatResult("state show", args.workspace, result);
  }
  const result = await tofu.stateList(args.workspace);
  return formatResult("state list", args.workspace, result);
}

async function handleOutput(args: TofuArgs, tofu: TofuWorkspaceManager) {
  const result = await tofu.output(args.workspace);
  return formatResult("output", args.workspace, result);
}

async function handleShow(args: TofuArgs, tofu: TofuWorkspaceManager) {
  const result = await tofu.show(args.workspace);
  return formatResult("show", args.workspace, result);
}

async function handleWrite(args: TofuArgs, tofu: TofuWorkspaceManager) {
  if (!args.hcl) {
    return {
      content: [{
        type: "text" as const,
        text: `write requires "hcl" parameter with the HCL configuration to save.`,
      }],
      isError: true,
    };
  }

  const path = tofu.writeHCL(
    args.workspace,
    args.filename ?? "main.tf",
    args.hcl,
    args.providers ?? ["aws"],
  );

  return {
    content: [{
      type: "text" as const,
      text: `HCL written to ${path}\n\nRun tofu with subcommand "plan" to preview changes.`,
    }],
    isError: false,
  };
}

async function handleRead(args: TofuArgs, tofu: TofuWorkspaceManager) {
  const files = tofu.readWorkspace(args.workspace);
  if (Object.keys(files).length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: `Workspace "${args.workspace}" is empty or does not exist.`,
      }],
      isError: false,
    };
  }

  const output = Object.entries(files)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join("\n\n");

  return {
    content: [{ type: "text" as const, text: output }],
    isError: false,
  };
}

async function handleListWorkspaces(tofu: TofuWorkspaceManager) {
  const workspaces = tofu.listWorkspaces();
  const version = await tofu.version().catch(() => "unknown");

  return {
    content: [{
      type: "text" as const,
      text: [
        `OpenTofu: ${version}`,
        ``,
        workspaces.length > 0
          ? `Workspaces:\n${workspaces.map((w) => `  - ${w}`).join("\n")}`
          : `No workspaces yet. Use subcommand "init" with a workspace name to create one.`,
      ].join("\n"),
    }],
    isError: false,
  };
}

async function handleRegistry(args: TofuArgs) {
  const query = args.resource ?? args.workspace ?? "aws";

  // If it looks like a specific provider lookup, do that
  if (query.includes("/") || /^[a-z]+$/.test(query)) {
    const info = await lookupProvider(query);
    if (!info) {
      return {
        content: [{
          type: "text" as const,
          text: `Provider "${query}" not found in the OpenTofu registry.\n\n` +
            `Try a full name like "hashicorp/aws" or search with a keyword.`,
        }],
        isError: false,
      };
    }

    const lines = [
      `[REGISTRY] Provider: ${info.source}`,
      ``,
      `Latest version: ${info.latestVersion}`,
      `Source: registry.opentofu.org/${info.source}`,
      ``,
      `Recent versions: ${info.allVersions.slice(0, 10).join(", ")}`,
      ``,
      `Usage in HCL:`,
      `  terraform {`,
      `    required_providers {`,
      `      ${info.name} = {`,
      `        source  = "${info.source}"`,
      `        version = "~> ${info.latestVersion.split(".")[0]}.0"`,
      `      }`,
      `    }`,
      `  }`,
    ];

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      isError: false,
    };
  }

  // Otherwise search
  const results = await searchProviders(query);
  if (results.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: `No providers found matching "${query}" in the OpenTofu registry.`,
      }],
      isError: false,
    };
  }

  const lines = [`[REGISTRY] Search results for "${query}"`, ``];
  for (const info of results) {
    lines.push(`  ${info.source} (latest: ${info.latestVersion})`);
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: false,
  };
}

function formatResult(
  subcommand: string,
  workspace: string,
  result: { success: boolean; output: string; error?: string },
) {
  const header = result.success
    ? `[${subcommand.toUpperCase()}] Workspace: ${workspace}`
    : `[${subcommand.toUpperCase()} FAILED] Workspace: ${workspace}`;

  const lines = [header, ``];
  if (result.output) lines.push(result.output);
  if (result.error && !result.output.includes(result.error)) {
    lines.push(`\nError: ${result.error}`);
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: !result.success,
  };
}
