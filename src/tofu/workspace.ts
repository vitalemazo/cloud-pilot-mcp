// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import type { AuthProvider } from "../interfaces/auth.js";

const execFileAsync = promisify(execFile);

export interface TofuConfig {
  workspacesDir: string;
  binary: string;
  stateBackend: "local" | "s3" | "http";
  stateConfig?: Record<string, string>;
  timeoutMs: number;
}

export interface TofuResult {
  success: boolean;
  output: string;
  error?: string;
  planSummary?: { add: number; change: number; destroy: number };
}

const DEFAULT_TOFU_CONFIG: TofuConfig = {
  workspacesDir: "/tmp/cloud-pilot-tofu/workspaces",
  binary: "tofu",
  stateBackend: "local",
  timeoutMs: 300000, // 5 minutes
};

/**
 * Manages OpenTofu workspaces for cloud-pilot.
 * Each workspace is a directory with HCL files and state.
 */
export class TofuWorkspaceManager {
  private config: TofuConfig;
  private providerConfigs: Map<string, Config["providers"][number]>;
  private auth: AuthProvider;

  constructor(
    tofuConfig: Partial<TofuConfig> | undefined,
    providerConfigs: Map<string, Config["providers"][number]>,
    auth: AuthProvider,
  ) {
    this.config = { ...DEFAULT_TOFU_CONFIG, ...tofuConfig };
    this.providerConfigs = providerConfigs;
    this.auth = auth;

    // Ensure workspaces directory exists
    if (!existsSync(this.config.workspacesDir)) {
      mkdirSync(this.config.workspacesDir, { recursive: true });
    }
  }

  /** Check if OpenTofu binary is available. */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.config.binary, ["version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Get the version of the OpenTofu binary. */
  async version(): Promise<string> {
    const { stdout } = await execFileAsync(this.config.binary, ["version"], { timeout: 5000 });
    return stdout.trim().split("\n")[0];
  }

  /** List all workspaces. */
  listWorkspaces(): string[] {
    if (!existsSync(this.config.workspacesDir)) return [];
    return readdirSync(this.config.workspacesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  /** Get the path for a workspace directory. */
  private workspacePath(workspace: string): string {
    // Sanitize workspace name
    const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(this.config.workspacesDir, safe);
  }

  /** Ensure a workspace exists and has provider config. */
  private ensureWorkspace(workspace: string, providers: string[]): string {
    const dir = this.workspacePath(workspace);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Generate provider.tf with required providers
    const providerTf = this.generateProviderConfig(providers);
    writeFileSync(join(dir, "provider.tf"), providerTf);

    // Generate backend config
    const backendTf = this.generateBackendConfig(workspace);
    writeFileSync(join(dir, "backend.tf"), backendTf);

    return dir;
  }

  /** Write HCL to a workspace. */
  writeHCL(workspace: string, filename: string, hcl: string, providers: string[] = ["aws"]): string {
    const dir = this.ensureWorkspace(workspace, providers);
    const safeName = filename.endsWith(".tf") ? filename : `${filename}.tf`;
    const filePath = join(dir, safeName);
    writeFileSync(filePath, hcl);
    return filePath;
  }

  /** Read the current HCL files in a workspace. */
  readWorkspace(workspace: string): Record<string, string> {
    const dir = this.workspacePath(workspace);
    if (!existsSync(dir)) return {};

    const files: Record<string, string> = {};
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".tf") || entry.endsWith(".tfvars")) {
        files[entry] = readFileSync(join(dir, entry), "utf-8");
      }
    }
    return files;
  }

  /** Run tofu init on a workspace. */
  async init(workspace: string, providers: string[] = ["aws"]): Promise<TofuResult> {
    const dir = this.ensureWorkspace(workspace, providers);
    return this.runTofu(dir, ["init", "-input=false", "-no-color"]);
  }

  /** Run tofu plan. */
  async plan(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    const result = await this.runTofu(dir, ["plan", "-input=false", "-no-color", "-detailed-exitcode"]);

    // Parse plan summary from output
    result.planSummary = parsePlanSummary(result.output);

    // Exit code 2 = changes present (not an error for plan)
    if (!result.success && result.output.includes("Plan:")) {
      result.success = true;
    }

    return result;
  }

