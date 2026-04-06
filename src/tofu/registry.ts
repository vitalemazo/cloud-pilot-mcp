// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const REGISTRY_BASE = "https://registry.opentofu.org/v1";

/** Provider version info from the registry. */
export interface ProviderVersion {
  version: string;
  protocols: string[];
  platforms: { os: string; arch: string }[];
}

/** Provider info with latest version. */
export interface ProviderInfo {
  namespace: string;
  name: string;
  latestVersion: string;
  allVersions: string[];
  source: string; // e.g. "hashicorp/aws"
}

// Map from cloud-pilot provider/service names to OpenTofu registry providers.
// This is the knowledge layer — it knows that "aws" means "hashicorp/aws",
// "azure" means "hashicorp/azurerm", etc.
const KNOWN_PROVIDERS: Record<string, { namespace: string; name: string }> = {
  // Cloud platforms
  aws: { namespace: "hashicorp", name: "aws" },
  azure: { namespace: "hashicorp", name: "azurerm" },
  azurerm: { namespace: "hashicorp", name: "azurerm" },
  gcp: { namespace: "hashicorp", name: "google" },
  google: { namespace: "hashicorp", name: "google" },
  alibaba: { namespace: "hashicorp", name: "alicloud" },
  alicloud: { namespace: "hashicorp", name: "alicloud" },

  // Common infrastructure
  kubernetes: { namespace: "hashicorp", name: "kubernetes" },
  helm: { namespace: "hashicorp", name: "helm" },
  docker: { namespace: "kreuzwerker", name: "docker" },
  cloudflare: { namespace: "cloudflare", name: "cloudflare" },
  datadog: { namespace: "DataDog", name: "datadog" },
  vault: { namespace: "hashicorp", name: "vault" },
  consul: { namespace: "hashicorp", name: "consul" },
  dns: { namespace: "hashicorp", name: "dns" },
  tls: { namespace: "hashicorp", name: "tls" },
  random: { namespace: "hashicorp", name: "random" },
  null: { namespace: "hashicorp", name: "null" },
  local: { namespace: "hashicorp", name: "local" },
  external: { namespace: "hashicorp", name: "external" },
  archive: { namespace: "hashicorp", name: "archive" },
  http: { namespace: "hashicorp", name: "http" },
};

/**
 * Lookup a provider's latest version from the OpenTofu registry.
 * Accepts common aliases (aws, azure, gcp) or full names (hashicorp/aws).
 */
export async function lookupProvider(query: string): Promise<ProviderInfo | null> {
  // Parse "namespace/name" format
  let namespace: string;
  let name: string;

  if (query.includes("/")) {
    [namespace, name] = query.split("/", 2);
  } else {
    const known = KNOWN_PROVIDERS[query.toLowerCase()];
    if (known) {
      namespace = known.namespace;
      name = known.name;
    } else {
      // Try hashicorp namespace as default
      namespace = "hashicorp";
      name = query.toLowerCase();
    }
  }

  try {
    const url = `${REGISTRY_BASE}/providers/${namespace}/${name}/versions`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as { versions: { version: string }[] };
    const versions = data.versions
      .map((v) => v.version)
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v)) // stable only
      .sort((a, b) => {
        const ap = a.split(".").map(Number);
        const bp = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if (ap[i] !== bp[i]) return bp[i] - ap[i];
        }
        return 0;
      });

    if (versions.length === 0) return null;

    return {
      namespace,
      name,
      latestVersion: versions[0],
      allVersions: versions.slice(0, 20), // Top 20
      source: `${namespace}/${name}`,
    };
  } catch {
    return null;
  }
}

/**
 * Search for providers matching a query.
 * Uses known providers list + registry lookup.
 */
export async function searchProviders(query: string): Promise<ProviderInfo[]> {
  const q = query.toLowerCase();
  const results: ProviderInfo[] = [];

  // Check known providers first
  const matches = Object.entries(KNOWN_PROVIDERS).filter(
    ([key, val]) =>
      key.includes(q) || val.name.includes(q) || val.namespace.includes(q),
  );

  // Deduplicate by source
  const seen = new Set<string>();
  for (const [, { namespace, name }] of matches) {
    const source = `${namespace}/${name}`;
    if (seen.has(source)) continue;
    seen.add(source);

    const info = await lookupProvider(source);
    if (info) results.push(info);
  }

  // If no known matches, try direct lookup
  if (results.length === 0) {
    const info = await lookupProvider(q);
    if (info) results.push(info);
  }

  return results;
}

/**
 * Generate the required_providers HCL block for given providers.
 * Fetches latest versions from the registry.
 */
export async function generateRequiredProviders(
  providerNames: string[],
): Promise<Record<string, { source: string; version: string }>> {
  const providers: Record<string, { source: string; version: string }> = {};

  for (const name of providerNames) {
    const info = await lookupProvider(name);
    if (info) {
      // Use the provider's registry name as the HCL key
      const hclKey = info.name === "azurerm" ? "azurerm"
        : info.name === "google" ? "google"
        : info.name === "alicloud" ? "alicloud"
        : info.name;

      // Pin to major version
      const major = info.latestVersion.split(".")[0];
      providers[hclKey] = {
        source: `${info.namespace}/${info.name}`,
        version: `~> ${major}.0`,
      };
    }
  }

  return providers;
}
