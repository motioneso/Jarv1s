# Close the auth-secret RLS gap — Design (P1 #52)

**Status:** DRAFT (coordinator readiness, 2026-06-09) — needs Ben's sign-off
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #52 (Part of epic #46)

---

## Context

`infra/postgres/migrations/0004_auth_workspaces_settings.sql` creates the three tables that
hold every user's deepest secrets and grants them to the **shared** `jarvis_app_runtime` role
with **no RLS**:

- `app.auth_accounts` — OAuth `access_token` / `refresh_token` / `id_token` **and the
  email-password `password` hash** (lines 10–25). Granted `SELECT, INSERT, UPDATE, DELETE` to
  `jarvis_app_runtime` (lines 82–84).
- `app.better_auth_sessions` — the live session `token` (line 30, `UNIQUE`). Same grant.
- `app.users` — granted `SELECT, INSERT, UPDATE` to `jarvis_app_runtime` (lines 79–80).

None of these tables has `ENABLE ROW LEVEL SECURITY`. Every other private table in the system
(see `packages/connectors/sql/0009_connectors_module.sql`, the canonical pattern) is
`ENABLE` + `FORCE ROW LEVEL SECURITY` with owner-scoped policies. These three are the hole:
**any future module repository running as `jarvis_app_runtime` could `SELECT * FROM
app.auth_accounts` and read every user's refresh tokens and password hashes**, with no
owner-scoping to stop it. ADR 0007 (House model, accepted 2026-06-09) makes this real and
immediate — Katherine is a second account on Ben's instance, and the ADR explicitly pulls
"the auth-secret RLS gap" forward to Phase 1.

**Why this is not already solved by the existing RLS pattern:** `better-auth` owns these
tables and runs its **own** `pg.Pool`, not through `DataContextRunner`. In
`packages/auth/src/index.ts` (lines 52–56) the auth runtime constructs
`new Pool({ connectionString: getJarvisDatabaseUrls(env).app, ... })`. That `.app` URL is
`postgres://jarvis_app_runtime:...` (`packages/db/src/urls.ts` lines 20–22). So **better-auth
authenticates to Postgres as the very role we want to lock out**, and it never calls
`set_config('app.actor_user_id', ...)` — it does inherently cross-user, unscoped work
(look up a session by token, find an account by `(provider_id, account_id)` during sign-in,
bootstrap the first user). If we simply `FORCE` owner-only RLS on these tables for
`jarvis_app_runtime`, **better-auth itself breaks** (every query returns zero rows because
`app.current_actor_user_id()` is NULL). This coupling is the whole design problem.

---

## Goals

1. Make it impossible for a module repository running as `jarvis_app_runtime` to read another
   user's auth secrets (tokens, password hash) or session tokens.
2. Keep better-auth fully functional (sign-up, sign-in, session lookup, first-user bootstrap).
3. Ship a **test** that fails if the gap reopens — the issue's acceptance bar.

## Non-Goals

- Encrypting `auth_accounts` columns at rest (better-auth manages its own column shapes; the
  `BETTER_AUTH_SECRET` already protects tokens better-auth chooses to encrypt). Out of scope.
- Touching the chat-CLI bearer-token legacy path (`AuthSessionResolver`) — it reads
  `better_auth_sessions` too and must keep working; the design must account for it but does
  not redesign it.
- Reworking the `app.workspaces` / membership machinery (legacy; `workspaceId` was removed
  from `AccessContext` in Slice 1f — do not reintroduce it).

---

## Resolved Decisions

- The canonical RLS shape to copy is `connectors` (`ENABLE` + `FORCE ROW LEVEL SECURITY`,
  `TO jarvis_app_runtime`, `USING owner_user_id = app.current_actor_user_id()`).
- A new migration for `app.*` tables lives in `infra/postgres/migrations/` (these are
  app-schema tables owned by the foundation, **not** a module). Module SQL stays in module
  `sql/` dirs — that invariant is unaffected here.
- Whatever option wins, the verifying test extends the existing release-hardening audit
  (`scripts/audit-release-hardening.ts` + `tests/integration/release-hardening.test.ts`),
  which already enumerates `protectedTables` and asserts RLS/force/no-DELETE per table.

---

## Open Decisions — NEED BEN

### FORK: (a) restrictive RLS + dedicated better-auth role  vs  (b) documented exception + module-reference guard

