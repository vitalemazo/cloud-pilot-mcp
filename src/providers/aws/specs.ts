// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { OperationSpec, ParamSpec, ServiceMetadata } from "../../interfaces/cloud-provider.js";

interface BotocoreShape {
  type: string;
  required?: string[];
  members?: Record<string, { shape: string; documentation?: string }>;
}

interface BotocoreOperation {
  name: string;
  http?: { method: string };
  input?: { shape: string };
  output?: { shape: string };
  documentation?: string;
}

interface BotocoreServiceModel {
  metadata: {
    serviceAbbreviation?: string;
    serviceFullName: string;
    endpointPrefix: string;
    protocol: string;
    targetPrefix?: string;
    apiVersion?: string;
    jsonVersion?: string;
  };
  operations: Record<string, BotocoreOperation>;
  shapes: Record<string, BotocoreShape>;
}

export class AwsSpecIndex {
  private specs = new Map<string, BotocoreServiceModel>();
  private specsDir: string;

  constructor(specsDir: string) {
    this.specsDir = specsDir;
  }

  loadService(service: string): void {
    const path = `${this.specsDir}/${service}.json`;
    if (!existsSync(path)) {
      throw new Error(`Spec not found for service: ${service}. Expected at ${path}`);
    }
    const raw = readFileSync(path, "utf-8");
    this.specs.set(service, JSON.parse(raw) as BotocoreServiceModel);
  }

  loadAll(): void {
    if (!existsSync(this.specsDir)) return;
    const files = readdirSync(this.specsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const service = file.replace(".json", "");
      this.loadService(service);
    }
  }

  listServices(): string[] {
    return Array.from(this.specs.keys());
  }

  search(query: string, service?: string): OperationSpec[] {
    const results: OperationSpec[] = [];
    const terms = query.toLowerCase().split(/\s+/);

    const servicesToSearch = service
      ? this.specs.has(service)
        ? [[service, this.specs.get(service)!] as const]
        : []
      : Array.from(this.specs.entries());

    for (const [svcName, model] of servicesToSearch) {
      for (const [, op] of Object.entries(model.operations)) {
        const searchText = `${op.name} ${op.documentation ?? ""}`.toLowerCase();
        const matches = terms.every((t) => searchText.includes(t));

        if (matches) {
          results.push(this.operationToSpec(svcName, op, model));
        }
      }
    }

    return results.slice(0, 20);
  }

  getOperation(service: string, operation: string): OperationSpec | null {
    const model = this.specs.get(service);
    if (!model) return null;

    const op = model.operations[operation];
    if (!op) return null;

    return this.operationToSpec(service, op, model);
  }

  private operationToSpec(
    service: string,
    op: BotocoreOperation,
    model: BotocoreServiceModel,
  ): OperationSpec {
    const inputParams = op.input
      ? this.extractParams(op.input.shape, model)
      : [];
    const outputFields = op.output
      ? this.extractParams(op.output.shape, model)
      : [];

    return {
      service,
      operation: op.name,
      httpMethod: op.http?.method ?? "POST",
      description: stripHtml(op.documentation ?? ""),
      inputParams,
      outputFields,
      serviceMetadata: {
        protocol: model.metadata.protocol,
        targetPrefix: model.metadata.targetPrefix,
        apiVersion: model.metadata.apiVersion,
        endpointPrefix: model.metadata.endpointPrefix,
        jsonVersion: model.metadata.jsonVersion,
      },
    };
  }

  private extractParams(shapeName: string, model: BotocoreServiceModel): ParamSpec[] {
    const shape = model.shapes[shapeName];
    if (!shape || !shape.members) return [];

    const required = new Set(shape.required ?? []);

    return Object.entries(shape.members).map(([name, member]) => ({
      name,
      type: model.shapes[member.shape]?.type ?? "unknown",
      required: required.has(name),
      description: stripHtml(member.documentation ?? ""),
    }));
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
