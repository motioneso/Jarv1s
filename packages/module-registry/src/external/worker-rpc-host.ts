import { sql } from "kysely";

import {
  createModuleStorageRpc,
  ModuleQueryError,
  type DataContextDb,
  type DataContextRunner
} from "@jarv1s/db";
import type { ModuleAssistantToolRisk } from "@jarv1s/module-sdk";
import type { ModuleFetchRequest, ModuleFetchResponse } from "@jarv1s/module-sdk";
import { createHostPinnedFetch } from "@jarv1s/host-fetch";
import {
  deleteModuleKvKey,
  getModuleKvValue,
  listModuleKvKeys,
  readModuleCredentialSecret,
  recordAuditEvent,
  setModuleKvValue,
  upsertModuleCredential,
  type ModuleCredentialCipher
} from "@jarv1s/settings";

import type { ExternalModuleDiscovery } from "./types.js";

export class ExternalModuleRpcError extends Error {
  constructor(
    readonly code:
      | "credential_missing"
      | "undeclared_auth"
      | "undeclared_namespace"
      | "forbidden_kv_mutation"
      | "forbidden_instance_kv_write"
      | "forbidden_instance_credential_write"
      | "forbidden_credential_write"
      | "credential_value_invalid"
      | "forbidden_ai_call"
      | "forbidden_secret_in_ai_input"
      | "undeclared_database"
      | "forbidden_db_statement"
      | "forbidden_db_mutation"
      | "invalid_rpc"
  ) {
    super(code);
    this.name = "ExternalModuleRpcError";
  }
}

export interface ExternalModuleAiRequest {
  readonly schema: Record<string, unknown>;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly tierHint?: "reasoning" | "interactive" | "economy";
}

// "usage_limited" is produced by the RPC layer's per-invocation cap (spec D6);
// the injected callback itself only ever returns the other four.
export type ExternalModuleAiError =
  | "needs_config"
  | "validation_failed"
  | "provider_error"
  | "usage_limited"
  | "aborted";

export type ExternalModuleAiResult =
  | { readonly ok: true; readonly object: unknown }
  | { readonly ok: false; readonly error: ExternalModuleAiError };

// Max ctx.ai.generateStructured calls per tool invocation (spec D6: platform
// config, enforced in parent memory — the handler is built per invocation).
export const AI_CALLS_PER_INVOCATION_CAP = 8;

const AI_ERRORS = new Set<string>([
  "needs_config",
  "validation_failed",
  "provider_error",
  "usage_limited",
  "aborted"
]);
const AI_TIERS = new Set(["reasoning", "interactive", "economy"]);
const AI_MAX_OUTPUT_TOKENS_CAP = 32_768;

