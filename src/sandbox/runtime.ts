// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createContext, Script } from "node:vm";

export interface SandboxOptions {
  memoryLimitMB: number;
  timeoutMs: number;
}

export interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  logs: string[];
}

export async function executeInSandbox(
  code: string,
  requestBridge: (service: string, action: string, params: string) => Promise<string>,
  options: SandboxOptions,
): Promise<SandboxResult> {
  const logs: string[] = [];

  // Build a minimal sandbox context — no require, process, fs, net, or
  // any Node.js API. Only console.log and sdk.request are available.
  const sandbox: Record<string, unknown> = Object.create(null);

  sandbox.console = Object.freeze({
    log: (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
    error: (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
  });

  sandbox.JSON = JSON;
  sandbox.Object = Object;
  sandbox.Array = Array;
  sandbox.String = String;
  sandbox.Number = Number;
  sandbox.Boolean = Boolean;
  sandbox.Math = Math;
  sandbox.Date = Date;
  sandbox.RegExp = RegExp;
  sandbox.Error = Error;
  sandbox.TypeError = TypeError;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;
  sandbox.isNaN = isNaN;
  sandbox.isFinite = isFinite;
  sandbox.encodeURIComponent = encodeURIComponent;
  sandbox.decodeURIComponent = decodeURIComponent;

  // The sdk.request bridge — async, delegates to the host which holds credentials.
  // The sandbox code never sees raw credentials.
  sandbox.sdk = Object.freeze({
    request: async (opts: { service: string; action: string; params?: Record<string, unknown> }) => {
      const resultStr = await requestBridge(
        opts.service,
        opts.action,
        JSON.stringify(opts.params || {}),
      );
      return JSON.parse(resultStr);
    },
  });

  const context = createContext(sandbox);

  // Wrap user code in an async IIFE so await works naturally
  const wrappedCode = `(async () => {\n${code}\n})()`;

  try {
    // Compile the script (syntax errors caught here)
    const script = new Script(wrappedCode, { filename: "sandbox.js" });

    // Run the script — returns a Promise from the async IIFE
    const promise = script.runInContext(context) as Promise<unknown>;

    // Race against timeout
    const result = await Promise.race([
      promise.then((output) => ({ ok: true as const, output })),
      new Promise<{ ok: false; error: string }>((resolve) =>
        setTimeout(
          () => resolve({ ok: false, error: "Execution timed out" }),
          options.timeoutMs,
        ),
      ),
    ]);

    if (!result.ok) {
      return { success: false, output: null, error: result.error, logs };
    }

    return { success: true, output: result.output ?? null, logs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: null, error: message, logs };
  }
}
