// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogEntry, OperationIndexEntry, CacheManifest } from "./types.js";

const EMPTY_MANIFEST: CacheManifest = {
  catalogFetchedAt: {},
  operationIndexFetchedAt: {},
  specsFetched: {},
};

export class SpecCache {
  private cacheDir: string;
  private manifest: CacheManifest;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir.replace(/^~/, process.env.HOME ?? "");
    this.manifest = this.readManifest();
  }

  // ── Catalog (Tier 1) ─────────────────────────────────────────────

  readCatalog(provider: string): CatalogEntry[] | null {
    return this.readJson<CatalogEntry[]>(this.catalogPath(provider));
  }

  writeCatalog(provider: string, entries: CatalogEntry[]): void {
    this.ensureDir(this.providerDir(provider));
    this.writeJson(this.catalogPath(provider), entries);
    this.manifest.catalogFetchedAt[provider] = Date.now();
    this.writeManifest();
  }

  isCatalogExpired(provider: string, ttlDays: number): boolean {
    const fetchedAt = this.manifest.catalogFetchedAt[provider];
    if (!fetchedAt) return true;
    return Date.now() - fetchedAt > ttlDays * 86400000;
  }

  // ── Operation Index (Tier 2) ──────────────────────────────────────

  readOperationIndex(provider: string): OperationIndexEntry[] | null {
    return this.readJson<OperationIndexEntry[]>(this.operationIndexPath(provider));
  }

  writeOperationIndex(provider: string, entries: OperationIndexEntry[]): void {
    this.ensureDir(this.providerDir(provider));
    this.writeJson(this.operationIndexPath(provider), entries);
    this.manifest.operationIndexFetchedAt[provider] = Date.now();
    this.writeManifest();
  }

  isOperationIndexExpired(provider: string, ttlDays: number): boolean {
    const fetchedAt = this.manifest.operationIndexFetchedAt[provider];
    if (!fetchedAt) return true;
    return Date.now() - fetchedAt > ttlDays * 86400000;
  }

  // ── Full Specs (Tier 3) ───────────────────────────────────────────

  readSpec(provider: string, service: string): unknown | null {
    return this.readJson(this.specPath(provider, service));
  }

  writeSpec(provider: string, service: string, data: unknown): void {
    this.ensureDir(this.specsDir(provider));
    this.writeJson(this.specPath(provider, service), data);
    if (!this.manifest.specsFetched[provider]) {
      this.manifest.specsFetched[provider] = {};
    }
    this.manifest.specsFetched[provider][service] = Date.now();
    this.writeManifest();
  }

  isSpecExpired(provider: string, service: string, ttlDays: number): boolean {
    const fetchedAt = this.manifest.specsFetched[provider]?.[service];
    if (!fetchedAt) return true;
    return Date.now() - fetchedAt > ttlDays * 86400000;
  }

  hasSpec(provider: string, service: string): boolean {
    return existsSync(this.specPath(provider, service));
  }

  // ── Paths ─────────────────────────────────────────────────────────

  private providerDir(provider: string): string {
    return join(this.cacheDir, provider);
  }

  private catalogPath(provider: string): string {
    return join(this.cacheDir, provider, "catalog.json");
  }

  private operationIndexPath(provider: string): string {
    return join(this.cacheDir, provider, "operation-index.json");
  }

  private specsDir(provider: string): string {
    return join(this.cacheDir, provider, "specs");
  }

  private specPath(provider: string, service: string): string {
    // Sanitize service names containing slashes (e.g. "authorization/policyAssignments")
    const safeService = service.replace(/\//g, "__");
    return join(this.cacheDir, provider, "specs", `${safeService}.json`);
  }

  // ── Manifest ──────────────────────────────────────────────────────

  private readManifest(): CacheManifest {
    const path = join(this.cacheDir, "manifest.json");
    return this.readJson<CacheManifest>(path) ?? { ...EMPTY_MANIFEST };
  }

  private writeManifest(): void {
    this.ensureDir(this.cacheDir);
    this.writeJson(join(this.cacheDir, "manifest.json"), this.manifest);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    } catch {
      return null;
    }
  }

  private writeJson(path: string, data: unknown): void {
    writeFileSync(path, JSON.stringify(data), "utf-8");
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