export function createExternalModuleRpcHandler(input: {
  readonly module: ExternalModuleDiscovery;
  readonly toolRisk: ModuleAssistantToolRisk;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly workerDataContext: DataContextRunner;
  readonly cipher: ModuleCredentialCipher;
  readonly isActorAdmin: () => Promise<boolean>;
  readonly createFetch?: (allowedHosts: readonly string[]) => typeof fetch;
  readonly ai?: (
    scopedDb: DataContextDb,
    request: ExternalModuleAiRequest
  ) => Promise<ExternalModuleAiResult>;
}): (method: string, params: unknown, rememberSecret: (value: string) => void) => Promise<unknown> {
  const declarations = new Map((input.module.manifest.auth ?? []).map((item) => [item.id, item]));
  const storage = new Map(
    (input.module.manifest.storage ?? []).map((item) => [item.namespace, item])
  );
  // Per-invocation state: the handler is constructed per tool invocation, so
  // these closures implement D6's composition guard and call cap in memory.
  const resolvedSecrets = new Set<string>();
  let aiCalls = 0;

  return async (method, rawParams, rememberSecret) => {
    const params = record(rawParams);
    if (method === "fetch.request") {
      const request = fetchRequest(params);
      const hosts = input.module.manifest.fetchHosts;
      if (!hosts?.length) throw new ExternalModuleRpcError("invalid_rpc");
      const response = await (input.createFetch ?? createHostPinnedFetch)(hosts)(request.url, {
        method: request.method ?? "GET",
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.bodyBase64
          ? { body: new Uint8Array(Buffer.from(request.bodyBase64, "base64")) }
          : {})
      });
      const headers: Record<string, string> = {};
      for (const name of ["content-type", "content-length", "last-modified", "etag"]) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      return {
        status: response.status,
        headers,
        bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64")
      } satisfies ModuleFetchResponse;
    }
    return input.workerDataContext.withDataContext(
      { actorUserId: input.actorUserId, requestId: input.requestId },
      async (scopedDb) => {
        await sql`SELECT set_config('app.current_module_id', ${input.module.id}, true)`.execute(
          scopedDb.db
        );

        if (method === "db.query") {
          // #1167: only modules that declared owned tables get the SQL door; the
          // tables themselves are created/guarded by the platform installer (RLS,
          // owner-only, jarvis_mod_<slug>_runtime role) — this check is the manifest
          // gate, not the security boundary.
          const ownedTables = input.module.manifest.database?.ownedTables ?? [];
          if (ownedTables.length === 0) throw new ExternalModuleRpcError("undeclared_database");
          const text = stringParam(params, "text");
          if (params.params !== undefined && !Array.isArray(params.params)) {
            throw new ExternalModuleRpcError("invalid_rpc");
          }
          const storageRpc = createModuleStorageRpc(scopedDb, input.module.id, {
            // Read-risk tools must not mutate — same policy as kv.set's
            // forbidden_kv_mutation. "write" and "destructive" may.
            readOnly: input.toolRisk === "read"
          });
          try {
            return await storageRpc.query(
              text,
              (params.params as readonly unknown[] | undefined) ?? []
            );
          } catch (error) {
            if (error instanceof ModuleQueryError) {
              if (error.code === "forbidden_statement") {
                throw new ExternalModuleRpcError("forbidden_db_statement");
              }
              if (error.code === "forbidden_mutation") {
                throw new ExternalModuleRpcError("forbidden_db_mutation");
              }
            }
            // Cap and db_query_failed errors cross as-is: already redacted at the
            // @jarv1s/db layer (SQLSTATE + primary message only, no detail/hint).
            // worker-runtime.ts forwards workers a generic rpc_failed regardless and
            // logs nothing for rpc errors (verified #1167 grounding).
            throw error;
          }
        }

        if (method === "ai.generateStructured") {
          // Handlers built without the ai dep (e.g. the queued-jobs path) fail
          // closed: resume prose must never flow through pg-boss payloads.
          if (!input.ai) throw new ExternalModuleRpcError("invalid_rpc");
          if (input.toolRisk === "read") throw new ExternalModuleRpcError("forbidden_ai_call");
          const request = aiRequest(params);
          // D6 composition guard: reject prompts/schemas containing any credential
          // resolved via auth.getCredential during this invocation (defense in
          // depth on top of the child-side transport containsSecret check).
          const schemaJson = JSON.stringify(request.schema);
          for (const secret of resolvedSecrets) {
            if (request.prompt.includes(secret) || schemaJson.includes(secret)) {
              throw new ExternalModuleRpcError("forbidden_secret_in_ai_input");
            }
          }
          aiCalls += 1;
          if (aiCalls > AI_CALLS_PER_INVOCATION_CAP) {
            return { ok: false, error: "usage_limited" } satisfies ExternalModuleAiResult;
          }
          const result = await input.ai(scopedDb, request);
          // Rebuild the envelope from scratch: host-side extras (usage, model or
          // provider ids) must never cross into module workers.
          if (result.ok) return { ok: true, object: result.object };
          return {
            ok: false,
            error: AI_ERRORS.has(result.error) ? result.error : "provider_error"
          } satisfies ExternalModuleAiResult;
        }

        if (method === "auth.getCredential") {
          const authId = stringParam(params, "authId");
          const declaration = declarations.get(authId);
          if (!declaration) throw new ExternalModuleRpcError("undeclared_auth");
          const envelope = await readModuleCredentialSecret(scopedDb, {
            moduleId: input.module.id,
            credentialId: authId,
            scope: declaration.scope,
            ownerUserId: declaration.scope === "user" ? input.actorUserId : null
          });
          if (!envelope) throw new ExternalModuleRpcError("credential_missing");
          const value = input.cipher.decryptJson(envelope).value;
          if (typeof value !== "string") throw new ExternalModuleRpcError("credential_missing");
          rememberSecret(value);
          resolvedSecrets.add(value);
          return value;
        }

        if (method === "auth.setCredential") {
          // FIN-00 #1145: workers may persist runtime-minted secrets (e.g. an
          // OAuth-style token exchange) into DECLARED, USER-scope slots only.
          // Instance slots stay human-written via admin settings routes, and
          // migration 0171 enforces the same rule at the database.
          const authId = stringParam(params, "authId");
          const declaration = declarations.get(authId);
          if (!declaration) throw new ExternalModuleRpcError("undeclared_auth");
          if (declaration.scope !== "user") {
            throw new ExternalModuleRpcError("forbidden_instance_credential_write");
          }
          if (input.toolRisk === "read") {
            throw new ExternalModuleRpcError("forbidden_credential_write");
          }
          const value = params.value;
          if (
            typeof value !== "string" ||
            value.length === 0 ||
            Buffer.byteLength(value, "utf8") > 32 * 1024
          ) {
            throw new ExternalModuleRpcError("credential_value_invalid");
          }
          await upsertModuleCredential(
            scopedDb,
            {
              moduleId: input.module.id,
              credentialId: authId,
              scope: "user",
              ownerUserId: input.actorUserId,
              displayName: declaration.displayName,
              encryptedSecret: input.cipher.encryptJson({ value }),
              actorUserId: input.actorUserId,
              requestId: input.requestId
            },
            // Metadata-only audit via the sanctioned cross-module API; override
            // the repository's default action so worker writes are distinguishable
            // from owner-PUT writes in the audit trail (spec D1).
            (event) =>
              recordAuditEvent(scopedDb, { ...event, action: "module.credential.worker-set" })
          );
          // Same redaction posture as getCredential: the just-written value must
          // never appear in ai/fetch inputs or worker stdout for this invocation.
          rememberSecret(value);
          resolvedSecrets.add(value);
          return undefined;
        }

        const scope = scopeParam(params);
        const namespace = stringParam(params, "namespace");
        const declaration = storage.get(namespace);
        if (!declaration || !declaration.scopes.includes(scope)) {
          throw new ExternalModuleRpcError("undeclared_namespace");
        }
        const ownerUserId = scope === "user" ? input.actorUserId : null;
        const base = { moduleId: input.module.id, namespace, scope, ownerUserId };
        if (method === "kv.list") return listModuleKvKeys(scopedDb, base);
        const key = stringParam(params, "key");
        const target = { ...base, key };
        if (method === "kv.get") return getModuleKvValue(scopedDb, target);
        if (method !== "kv.set" && method !== "kv.delete") {
          throw new ExternalModuleRpcError("invalid_rpc");
        }
        if (input.toolRisk === "read") {
          throw new ExternalModuleRpcError("forbidden_kv_mutation");
        }
        // FIN-00 #1145: default stays admin-gated; a namespace whose reviewed,
        // hash-pinned manifest declares instanceWritePolicy "module" opts its
        // instance rows into handler writes for any acting user.
        if (
          scope === "instance" &&
          declaration.instanceWritePolicy !== "module" &&
          !(await input.isActorAdmin())
        ) {
          throw new ExternalModuleRpcError("forbidden_instance_kv_write");
        }
        if (method === "kv.delete") return deleteModuleKvKey(scopedDb, target);
        const value = record(params.value);
        await setModuleKvValue(scopedDb, target, value);
        return undefined;
      }
    );
  };
}

