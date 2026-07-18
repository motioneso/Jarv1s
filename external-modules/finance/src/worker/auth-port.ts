// external-modules/finance/src/worker/auth-port.ts
//
// FIN-01 (#1146) Task 5: the ONLY code in this module allowed to touch
// ctx.auth (checkpoint-doc invariant). Everything credential-shaped funnels
// through the two ports built here so the secret boundary stays auditable in
// one file: Plaid API keys (instance slots) come out read-only via CredsPort,
// and the per-user access-token map (user slot finance.plaid-tokens) is
// serialized/parsed exclusively via TokensPort. Access tokens never appear in
// KV, logs, job payloads, or handler results.
import { InputError } from "./validate.js";
import type { CredsPort, TokenMap, TokensPort } from "./ports.js";

// Structural mirror of ModuleWorkerContext["auth"] — not an SDK import, so
// this file (and its tests) stay bundler-independent like the kv port.
export interface WorkerAuth {
  getCredential(authId: string): Promise<string>;
  setCredential(authId: string, value: string): Promise<void>;
}

const CLIENT_ID_SLOT = "finance.plaid-client-id";
const SECRET_SLOT = "finance.plaid-secret";
const TOKENS_SLOT = "finance.plaid-tokens";

export function credsFromWorkerContext(auth: WorkerAuth): CredsPort {
  return {
    async get() {
      let clientId: string;
      let secret: string;
      try {
        [clientId, secret] = await Promise.all([
          auth.getCredential(CLIENT_ID_SLOT),
          auth.getCredential(SECRET_SLOT)
        ]);
      } catch {
        // The runtime collapses "missing" and "rpc failed" into one error;
        // either way the user-facing remediation is identical.
        throw new InputError("needs_config", "Plaid keys are not configured; ask an admin");
      }
      if (!clientId || !secret) {
        throw new InputError("needs_config", "Plaid keys are not configured; ask an admin");
      }
      return { clientId, secret };
    }
  };
}

export function tokensFromWorkerContext(auth: WorkerAuth): TokensPort {
  return {
    /**
     * null on ANY failure — credential_missing (first connect) is
     * indistinguishable from a transient RPC error at this layer, which is
     * exactly why callers must apply the D5 clobber guard before writing.
     */
    async read() {
      try {
        const raw = await auth.getCredential(TOKENS_SLOT);
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as TokenMap;
      } catch {
        return null;
      }
    },
    async write(map: TokenMap) {
      await auth.setCredential(TOKENS_SLOT, JSON.stringify(map));
    }
  };
}
