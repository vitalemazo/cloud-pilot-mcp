import type { OperationIndexEntry } from "./types.js";

export class OperationIndex {
  private entries: OperationIndexEntry[] = [];
  private serviceSet = new Set<string>();

  load(entries: OperationIndexEntry[]): void {
    this.entries = entries;
    this.serviceSet.clear();
    for (const e of entries) {
      this.serviceSet.add(e.service);
    }
  }

  addService(service: string, operations: OperationIndexEntry[]): void {
    if (this.serviceSet.has(service)) {
      this.entries = this.entries.filter((e) => e.service !== service);
    }
    this.entries.push(...operations);
    this.serviceSet.add(service);
  }

  hasService(service: string): boolean {
    return this.serviceSet.has(service);
  }

  getAll(): OperationIndexEntry[] {
    return this.entries;
  }

  search(query: string, service?: string): OperationIndexEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    let pool = this.entries;
    if (service) {
      pool = pool.filter((e) => e.service === service);
    }

    const results: OperationIndexEntry[] = [];
    for (const entry of pool) {
      const text =
        `${entry.operation} ${entry.description}`.toLowerCase();
      if (terms.every((t) => text.includes(t))) {
        results.push(entry);
      }
    }

    return results.slice(0, 30);
  }

  // ── Extraction from raw specs ────────────────────────────────────

  static extractFromAwsSpec(
    service: string,
    spec: {
      operations?: Record<
        string,
        { name: string; http?: { method: string }; documentation?: string }
      >;
    },
  ): OperationIndexEntry[] {
    if (!spec.operations) return [];

    return Object.values(spec.operations).map((op) => ({
      service,
      operation: op.name,
      method: op.http?.method ?? "POST",
      description: stripHtml(op.documentation ?? "").slice(0, 120),
    }));
  }

  static extractFromAzureSpec(
    service: string,
    spec: {
      paths?: Record<
        string,
        Record<
          string,
          { operationId?: string; summary?: string; description?: string }
        >
      >;
    },
  ): OperationIndexEntry[] {
    const entries: OperationIndexEntry[] = [];
    if (!spec.paths) return entries;

    for (const [, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (method === "parameters" || !operation.operationId) continue;
        entries.push({
          service,
          operation: operation.operationId,
          method: method.toUpperCase(),
          description: (
            operation.summary ??
            operation.description ??
            ""
          ).slice(0, 120),
        });
      }
    }

    return entries;
  }

  static extractFromGcpSpec(
    service: string,
    spec: {
      resources?: Record<string, unknown>;
    },
  ): OperationIndexEntry[] {
    const entries: OperationIndexEntry[] = [];
    if (!spec.resources) return entries;

    function walk(resources: Record<string, unknown>): void {
      for (const resource of Object.values(resources)) {
        const res = resource as {
          methods?: Record<
            string,
            { id: string; httpMethod: string; description?: string }
          >;
          resources?: Record<string, unknown>;
        };
        if (res.methods) {
          for (const method of Object.values(res.methods)) {
            entries.push({
              service,
              operation: method.id,
              method: method.httpMethod,
              description: (method.description ?? "").slice(0, 120),
            });
          }
        }
        if (res.resources) {
          walk(res.resources);
        }
      }
    }

    walk(spec.resources);
    return entries;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
