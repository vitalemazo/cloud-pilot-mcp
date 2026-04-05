import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { OperationSpec } from "../interfaces/cloud-provider.js";
import type { CatalogEntry, OperationIndexEntry, SpecsConfig } from "./types.js";
import { LRUCache } from "./lru-cache.js";
import { SpecCache } from "./spec-cache.js";
import { SpecFetcher } from "./spec-fetcher.js";
import { OperationIndex } from "./operation-index.js";
import { AwsSpecIndex } from "../providers/aws/specs.js";
import { AzureSpecIndex } from "../providers/azure/specs.js";

type Provider = "aws" | "azure" | "gcp" | "alibaba";

interface DynamicSpecIndexOptions {
  provider: Provider;
  config: SpecsConfig;
  cache: SpecCache;
  fetcher: SpecFetcher;
  localSpecsDir: string;
  bundledCatalogPath?: string;
}

export class DynamicSpecIndex {
  private provider: Provider;
  private config: SpecsConfig;
  private cache: SpecCache;
  private fetcher: SpecFetcher;
  private localSpecsDir: string;
  private bundledCatalogPath?: string;

  private catalog: CatalogEntry[] = [];
  private catalogMap = new Map<string, CatalogEntry>();
  private opIndex = new OperationIndex();
  private specLRU: LRUCache<string, unknown>;
  private backgroundIndexing = false;

  constructor(opts: DynamicSpecIndexOptions) {
    this.provider = opts.provider;
    this.config = opts.config;
    this.cache = opts.cache;
    this.fetcher = opts.fetcher;
    this.localSpecsDir = opts.localSpecsDir;
    this.bundledCatalogPath = opts.bundledCatalogPath;
    this.specLRU = new LRUCache(opts.config.maxMemorySpecs);
  }

