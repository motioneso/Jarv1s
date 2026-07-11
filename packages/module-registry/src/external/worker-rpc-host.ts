import { sql } from "kysely";

import type { DataContextRunner } from "@jarv1s/db";
import type { ModuleAssistantToolRisk } from "@jarv1s/module-sdk";
import type { ModuleFetchRequest, ModuleFetchResponse } from "@jarv1s/module-sdk";
import { createHostPinnedFetch } from "@jarv1s/host-fetch";
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
  readonly createFetch?: (allowedHosts: readonly string[]) => typeof fetch;
}): (method: string, params: unknown, rememberSecret: (value: string) => void) => Promise<unknown> {
  const declarations = new Map((input.module.manifest.auth ?? []).map((item) => [item.id, item]));
  const storage = new Map(
    (input.module.manifest.storage ?? []).map((item) => [item.namespace, item])
  );

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
