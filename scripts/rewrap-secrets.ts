/**
 * Operator script: re-encrypt all connector and AI secrets with the current key.
 *
 * Run this after rotating JARVIS_*_SECRET_KEY_ID to force-rewrap every row so
 * the old key can be retired from the keyring promptly. Safe to run multiple
 * times — it is idempotent (already-current envelopes get re-encrypted with
 * the same key, which is a no-op in practice).
 *
 * Usage:
 *   JARVIS_CONNECTOR_SECRET_KEY=... JARVIS_AI_SECRET_KEY=... \
 *   JARVIS_CONNECTOR_SECRET_KEYS='{"v1":"old"}' JARVIS_AI_SECRET_KEYS='{"v1":"old"}' \
 *   JARVIS_CONNECTOR_SECRET_KEY_ID=v2 JARVIS_AI_SECRET_KEY_ID=v2 \
 *   pnpm tsx scripts/rewrap-secrets.ts
 *
 * See docs/operations/secret-key-rotation.md for the full runbook.
 */
import { randomUUID } from "node:crypto";

import { createConnectorSecretCipher } from "@jarv1s/connectors";
import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { createAiSecretCipher } from "@jarv1s/ai";

async function main(): Promise<void> {
  const db = createDatabase({ connectionString: getJarvisDatabaseUrls().bootstrap });
  const connectorCipher = createConnectorSecretCipher();
  const aiCipher = createAiSecretCipher();
  const dataContext = new DataContextRunner(db);

  // Enumerate distinct owner user ids from both tables (root query, no RLS)
  const connectorOwners = await db
    .selectFrom("app.connector_accounts")
    .select("owner_user_id")
    .distinct()
    .execute();

  const connectorPendingOwners = await db
    .selectFrom("app.connector_oauth_pending")
    .select("owner_user_id")
    .distinct()
    .execute();

  const aiOwners = await db
    .selectFrom("app.ai_provider_configs")
    .select("owner_user_id")
    .distinct()
    .execute();

  const allUserIds = new Set<string>([
    ...connectorOwners.map((r) => r.owner_user_id),
    ...connectorPendingOwners.map((r) => r.owner_user_id),
    ...aiOwners.map((r) => r.owner_user_id)
  ]);

  console.log(`Rewrapping secrets for ${allUserIds.size} user(s)…`);

  let connectorRewrapped = 0;
  let connectorPendingRewrapped = 0;
  let aiRewrapped = 0;

  for (const userId of allUserIds) {
    const accessContext = { actorUserId: userId, requestId: randomUUID() };

    await dataContext.withDataContext(accessContext, async (scopedDb) => {
      // Rewrap connector_accounts
      const connectorRows = await scopedDb.db
        .selectFrom("app.connector_accounts")
        .select(["id", "encrypted_secret"])
        .execute();

      for (const row of connectorRows) {
        const plaintext = connectorCipher.decryptJson(
          row.encrypted_secret as Parameters<typeof connectorCipher.decryptJson>[0]
        );
        const rewrapped = connectorCipher.encryptJson(plaintext);
        await scopedDb.db
          .updateTable("app.connector_accounts")
          .set({ encrypted_secret: rewrapped })
          .where("id", "=", row.id)
          .execute();
        connectorRewrapped++;
        console.log(`  connector_accounts row ${row.id} — rewrapped → keyId:${rewrapped.keyId}`);
      }

      // Rewrap connector_oauth_pending
      const pendingRows = await scopedDb.db
        .selectFrom("app.connector_oauth_pending")
        .select(["id", "encrypted_secret"])
        .execute();

      for (const row of pendingRows) {
        const plaintext = connectorCipher.decryptJson(
          row.encrypted_secret as Parameters<typeof connectorCipher.decryptJson>[0]
        );
        const rewrapped = connectorCipher.encryptJson(plaintext);
        await scopedDb.db
          .updateTable("app.connector_oauth_pending")
          .set({ encrypted_secret: rewrapped })
          .where("id", "=", row.id)
          .execute();
        connectorPendingRewrapped++;
        console.log(
          `  connector_oauth_pending row ${row.id} — rewrapped → keyId:${rewrapped.keyId}`
        );
      }

      // Rewrap ai_provider_configs
      const aiRows = await scopedDb.db
        .selectFrom("app.ai_provider_configs")
        .select(["id", "encrypted_credential"])
        .where("encrypted_credential", "is not", null)
        .execute();

      for (const row of aiRows) {
        if (!row.encrypted_credential) continue;
        const plaintext = aiCipher.decryptJson(
          row.encrypted_credential as Parameters<typeof aiCipher.decryptJson>[0]
        );
        const rewrapped = aiCipher.encryptJson(plaintext);
        await scopedDb.db
          .updateTable("app.ai_provider_configs")
          .set({ encrypted_credential: rewrapped })
          .where("id", "=", row.id)
          .execute();
        aiRewrapped++;
        console.log(`  ai_provider_configs row ${row.id} — rewrapped → keyId:${rewrapped.keyId}`);
      }
    });
  }

  console.log(
    `Done. Rewrapped: ${connectorRewrapped} connector_accounts, ` +
      `${connectorPendingRewrapped} connector_oauth_pending, ` +
      `${aiRewrapped} ai_provider_configs.`
  );

  await db.destroy();
}

main().catch((err: unknown) => {
  console.error("rewrap-secrets failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