  // ── Initialization ────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.loadCatalog();
    this.indexLocalSpecs();
    this.loadCachedOperationIndex();
  }

  private async loadCatalog(): Promise<void> {
    // 1. Try disk cache
    if (!this.cache.isCatalogExpired(this.provider, this.config.catalogTtlDays)) {
      const cached = this.cache.readCatalog(this.provider);
      if (cached) {
        this.setCatalog(cached);
        return;
      }
    }

    // 2. Fetch from network (unless offline)
    if (!this.config.offline) {
      try {
        const entries =
          this.provider === "aws"
            ? await this.fetcher.fetchAwsCatalog()
            : this.provider === "gcp"
              ? await this.fetcher.fetchGcpCatalog()
              : this.provider === "alibaba"
                ? await this.fetcher.fetchAlibabaCatalog()
                : await this.fetcher.fetchAzureCatalog();
        this.cache.writeCatalog(this.provider, entries);
        this.setCatalog(entries);
        return;
      } catch (err) {
        console.error(
          `[cloud-pilot] Failed to fetch ${this.provider} catalog: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 3. Fall back to stale cache
    const stale = this.cache.readCatalog(this.provider);
    if (stale) {
      this.setCatalog(stale);
      return;
    }

    // 4. Fall back to bundled catalog
    if (this.bundledCatalogPath && existsSync(this.bundledCatalogPath)) {
      const raw = readFileSync(this.bundledCatalogPath, "utf-8");
      this.setCatalog(JSON.parse(raw) as CatalogEntry[]);
      return;
    }

    // 5. Fall back to local specs directory
    this.catalogFromLocalSpecs();
  }

  private setCatalog(entries: CatalogEntry[]): void {
    this.catalog = entries;
    this.catalogMap.clear();
    for (const e of entries) {
      this.catalogMap.set(e.service, e);
    }
  }

  private catalogFromLocalSpecs(): void {
    if (!existsSync(this.localSpecsDir)) return;
    const files = readdirSync(this.localSpecsDir).filter((f) =>
      f.endsWith(".json"),
    );
    const entries: CatalogEntry[] = files.map((f) => ({
      service: f.replace(".json", ""),
      path: f,
    }));
    this.setCatalog(entries);
  }

  private indexLocalSpecs(): void {
    if (!existsSync(this.localSpecsDir)) return;

    const files = readdirSync(this.localSpecsDir).filter((f) =>
      f.endsWith(".json"),
    );

    for (const file of files) {
      const service = file.replace(".json", "");
      try {
        const raw = readFileSync(
          resolve(this.localSpecsDir, file),
          "utf-8",
        );
        const spec = JSON.parse(raw) as Record<string, unknown>;
        this.specLRU.set(service, spec);

        const ops =
          this.provider === "aws"
            ? OperationIndex.extractFromAwsSpec(service, spec as Parameters<typeof OperationIndex.extractFromAwsSpec>[1])
            : this.provider === "gcp"
              ? OperationIndex.extractFromGcpSpec(service, spec as Parameters<typeof OperationIndex.extractFromGcpSpec>[1])
              : this.provider === "alibaba"
                ? OperationIndex.extractFromAlibabaSpec(service, spec as Parameters<typeof OperationIndex.extractFromAlibabaSpec>[1])
                : OperationIndex.extractFromAzureSpec(service, spec as Parameters<typeof OperationIndex.extractFromAzureSpec>[1]);
        this.opIndex.addService(service, ops);
      } catch {
        // Skip unparseable files
      }
    }
  }

  private loadCachedOperationIndex(): void {
    const cached = this.cache.readOperationIndex(this.provider);
    if (!cached || cached.length === 0) return;

    // Group cached entries by service, then merge those we don't already have
    const byService = new Map<string, OperationIndexEntry[]>();
    for (const entry of cached) {
      if (!byService.has(entry.service)) {
        byService.set(entry.service, []);
      }
      byService.get(entry.service)!.push(entry);
    }

    for (const [service, ops] of byService) {
      if (!this.opIndex.hasService(service)) {
        this.opIndex.addService(service, ops);
      }
    }
  }

  // ── Public Interface ──────────────────────────────────────────────

  listServices(): string[] {
    return this.catalog.map((e) => e.service);
  }

  async search(query: string, service?: string): Promise<OperationSpec[]> {
    // Step 1: search the operation index for matches
    let matches = this.opIndex.search(query, service);

    // Step 2: if no matches and we have catalog entries not yet indexed,
    // try fetching specs for services matching the query keywords
    if (matches.length === 0 && !service) {
      const candidates = this.findCatalogCandidates(query);
      for (const candidate of candidates.slice(0, 5)) {
        if (!this.opIndex.hasService(candidate.service)) {
          await this.ensureServiceIndexed(candidate.service);
        }
      }
      matches = this.opIndex.search(query, service);
    }

    // Step 3: if service was specified but not indexed, fetch it
    if (matches.length === 0 && service && !this.opIndex.hasService(service)) {
      await this.ensureServiceIndexed(service);
      matches = this.opIndex.search(query, service);
    }

    if (matches.length === 0) {
      this.triggerBackgroundIndexing();
      return [];
    }

    // Step 4: hydrate matched operations with full spec details
    const servicesNeeded = [...new Set(matches.map((m) => m.service))];
    for (const svc of servicesNeeded) {
      await this.ensureSpecLoaded(svc);
    }

    // Step 5: build full OperationSpecs
    return this.hydrateMatches(matches);
  }

  async getOperation(
    service: string,
    operation: string,
  ): Promise<OperationSpec | null> {
    await this.ensureSpecLoaded(service);
    const spec = this.specLRU.get(service);
    if (!spec) return null;

    if (this.provider === "aws") {
      return this.getAwsOperation(service, operation, spec);
    }
    if (this.provider === "gcp") {
      return this.getGcpOperation(service, operation, spec);
    }
    if (this.provider === "alibaba") {
      return this.getAlibabaOperation(service, operation, spec);
    }
    return this.getAzureOperation(service, operation, spec);
  }

  // ── Spec Loading ──────────────────────────────────────────────────

  private async ensureServiceIndexed(service: string): Promise<void> {
    if (this.opIndex.hasService(service)) return;

    const spec = await this.loadSpec(service);
    if (!spec) return;

    const ops =
      this.provider === "aws"
        ? OperationIndex.extractFromAwsSpec(service, spec as Parameters<typeof OperationIndex.extractFromAwsSpec>[1])
        : OperationIndex.extractFromAzureSpec(service, spec as Parameters<typeof OperationIndex.extractFromAzureSpec>[1]);

    this.opIndex.addService(service, ops);
  }

  private async ensureSpecLoaded(service: string): Promise<void> {
    if (this.specLRU.has(service)) return;

    const spec = await this.loadSpec(service);
    if (spec) {
      this.specLRU.set(service, spec);
    }
  }

  private async loadSpec(service: string): Promise<unknown | null> {
    // 1. Memory LRU
    const cached = this.specLRU.get(service);
    if (cached) return cached;

    // 2. Pre-downloaded local specs
    const localSpec = this.readLocalSpec(service);
    if (localSpec) {
      this.specLRU.set(service, localSpec);
      return localSpec;
    }

    // 3. Disk cache
    const diskSpec = this.cache.readSpec(this.provider, service);
    if (diskSpec) {
      this.specLRU.set(service, diskSpec);
      return diskSpec;
    }

    // 4. Network fetch
    if (this.config.offline) return null;

    const catalogEntry = this.catalogMap.get(service);
    if (!catalogEntry) return null;

    try {
      const spec =
        this.provider === "aws"
          ? await this.fetcher.fetchAwsSpec(
              service,
              catalogEntry.version ?? "",
            )
          : this.provider === "gcp"
            ? await this.fetcher.fetchGcpSpec(catalogEntry.path)
            : this.provider === "alibaba"
              ? await this.fetcher.fetchAlibabaApiList(
                  catalogEntry.service,
                  catalogEntry.version ?? "",
                )
              : await this.fetcher.fetchAzureSpec(catalogEntry.path);

      this.cache.writeSpec(this.provider, service, spec);
      this.specLRU.set(service, spec);
      return spec;
    } catch (err) {
      console.error(
        `[cloud-pilot] Failed to fetch spec for ${this.provider}/${service}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  private readLocalSpec(service: string): unknown | null {
    // Try exact name first, then base name (for Azure "service/file" format)
    const candidates = [
      resolve(this.localSpecsDir, `${service}.json`),
      resolve(this.localSpecsDir, `${service.replace(/\//g, "__")}.json`),
    ];
    // Also try just the part before the slash (e.g. "compute" from "compute/virtualMachine")
    if (service.includes("/")) {
      const base = service.split("/")[0];
      candidates.push(resolve(this.localSpecsDir, `${base}.json`));
    }

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as unknown;
      } catch {
        continue;
      }
    }
    return null;
  }

  // ── Catalog Search ────────────────────────────────────────────────

  private findCatalogCandidates(query: string): CatalogEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.catalog.filter((entry) => {
      const text =
        `${entry.service} ${entry.fullName ?? ""}`.toLowerCase();
      return terms.some((t) => text.includes(t));
    });
  }

  // ── Background Indexing ───────────────────────────────────────────

  private triggerBackgroundIndexing(): void {
    if (this.backgroundIndexing) return;
    if (this.config.offline) return;

    this.backgroundIndexing = true;
    console.error(
      `[cloud-pilot] Starting background operation index build for ${this.provider} (${this.catalog.length} services)...`,
    );

    this.buildFullOperationIndex().then(
      () => {
        this.backgroundIndexing = false;
        console.error(
          `[cloud-pilot] Background index build complete for ${this.provider}`,
        );
      },
      (err) => {
        this.backgroundIndexing = false;
        console.error(
          `[cloud-pilot] Background index build failed for ${this.provider}: ${err}`,
        );
      },
    );
  }

  private async buildFullOperationIndex(): Promise<void> {
    let indexed = 0;
    const total = this.catalog.length;

    for (const entry of this.catalog) {
      if (this.opIndex.hasService(entry.service)) {
        indexed++;
        continue;
      }

      try {
        await this.ensureServiceIndexed(entry.service);
        indexed++;

        if (indexed % 50 === 0) {
          console.error(
            `[cloud-pilot] Indexing ${this.provider}: ${indexed}/${total}`,
          );
          // Persist progress periodically
          this.cache.writeOperationIndex(this.provider, this.opIndex.getAll());
        }
      } catch {
        indexed++;
        // Skip failures, continue with rest
      }
    }

    // Final persist
    this.cache.writeOperationIndex(this.provider, this.opIndex.getAll());
  }

  // ── Hydration ─────────────────────────────────────────────────────

  private hydrateMatches(matches: OperationIndexEntry[]): OperationSpec[] {
    const results: OperationSpec[] = [];

    for (const match of matches) {
      const spec = this.specLRU.get(match.service);
      if (!spec) continue;

      const opSpec =
        this.provider === "aws"
          ? this.getAwsOperation(match.service, match.operation, spec)
          : this.provider === "gcp"
            ? this.getGcpOperation(match.service, match.operation, spec)
            : this.provider === "alibaba"
              ? this.getAlibabaOperation(match.service, match.operation, spec)
              : this.getAzureOperation(match.service, match.operation, spec);

      if (opSpec) results.push(opSpec);
    }

    return results;
  }

  private getAwsOperation(
    service: string,
    operation: string,
    spec: unknown,
  ): OperationSpec | null {
    // Create a temporary AwsSpecIndex and feed it the spec
    const tempIndex = new AwsSpecIndex(this.localSpecsDir);
    // Access internal method via the public getOperation after loading
    // We need to inject the spec — use a workaround
    const typedSpec = spec as {
      operations?: Record<string, unknown>;
      shapes?: Record<string, unknown>;
    };
    if (!typedSpec.operations?.[operation]) return null;

    // Build a minimal spec index by writing to a temp approach
    // Instead, directly extract the operation spec
    return extractAwsOperationSpec(service, operation, spec);
  }

  private getAzureOperation(
    service: string,
    operation: string,
    spec: unknown,
  ): OperationSpec | null {
    return extractAzureOperationSpec(service, operation, spec);
  }

  private getGcpOperation(
    service: string,
    operation: string,
    spec: unknown,
  ): OperationSpec | null {
    return extractGcpOperationSpec(service, operation, spec);
  }

  private getAlibabaOperation(
    service: string,
    operation: string,
    spec: unknown,
  ): OperationSpec | null {
    const typedSpec = spec as {
      apis?: Record<
        string,
        {
          methods?: string[];
          summary?: string;
          title?: string;
          parameters?: Array<{
            name: string;
            in: string;
            schema?: { type?: string; required?: boolean; description?: string };
          }>;
          responses?: Record<string, { schema?: { properties?: Record<string, { type?: string; description?: string }> } }>;
        }
      > | Array<{ name?: string; title?: string; method?: string }>;
    };

    if (!typedSpec.apis) {
      return { service, operation, httpMethod: "POST", description: "", inputParams: [], outputFields: [] };
    }

    // api-docs.json format (object keyed by action name)
    if (!Array.isArray(typedSpec.apis)) {
      const api = typedSpec.apis[operation];
      if (!api) return null;

      const inputParams = (api.parameters ?? []).map((p) => ({
        name: p.name,
        type: p.schema?.type ?? "string",
        required: p.schema?.required ?? false,
        description: p.schema?.description,
      }));

      const outputFields: OperationSpec["outputFields"] = [];
      const resp = api.responses?.["200"]?.schema?.properties;
      if (resp) {
        for (const [name, prop] of Object.entries(resp)) {
          outputFields.push({ name, type: prop.type ?? "object", required: false, description: prop.description });
        }
      }

      return {
        service,
        operation,
        httpMethod: (api.methods?.[0] ?? "POST").toUpperCase(),
        description: api.summary ?? api.title ?? "",
        inputParams,
        outputFields,
      };
    }

    // Fallback: array format from apiDir
    const api = typedSpec.apis.find((a) => a.name === operation);
    return {
      service,
      operation,
      httpMethod: (api?.method ?? "POST").toUpperCase(),
      description: api?.title ?? "",
      inputParams: [],
      outputFields: [],
    };
  }
}

