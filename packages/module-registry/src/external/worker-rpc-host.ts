import { sql } from "kysely";

import type { DataContextRunner } from "@jarv1s/db";
import type { ModuleAssistantToolRisk } from "@jarv1s/module-sdk";
import {
  deleteModuleKvKey,
  getModuleKvValue,
  listModuleKvKeys,
  readModuleCredentialSecret,
  setModuleKvValue,
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
      | "invalid_rpc"
  ) {
    super(code);
    this.name = "ExternalModuleRpcError";
  }
}

export function createExternalModuleRpcHandler(input: {
  readonly module: ExternalModuleDiscovery;
  readonly toolRisk: ModuleAssistantToolRisk;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly workerDataContext: DataContextRunner;
  readonly cipher: ModuleCredentialCipher;
  readonly isActorAdmin: () => Promise<boolean>;
}): (method: string, params: unknown, rememberSecret: (value: string) => void) => Promise<unknown> {
  const declarations = new Map((input.module.manifest.auth ?? []).map((item) => [item.id, item]));
  const storage = new Map(
    (input.module.manifest.storage ?? []).map((item) => [item.namespace, item])
  );

  return async (method, rawParams, rememberSecret) => {
    const params = record(rawParams);
    return input.workerDataContext.withDataContext(
      { actorUserId: input.actorUserId, requestId: input.requestId },
      async (scopedDb) => {
        await sql`SELECT set_config('app.current_module_id', ${input.module.id}, true)`.execute(
          scopedDb.db
        );

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
          return value;
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
        if (scope === "instance" && !(await input.isActorAdmin())) {
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
