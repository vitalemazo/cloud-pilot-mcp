// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import type { AuditEntry, AuditLogger } from "../interfaces/audit.js";

export class FileAuditLogger implements AuditLogger {
  name = "file";
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async log(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.path, line, "utf-8");
  }

  async query(filter: Partial<AuditEntry>, limit = 50): Promise<AuditEntry[]> {
    if (!existsSync(this.path)) return [];

    const lines = readFileSync(this.path, "utf-8").trim().split("\n").filter(Boolean);
    const entries: AuditEntry[] = lines.map((l) => JSON.parse(l) as AuditEntry);

    const filtered = entries.filter((entry) => {
      for (const [key, value] of Object.entries(filter)) {
        if (entry[key as keyof AuditEntry] !== value) return false;
      }
      return true;
    });

    return filtered.slice(-limit);
  }
}