// ── Standalone extraction functions ─────────────────────────────────

function extractAwsOperationSpec(
  service: string,
  operationName: string,
  rawSpec: unknown,
): OperationSpec | null {
  const spec = rawSpec as {
    operations?: Record<
      string,
      {
        name: string;
        http?: { method: string };
        input?: { shape: string };
        output?: { shape: string };
        documentation?: string;
      }
    >;
    shapes?: Record<
      string,
      {
        type: string;
        required?: string[];
        members?: Record<
          string,
          { shape: string; documentation?: string }
        >;
      }
    >;
  };

  const op = spec.operations?.[operationName];
  if (!op) return null;

  const inputParams = op.input
    ? extractAwsParams(op.input.shape, spec.shapes ?? {})
    : [];
  const outputFields = op.output
    ? extractAwsParams(op.output.shape, spec.shapes ?? {})
    : [];

  return {
    service,
    operation: op.name,
    httpMethod: op.http?.method ?? "POST",
    description: stripHtml(op.documentation ?? ""),
    inputParams,
    outputFields,
  };
}

function extractAwsParams(
  shapeName: string,
  shapes: Record<
    string,
    {
      type: string;
      required?: string[];
      members?: Record<string, { shape: string; documentation?: string }>;
    }
  >,
): OperationSpec["inputParams"] {
  const shape = shapes[shapeName];
  if (!shape?.members) return [];

  const required = new Set(shape.required ?? []);
  return Object.entries(shape.members).map(([name, member]) => ({
    name,
    type: shapes[member.shape]?.type ?? "unknown",
    required: required.has(name),
    description: stripHtml(member.documentation ?? ""),
  }));
}

