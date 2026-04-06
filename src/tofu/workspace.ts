// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import type { AuthProvider } from "../interfaces/auth.js";
import { VaultStateProxy } from "./vault-state-proxy.js";
import { generateRequiredProviders, lookupProvider, searchProviders, type ProviderInfo } from "./registry.js";

const execFileAsync = promisify(execFile);

export interface TofuConfig {
  workspacesDir: string;
  binary: string;
  stateBackend: "local" | "s3" | "http" | "consul" | "pg" | "vault";
  stateConfig?: {
    bucket?: string;
    region?: string;
    key?: string;
    dynamodbTable?: string;
    encrypt?: boolean;
    address?: string;
    lockAddress?: string;
    unlockAddress?: string;
    username?: string;
    password?: string;
    path?: string;
    connStr?: string;
    schemaName?: string;
  };
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
  private vaultProxy: VaultStateProxy | null = null;
  private vaultProxyPort = 0;

  constructor(
    tofuConfig: Partial<TofuConfig> | undefined,
    providerConfigs: Map<string, Config["providers"][number]>,
    auth: AuthProvider,
  ) {
    this.config = { ...DEFAULT_TOFU_CONFIG, ...tofuConfig };
    this.providerConfigs = providerConfigs;
    this.auth = auth;

    // Resolve ~ to home directory
    if (this.config.workspacesDir.startsWith("~")) {
      this.config.workspacesDir = this.config.workspacesDir.replace(
        "~",
        process.env.HOME ?? "/root",
      );
    }

    // Ensure workspaces directory exists
    if (!existsSync(this.config.workspacesDir)) {
      mkdirSync(this.config.workspacesDir, { recursive: true });
    }
  }

