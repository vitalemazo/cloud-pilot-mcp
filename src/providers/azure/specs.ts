// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { OperationSpec, ParamSpec } from "../../interfaces/cloud-provider.js";

interface SwaggerParam {
  name: string;
  in: string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: { $ref?: string };
}

interface SwaggerOperation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: SwaggerParam[];
  responses?: Record<string, { description?: string; schema?: { $ref?: string } }>;
}

interface SwaggerSpec {
  swagger: string;
  info: { title: string; version: string };
  host?: string;
  basePath?: string;
  paths: Record<string, Record<string, SwaggerOperation>>;
  definitions?: Record<string, SwaggerDefinition>;
}

interface SwaggerDefinition {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string; $ref?: string }>;
  description?: string;
}

export class AzureSpecIndex {
  private specs = new Map<string, SwaggerSpec>();
  private serviceMap = new Map<string, string[]>(); // service -> spec file names
  private specsDir: string;

  constructor(specsDir: string) {
    this.specsDir = specsDir;
  }

  loadService(service: string): void {
    const serviceDir = `${this.specsDir}/${service}`;
    if (!existsSync(serviceDir)) {
      // Try loading as a single file
      const singleFile = `${this.specsDir}/${service}.json`;
      if (existsSync(singleFile)) {
        const raw = readFileSync(singleFile, "utf-8");
        this.specs.set(service, JSON.parse(raw) as SwaggerSpec);
        this.serviceMap.set(service, [service]);
        return;
      }
      throw new Error(`Spec not found for Azure service: ${service}`);
    }

    const files = readdirSync(serviceDir).filter((f) => f.endsWith(".json"));
    const specNames: string[] = [];

    for (const file of files) {
      const specName = `${service}/${file.replace(".json", "")}`;
      const raw = readFileSync(`${serviceDir}/${file}`, "utf-8");
      this.specs.set(specName, JSON.parse(raw) as SwaggerSpec);
      specNames.push(specName);
    }

    this.serviceMap.set(service, specNames);
  }

  loadAll(): void {
    if (!existsSync(this.specsDir)) return;

    const entries = readdirSync(this.specsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        this.loadService(entry.name);
      } else if (entry.name.endsWith(".json")) {
        const service = entry.name.replace(".json", "");
        const raw = readFileSync(`${this.specsDir}/${entry.name}`, "utf-8");
        this.specs.set(service, JSON.parse(raw) as SwaggerSpec);
        this.serviceMap.set(service, [service]);
      }
    }
  }

  listServices(): string[] {
    return Array.from(this.serviceMap.keys());
  }

  search(query: string, service?: string): OperationSpec[] {
    const results: OperationSpec[] = [];
    const terms = query.toLowerCase().split(/\s+/);

    const specsToSearch = service
      ? (this.serviceMap.get(service) ?? []).map((name) => [name, this.specs.get(name)!] as const)
      : Array.from(this.specs.entries());

    for (const [specName, spec] of specsToSearch) {
      if (!spec) continue;
      const serviceName = specName.split("/")[0] ?? specName;

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (method === "parameters") continue;

          const op = operation as SwaggerOperation;
          if (!op.operationId) continue;

          const searchText =
            `${op.operationId} ${op.summary ?? ""} ${op.description ?? ""} ${path}`.toLowerCase();
          const matches = terms.every((t) => searchText.includes(t));

          if (matches) {
            results.push(this.operationToSpec(serviceName, path, method, op, spec));
          }
        }
      }
    }

    return results.slice(0, 20);
  }

  private operationToSpec(
    service: string,
    path: string,
    method: string,
    op: SwaggerOperation,
    spec: SwaggerSpec,
  ): OperationSpec {
    const inputParams: ParamSpec[] = (op.parameters ?? []).map((p) => ({
      name: p.name,
      type: p.type ?? (p.schema?.$ref ? resolveRefName(p.schema.$ref) : "object"),
      required: p.required ?? false,
      description: p.description,
    }));

    const outputFields: ParamSpec[] = [];
    const successResponse = op.responses?.["200"] ?? op.responses?.["201"];
    if (successResponse?.schema?.$ref) {
      const defName = resolveRefName(successResponse.schema.$ref);
      const definition = spec.definitions?.[defName];
      if (definition?.properties) {
        for (const [name, prop] of Object.entries(definition.properties)) {
          outputFields.push({
            name,
            type: prop.type ?? (prop.$ref ? resolveRefName(prop.$ref) : "object"),
            required: (definition.required ?? []).includes(name),
            description: prop.description,
          });
        }
      }
    }

    return {
      service,
      operation: op.operationId,
      httpMethod: method.toUpperCase(),
      description: op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
      inputParams,
      outputFields,
    };
  }
}

function resolveRefName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}
