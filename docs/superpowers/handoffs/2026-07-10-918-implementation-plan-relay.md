# Relay — #918 Open module system Slice 2 (plan-authoring)

**Relayed:** 2026-07-10, context-meter 70% + compaction summary observed (relay trigger fired).
**Predecessor session:** `bb331864-9fb2-4ffb-8f1d-58dc4b2d3e48` (pane label `Plan: #918 module
system slice2`, resolve fresh — pane numbers reflow).
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/918-implementation-plan` (stay here — do not
`pnpm install`, `node_modules` already present).
**Branch:** `plan/918-open-module-system-slice2` (off `origin/main` @ `4bc53694`, includes
#917/PR #924).
**Original task handoff (coordinator-owned, READ-ONLY, do not edit):**
`docs/coordination/handoffs/918-implementation-plan.md` — read it in full again; it is the
authoritative scope/bans doc. This file only supplements it with grounding state.

## This is plan-authoring only, not a build task

Deliverable = an implementation plan document for GitHub issue **#918**, authored via
**`superpowers:writing-plans`**, against the approved spec
`docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md` (§Build slices —
Slice 2). **Risk tier: security** — build the plan to the adversarial-QA bar even though no code
is written in this lane.

## What's done (grounding — read in full this session)

- `docs/coordination/handoffs/918-implementation-plan.md` (task scope + bans)
- `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md` (master spec,
  incl. its own "Revisions" note — the original nested runtime/web/auth/storage architecture
  sketch was superseded by Slice 1's landed flat manifest shape; don't plan against the sketch)
- `packages/module-sdk/src/index.ts` — compiled manifest types
- `packages/module-registry/src/external/types.ts`, `validate.ts`, `hash.ts`, `reconcile.ts`
- `packages/module-registry/src/node.ts` — server-only discovery loader
- `packages/settings/src/repository-external-modules.ts`, `routes-modules.ts`
- `packages/settings/sql/0152_external_modules.sql` (Slice 1's migration — RLS template to mirror)
- `packages/db/src/secret-cipher.ts`, `packages/connectors/src/crypto.ts` (crypto reuse pattern)
- `docs/superpowers/specs/2026-07-04-module-data-lifecycle-ports.md`,
  `2026-07-04-module-web-registry.md` (adjacent-but-not-reusable mechanisms — see below)

**Not yet read** (do this before drafting the plan): `packages/settings/src/manifest.ts`,
`tests/integration/foundation.test.ts` (need its exact current migration-list shape before writing
the "new migration rows" section), and a deeper look at `packages/settings/src/data-export.ts` /
`repository.ts` for the export/delete wiring points.

Two `memory_save` calls already recorded these findings under `project: "jarv1s"` — recall with
`memory_smart_search("918 module system slice2")` if useful, but this doc is self-contained.

## Key findings to carry into the plan

1. **Crypto reuse for `app.module_credentials`:** don't invent new crypto. Mirror
   `packages/connectors/src/crypto.ts`'s `ConnectorSecretCipher extends JsonSecretCipher` +
   `createConnectorSecretCipher(env)` via `resolveKeyring` — a new `ModuleCredentialCipher` +
   `createModuleCredentialSecretCipher()`, own env key family (e.g.
   `JARVIS_MODULE_CREDENTIAL_SECRET_KEY*`). **Slice 2 has no decrypt-and-return consumer** — no
   worker execution exists yet (that's Slice 3, `ctx.auth.getCredential`). So Slice 2's credential
   UI is **write-only** from the frontend's perspective: set/rotate/revoke + metadata-only reads
   (`hasCredential`, `label`, `scope`, timestamps) — never plaintext or ciphertext back to the
   frontend. This simplifies the "plaintext-never-escapes" plan section to: prove no route, log,
   audit-metadata, export, or pg-boss payload path can ever surface it, rather than modeling a live
   decrypt boundary.
2. **Path-traversal/symlink defense for the asset route:** reuse, don't reinvent, the
   `realpathSync` + `startsWith(rootReal + sep)` containment pattern already proven twice in
   `module-registry/src/external/node.ts` (module dir escape, manifest-file escape) and
   `hash.ts`'s `ExternalPackageEscapeError` (already walks+hashes `dist/web/**` — forward-compat).
   Apply the same fail-closed, redact-fs-error-to-code-or-name discipline (never interpolate raw
   `fs` error messages — they leak absolute host paths) to the new
   `/api/modules/:moduleId/web/*` route.
3. **`validateExternalModuleManifest`'s `FORBIDDEN_FIELDS`** (in `external/validate.ts`) currently
   rejects `auth`/`storage`/`web` entirely (Slice 1's metadata-only gate). Slice 2 must relax this
   to positively validate `auth` (`ModuleAuthDeclaration[]`), `storage`
   (`ModuleStorageDeclaration[]`), and a new `web: {entrypoint, contractVersion}` field, while
   keeping `routes`/`tools`/`jobs`/`database`/etc. forbidden until Slice 3.
4. **SDK type discrepancy to reconcile in the plan:** the SDK's currently-RESERVED
   `ModuleAuthDeclaration` is `{id, kind:"api-key"|"oauth2", label}` and `ModuleStorageDeclaration`
   is `{namespace, kind:"kv"}` (`packages/module-sdk/src/index.ts`) — these do **not** structurally
   match the spec's shapes (`ModuleAuthDeclaration{id, displayName, kind:"api-key",
   scope:"instance"|"user"}`, `ModuleStorageDeclaration{namespace, scopes:("instance"|"user")[]}`).
   The plan must explicitly decide: redefine the SDK types to match the spec (add
   `scope`/`scopes`, rename `label`→`displayName`, drop `oauth2` for now), or document and justify
   a deliberate divergence. Don't silently pick one without a plan section calling it out.
5. **Repo/route pattern to mirror:** `repository-external-modules.ts`'s audit-writer-closure +
   metadata-only-audit (`{moduleId}` only, never a hash/secret) + upsert-on-conflict pattern, and
   `routes-modules.ts`'s "authorize FIRST, before any 404/409 branch" discipline (so a non-admin/
   non-owner request can never distinguish unknown vs. forbidden vs. feature-off state) — apply
   both to the new credential and KV routes.
6. **`app.module_credentials` / `app.module_kv` RLS template:** mirror
   `packages/settings/sql/0152_external_modules.sql`'s ENABLE+FORCE RLS pattern, but per the
   master spec's table: user-scope rows are **owner-only**
   (`owner_user_id = app.current_actor_user_id()`), instance-scope rows are **admin-writable +
   execution-readable for enabled module runtime**, and any "safe list" query must project
   metadata only — never the encrypted secret column — at the SQL/query level, not just at the DTO
   layer.
7. **Data-lifecycle-ports spec (`2026-07-04-module-data-lifecycle-ports.md`) does NOT directly
   apply** to `module_credentials`/`module_kv` — those are **settings-owned platform tables**, not
   an external module's own `ownedTables` (which external modules are explicitly forbidden from
   declaring). Plan for settings' own direct integration into its export/delete code path, not a
   manifest `dataLifecycle` port declaration.
8. **Module-web-registry spec (`2026-07-04-module-web-registry.md`)'s build-time Vite AST scanner
   (`virtual:jarvis-module-web`) is for in-repo, first-party built-in modules only.** External
   modules need a separate **runtime** dynamic-`import()` ESM contribution loader (per the master
   spec §3) — do not propose reusing the scanner.

## What's left (next concrete steps)

1. Finish grounding: read `packages/settings/src/manifest.ts` and
   `tests/integration/foundation.test.ts`'s current migration-list assertion.
2. Invoke **`superpowers:writing-plans`** and author the #918 Slice 2 implementation plan. It
   **must** include, as first-class sections:
   - (a) the path-traversal/symlink defense mechanism for the asset route
   - (b) the credential encryption/decryption flow and the plaintext-never-escapes guarantee,
     end to end
   - (c) KV export/delete completeness against the data-lifecycle export/delete code paths
   Plus: new migrations (numbers TBD by the coordinator at build time — do not pre-assign) and
   their `foundation.test.ts` row additions (note: build-time lane runs full `test:integration`,
   not this plan-authoring lane); the SDK type-discrepancy reconciliation decision (#4 above); and
   an explicit boundary statement that Slice 3's module-facing RPC helpers are OUT of scope — do
   not assume they exist.
3. When the plan is drafted, message the **Coordinator** — resolve **fresh** via `herdr pane list`
   (must show exactly one pane labeled `Coordinator`) — with a pointer to the plan doc. **Do NOT
   self-approve.** Security tier means Ben/overnight-panel sign-off is required before any build
   lane spawns against it.
   - **Coordinator label/session note:** the original handoff recorded coordinator session id
     `46590121-e5b0-42cb-aa50-b2da3a615f1f`. At relay time the live `Coordinator`-labeled pane
     (`w1:pDA` then, will reflow) carried session id `cfdfc7bb-4f60-4230-a261-13ab5ca8474e`
     instead — flagged to the coordinator already via `herdr-pane-message`; no reply yet. Re-verify
     which session id is current authority before treating any approval as valid.

## Run-specific bans (non-negotiable — unchanged from the original handoff)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.
- Do not touch other agents' active lanes (`Fable: sports-fed spec+plan`, `Fable: PR review
  908/909/910`, `Codex: Job Search Spec`, and any others active at read time) — read-only
  reference only if cross-context needed, never edit.
- Do not write feature code in this worktree — this lane's deliverable is the plan only.

## Collision notes (from the original handoff, still current)

- #918 serializes behind #917 (already merged). #919 serializes behind #918 — do not assume
  Slice 3 RPC helpers exist yet.
- #915 already merged via PR #923 (context for later worker interop, not this slice's concern).
- #914 has an approved spec (PR #920 merged) but is NOT yet implemented — don't assume its
  migration-ledger mechanism exists on disk.
- Migration numbers not yet assigned — assigned by the coordinator at build time.