function extractAzureOperationSpec(
  service: string,
  operationId: string,
  rawSpec: unknown,
): OperationSpec | null {
  const spec = rawSpec as {
    paths?: Record<
      string,
      Record<
        string,
        {
          operationId?: string;
          summary?: string;
          description?: string;
          parameters?: Array<{
            name: string;
            in: string;
            required?: boolean;
            type?: string;
            description?: string;
            schema?: { $ref?: string };
          }>;
          responses?: Record<
            string,
            { schema?: { $ref?: string } }
          >;
        }
      >
    >;
    definitions?: Record<
      string,
      {
        properties?: Record<
          string,
          { type?: string; description?: string; $ref?: string }
        >;
        required?: string[];
      }
    >;
  };

  if (!spec.paths) return null;

  for (const [, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (method === "parameters") continue;
      if (op.operationId !== operationId) continue;

      const inputParams = (op.parameters ?? []).map((p) => ({
        name: p.name,
        type: p.type ?? "object",
        required: p.required ?? false,
        description: p.description,
      }));

      const outputFields: OperationSpec["outputFields"] = [];
      const successResp = op.responses?.["200"] ?? op.responses?.["201"];
      if (successResp?.schema?.$ref && spec.definitions) {
        const defName = successResp.schema.$ref.split("/").pop() ?? "";
        const def = spec.definitions[defName];
        if (def?.properties) {
          for (const [name, prop] of Object.entries(def.properties)) {
            outputFields.push({
              name,
              type: prop.type ?? "object",
              required: (def.required ?? []).includes(name),
              description: prop.description,
            });
          }
        }
      }

      return {
        service,
        operation: operationId,
        httpMethod: method.toUpperCase(),
        description: op.summary ?? op.description ?? "",
        inputParams,
        outputFields,
      };
    }
  }

  return null;
}

