// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface CatalogEntry {
  service: string;
  version?: string;
  path: string;
  fullName?: string;
}

export interface OperationIndexEntry {
  service: string;
  operation: string;
  method: string;
  description: string;
}

export interface CacheManifest {
  catalogFetchedAt: Record<string, number>;
  operationIndexFetchedAt: Record<string, number>;
  specsFetched: Record<string, Record<string, number>>;
}

export interface SpecsConfig {
  dynamic: boolean;
  cacheDir: string;
  catalogTtlDays: number;
  specTtlDays: number;
  maxMemorySpecs: number;
  offline: boolean;
}
