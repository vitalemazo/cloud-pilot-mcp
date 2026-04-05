import type { CloudProvider, CloudProviderCallResult } from "../interfaces/cloud-provider.js";
import type { AuditLogger, AuditEntry } from "../interfaces/audit.js";
import type { ProviderConfig } from "../config.js";

export interface ApiBridgeOptions {
  provider: CloudProvider;
  config: ProviderConfig;
  audit: AuditLogger;
  dryRun: boolean;
  sessionId?: string;
}

export function createApiBridge(opts: ApiBridgeOptions) {
  return async (
    service: string,
    action: string,
    paramsJson: string,
  ): Promise<string> => {
    const params = JSON.parse(paramsJson) as Record<string, unknown>;
    const start = Date.now();

    if (opts.dryRun) {
      const result = {
        dryRun: true,
        wouldCall: { provider: opts.provider.name, service, action, params },
      };

      await opts.audit.log({
        timestamp: new Date().toISOString(),
        tool: "execute",
        provider: opts.provider.name,
        service,
        action,
        params,
        dryRun: true,
        success: true,
        durationMs: Date.now() - start,
        sessionId: opts.sessionId,
      });

      return JSON.stringify(result);
    }

    let callResult: CloudProviderCallResult;
    try {
      callResult = await opts.provider.call(service, action, params);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await logAudit(opts, { service, action, params, start, success: false, error });
      return JSON.stringify({ success: false, error });
    }

    await logAudit(opts, {
      service,
      action,
      params,
      start,
      success: callResult.success,
      error: callResult.error,
    });

    return JSON.stringify(callResult);
  };
}

async function logAudit(
  opts: ApiBridgeOptions,
  ctx: {
    service: string;
    action: string;
    params: Record<string, unknown>;
    start: number;
    success: boolean;
    error?: string;
  },
): Promise<void> {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    tool: "execute",
    provider: opts.provider.name,
    service: ctx.service,
    action: ctx.action,
    params: ctx.params,
    dryRun: false,
    success: ctx.success,
    error: ctx.error,
    durationMs: Date.now() - ctx.start,
    sessionId: opts.sessionId,
  };
  await opts.audit.log(entry);
}
