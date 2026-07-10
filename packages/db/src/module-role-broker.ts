// Slice 2 (#914): per-module Postgres role lifecycle. Two roles per installed module:
// jarvis_mod_<slug>_runtime (NOLOGIN, granted to the parent runtime roles WITH INHERIT FALSE so
// they must SET LOCAL ROLE to use it — see module-storage-rpc.ts) and jarvis_mod_<slug>_install
// (NOLOGIN at rest, flipped to LOGIN with a random in-memory password only for the duration of
// Phase B, flipped back in Phase D regardless of outcome). Mirrors the idempotent
// DO $$ ... IF NOT EXISTS ... ELSE ... END $$ pattern in infra/postgres/bootstrap/0000_roles.sql.
import { randomBytes } from "node:crypto";

import { Client } from "pg";

// Mirrors packages/module-registry/src/external/validate.ts's MODULE_ID_RE. Duplicated rather
// than imported: module-registry already depends on @jarv1s/db, so importing the other way would
// create a package cycle.
const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function assertValidModuleId(moduleId: string): void {
  if (!MODULE_ID_RE.test(moduleId)) {
    throw new Error(`invalid module id "${moduleId}"`);
  }
}

function moduleSlugForRole(moduleId: string): string {
  assertValidModuleId(moduleId);
  return moduleId.replace(/-/g, "_");
}

export function moduleRuntimeRoleName(moduleId: string): string {
  return `jarvis_mod_${moduleSlugForRole(moduleId)}_runtime`;
}

export function moduleInstallRoleName(moduleId: string): string {
  return `jarvis_mod_${moduleSlugForRole(moduleId)}_install`;
}

export interface ModuleRoles {
  readonly runtimeRole: string;
  readonly installRole: string;
}

/** Phase A: idempotently create both roles (NOLOGIN) and grant the runtime role to the parent runtime roles. */
export async function ensureModuleRoles(
  connectionString: string,
  moduleId: string
): Promise<ModuleRoles> {
  const runtimeRole = moduleRuntimeRoleName(moduleId);
  const installRole = moduleInstallRoleName(moduleId);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const role of [runtimeRole, installRole]) {
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
             EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ' ||
               'NOINHERIT NOREPLICATION NOBYPASSRLS', '${role}');
           END IF;
         END $$;`
      );
    }
    await client.query(
      `GRANT ${client.escapeIdentifier(runtimeRole)} TO jarvis_app_runtime, jarvis_worker_runtime ` +
        `WITH INHERIT FALSE`
    );
  } finally {
    await client.end();
  }
  return { runtimeRole, installRole };
}

/** Phase A/B boundary: flips the installer role to LOGIN with a fresh random password, returned only in memory. */
export async function enableInstallerLogin(
  connectionString: string,
  moduleId: string
): Promise<string> {
  const installRole = moduleInstallRoleName(moduleId);
  const password = randomBytes(24).toString("base64url");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `ALTER ROLE ${client.escapeIdentifier(installRole)} LOGIN PASSWORD ` +
        client.escapeLiteral(password)
    );
  } finally {
    await client.end();
  }
  return password;
}

/** Phase D: flips the installer role back to NOLOGIN and clears its password, regardless of install outcome. */
export async function disableInstallerLogin(
  connectionString: string,
  moduleId: string
): Promise<void> {
  const installRole = moduleInstallRoleName(moduleId);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${client.escapeIdentifier(installRole)} NOLOGIN PASSWORD NULL`);
  } finally {
    await client.end();
  }
}