  /** Start the Vault state proxy if vault backend is configured. */
  async ensureVaultProxy(): Promise<void> {
    if (this.config.stateBackend !== "vault" || this.vaultProxy) return;

    // Resolve Vault credentials from auth provider
    let vaultAddr = this.config.stateConfig?.address ?? "";
    let vaultToken = "";

    // Try to get Vault token from auth config or environment
    if (process.env.VAULT_TOKEN) {
      vaultToken = process.env.VAULT_TOKEN;
    } else if (process.env.VAULT_ADDR) {
      vaultAddr = vaultAddr || process.env.VAULT_ADDR;
    }

    // If no token from env, try to get from auth provider (Vault AppRole)
    if (!vaultToken) {
      try {
        // The auth provider may have a Vault token from AppRole login
        const creds = await this.auth.getCredentials("aws");
        // Check if there's a vault token in the process env (set by VaultAuthProvider)
        vaultToken = process.env.VAULT_TOKEN ?? "";
      } catch { /* not available */ }
    }

    if (!vaultAddr || !vaultToken) {
      throw new Error(
        "Vault state backend requires vault address and token. " +
        "Set stateConfig.address in config.yaml and VAULT_TOKEN env var, " +
        "or configure auth.type: vault with AppRole credentials.",
      );
    }

    const secretPath = this.config.stateConfig?.path
      ?? this.config.stateConfig?.address?.replace(/^https?:\/\/[^/]+\/v1\//, "")
      ?? "secret/data/tofu-state";

    this.vaultProxy = new VaultStateProxy({
      vaultAddr,
      vaultToken,
      secretPath,
    });

    this.vaultProxyPort = await this.vaultProxy.start();
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
  private async ensureWorkspace(workspace: string, providers: string[]): Promise<string> {
    const dir = this.workspacePath(workspace);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Generate provider.tf from OpenTofu registry (fetches latest versions)
    const providerTf = await this.generateProviderConfig(providers);
    writeFileSync(join(dir, "provider.tf"), providerTf);

    // Generate backend config
    const backendTf = this.generateBackendConfig(workspace);
    writeFileSync(join(dir, "backend.tf"), backendTf);

    return dir;
  }

  /** Write HCL to a workspace. */
  async writeHCL(workspace: string, filename: string, hcl: string, providers: string[] = ["aws"]): Promise<string> {
    const dir = await this.ensureWorkspace(workspace, providers);
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
    // Start Vault proxy if vault backend is configured
    await this.ensureVaultProxy();
    const dir = await this.ensureWorkspace(workspace, providers);
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

  /** Generate provider.tf by looking up latest versions from the OpenTofu registry. */
  private async generateProviderConfig(providers: string[]): Promise<string> {
    // Fetch provider info from registry
    const requiredProviders = await generateRequiredProviders(providers);

    const blocks: string[] = [
      `terraform {`,
      `  required_providers {`,
    ];

    for (const [name, info] of Object.entries(requiredProviders)) {
      blocks.push(`    ${name} = {`);
      blocks.push(`      source  = "${info.source}"`);
      blocks.push(`      version = "${info.version}"`);
      blocks.push(`    }`);
    }

    blocks.push(`  }`);
    blocks.push(`}`);
    blocks.push(``);

    // Provider blocks with region config from cloud-pilot config
    for (const p of providers) {
      const pc = this.providerConfigs.get(p);
      const providerName = p === "azure" ? "azurerm"
        : p === "gcp" ? "google"
        : p === "alibaba" ? "alicloud"
        : p;

      // Only generate provider block if we have it in required_providers
      if (!requiredProviders[providerName]) continue;

      blocks.push(`provider "${providerName}" {`);

      switch (providerName) {
        case "azurerm":
          blocks.push(`  features {}`);
          if (pc?.subscriptionId) blocks.push(`  subscription_id = "${pc.subscriptionId}"`);
          break;
        case "google":
          blocks.push(`  region = "${pc?.region ?? "us-central1"}"`);
          if (pc?.subscriptionId) blocks.push(`  project = "${pc.subscriptionId}"`);
          break;
        default:
          if (pc?.region) blocks.push(`  region = "${pc.region}"`);
          break;
      }

      blocks.push(`}`);
      blocks.push(``);
    }

    return blocks.join("\n");
  }

  /** Generate backend.tf content. */
  private generateBackendConfig(workspace: string): string {
    const sc = this.config.stateConfig;
    switch (this.config.stateBackend) {
      case "s3": {
        const lines = [
          `terraform {`,
          `  backend "s3" {`,
          `    bucket = "${sc?.bucket ?? "cloud-pilot-state"}"`,
          `    key    = "${sc?.key ?? `workspaces/${workspace}/terraform.tfstate`}"`,
          `    region = "${sc?.region ?? "us-east-1"}"`,
        ];
        if (sc?.dynamodbTable) lines.push(`    dynamodb_table = "${sc.dynamodbTable}"`);
        if (sc?.encrypt) lines.push(`    encrypt = true`);
        lines.push(`  }`, `}`);
        return lines.join("\n");
      }
      case "http": {
        const baseAddr = sc?.address ?? "http://localhost:8200/v1/secret/data/tofu-state";
        const lines = [
          `terraform {`,
          `  backend "http" {`,
          `    address        = "${baseAddr}/${workspace}"`,
          `    lock_address   = "${sc?.lockAddress ?? `${baseAddr}/${workspace}`}"`,
          `    unlock_address = "${sc?.unlockAddress ?? `${baseAddr}/${workspace}`}"`,
        ];
        if (sc?.username) lines.push(`    username = "${sc.username}"`);
        if (sc?.password) lines.push(`    password = "${sc.password}"`);
        lines.push(`  }`, `}`);
        return lines.join("\n");
      }
      case "consul": {
        const lines = [
          `terraform {`,
          `  backend "consul" {`,
          `    address = "${sc?.address ?? "localhost:8500"}"`,
          `    path    = "${sc?.path ?? `cloud-pilot/tofu-state/${workspace}`}"`,
        ];
        lines.push(`  }`, `}`);
        return lines.join("\n");
      }
      case "pg": {
        const lines = [
          `terraform {`,
          `  backend "pg" {`,
          `    conn_str    = "${sc?.connStr ?? "postgres://localhost/terraform_state"}"`,
        ];
        if (sc?.schemaName) lines.push(`    schema_name = "${sc.schemaName}"`);
        lines.push(`  }`, `}`);
        return lines.join("\n");
      }
      case "vault": {
        // Point to the internal Vault state proxy
        const proxyBase = `http://127.0.0.1:${this.vaultProxyPort}`;
        return [
          `terraform {`,
          `  backend "http" {`,
          `    address        = "${proxyBase}/state/${workspace}"`,
          `    lock_address   = "${proxyBase}/lock/${workspace}"`,
          `    unlock_address = "${proxyBase}/lock/${workspace}"`,
          `    lock_method    = "POST"`,
          `    unlock_method  = "DELETE"`,
          `  }`,
          `}`,
        ].join("\n");
      }
      case "local":
      default:
        return `# State stored locally in ${this.config.workspacesDir}/${workspace}/\n`;
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
