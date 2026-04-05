import type { OperationSpec, ParamSpec } from "../../interfaces/cloud-provider.js";

interface DiscoveryMethod {
  id: string;
  description?: string;
  httpMethod: string;
  path: string;
  flatPath?: string;
  parameterOrder?: string[];
  parameters?: Record<
    string,
    {
      type: string;
      description?: string;
      required?: boolean;
      location: string;
    }
  >;
  request?: { $ref: string };
  response?: { $ref: string };
  scopes?: string[];
}

interface DiscoveryResource {
  methods?: Record<string, DiscoveryMethod>;
  resources?: Record<string, DiscoveryResource>;
}

interface DiscoveryDoc {
  name: string;
  version: string;
  title?: string;
  description?: string;
  baseUrl: string;
  basePath: string;
  rootUrl: string;
  servicePath: string;
  resources?: Record<string, DiscoveryResource>;
  schemas?: Record<
    string,
    {
      id: string;
      type: string;
      description?: string;
      properties?: Record<
        string,
        { type?: string; description?: string; $ref?: string }
      >;
      required?: string[];
    }
  >;
}

export class GcpSpecIndex {
  private specs = new Map<string, DiscoveryDoc>();

  loadSpec(service: string, doc: DiscoveryDoc): void {
    this.specs.set(service, doc);
  }

  listServices(): string[] {
    return Array.from(this.specs.keys());
  }

  search(query: string, service?: string): OperationSpec[] {
    const results: OperationSpec[] = [];
    const terms = query.toLowerCase().split(/\s+/);

    const specsToSearch = service
      ? this.specs.has(service)
        ? [[service, this.specs.get(service)!] as const]
        : []
      : Array.from(this.specs.entries());

    for (const [svcName, doc] of specsToSearch) {
      const methods = this.extractMethods(doc.resources ?? {});
      for (const method of methods) {
        const text =
          `${method.id} ${method.description ?? ""}`.toLowerCase();
        if (terms.every((t) => text.includes(t))) {
          results.push(this.methodToSpec(svcName, method, doc));
        }
      }
    }

    return results.slice(0, 20);
  }

  private extractMethods(
    resources: Record<string, DiscoveryResource>,
  ): DiscoveryMethod[] {
    const methods: DiscoveryMethod[] = [];

    for (const resource of Object.values(resources)) {
      if (resource.methods) {
        methods.push(...Object.values(resource.methods));
      }
      if (resource.resources) {
        methods.push(...this.extractMethods(resource.resources));
      }
    }

    return methods;
  }

  private methodToSpec(
    service: string,
    method: DiscoveryMethod,
    doc: DiscoveryDoc,
  ): OperationSpec {
    const inputParams: ParamSpec[] = method.parameters
      ? Object.entries(method.parameters).map(([name, param]) => ({
          name,
          type: param.type,
          required: param.required ?? false,
          description: param.description,
        }))
      : [];

    // Add request body params from schema
    if (method.request?.$ref && doc.schemas) {
      const schema = doc.schemas[method.request.$ref];
      if (schema?.properties) {
        for (const [name, prop] of Object.entries(schema.properties)) {
          inputParams.push({
            name: `body.${name}`,
            type: prop.type ?? (prop.$ref ?? "object"),
            required: (schema.required ?? []).includes(name),
            description: prop.description,
          });
        }
      }
    }

    const outputFields: ParamSpec[] = [];
    if (method.response?.$ref && doc.schemas) {
      const schema = doc.schemas[method.response.$ref];
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
      operation: method.id,
      httpMethod: method.httpMethod,
      description: method.description ?? "",
      inputParams,
      outputFields,
    };
  }
}