  /** Run tofu apply. */
  async apply(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["apply", "-auto-approve", "-input=false", "-no-color"]);
  }

  /** Run tofu destroy. */
  async destroy(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["destroy", "-auto-approve", "-input=false", "-no-color"]);
  }

  /** Run tofu state list. */
  async stateList(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["state", "list", "-no-color"]);
  }

  /** Run tofu state show. */
  async stateShow(workspace: string, resource: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["state", "show", "-no-color", resource]);
  }

  /** Run tofu import. */
  async import(workspace: string, address: string, id: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["import", "-input=false", "-no-color", address, id]);
  }

  /** Run tofu output. */
  async output(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["output", "-json", "-no-color"]);
  }

  /** Run tofu show (current state). */
  async show(workspace: string): Promise<TofuResult> {
    const dir = this.workspacePath(workspace);
    return this.runTofu(dir, ["show", "-no-color"]);
  }

  /** Resolve cloud credentials and inject them as environment variables. */
  private async resolveCredentialEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {};

    // AWS credentials
    try {
      const creds = await this.auth.getCredentials("aws");
      if (creds.aws) {
        env.AWS_ACCESS_KEY_ID = creds.aws.accessKeyId;
        env.AWS_SECRET_ACCESS_KEY = creds.aws.secretAccessKey;
        if (creds.aws.sessionToken) env.AWS_SESSION_TOKEN = creds.aws.sessionToken;
        env.AWS_REGION = creds.aws.region;
      }
    } catch { /* AWS not configured */ }

    // Azure credentials (tofu uses ARM_* env vars)
    try {
      const creds = await this.auth.getCredentials("azure");
      if (creds.azure) {
        env.ARM_TENANT_ID = creds.azure.tenantId ?? "";
        env.ARM_CLIENT_ID = creds.azure.clientId ?? "";
        if (creds.azure.accessToken) env.ARM_ACCESS_TOKEN = creds.azure.accessToken;
        if (creds.azure.subscriptionId) env.ARM_SUBSCRIPTION_ID = creds.azure.subscriptionId;
      }
    } catch { /* Azure not configured */ }

    // GCP credentials (tofu uses GOOGLE_* env vars)
    try {
      const creds = await this.auth.getCredentials("gcp");
      if (creds.gcp) {
        env.GOOGLE_OAUTH_ACCESS_TOKEN = creds.gcp.accessToken;
        if (creds.gcp.projectId) env.GOOGLE_PROJECT = creds.gcp.projectId;
      }
    } catch { /* GCP not configured */ }

    return env;
  }

  /** Execute a tofu command in a workspace directory. */
  private async runTofu(cwd: string, args: string[]): Promise<TofuResult> {
    try {
      // Inject cloud credentials from auth provider into child process
      const credEnv = await this.resolveCredentialEnv();
      const env = {
        ...process.env,
        ...credEnv,
        TF_IN_AUTOMATION: "true",
        TF_INPUT: "false",
      };

      const { stdout, stderr } = await execFileAsync(
        this.config.binary,
        args,
        {
          cwd,
          timeout: this.config.timeoutMs,
          env,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
      );

      const output = stdout + (stderr ? `\n${stderr}` : "");
      return { success: true, output: output.trim() };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const output = (execErr.stdout ?? "") + (execErr.stderr ? `\n${execErr.stderr}` : "");

      return {
        success: false,
        output: output.trim(),
        error: execErr.message ?? "Unknown error",
      };
    }
  }

  /** Generate provider.tf content based on configured providers. */
  private generateProviderConfig(providers: string[]): string {
    const blocks: string[] = [
      `terraform {`,
      `  required_providers {`,
    ];

    for (const p of providers) {
      const pc = this.providerConfigs.get(p);
      switch (p) {
        case "aws":
          blocks.push(`    aws = {`);
          blocks.push(`      source  = "hashicorp/aws"`);
          blocks.push(`      version = "~> 5.0"`);
          blocks.push(`    }`);
          break;
        case "azure":
          blocks.push(`    azurerm = {`);
          blocks.push(`      source  = "hashicorp/azurerm"`);
          blocks.push(`      version = "~> 4.0"`);
          blocks.push(`    }`);
          break;
        case "gcp":
          blocks.push(`    google = {`);
          blocks.push(`      source  = "hashicorp/google"`);
          blocks.push(`      version = "~> 6.0"`);
          blocks.push(`    }`);
          break;
      }
    }

    blocks.push(`  }`);
    blocks.push(`}`);
    blocks.push(``);

    // Provider blocks with region config
    for (const p of providers) {
      const pc = this.providerConfigs.get(p);
      switch (p) {
        case "aws":
          blocks.push(`provider "aws" {`);
          blocks.push(`  region = "${pc?.region ?? "us-east-1"}"`);
          blocks.push(`}`);
          break;
        case "azure":
          blocks.push(`provider "azurerm" {`);
          blocks.push(`  features {}`);
          if (pc?.subscriptionId) {
            blocks.push(`  subscription_id = "${pc.subscriptionId}"`);
          }
          blocks.push(`}`);
          break;
        case "gcp":
          blocks.push(`provider "google" {`);
          blocks.push(`  region = "${pc?.region ?? "us-central1"}"`);
          if (pc?.subscriptionId) {
            blocks.push(`  project = "${pc.subscriptionId}"`);
          }
          blocks.push(`}`);
          break;
      }
      blocks.push(``);
    }

    return blocks.join("\n");
  }

  /** Generate backend.tf content. */
  private generateBackendConfig(workspace: string): string {
    switch (this.config.stateBackend) {
      case "s3":
        return [
          `terraform {`,
          `  backend "s3" {`,
          `    bucket = "${this.config.stateConfig?.bucket ?? "cloud-pilot-state"}"`,
          `    key    = "workspaces/${workspace}/terraform.tfstate"`,
          `    region = "${this.config.stateConfig?.region ?? "us-east-1"}"`,
          `  }`,
          `}`,
        ].join("\n");
      case "http":
        return [
          `terraform {`,
          `  backend "http" {`,
          `    address = "${this.config.stateConfig?.address ?? "http://localhost:8200/v1/secret/data/tofu-state"}/${workspace}"`,
          `  }`,
          `}`,
        ].join("\n");
      case "local":
      default:
        // Local backend is the default, no config needed
        return `# State stored locally in this workspace directory\n`;
    }
  }
}

/** Parse plan summary from tofu plan output. */
function parsePlanSummary(output: string): { add: number; change: number; destroy: number } | undefined {
  // Match "Plan: X to add, Y to change, Z to destroy."
  const match = output.match(/Plan:\s*(\d+)\s*to add,\s*(\d+)\s*to change,\s*(\d+)\s*to destroy/);
  if (!match) return undefined;
  return {
    add: parseInt(match[1], 10),
    change: parseInt(match[2], 10),
    destroy: parseInt(match[3], 10),
  };
}
