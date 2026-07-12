// Module credential repository (#918 Slice 2). Metadata-only reads, scrubbing revoke —
// see the plan's Security Design §B (plaintext-never-escapes guarantee). Mirrors
// repository-external-modules.ts's shape: standalone exported functions taking scopedDb +
// an audit-writer closure so the metadata-only audit write still routes through
// SettingsRepository.insertAuditEvent (a private method unreachable from here).
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type { EncryptedModuleCredentialSecret } from "./module-credential-crypto.js";
import type { ExternalModuleAuditWriter } from "./repository-external-modules.js";

export interface ModuleCredentialMetadataRow {
  readonly id: string;
  readonly module_id: string;
  readonly credential_id: string;
  readonly scope: "instance" | "user";
  readonly owner_user_id: string | null;
  readonly display_name: string;
  readonly has_secret: boolean;
  readonly revoked_at: Date | null;
  readonly updated_at: Date;
}

export interface UpsertModuleCredentialInput {
  readonly moduleId: string;
  readonly credentialId: string;
  readonly scope: "instance" | "user";
  /** null for scope='instance'; the acting user's own id for scope='user'. */
  readonly ownerUserId: string | null;
  readonly displayName: string;
  readonly encryptedSecret: EncryptedModuleCredentialSecret;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RevokeModuleCredentialInput {
  readonly moduleId: string;
  readonly credentialId: string;
  readonly scope: "instance" | "user";
  readonly ownerUserId: string | null;
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * Metadata projection only — encrypted_secret is NEVER selected here (Slice 2 has
 * no decrypt consumer at all; Slice 3's RPC gets its own query). RLS already scopes
 * rows: user rows to the actor, instance rows to admins (#918 Security Design §B).
 */
export async function listModuleCredentialMetadata(
  scopedDb: DataContextDb,
  moduleId: string
): Promise<ModuleCredentialMetadataRow[]> {
  assertDataContextDb(scopedDb);
  return await scopedDb.db
    .selectFrom("app.module_credentials")
    .select([
      "id",
      "module_id",
      "credential_id",
      "scope",
      "owner_user_id",
      "display_name",
      "revoked_at",
      "updated_at",
      sql<boolean>`encrypted_secret IS NOT NULL AND revoked_at IS NULL`.as("has_secret")
    ])
    .where("module_id", "=", moduleId)
    .orderBy("credential_id")
    .execute();
}

export async function readModuleCredentialSecret(
  scopedDb: DataContextDb,
  input: {
    readonly moduleId: string;
    readonly credentialId: string;
    readonly scope: "instance" | "user";
    readonly ownerUserId: string | null;
  }
): Promise<EncryptedModuleCredentialSecret | null> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.module_credentials")
    .select("encrypted_secret")
    .where("module_id", "=", input.moduleId)
    .where("credential_id", "=", input.credentialId)
    .where("scope", "=", input.scope)
    .where("owner_user_id", input.ownerUserId === null ? "is" : "=", input.ownerUserId as never)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return (row?.encrypted_secret as EncryptedModuleCredentialSecret | null | undefined) ?? null;
}

/**
 * Scope-shaped PARTIAL unique indexes (migration 0153) rule out a plain
 * .onConflict(columns) target, so upsert is SELECT -> UPDATE-or-INSERT. Safe: the
 * route runs this inside one withDataContext transaction, and the unique index still
 * backstops a lost race with a constraint error rather than a duplicate row.
 */
export async function upsertModuleCredential(
  scopedDb: DataContextDb,
  input: UpsertModuleCredentialInput,
  writeAudit: ExternalModuleAuditWriter
): Promise<void> {
  assertDataContextDb(scopedDb);
  const existing = await scopedDb.db
    .selectFrom("app.module_credentials")
    .select("id")
    .where("module_id", "=", input.moduleId)
    .where("credential_id", "=", input.credentialId)
    .where("scope", "=", input.scope)
    .where("owner_user_id", input.ownerUserId === null ? "is" : "=", input.ownerUserId as never)
    .executeTakeFirst();

  if (existing) {
    await scopedDb.db
      .updateTable("app.module_credentials")
      .set({
        display_name: input.displayName,
        encrypted_secret: input.encryptedSecret,
        revoked_at: null,
        updated_at: new Date()
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await scopedDb.db
      .insertInto("app.module_credentials")
      .values({
        id: randomUUID(),
        module_id: input.moduleId,
        credential_id: input.credentialId,
        scope: input.scope,
        owner_user_id: input.ownerUserId,
        display_name: input.displayName,
        encrypted_secret: input.encryptedSecret,
        created_by: input.actorUserId
      })
      .execute();
  }

  // SECURITY: metadata-only audit — ids and scope ONLY. Never the value, the
  // envelope, or even displayName (per-sink audit in the plan's Security Design §B).
  await writeAudit({
    actorUserId: input.actorUserId,
    action: "module.credential.set",
    targetType: "module_credential",
    targetId: `${input.moduleId}/${input.credentialId}`,
    metadata: { moduleId: input.moduleId, credentialId: input.credentialId, scope: input.scope },
    requestId: input.requestId
  });
}

/**
 * Revoke destroys the secret in place (UPDATE, not DELETE — app_runtime has no
 * DELETE grant on this protected table; migration 0153). Returns false when no
 * matching, not-already-revoked row exists so the route can 404.
 */
export async function revokeModuleCredential(
  scopedDb: DataContextDb,
  input: RevokeModuleCredentialInput,
  writeAudit: ExternalModuleAuditWriter
): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .updateTable("app.module_credentials")
    .set({
      encrypted_secret: null,
      revoked_at: new Date(),
      updated_at: new Date()
    })
    .where("module_id", "=", input.moduleId)
    .where("credential_id", "=", input.credentialId)
    .where("scope", "=", input.scope)
    .where("owner_user_id", input.ownerUserId === null ? "is" : "=", input.ownerUserId as never)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  const revoked = (result.numUpdatedRows ?? 0n) > 0n;
  if (revoked) {
    await writeAudit({
      actorUserId: input.actorUserId,
      action: "module.credential.revoke",
      targetType: "module_credential",
      targetId: `${input.moduleId}/${input.credentialId}`,
      metadata: { moduleId: input.moduleId, credentialId: input.credentialId, scope: input.scope },
      requestId: input.requestId
    });
  }
  return revoked;
}
