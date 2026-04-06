// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CloudProvider } from "../interfaces/cloud-provider.js";
import type { Config } from "../config.js";
import { getProviderProfile } from "./provider-profiles.js";
import { buildInstructions } from "./instructions.js";

export function registerPersonaResources(
  server: McpServer,
  providers: Map<string, CloudProvider>,
  providerConfigs: Map<string, Config["providers"][number]>,
): void {
  const providerNames = Array.from(providers.keys());

  // Static overview resource
  server.resource(
    "Cloud Platform Engineer Persona — Overview",
    "cloud-pilot://persona/overview",
    {
      description:
        "Complete persona document: identity, core principles, behavioral standards, and configured provider summary",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "cloud-pilot://persona/overview",
          mimeType: "text/markdown",
          text: buildInstructions(providerNames, providerConfigs),
        },
      ],
    }),
  );

  // Per-provider expertise resources
  for (const name of providerNames) {
    const profile = getProviderProfile(name);
    if (!profile) continue;

    server.resource(
      profile.title,
      `cloud-pilot://persona/${name}`,
      {
        description: `Deep architecture, security, IAM, networking, and anti-pattern guide for ${name.toUpperCase()}`,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: `cloud-pilot://persona/${name}`,
            mimeType: "text/markdown",
            text: profile.content,
          },
        ],
      }),
    );
  }

  // Per-provider safety posture resources
  for (const name of providerNames) {
    const cfg = providerConfigs.get(name);
    if (!cfg) continue;

    server.resource(
      `Safety Configuration — ${name.toUpperCase()}`,
      `cloud-pilot://safety/${name}`,
      {
        description: `Current safety mode, allowed services, blocked actions, and access boundaries for ${name.toUpperCase()}`,
        mimeType: "text/markdown",
      },
      async () => {
        const lines = [
          `# Safety Configuration: ${name.toUpperCase()}`,
          "",
          `## Mode: ${cfg.mode}`,
          "",
        ];

        switch (cfg.mode) {
          case "read-only":
            lines.push(
              "Only read operations are allowed (Describe, Get, List, etc.). All mutating operations (Create, Update, Delete) are blocked.",
            );
            break;
          case "read-write":
            lines.push(
              "Read and write operations are allowed. Explicitly blocklisted actions are still denied. Use `dryRun: true` before mutating calls.",
            );
            break;
          case "full":
            lines.push(
              "**All operations are allowed with no restrictions.** Exercise extreme caution. Every action is audited.",
            );
            break;
        }

        lines.push("", `## Region: ${cfg.region}`, "");

        if (cfg.allowedServices.length > 0) {
          lines.push(
            `## Allowed Services (${cfg.allowedServices.length})`,
            "",
            ...cfg.allowedServices.map((s) => `- ${s}`),
            "",
            "Only these services can be called. Requests to other services will be rejected.",
          );
        } else {
          lines.push("## Allowed Services", "", "All services are allowed (no allowlist configured).");
        }

        if (cfg.blockedActions.length > 0) {
          lines.push(
            "",
            `## Blocked Actions (${cfg.blockedActions.length})`,
            "",
            ...cfg.blockedActions.map((a) => `- ${a}`),
            "",
            "These actions are permanently blocked regardless of mode.",
          );
        }

        lines.push(
          "",
          "## Audit",
          "",
          "Every search and execute call is logged with timestamp, service, action, parameters, success/failure, and duration.",
        );

        return {
          contents: [
            {
              uri: `cloud-pilot://safety/${name}`,
              mimeType: "text/markdown",
              text: lines.join("\n"),
            },
          ],
        };
      },
    );
  }
}
