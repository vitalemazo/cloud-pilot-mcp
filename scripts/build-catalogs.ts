#!/usr/bin/env tsx

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { SpecFetcher } from "../src/specs/spec-fetcher.js";

async function main() {
  const fetcher = new SpecFetcher();
  const dataDir = resolve(dirname(import.meta.url.replace("file://", "")), "..", "data");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  console.log("Building bundled catalogs...\n");

  // AWS
  console.log("Fetching AWS catalog from botocore Git tree...");
  const awsCatalog = await fetcher.fetchAwsCatalog();
  const awsPath = resolve(dataDir, "aws-catalog.json");
  writeFileSync(awsPath, JSON.stringify(awsCatalog, null, 2));
  console.log(`  AWS: ${awsCatalog.length} services -> ${awsPath}`);

  // Azure
  console.log("Fetching Azure catalog from azure-rest-api-specs Git tree...");
  const azureCatalog = await fetcher.fetchAzureCatalog();
  const azurePath = resolve(dataDir, "azure-catalog.json");
  writeFileSync(azurePath, JSON.stringify(azureCatalog, null, 2));
  console.log(`  Azure: ${azureCatalog.length} services -> ${azurePath}`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
