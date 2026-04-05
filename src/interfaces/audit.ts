export interface AuditEntry {
  timestamp: string;
  tool: "search" | "execute";
  provider: "aws" | "azure";
  service?: string;
  action?: string;
  params?: Record<string, unknown>;
  dryRun: boolean;
  success: boolean;
  error?: string;
  durationMs: number;
  sessionId?: string;
}

export interface AuditLogger {
  name: string;
  log(entry: AuditEntry): Promise<void>;
  query?(filter: Partial<AuditEntry>, limit?: number): Promise<AuditEntry[]>;
}