**Option (a) — RLS + a dedicated unscoped role for better-auth's own pool.**

- Add a new login role, e.g. `jarvis_auth_runtime` (bootstrap `0000_roles.sql`), `NOBYPASSRLS`
  like the others. Grant it the privileges better-auth needs on `auth_accounts`,
  `better_auth_sessions`, `auth_verifications`, `users`.
- Point better-auth's pool at a new `JARVIS_AUTH_DATABASE_URL` for that role
  (`packages/db/src/urls.ts` + `packages/auth/src/index.ts` line 53).
- `ENABLE` + `FORCE ROW LEVEL SECURITY` on the three tables. Write **owner-only** policies
  `TO jarvis_app_runtime` (and `jarvis_worker_runtime` where it reads users), keyed on
  `app.current_actor_user_id()`. The dedicated `jarvis_auth_runtime` role gets a separate
  **unscoped** policy (`USING (true)` `TO jarvis_auth_runtime`) so better-auth keeps working;
  RLS still applies to it (no `BYPASSRLS`), it just has a permissive policy because it is the
  trusted owner of these tables.
- Tradeoffs: **+** Defense-in-depth at the database — even a module SQL-injection or a stray
  raw query as `jarvis_app_runtime` cannot read cross-user secrets. **+** Matches the
  system-wide invariant ("RLS applies to all actors"). **−** New role = new credential to
  provision/rotate/document; touches bootstrap, urls, auth runtime, compose env, and the
  release-hardening role list. **−** The legacy CLI bearer path (`AuthSessionResolver`,
  `packages/db/src/auth-session.ts`) reads `better_auth_sessions` as `jarvis_app_runtime`;
  its policy must allow a by-token lookup that has no actor context yet (chicken-and-egg:
  you read the session to *learn* the actor). That likely needs a narrow
  `SECURITY DEFINER` lookup function (mirroring `app.has_resource_grant`) rather than a row
  policy, or the bearer path must move onto `jarvis_auth_runtime` too.

**Option (b) — documented exception in CLAUDE.md + a lint/test guard.**

- Leave the tables unscoped (better-auth keeps working unchanged). Add a hard invariant to
  CLAUDE.md: *no module package may reference `auth_accounts`, `better_auth_sessions`, or the
  secret columns of `users`; only `packages/auth` and `packages/db` (the session resolver)
  may.* Enforce with a guard test that greps every `packages/*/src` **except** `auth` and `db`
  for those table names / Kysely table strings and fails on a hit.
- Tradeoffs: **+** Tiny, fast, no new role/credential, no migration, zero risk to the auth
  flow. **+** Directly encodes the actual threat model (a *module* query reaching these
  tables). **−** It is a **process/static** guard, not a database guarantee: a raw query, a
  dynamic table name, or a query authored inside `auth`/`db` that leaks data is not caught. **−**
  Violates the spirit of the system-wide "RLS applies to all actors including admins"
  invariant by carving out an explicit hole. **−** The guard's denylist is bypassable (string
  obfuscation), so it is necessary-but-not-sufficient.