function fetchRequest(value: Record<string, unknown>): ModuleFetchRequest {
  const allowed = new Set(["url", "method", "headers", "bodyBase64"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.url !== "string" ||
    (value.method !== undefined && value.method !== "GET" && value.method !== "POST") ||
    (value.bodyBase64 !== undefined &&
      (typeof value.bodyBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64)))
  ) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  let headers: Record<string, string> | undefined;
  if (value.headers !== undefined) {
    const raw = record(value.headers);
    if (Object.values(raw).some((header) => typeof header !== "string")) {
      throw new ExternalModuleRpcError("invalid_rpc");
    }
    headers = raw as Record<string, string>;
  }
  if ((value.method ?? "GET") === "GET" && value.bodyBase64 !== undefined) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  return {
    url: value.url,
    ...(value.method === undefined ? {} : { method: value.method }),
    ...(headers === undefined ? {} : { headers }),
    ...(value.bodyBase64 === undefined ? {} : { bodyBase64: value.bodyBase64 as string })
  };
}

function aiRequest(value: Record<string, unknown>): ExternalModuleAiRequest {
  const allowed = new Set(["schema", "prompt", "maxOutputTokens", "tierHint"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.prompt !== "string" ||
    value.prompt.length === 0 ||
    (value.maxOutputTokens !== undefined &&
      (!Number.isInteger(value.maxOutputTokens) ||
        (value.maxOutputTokens as number) <= 0 ||
        (value.maxOutputTokens as number) > AI_MAX_OUTPUT_TOKENS_CAP)) ||
    (value.tierHint !== undefined && !AI_TIERS.has(value.tierHint as string))
  ) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  const schema = record(value.schema);
  return {
    schema,
    prompt: value.prompt,
    ...(value.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: value.maxOutputTokens as number }),
    ...(value.tierHint === undefined
      ? {}
      : { tierHint: value.tierHint as ExternalModuleAiRequest["tierHint"] })
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  return value as Record<string, unknown>;
}

function stringParam(value: Record<string, unknown>, key: string): string {
  const found = value[key];
  if (typeof found !== "string" || found.length === 0) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  return found;
}

function scopeParam(value: Record<string, unknown>): "instance" | "user" {
  const scope = value.scope;
  if (scope !== "instance" && scope !== "user") {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  return scope;
}
