# Secret-key versioning / rotation — Design (P1 #55)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #55 (Part of epic #46)

---

## Context

Two near-identical ciphers protect the system's stored third-party secrets:

- `packages/connectors/src/crypto.ts` — `ConnectorSecretCipher`, wraps Google OAuth tokens.
- `packages/ai/src/crypto.ts` — `AiSecretCipher`, wraps AI provider API keys.

Both derive the AES-256-GCM key with `createHash("sha256").update(JARVIS_*_SECRET_KEY)` and
emit an envelope `{ version: 1, algorithm: "aes-256-gcm", iv, tag, ciphertext }`
(connectors lines 14–27 / 55–67; ai identical). **The envelope carries no key id.** `version`
is the *envelope-format* version (hardcoded `1`, asserted on decrypt), not a key generation.

Consequence: there is exactly **one** key in play, derived purely from the env var. If the
operator rotates, fat-fingers, or loses `JARVIS_CONNECTOR_SECRET_KEY` / `JARVIS_AI_SECRET_KEY`,
`decryptJson` throws (GCM auth-tag mismatch) and **every stored Google token and AI credential
becomes permanently undecryptable** — silent until the next connector sync or AI call fails.
ADR 0007's House model (multiple users, each with their own AI keys / Google connections)
multiplies the blast radius. There is today no supported way to rotate the key.

**Storage shape (load-bearing for the migration question):** both ciphertexts are stored as a
**`jsonb` object column**, not discrete columns:

- `app.connector_accounts.encrypted_secret jsonb NOT NULL CHECK (jsonb_typeof(...) = 'object')`
  (`packages/connectors/sql/0009_connectors_module.sql` line 48). Also
  `connector_oauth_pending.encrypted_secret`.
- `app.ai_provider_configs.encrypted_credential jsonb NOT NULL CHECK (jsonb_typeof(...) =
  'object')` (`packages/ai/sql/0013_ai_module.sql` line 45).

The repositories read the whole envelope back out and hand it to the cipher
(`repository.ts`: `row.encrypted_secret as EncryptedConnectorSecret`), and write the cipher's
output straight back into the jsonb column. The cipher round-trips an opaque JSON object — the
**database never inspects the envelope's fields**, only that it is a JSON object.

---

## Goals

1. A **key id / version** inside the envelope so the cipher knows *which* key decrypts a row.
2. **Decrypt-with-old / encrypt-with-new:** the active cipher holds a keyring (current key +
   zero or more retired keys); it decrypts any envelope whose `keyId` it still has, and always
   encrypts with the current key.
3. **Existing ciphertext still decrypts** after the change (backward compatibility for
   envelopes with no `keyId`).
4. A documented **rotation runbook** (`docs/operations/`).

## Non-Goals

