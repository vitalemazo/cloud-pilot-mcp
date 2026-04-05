import type { CatalogEntry } from "./types.js";

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface GitTreeResponse {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

export class SpecFetcher {
  private githubToken?: string;

  constructor(opts?: { githubToken?: string }) {
    this.githubToken = opts?.githubToken || process.env.GITHUB_TOKEN;
  }

  // ── Catalog Fetching ──────────────────────────────────────────────

  async fetchAwsCatalog(): Promise<CatalogEntry[]> {
    const tree = await this.fetchGitTree(
      "boto/botocore",
      "develop",
      true,
    );

    const servicePattern = /^botocore\/data\/([^/]+)\/([^/]+)\/service-2\.json$/;
    const serviceMap = new Map<string, { version: string; path: string }>();

    for (const entry of tree.tree) {
      const match = entry.path.match(servicePattern);
      if (!match) continue;
      const [, service, version] = match;
      const existing = serviceMap.get(service);
      if (!existing || version > existing.version) {
        serviceMap.set(service, {
          version,
          path: entry.path,
        });
      }
    }

    return Array.from(serviceMap.entries()).map(([service, info]) => ({
      service,
      version: info.version,
      path: info.path,
    }));
  }

  async fetchAzureCatalog(): Promise<CatalogEntry[]> {
    const tree = await this.fetchGitTree(
      "Azure/azure-rest-api-specs",
      "main",
      true,
    );

    // Match swagger files under resource-manager stable directories, excluding examples
    const specPattern =
      /^specification\/([^/]+)\/resource-manager\/.*\/stable\/([^/]+)\/([^/]+\.json)$/;
    const examplesPattern = /\/examples\//;

    const serviceMap = new Map<
      string,
      { version: string; path: string; files: string[] }
    >();

    for (const entry of tree.tree) {
      if (entry.type !== "blob") continue;
      if (examplesPattern.test(entry.path)) continue;

      const match = entry.path.match(specPattern);
      if (!match) continue;

      const [, service, version] = match;
      const existing = serviceMap.get(service);

      if (!existing || version > existing.version) {
        serviceMap.set(service, {
          version,
          path: entry.path,
          files: [entry.path],
        });
      } else if (existing.version === version) {
        existing.files.push(entry.path);
      }
    }

    const entries: CatalogEntry[] = [];
    for (const [service, info] of serviceMap) {
      for (const filePath of info.files) {
        const fileName = filePath.split("/").pop()?.replace(".json", "") ?? service;
        entries.push({
          service: `${service}/${fileName}`,
          version: info.version,
          path: filePath,
        });
      }
    }

    return entries;
  }

  // ── Spec Fetching ─────────────────────────────────────────────────

  async fetchAwsSpec(service: string, version: string): Promise<unknown> {
    const url = `https://cdn.jsdelivr.net/gh/boto/botocore@develop/botocore/data/${service}/${version}/service-2.json`;
    return this.fetchJson(url);
  }

  async fetchAzureSpec(specPath: string): Promise<unknown> {
    const url = `https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/${specPath}`;
    return this.fetchJson(url);
  }

  // ── GCP ───────────────────────────────────────────────────────────

  async fetchGcpCatalog(): Promise<CatalogEntry[]> {
    const url =
      "https://www.googleapis.com/discovery/v1/apis";
    const data = (await this.fetchJson(url)) as {
      items: Array<{
        name: string;
        version: string;
        title?: string;
        discoveryRestUrl: string;
        preferred: boolean;
      }>;
    };

    // Only take preferred versions to avoid duplicates
    return data.items
      .filter((item) => item.preferred)
      .map((item) => ({
        service: item.name,
        version: item.version,
        path: item.discoveryRestUrl,
        fullName: item.title,
      }));
  }

  async fetchGcpSpec(discoveryUrl: string): Promise<unknown> {
    return this.fetchJson(discoveryUrl);
  }

  // ── Alibaba Cloud ─────────────────────────────────────────────────

  async fetchAlibabaCatalog(): Promise<CatalogEntry[]> {
    const url = "https://api.aliyun.com/meta/v1/products";
    const data = (await this.fetchJson(url)) as Array<{
      code: string;
      name?: string;
      defaultVersion?: string;
      versions?: string[];
      style?: string;
    }>;

    return data.map((product) => ({
      service: product.code,
      version: product.defaultVersion ?? product.versions?.[0],
      path: product.code,
      fullName: product.name,
    }));
  }

  async fetchAlibabaApiList(
    product: string,
    version: string,
  ): Promise<unknown> {
    // Primary: full api-docs.json with parameter schemas
    const docsUrl = `https://api.aliyun.com/meta/v1/products/${encodeURIComponent(product)}/versions/${encodeURIComponent(version)}/api-docs.json?language=en_US`;
    try {
      return await this.fetchJson(docsUrl);
    } catch {
      // Fallback: apiDir endpoint (lighter, operation names only)
      const dirUrl = `https://api.aliyun.com/api/product/apiDir?product=${encodeURIComponent(product)}&version=${encodeURIComponent(version)}`;
      const raw = (await this.fetchJson(dirUrl)) as {
        data: Array<{
          children?: Array<{
            name?: string;
            title?: string;
            method?: string;
            deprecated?: number;
          }>;
        }>;
      };
      const apis: Array<{ name: string; title: string; method: string }> = [];
      for (const dir of raw.data ?? []) {
        for (const child of dir.children ?? []) {
          if (child.name && !child.deprecated) {
            apis.push({
              name: child.name,
              title: child.title ?? "",
              method: (child.method ?? "POST").split("|")[0],
            });
          }
        }
      }
      return { apis };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async fetchGitTree(
    repo: string,
    branch: string,
    recursive: boolean,
  ): Promise<GitTreeResponse> {
    const url = `https://api.github.com/repos/${repo}/git/trees/${branch}${recursive ? "?recursive=1" : ""}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "cloud-pilot-mcp",
    };
    if (this.githubToken) {
      headers.Authorization = `Bearer ${this.githubToken}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(
        `GitHub API ${url} failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as GitTreeResponse;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: { "User-Agent": "cloud-pilot-mcp" },
    });
    if (!res.ok) {
      throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }
}
