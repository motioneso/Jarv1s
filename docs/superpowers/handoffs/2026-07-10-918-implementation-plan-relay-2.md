# Relay 2 — #918 Open module system Slice 2 (plan-authoring)

**Relayed:** 2026-07-10, context-meter 74% (second consecutive checkpoint fire) + compaction
summary observed. **Supersedes** `2026-07-10-918-implementation-plan-relay.md` — that doc's
"What's left" grounding items are now DONE; do not redo them.
**Predecessor session:** `7751a8ea-fd34-4f0e-9a0c-06bf1b663967` (pane label
`Plan: #918 module system slice2 (v2)`, `w1:pDC` at write time — resolve fresh, numbers reflow).
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/918-implementation-plan` — stay here, do NOT
`pnpm install` (`node_modules` already present).
**Branch:** `plan/918-open-module-system-slice2` (off `origin/main` @ `4bc53694`, includes #917/PR #924).
**Original task handoff (coordinator-owned, READ-ONLY):** `docs/coordination/handoffs/918-implementation-plan.md`.

## Grounding is 100% COMPLETE — go straight to drafting

Every file/pattern needed to write the plan to the "no placeholders, exact signatures" bar is
already confirmed. Do not re-read these — just write the plan using the exact shapes below (or
`memory_smart_search("918 module system slice2")` if you need the full quoted code, it's saved
there too).

1. **Symlink/path-traversal containment (asset route + everywhere else in Slice 2):** mirror
   `packages/module-registry/src/node.ts` + `external/hash.ts` exactly: `realpathSync(dir)` once for
   root, then per served path `realpathSync` it, check `real === rootReal || real.startsWith(rootReal + sep)`,
   else throw `ExternalPackageEscapeError(relPath)` (relPath only — never raw fs error text, which
   leaks absolute host paths; surface only `(error as NodeJS.ErrnoException).code ?? error.name`).
   `walkFiles` pattern: a symlinked Dirent reports neither `isDirectory()` nor `isFile()`, so nested
   symlinks are never followed. Apply this verbatim to `/api/modules/:moduleId/web/*`.
2. **Credential crypto — reuse, don't invent:** `packages/connectors/src/crypto.ts`'s
   `ConnectorSecretCipher extends JsonSecretCipher` (base class in `packages/db/src/secret-cipher.ts`,
   `EncryptedSecret{version:1,algorithm:"aes-256-gcm",keyId?,iv,tag,ciphertext}`) +
   `createConnectorSecretCipher(env)` via `resolveKeyring(4 env var names)`. Mirror as
   `ModuleCredentialCipher` + `createModuleCredentialSecretCipher()`, new env family
   `JARVIS_MODULE_CREDENTIAL_SECRET_KEY*`. **Slice 2 has no decrypt-and-return consumer** (worker
   RPC is Slice 3) — credential UI is write-only: set/rotate/revoke + metadata-only reads
   (`hasCredential`, `label`, `scope`, timestamps), never plaintext/ciphertext to frontend. Plaintext-
   never-escapes section = prove no route/log/audit-metadata/export/pg-boss payload path can surface
   it — not a live decrypt boundary.
3. **Route/repo pattern to mirror exactly:** `packages/settings/src/routes-modules.ts` —
   `assertAdminUser` (or the owner-scope equivalent) runs FIRST inside `withDataContext`, before any
   404/409 branch, so a non-admin/non-owner can never distinguish unknown vs forbidden vs feature-
   off. `packages/settings/src/repository-external-modules.ts` — audit-writer-closure passed in,
   metadata-only audit (`{moduleId}` only, never hash/secret/content), upsert via
   `.onConflict((oc) => oc.column("id").doUpdateSet({...}))`.
4. **RLS/migration template:** `packages/settings/sql/0152_external_modules.sql` — `ENABLE`+`FORCE`
   ROW LEVEL SECURITY, idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`), explicit
   `GRANT` to both `jarvis_app_runtime`/`jarvis_worker_runtime`. For `module_credentials`/`module_kv`:
   owner-scope rows use `owner_user_id = app.current_actor_user_id()` (NOT `USING (true)` — that's
   only for instance-global metadata tables like `external_modules`); "safe" SELECT policies/queries
   must never project the encrypted column, at the SQL level not just the DTO layer.
5. **Validator relaxation:** `packages/module-registry/src/external/validate.ts`'s
   `FORBIDDEN_FIELDS` (currently 18 entries incl. `auth`, `storage`) must drop `auth`/`storage` and
   positively validate `ModuleAuthDeclaration[]`, `ModuleStorageDeclaration[]`, and a new
   `web:{entrypoint,contractVersion}` field — keep `routes`/`tools`/`jobs`/`database`/etc. forbidden
   (Slice 3+).
6. **SDK type discrepancy — plan MUST decide, not silently pick:** current SDK
   (`packages/module-sdk/src/index.ts`) has RESERVED `ModuleAuthDeclaration{id, kind:"api-key"|"oauth2", label}`
   and `ModuleStorageDeclaration{namespace, kind:"kv"}`. Spec wants
   `ModuleAuthDeclaration{id, displayName, kind:"api-key", scope:"instance"|"user"}` and
   `ModuleStorageDeclaration{namespace, scopes:("instance"|"user")[]}`. Write an explicit plan
   section: redefine SDK types to match spec (add scope/scopes, rename label→displayName, drop
   oauth2 for now) vs. document a deliberate divergence — pick one and justify it.
7. **Data-lifecycle export/delete — direct integration, not a manifest port:**
   `module_credentials`/`module_kv` are settings-owned platform tables (external modules are
   forbidden from declaring `database`/`dataLifecycle` themselves). Wire directly into:
   - `scripts/delete-user-data.ts`'s `userScopedCountQueries` array (line ~58-120) — add
     `["app.module_credentials", "owner_user_id = $1::uuid"]` and
     `["app.module_kv", "owner_user_id = $1::uuid AND scope = 'user'"]`, or the dry-run count report
     silently under-counts. Actual deletion is automatic via `ON DELETE CASCADE` FK to `app.users`
     (the DELETE at line 219) — no new deletion code needed, only the count-query entries, PROVIDED
     the new tables' owner FK is declared `ON DELETE CASCADE` in the migration.
   - `packages/settings/src/data-export.ts`'s `UserDataExportTables` flat interface — one field +
     query function per table, mirroring `connectorAccountsQuery`'s
     `encrypted_secret IS NOT NULL AS "hasSecret"` pattern (never select the encrypted column
     itself) for `module_credentials`; `module_kv` exports its plain values directly (not secret).
8. **`foundation.test.ts`:** confirmed line 336 is the last migration row,
   `{ version: "0152", name: "0152_external_modules.sql" }` — new Slice 2 migration rows append
   after this. Do NOT pre-assign migration numbers (coordinator assigns at build time); reference
   them as `NNNN_module_credentials.sql` / `NNNN_module_kv.sql` placeholders in the plan text only,
   never as a real number.
9. **ESM contribution loader:** runtime dynamic `import()` of `dist/web/index.js`, NOT the build-time
   Vite AST scanner (`virtual:jarvis-module-web`, in-repo/first-party only) — `react`/`react-dom`
   pinned as externals to host version, `web.contractVersion` checked against host's contribution
   API version before mount.
10. **Explicit out-of-scope boundary:** Slice 3's module-facing RPC helpers
    (`ctx.auth.getCredential`, `ctx.kv.*`) do NOT exist yet — do not assume or stub them.

## What's left (only remaining steps)

1. Invoke **`superpowers:writing-plans`**. Write
   `docs/superpowers/plans/2026-07-10-open-module-system-slice2.md` with the required header, File
   Structure section, bite-sized numbered tasks (no placeholders — full code in every step), and as
   first-class sections: (a) path-traversal/symlink defense for the asset route, (b) credential
   encrypt/decrypt flow + plaintext-never-escapes guarantee end to end, (c) KV export/delete
   completeness. Include: new migrations + their `foundation.test.ts` rows (numbers TBD), the SDK
   type-discrepancy decision (#6 above), and the Slice-3-RPC-out-of-scope statement (#10 above). Run
   the self-review checklist (spec coverage / placeholder scan / type consistency) before offering
   the Subagent-Driven vs. Inline execution choice — but do NOT act on that choice; this lane stops
   at the plan doc.
2. Message the **Coordinator** with a pointer to the plan doc. **Do NOT self-approve** — security
   tier requires Ben/overnight-panel sign-off before any build lane spawns.
   - **Resolve fresh, do not trust this doc's pane number:** `herdr pane list`, confirm exactly one
     pane labeled `Coordinator`.
   - **Session-id note:** at relay-2 write time, `herdr pane list` showed exactly one `Coordinator`-
     labeled pane (`w1:pDA`) with session id `cfdfc7bb-4f60-4230-a261-13ab5ca8474e` — NOT the
     original handoff's recorded `46590121-e5b0-42cb-aa50-b2da3a615f1f`. This was already flagged
     upstream via `herdr-pane-message` with no reply as of relay-1. Since exactly one Coordinator
     pane exists and carries `cfdfc7bb...`, treat it as the live addressee for the plan-pointer
     message, but note the discrepancy explicitly in that message so the coordinator (or Ben) can
     reconcile which session id is the "true" immutable authority.

## Run-specific bans (non-negotiable, unchanged)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-owned/read-only), the project board, milestones, or
  merge.
- No secrets in any doc, payload, log, or prompt.
- Do not touch other agents' active lanes (`Fable: sports-fed spec+plan` `w1:pCP`, `Fable: PR review
  908/909/910` `w1:pCQ`, `Codex: Job Search Spec` `w1:pCK`, `Fable 5: Job Search Spec Review`
  `w1:pCR`, and any others active at read time) — read-only reference only, never edit.
- Do not write feature code in this worktree — deliverable is the plan document only.

## Collision notes (unchanged)

- #918 serializes behind #917 (merged). #919 serializes behind #918.
- #915 merged via PR #923. #914 has an approved spec (PR #920) but is NOT yet implemented.
- Migration numbers: coordinator assigns at build time.