**MY RECOMMENDATION: Option (a), with the bearer-token lookup handled by a `SECURITY DEFINER`
function.** Reasoning: these are the single most sensitive tables in the product (refresh
tokens + password hashes), ADR 0007 just made cross-user real, and the project's defining hard
lesson is "build it right the first time." A static denylist that is admittedly bypassable is
the wrong tool for the crown-jewel tables — it protects against an honest mistake but not
against the threat (one module reading every user's secrets). Option (a) makes it a database
invariant that survives any future module, matching every other private table in the system.
The cost (one new role + a definer function for the by-token session lookup) is real but
bounded and is exactly the machinery the codebase already uses elsewhere. **Recommend (a); if
Ben wants to de-risk Phase 1 scope, ship (b)'s guard test *as well* (cheap) but not instead.**

### Secondary decision — does `jarvis_worker_runtime` need any of these grants?

The worker currently has no grants on the auth tables; confirm no worker code reads `users`
for display/email. If it does, its policy must be added in the same migration. (Verify against
`packages/*/src` worker paths during build; do not assume.)

---

## Approach (option (a), the recommended path)

1. **`infra/postgres/bootstrap/0000_roles.sql`** — add `jarvis_auth_runtime` LOGIN role,
   `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, `GRANT CONNECT`.
2. **`packages/db/src/urls.ts`** — add `auth` URL
   (`JARVIS_AUTH_DATABASE_URL ?? postgres://jarvis_auth_runtime:...`).
3. **`packages/auth/src/index.ts`** — point the better-auth `Pool` and the
   `AuthSessionResolver` path at the auth URL (or expose `app.has_session_token(...)` definer
   fn for the legacy bearer lookup that still runs as `jarvis_app_runtime`).
4. **New migration `infra/postgres/migrations/0045_auth_secret_rls.sql`** (next global number;
   see ordering notes):
   - `GRANT` the needed privileges on the three tables to `jarvis_auth_runtime`; **REVOKE**
     `jarvis_app_runtime`'s access to the **secret** surface that no module legitimately needs
     (at minimum: keep `users` SELECT for display fields, drop direct token-table access from
     `jarvis_app_runtime` if nothing but auth uses it — verify usage first).
   - `ENABLE` + `FORCE ROW LEVEL SECURITY` on `auth_accounts`, `better_auth_sessions`,
     `users`.
   - Permissive policy `TO jarvis_auth_runtime` (`USING (true)` / `WITH CHECK (true)`); any
     residual `jarvis_app_runtime` access to `users` scoped to
     `id = app.current_actor_user_id()` (self-row) only.
   - Follow the exact `DROP POLICY IF EXISTS ... CREATE POLICY` idempotent shape from
     `0009_connectors_module.sql`.
5. **`scripts/audit-release-hardening.ts`** — add the three tables to a new
   `authSecretTables` set asserting `rlsEnabled && forceRls` and that `jarvis_app_runtime`
   cannot read the token/password surface; add `jarvis_auth_runtime` to the audited role list
   (must be `NOBYPASSRLS`, not superuser).
6. **Compose / dev env** — surface the new role's credentials in
   `docs/operations/dev-environment.md` and compose env.

*(If Ben picks (b): skip 1–4 and 6; add the CLAUDE.md invariant + a guard test under
`tests/integration/` that scans `packages/*/src` excluding `auth`/`db`.)*

---

## Collision / migration-ordering notes

- Migration version numbers are **global and assigned by landing order** (the runner sorts by
  filename prefix; the highest applied today is `0044`). Whichever of #52 / #55 lands first
  takes `0045`; the other must rebase to `0046`. **Coordinator must serialize the two if both
  add migrations.**
- **#55 likely needs NO migration** (see that spec). If so, #52 is the only Phase-1
  data-at-rest task touching SQL, and there is no real collision — #52 takes `0045` cleanly.
  Confirm before fan-out.
- Applied migrations are hash-checked and immutable — never edit `0004`; all changes go in the
  new file.

---

## Exit Criteria (verifiable)

1. `app.auth_accounts`, `app.better_auth_sessions`, `app.users` have `relrowsecurity` **and**
   `relforcerowsecurity` true (option a), OR a documented CLAUDE.md exception + a guard test
   exists (option b).
2. A test proves a `jarvis_app_runtime` connection **without** the auth role/policy **cannot**
   read another user's `access_token`/`refresh_token`/`password` (option a), or that no module
   package references the tables (option b).
3. better-auth sign-up, sign-in, and session resolution still pass
   (`pnpm test:integration` auth/chat suites green); the legacy CLI bearer path still resolves.
4. `pnpm audit:release-hardening` green with the auth tables added and any new role audited as
   `NOBYPASSRLS` / non-superuser.
5. `pnpm verify:foundation` green.

---

## Hard Invariants honored

- **No admin private-data bypass / RLS applies to all actors** — option (a) keeps every role
  `NOBYPASSRLS`; the dedicated auth role gets a *permissive policy*, not `BYPASSRLS`.
- **Private by default** — auth secrets become owner-scoped like every other private table.
- **Secrets never escape** — narrows the runtime surface that can ever read tokens/hashes.
- **Never edit applied migrations / module SQL placement** — new `infra/` migration file;
  `0004` untouched. These are app-schema tables, correctly placed in `infra/postgres/migrations`.
- **AccessContext shape** — no new fields; relies only on the existing
  `app.actor_user_id` GUC set by `DataContextRunner`.
- **RLS classification:** `auth_accounts`, `better_auth_sessions` → **owner-only** (plus a
  trusted-owner permissive policy for the `jarvis_auth_runtime` service role); `users` →
  **owner-only self-row** for runtime reads, owned by the auth service role.
