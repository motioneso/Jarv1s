# Plan: Fix #73 — Legacy-envelope decrypt breaks after key rotation (CRITICAL C2)

**Branch:** p1-fix-key-rotation  
**Issue:** #73  
**Date:** 2026-06-09

---

## Root cause

`keyring.ts:50-52` unconditionally maps the reserved `"legacy"` key-id to `currentKeyBuffer`:

```ts
if (!keys.has("legacy")) {
  keys.set("legacy", currentKeyBuffer);
}
```

After rotation (old key → retired in `JARVIS_*_SECRET_KEYS`, new key → `JARVIS_*_SECRET_KEY`), any
envelope written before keyId was introduced (no `keyId` field) will look up `"legacy"` and get the
**new** current key. AES-256-GCM auth-tag verification then fails because the envelope was encrypted
with the old key. Result: every pre-rotation legacy token is permanently bricked after rotation.

---

## Exit criteria

1. `packages/db/src/keyring.ts` no longer maps `"legacy"` to the current key; instead exposes
   `legacyCandidates: readonly Buffer[]` (the retired keys) for callers to try.
2. Both `decryptJson` implementations (`packages/ai/src/crypto.ts`,
   `packages/connectors/src/crypto.ts`) iterate `legacyCandidates` for legacy envelopes; fall
   through to current key only when no retired keys are configured (new-install, never rotated).
3. Regression test `tests/unit/keyring-rotation.test.ts` covers the exact combination:
   encrypt-as-legacy → rotate → decrypt. **Must FAIL on origin/main, PASS with fix.**
4. `docs/operations/secret-key-rotation.md` corrected: rewrap-then-rotate ordering, fixed
   "key is lost" claim for legacy envelopes.
5. `scripts/rewrap-secrets.ts` hardened: per-row try/catch (no crash on bad row), row locking,
   "stop api+worker first" note.
6. Full gate passes: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:unit`.

---

## Tasks

### Task 1 — Fix `Keyring` interface + `resolveKeyring` (packages/db/src/keyring.ts)

**File:** `packages/db/src/keyring.ts`

Changes:

- Add `legacyCandidates: readonly Buffer[]` to `Keyring` interface — ordered list of retired key
  buffers to try when decrypting a legacy (no-keyId) envelope.
- Remove the `keys.set("legacy", currentKeyBuffer)` auto-mapping.
- After parsing `keysJson` retired keys, populate `legacyCandidates` from those retired key
  buffers (same order they were parsed).

Backward compat: `legacyCandidates` is empty on fresh installs (no `keysEnvVar`); the decrypt
code falls back to current key in that case (existing dev-env behaviour preserved).

**Test note:** this task alone will make existing tests that rely on implicit legacy→current
mapping fail — that is intentional; Task 2 repairs the decrypt side.

---

### Task 2 — Fix `decryptJson` for legacy envelopes (both crypto.ts files)

**Files:**

- `packages/ai/src/crypto.ts`
- `packages/connectors/src/crypto.ts`

Changes in each:

- When `envelope.keyId` is absent (legacy envelope), get the candidates:
  - If `keyring.legacyCandidates.length > 0`: try each retired key in order; catch GCM auth
    errors and move to next; if none succeed, throw a descriptive error.
  - If `keyring.legacyCandidates.length === 0` (no rotation yet): try the current key
    (backward compat — same as today).
- Extract a `tryDecryptBuffer(key, envelope)` helper to avoid duplication.

Both files are structurally identical so the change is parallel but independent.

---

### Task 3 — Add regression test (tests/unit/keyring-rotation.test.ts)

**File:** `tests/unit/keyring-rotation.test.ts` (new file)

The test that should have caught C2 — exercises the combination not previously covered:

```
describe("keyring: legacy-envelope survives rotation", () => {
  it("decrypts a legacy (no-keyId) envelope after key rotation", () => {
    // 1. Build keyring with OLD key only (simulates pre-rotation state)
    // 2. Encrypt a value using the old key, omit keyId from the resulting envelope
    // 3. Build a ROTATED keyring (new current + old key in retired map)
    // 4. Decrypt the legacy envelope with the rotated keyring → must succeed
    // 5. Assert plaintext matches original
  });

  it("force-rewrap of a legacy envelope produces a current-keyId envelope", () => {
    // 1. Decrypt legacy envelope as above
    // 2. Re-encrypt with the rotated keyring
    // 3. Assert result.keyId === currentKeyId (not "legacy", not undefined)
  });

  it("legacy envelope with no retired keys falls back to current key (no-rotation path)", () => {
    // Existing single-key setup: legacy should still decrypt via current key
  });
});
```

Uses `resolveKeyring` directly + `AiSecretCipher` (or minimal manual GCM so no DB required).

**Verification:** run `git stash`, confirm test FAILS on origin/main; `git stash pop`, confirm
test PASSES.

---

### Task 4 — Fix rotation runbook (docs/operations/secret-key-rotation.md)

**File:** `docs/operations/secret-key-rotation.md`

Two corrections:

1. **Ordering → rewrap-THEN-rotate.** The runbook currently says: add old key to retired map →
   set new key as current → deploy → (optional) rewrap. The correct safe order for legacy
   envelopes is: rewrap all rows first (to give them explicit keyIds) → then rotate. Add a note
   that if legacy envelopes exist, running rewrap first is **required**, not optional.

2. **"What happens if a key is lost" claim.** Current text says a lost key throws a named error
   (`Unknown connector secret key id: v1`) rather than an opaque GCM failure. After this fix,
   **legacy** envelopes also throw a named error (`Legacy envelope: no retired key could decrypt
it`). Update the section to cover both keyed and legacy-envelope failure modes.

---

### Task 5 — Harden rewrap-secrets.ts (scripts/rewrap-secrets.ts)

**File:** `scripts/rewrap-secrets.ts`

Three hardening changes:

1. **Per-row try/catch.** Wrap each row's `decryptJson` + `updateTable` in a try/catch so a
   single bad row (e.g. legacy envelope without the old key in scope) logs an error and
   continues rather than crashing the entire run. Log: `row <id> SKIPPED: <error>`.

2. **Row-level locking.** Perform each row's read + re-encrypt + write inside a transaction
   with `FOR UPDATE` row lock (raw `db.executeQuery` SELECT ... FOR UPDATE) to prevent a
   concurrent token-refresh from overwriting the rewrap with stale plaintext.

3. **"Stop API + worker first" note.** Add a prominent comment / usage line at the top of the
   script: rewrap is safest when the API and worker processes are stopped (or frozen) to
   eliminate concurrent writes. Document as the first step in the Usage comment block.

---

## Commit plan

Each task commits green independently:

| #   | Commit message prefix | Green gate       |
| --- | --------------------- | ---------------- |
| 1   | `fix(keyring): …`     | typecheck        |
| 2   | `fix(crypto): …`      | typecheck        |
| 3   | `test(keyring): …`    | `pnpm test:unit` |
| 4   | `docs(ops): …`        | format:check     |
| 5   | `fix(rewrap): …`      | typecheck        |

Final: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:unit` before push.

---

## No migration needed

All changes are in application code, documentation, and scripts. No DB schema change required.
