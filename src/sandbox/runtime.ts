// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getQuickJS } from "quickjs-emscripten";
import type { QuickJSHandle } from "quickjs-emscripten";

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
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(options.memoryLimitMB * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);

  const logs: string[] = [];
  const vm = runtime.newContext();

  try {
    // Inject console.log
    const logHandle = vm.newFunction("log", (...args: QuickJSHandle[]) => {
      const parts = args.map((a) => {
        const val = vm.dump(a);
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      });
      logs.push(parts.join(" "));
    });
    const consoleHandle = vm.newObject();
    vm.setProp(consoleHandle, "log", logHandle);
    vm.setProp(consoleHandle, "error", logHandle);
    vm.setProp(vm.global, "console", consoleHandle);
    consoleHandle.dispose();
    logHandle.dispose();

    // Inject _request bridge as a sync function that stores pending calls
    // Since QuickJS doesn't support async host functions natively,
    // we use a request queue pattern
    const pendingRequests: Array<{
      service: string;
      action: string;
      params: string;
      resolve: (result: string) => void;
    }> = [];

    const requestHandle = vm.newFunction(
      "_request",
      (serviceH: QuickJSHandle, actionH: QuickJSHandle, paramsH: QuickJSHandle) => {
        const service = vm.getString(serviceH);
        const action = vm.getString(actionH);
        const params = vm.getString(paramsH);

        // We'll handle this synchronously by blocking — see executeWithBridge below
        let result: string | undefined;
        pendingRequests.push({
          service,
          action,
          params,
          resolve: (r) => {
            result = r;
          },
        });

        // Return a placeholder — the actual async handling happens in the wrapper
        if (result !== undefined) {
          return vm.newString(result);
        }
        return vm.newString('{"error":"async bridge not resolved"}');
      },
    );
    vm.setProp(vm.global, "_request", requestHandle);
    requestHandle.dispose();

    // Bootstrap the sdk object with a synchronous request wrapper
    const bootstrap = `
      var sdk = {
        request: function(opts) {
          var service = opts.service;
          var action = opts.action;
          var params = JSON.stringify(opts.params || {});
          var resultStr = _request(service, action, params);
          return JSON.parse(resultStr);
        }
      };
    `;

    const bootstrapResult = vm.evalCode(bootstrap);
    if (bootstrapResult.error) {
      const err = vm.dump(bootstrapResult.error);
      bootstrapResult.error.dispose();
      return { success: false, output: null, error: `Bootstrap failed: ${JSON.stringify(err)}`, logs };
    }
    bootstrapResult.value.dispose();

    // Execute with a timeout using interrupt handler
    let timedOut = false;
    const deadline = Date.now() + options.timeoutMs;
    runtime.setInterruptHandler(() => {
      if (Date.now() > deadline) {
        timedOut = true;
        return true;
      }
      return false;
    });

    // For synchronous execution, we resolve requests inline.
    // For a production async version, we'd need a more sophisticated approach.
    // This works because cloud API calls are awaited one at a time in the sandbox.
    const wrappedCode = `
      (function() {
        ${code}
      })();
    `;

    // Pre-resolve all requests synchronously by running the code,
    // collecting requests, resolving them, and re-running if needed.
    // For v0.1, we use a simpler approach: make the bridge sync.
    const resolvedCache = new Map<string, string>();

    const executeWithRetries = async (): Promise<SandboxResult> => {
      // Override _request with one that can use the cache
      const syncRequestHandle = vm.newFunction(
        "_request",
        (serviceH: QuickJSHandle, actionH: QuickJSHandle, paramsH: QuickJSHandle) => {
          const service = vm.getString(serviceH);
          const action = vm.getString(actionH);
          const params = vm.getString(paramsH);
          const cacheKey = `${service}:${action}:${params}`;

          const cached = resolvedCache.get(cacheKey);
          if (cached) {
            return vm.newString(cached);
          }

          // Not cached — return a marker so we know to resolve and retry
          return vm.newString(JSON.stringify({ __pending: true, service, action, params }));
        },
      );
      vm.setProp(vm.global, "_request", syncRequestHandle);
      syncRequestHandle.dispose();

      const result = vm.evalCode(wrappedCode);

      if (result.error) {
        const err = vm.dump(result.error);
        result.error.dispose();
        if (timedOut) {
          return { success: false, output: null, error: "Execution timed out", logs };
        }
        return { success: false, output: null, error: JSON.stringify(err), logs };
      }

      const output = vm.dump(result.value);
      result.value.dispose();

      // Check if there were unresolved requests in the output or logs
      // For v0.1, we resolve all _request calls before execution
      return { success: true, output, logs };
    };

    // Pre-flight: extract all API calls by doing a dry parse,
    // then resolve them and inject into cache.
    // For now, support the simple case: resolve on first call.
    // We'll enhance this with proper async support in v0.2.

    // Simple approach: wrap each sdk.request to be truly sync via the bridge
    const overrideBootstrap = `
      var __requestResults = {};
      var __requestQueue = [];
      sdk.request = function(opts) {
        var key = opts.service + ":" + opts.action + ":" + JSON.stringify(opts.params || {});
        if (__requestResults[key]) {
          return JSON.parse(__requestResults[key]);
        }
        var resultStr = _request(opts.service, opts.action, JSON.stringify(opts.params || {}));
        var parsed = JSON.parse(resultStr);
        if (parsed.__pending) {
          __requestQueue.push(key);
          return parsed;
        }
        __requestResults[key] = resultStr;
        return parsed;
      };
    `;

    const overrideResult = vm.evalCode(overrideBootstrap);
    if (overrideResult.error) {
      overrideResult.error.dispose();
    } else {
      overrideResult.value.dispose();
    }

    // First pass: collect all needed API calls
    let evalResult = vm.evalCode(wrappedCode);
    if (evalResult.error) {
      const err = vm.dump(evalResult.error);
      evalResult.error.dispose();
      return { success: false, output: null, error: JSON.stringify(err), logs };
    }
    evalResult.value.dispose();

    // Check for pending requests
    const queueResult = vm.evalCode("JSON.stringify(__requestQueue)");
    if (!queueResult.error) {
      const queue = JSON.parse(vm.getString(queueResult.value)) as string[];
      queueResult.value.dispose();

      // Resolve all pending requests
      for (const key of queue) {
        if (!resolvedCache.has(key)) {
          const [service, action, params] = key.split(":");
          const result = await requestBridge(service, action, params);
          resolvedCache.set(key, result);
        }
      }

      // If there were pending requests, re-run with resolved cache
      if (queue.length > 0) {
        // Inject resolved results
        for (const [key, value] of resolvedCache) {
          const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const injectResult = vm.evalCode(`__requestResults['${key}'] = '${escaped}';`);
          if (!injectResult.error) {
            injectResult.value.dispose();
          } else {
            injectResult.error.dispose();
          }
        }

        // Clear logs for clean re-run
        logs.length = 0;

        return executeWithRetries();
      }
    } else {
      queueResult.error.dispose();
    }

    return { success: true, output: null, logs };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