- Automatic/scheduled rotation, an HSM/KMS, or per-user keys. Single operator-held keyring.
- Re-keying `BETTER_AUTH_SECRET` or the auth tables (that is #52's surface, different secret).
- Changing the AES-256-GCM algorithm or the IV/tag scheme.

---

## Resolved Decisions

- **Envelope gets an additive optional field `keyId: string`** (e.g. `"v1"`, `"v2"`, or a
  short hash of the key material). Absent `keyId` ⇒ treat as the legacy default key. Because
  the column is opaque jsonb with only a `jsonb_typeof = 'object'` CHECK, adding a field is
  **schema-compatible with the existing CHECK** — no DDL.
- **Keyring config**, not a single env var: keep `JARVIS_CONNECTOR_SECRET_KEY` /
  `JARVIS_AI_SECRET_KEY` as the *current* key (back-compat), and add an optional
  `JARVIS_*_SECRET_KEYS` (id→secret map, e.g. JSON or `id:secret,id:secret`) listing current +
  retired keys. The current key id is named by a `JARVIS_*_SECRET_KEY_ID` (default `"v1"`).
- The two ciphers are duplicates; factor the keyring logic into one shared helper
  (candidate: a small module in `packages/shared` or a `packages/crypto`), then have both
  cipher classes consume it — but keep the two public envelope types/branding distinct. (Scope
  this during build; do not over-engineer.)

---

## Resolved Decisions (was open)

### No DB migration — runtime-only, with lazy re-encrypt

**#55 needs NO migration; it is done purely at runtime.** The ciphertext lives in an **opaque
`jsonb` object column** whose only DB constraint is `jsonb_typeof = 'object'`. Adding a `keyId`
field keeps it a JSON object, so there are **no column, type, constraint, or grant changes** —
nothing for a migration to do. The cipher is the only thing that reads the envelope's internal
fields; Postgres never does, so versioning is entirely a TypeScript concern in `crypto.ts` + config.

**Posture: lazy re-encrypt.** Reads decrypt with the old key (matched by `keyId`/absent); the next
legitimate write re-encrypts with the new key on the existing `UPDATE` paths (`connector_accounts`
token refresh; AI config update). No bulk re-encryption job, hence no data migration. Old keys must
remain in the keyring until every row has been touched at least once post-rotation — that is what
the keyring + runbook are for.

**Optional operator script.** An optional one-shot `scripts/rewrap-secrets.ts` (run as the migration
role inside `withDataContext` per user) can force-rewrap every row so the operator can retire an old
key promptly. This is operator tooling **alongside** `backup:db` / `export:user`, **not** part of the
migration chain — so it consumes no global migration number.

**Consequence for ordering:** #55 adds no migration file, so it cannot collide with #52 in global
migration ordering; #52 takes the next number (`0045`) uncontested.

### Keyring config format → JSON

`JARVIS_*_SECRET_KEYS` is a JSON id→secret map (e.g. `{"v1":"...","v2":"..."}`), not a delimited
string — unambiguous even when secrets contain `:` or `,`.

### keyId derivation → explicit, operator-chosen

The current key id is an explicit operator-chosen value (e.g. `"v1"`), named by
`JARVIS_*_SECRET_KEY_ID` — not a hash-derived id — so the runbook reads cleanly and ids are
stable and human-meaningful.

---

## Approach (runtime-only)

1. **Shared keyring helper** — resolve `{ currentKeyId, keys: Map<keyId, Buffer> }` from env
   (current key + `JARVIS_*_SECRET_KEYS`), preserving today's dev-default + production-required
   behavior. Absent-`keyId` envelopes map to a reserved legacy id.
2. **`packages/connectors/src/crypto.ts` / `packages/ai/src/crypto.ts`:**
   - `encryptJson` writes `keyId: currentKeyId` into the envelope, encrypts with that key.
   - `decryptJson` reads `envelope.keyId` (default → legacy key), looks it up in the keyring,
     throws a **clear, actionable** error if the id is unknown (naming the missing key id),
     instead of an opaque GCM failure.
   - Keep `version`/`algorithm` assertions; bump envelope `version` to `2` only if `keyId`
     must be mandatory going forward — otherwise leave `version: 1` and treat `keyId` as
     optional-additive (preferred, maximal back-compat).
3. **Optional `scripts/rewrap-secrets.ts`** — operator command (not a migration) to walk all
   `connector_accounts` / `connector_oauth_pending` / `ai_provider_configs` rows per user and
   re-encrypt with the current key, so a retired key can be dropped from the keyring. Runs
   through `withDataContext`; never logs plaintext.
4. **Runbook** `docs/operations/secret-key-rotation.md` — generate new key, add it to
   `JARVIS_*_SECRET_KEYS`, set it current via `JARVIS_*_SECRET_KEY_ID`, deploy, (optional)
   run rewrap, verify, then retire the old key from the keyring. Cross-link from
   `docs/operations/release-hardening.md`.
5. **Tests** (see Exit Criteria) covering decrypt-old/encrypt-new and the legacy-envelope path.

---

## Collision / migration-ordering notes

- **#55 adds no migration file → it claims no global migration number → it cannot collide with
  #52 (or anything else) in migration ordering.** This is the headline for the coordinator: #55
  and #52 are **safe to build in parallel** with respect to SQL; the only shared-surface caution
  is that both touch security-sensitive areas and both should land green through
  `pnpm audit:release-hardening` + `pnpm verify:foundation`.
- The optional `rewrap-secrets.ts` is an operator script alongside `backup:db` / `export:user`,
  not in the migration chain.

---

## Exit Criteria (verifiable)

1. Envelope carries a `keyId`; `encryptJson` stamps the current key id.
2. A test proves **encrypt-with-new + decrypt-with-old**: encrypt under key `v1`, rotate
   current to `v2` (both in the keyring), and confirm the `v1` ciphertext still decrypts and a
   fresh encrypt is stamped `v2`.
3. A test proves **a legacy envelope without `keyId` still decrypts** under the current/default
   key (existing ciphertext compatibility — the issue's hard requirement).
4. A test proves an **unknown `keyId` raises a clear, named error** (not an opaque GCM tag
   failure).
5. `docs/operations/secret-key-rotation.md` exists with a step-by-step runbook.
6. `pnpm verify:foundation` green. (No new migration; migration count unchanged at 44.)

---

## Hard Invariants honored

- **Secrets never escape** — keyring/keys live only in process env + memory; never logged, never
  in pg-boss payloads, exports, or AI prompts; rewrap script logs ids only, never plaintext.
- **Connector/AI secrets are AES-256-GCM encrypted at rest** — unchanged algorithm; this only
  adds key identification + a rotation path.
- **DataContextDb only** — the optional rewrap script reads/writes through `withDataContext`,
  never a root Kysely handle.
- **Never edit applied migrations / module SQL placement** — **no migration at all** for this
  task; storage CHECK (`jsonb_typeof = 'object'`) is unchanged because `keyId` is just another
  field in the same JSON object.
- **Provider-agnostic AI** — key versioning is provider-independent; touches only the at-rest
  credential envelope, not the capability router.
- **RLS classification:** unchanged — `connector_accounts` / `ai_provider_configs` remain
  **owner-only**; this task does not alter who can read a row, only how its ciphertext is keyed.