function extractGcpOperationSpec(
  service: string,
  operationId: string,
  rawSpec: unknown,
): OperationSpec | null {
  const spec = rawSpec as {
    resources?: Record<string, unknown>;
    schemas?: Record<
      string,
      {
        properties?: Record<
          string,
          { type?: string; description?: string; $ref?: string }
        >;
        required?: string[];
      }
    >;
  };

  if (!spec.resources) return null;

  function findMethod(
    resources: Record<string, unknown>,
  ): { id: string; httpMethod: string; description?: string; parameters?: Record<string, { type: string; description?: string; required?: boolean }>; request?: { $ref: string }; response?: { $ref: string } } | null {
    for (const resource of Object.values(resources)) {
      const res = resource as {
        methods?: Record<string, { id: string; httpMethod: string; description?: string; parameters?: Record<string, { type: string; description?: string; required?: boolean }>; request?: { $ref: string }; response?: { $ref: string } }>;
        resources?: Record<string, unknown>;
      };
      if (res.methods) {
        for (const method of Object.values(res.methods)) {
          if (method.id === operationId) return method;
        }
      }
      if (res.resources) {
        const found = findMethod(res.resources);
        if (found) return found;
      }
    }
    return null;
  }

  const method = findMethod(spec.resources);
  if (!method) return null;

  const inputParams = method.parameters
    ? Object.entries(method.parameters).map(([name, p]) => ({
        name,
        type: p.type,
        required: p.required ?? false,
        description: p.description,
      }))
    : [];

  const outputFields: OperationSpec["outputFields"] = [];
  if (method.response?.$ref && spec.schemas) {
    const schema = spec.schemas[method.response.$ref];
    if (schema?.properties) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        outputFields.push({
          name,
          type: prop.type ?? (prop.$ref ?? "object"),
          required: false,
          description: prop.description,
        });
      }
    }
  }

  return {
    service,
    operation: operationId,
    httpMethod: method.httpMethod,
    description: method.description ?? "",
    inputParams,
    outputFields,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
