// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface VaultStateProxyConfig {
  vaultAddr: string;
  vaultToken: string;
  secretPath: string; // e.g. "secret/data/tofu-state"
  lockPath?: string;  // e.g. "secret/data/tofu-locks" (defaults to secretPath + "-locks")
  listenPort?: number; // Defaults to 0 (OS-assigned)
}

/**
 * Lightweight HTTP proxy that translates between OpenTofu's HTTP backend
 * protocol and Vault's KV v2 API. Handles:
 *
 * - GET /state/{workspace}    → Vault KV v2 read, unwrap response
 * - POST /state/{workspace}   → Vault KV v2 write, wrap in {data:{}}
 * - LOCK POST /lock/{workspace}  → Vault KV v2 write (lock record)
 * - LOCK DELETE /lock/{workspace} → Vault KV v2 delete (release lock)
 *
 * The proxy runs on localhost with an OS-assigned port. The port is
 * returned by start() for use in OpenTofu backend config generation.
 */
export class VaultStateProxy {
  private config: VaultStateProxyConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private port = 0;

  constructor(config: VaultStateProxyConfig) {
    this.config = config;
    this.config.lockPath = config.lockPath ?? config.secretPath + "-locks";
  }

  /** Start the proxy and return the assigned port. */
  async start(): Promise<number> {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(this.config.listenPort ?? 0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          console.error(`[cloud-pilot:vault-state] Proxy listening on http://127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error("Failed to get proxy address"));
        }
      });

      this.server.on("error", reject);
    });
  }

  /** Stop the proxy. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  /** Get the proxy's listen port. */
  getPort(): number {
    return this.port;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    try {
      // Parse path: /state/{workspace} or /lock/{workspace}
      const stateMatch = url.match(/^\/state\/(.+)$/);
      const lockMatch = url.match(/^\/lock\/(.+)$/);

      if (stateMatch) {
        const workspace = decodeURIComponent(stateMatch[1]);
        if (method === "GET") {
          await this.handleStateGet(workspace, res);
        } else if (method === "POST") {
          const body = await readBody(req);
          await this.handleStatePost(workspace, body, res);
        } else if (method === "DELETE") {
          await this.handleStateDelete(workspace, res);
        } else {
          res.writeHead(405).end();
        }
      } else if (lockMatch) {
        const workspace = decodeURIComponent(lockMatch[1]);
        if (method === "LOCK" || method === "POST") {
          const body = await readBody(req);
          await this.handleLockAcquire(workspace, body, res);
        } else if (method === "UNLOCK" || method === "DELETE") {
          const body = await readBody(req);
          await this.handleLockRelease(workspace, body, res);
        } else {
          res.writeHead(405).end();
        }
      } else if (url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", port: this.port }));
      } else {
        res.writeHead(404).end("Not found");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cloud-pilot:vault-state] Error: ${msg}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  }

  // ── State operations ────────────────────────────────────────────

  /** GET state from Vault KV v2, unwrap the response. */
  private async handleStateGet(workspace: string, res: ServerResponse): Promise<void> {
    const vaultPath = `${this.config.secretPath}/${workspace}`;
    const vaultRes = await this.vaultRequest("GET", vaultPath);

    if (vaultRes.status === 404) {
      // No state exists yet — return empty
      res.writeHead(404).end();
      return;
    }

    if (!vaultRes.ok) {
      res.writeHead(vaultRes.status).end(vaultRes.body);
      return;
    }

    // Vault KV v2 wraps data: { data: { data: { ...actual state... } } }
    const vaultData = JSON.parse(vaultRes.body);
    const state = vaultData?.data?.data?.state;

    if (!state) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(state);
  }

  /** POST state to Vault KV v2, wrap in the required format. */
  private async handleStatePost(workspace: string, body: string, res: ServerResponse): Promise<void> {
    const vaultPath = `${this.config.secretPath}/${workspace}`;

    // Store the raw state JSON as a string inside the Vault secret
    const payload = JSON.stringify({
      data: {
        state: body,
        updated: new Date().toISOString(),
      },
    });

    const vaultRes = await this.vaultRequest("POST", vaultPath, payload);

    if (!vaultRes.ok) {
      res.writeHead(vaultRes.status).end(vaultRes.body);
      return;
    }

    res.writeHead(200).end();
  }

  /** DELETE state from Vault. */
  private async handleStateDelete(workspace: string, res: ServerResponse): Promise<void> {
    const vaultPath = `${this.config.secretPath}/${workspace}`;
    // Use metadata endpoint to fully delete (not just soft-delete)
    const metadataPath = vaultPath.replace("/data/", "/metadata/");
    await this.vaultRequest("DELETE", metadataPath);
    res.writeHead(200).end();
  }

  // ── Lock operations ─────────────────────────────────────────────

  /** Acquire a lock by writing the lock info to Vault. */
  private async handleLockAcquire(workspace: string, body: string, res: ServerResponse): Promise<void> {
    const lockPath = `${this.config.lockPath}/${workspace}`;

    // Check if lock already exists
    const existing = await this.vaultRequest("GET", lockPath);
    if (existing.ok) {
      const data = JSON.parse(existing.body);
      const lockInfo = data?.data?.data?.lock;
      if (lockInfo) {
        // Lock is held — return 423 Locked with the existing lock info
        res.writeHead(423, { "Content-Type": "application/json" });
        res.end(lockInfo);
        return;
      }
    }

    // Write the lock
    const payload = JSON.stringify({
      data: {
        lock: body,
        created: new Date().toISOString(),
      },
    });

    const vaultRes = await this.vaultRequest("POST", lockPath, payload);
    if (!vaultRes.ok) {
      res.writeHead(vaultRes.status).end(vaultRes.body);
      return;
    }

    res.writeHead(200).end();
  }

  /** Release a lock by deleting it from Vault. */
  private async handleLockRelease(workspace: string, _body: string, res: ServerResponse): Promise<void> {
    const lockPath = `${this.config.lockPath}/${workspace}`;
    const metadataPath = lockPath.replace("/data/", "/metadata/");
    await this.vaultRequest("DELETE", metadataPath);
    res.writeHead(200).end();
  }

  // ── Vault HTTP client ───────────────────────────────────────────

  private async vaultRequest(
    method: string,
    path: string,
    body?: string,
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const url = `${this.config.vaultAddr}/v1/${path}`;
    const headers: Record<string, string> = {
      "X-Vault-Token": this.config.vaultToken,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  }
}

/** Read the full body of an incoming request. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
