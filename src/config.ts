// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ProviderConfigSchema = z.object({
  type: z.enum(["aws", "azure", "gcp", "alibaba"]),
  region: z.string().default("us-east-1"),
  mode: z.enum(["read-only", "read-write", "full"]).default("read-only"),
  allowedServices: z.array(z.string()).default([]),
  blockedActions: z.array(z.string()).default([]),
  requireConfirmation: z.array(z.string()).default([]),
  subscriptionId: z.string().optional(),
});

const ConfigSchema = z.object({
  transport: z.enum(["stdio", "http"]).default("stdio"),
  http: z
    .object({
      port: z.number().default(8400),
      host: z.string().default("127.0.0.1"),
      apiKey: z.string().optional(),
      corsOrigins: z.array(z.string()).default(["*"]),
      rateLimitPerMinute: z.number().default(60),
    })
    .default({}),
  auth: z
    .object({
      type: z.enum(["env", "vault", "azure-ad", "aws-iam"]).default("env"),
      vault: z
        .object({
          address: z.string().optional(),
          roleId: z.string().optional(),
          secretId: z.string().optional(),
          secretPath: z.string().default("secret/cloud-pilot"),
        })
        .optional(),
      azureAd: z
        .object({
          tenantId: z.string().optional(),
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
        })
        .optional(),
    })
    .default({}),
  providers: z.array(ProviderConfigSchema).default([]),
  sandbox: z
    .object({
      memoryLimitMB: z.number().default(128),
      timeoutMs: z.number().default(30000),
    })
    .default({}),
  specs: z
    .object({
      dynamic: z.boolean().default(true),
      cacheDir: z.string().default("~/.cloud-pilot/cache"),
      catalogTtlDays: z.number().default(7),
      specTtlDays: z.number().default(30),
      maxMemorySpecs: z.number().default(10),
      offline: z.boolean().default(false),
    })
    .default({}),
  audit: z
    .object({
      type: z.enum(["file", "console", "cloudwatch", "azure-monitor"]).default("file"),
      path: z.string().default("./audit.json"),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolveConfigPath();

  let raw: Record<string, unknown> = {};

  if (path && existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    raw = parseYaml(content) as Record<string, unknown>;
  }

  raw = applyEnvOverrides(raw);

  return ConfigSchema.parse(raw);
}

function resolveConfigPath(): string | undefined {
  const candidates = [
    process.env.CLOUD_PILOT_CONFIG,
    "config.local.yaml",
    "config.yaml",
  ];
  return candidates.find((p) => p && existsSync(p));
}

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  if (process.env.TRANSPORT) {
    raw.transport = process.env.TRANSPORT;
  }
  if (process.env.HTTP_PORT) {
    raw.http = { ...(raw.http as object), port: parseInt(process.env.HTTP_PORT, 10) };
  }
  if (process.env.HTTP_HOST) {
    raw.http = { ...(raw.http as object), host: process.env.HTTP_HOST };
  }
  if (process.env.HTTP_API_KEY) {
    raw.http = { ...(raw.http as object), apiKey: process.env.HTTP_API_KEY };
  }
  if (process.env.AUTH_TYPE) {
    raw.auth = { ...(raw.auth as object), type: process.env.AUTH_TYPE };
  }
  if (process.env.CLOUD_PILOT_SPECS_DYNAMIC !== undefined) {
    raw.specs = {
      ...(raw.specs as object),
      dynamic: process.env.CLOUD_PILOT_SPECS_DYNAMIC === "true",
    };
  }
  if (process.env.CLOUD_PILOT_SPECS_OFFLINE !== undefined) {
    raw.specs = {
      ...(raw.specs as object),
      offline: process.env.CLOUD_PILOT_SPECS_OFFLINE === "true",
    };
  }
  return raw;
}
