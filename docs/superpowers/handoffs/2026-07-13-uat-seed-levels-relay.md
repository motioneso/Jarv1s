# Relay — #1025 UAT seed levels (research done, plan not yet written)

Worktree: `.claude/worktrees/uat-seed-1025`, branch `uat-seed-1025` off `origin/main@51f468d4`.
Coordinator: label `Coordinator` (resolve pane fresh by label — do not trust any `w1:pE6`-style
number in this doc, it reflows). Spec: `docs/superpowers/specs/2026-07-12-dev-uat-harness.md`
(read by section: §4, §8.2 = Phase 2). Original handoff:
`/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-coord-2026-06-30-rfa-fleet/58a78927-385c-4b1d-8fa0-94db20255d6f/scratchpad/handoff-uat-1025.md`.

Task list has #1 (done), #2 (plan — **your job**), #3 (escalate), #4 (build), #5 (wire
provisioner hook), #6 (gate+PR).

## SUPERSEDED — see below, then the plan doc

The "Option A" (single migration_owner connection + `SET LOCAL ROLE jarvis_app_runtime` +
bootstrap `GRANT`) ruling that was originally recorded here is **DEAD**. A background research
fork independently rediscovered the same FORCE-RLS blocker, proposed a **dual-connection** design
instead, and escalated it on its own initiative. The Coordinator's follow-up ruling (2026-07-13,
same day) **explicitly supersedes Option A**:

> DUAL-CONNECTION: APPROVED, and it SUPERSEDES my earlier Option A. Do NOT add `GRANT
> jarvis_app_runtime TO jarvis_migration_owner` — not needed. `jarvis_migration_owner` (via its
> existing `jarvis_auth_runtime` membership) for `app.users`/`auth_accounts` identity rows ONLY; a
> SEPARATE `jarvis_app_runtime` connection through `DataContextRunner` + the real repository
> classes for every feature chunk. Real RLS write path, no role privilege grant. TRIPWIRE: any
> forced RLS carve-out/BYPASSRLS/role widening → STOP and escalate.

Also approved in that same ruling: a new one-shot `seed` compose service (profile-gated +
prod-target guard), the determinism-scope reading below, notes seeded via `VaultContext` only
(never a DB-proxy substitute), and `multi-user` deferred to fast-follow **issue #1030**.

**The authoritative build reference is now `docs/superpowers/plans/2026-07-13-uat-seed-levels.md`**
(committed, corrected to match every ruling above) — a background fork wrote the full task
breakdown (Tasks 2-8, real code per task) and it has already been corrected in place for: dual-
connection approval, notes-via-VaultContext, multi-user→#1030, and the `JARVIS_UAT_SEED_CONFIRM`
prod-guard on the new compose service. **Read that plan file, not the stale ruling text below** —
this section is kept only as a record of what changed and why. No further escalation is needed;
Coordinator said "Build now."

## Schema grounding (all confirmed on this branch @ 51f468d4 — cite file:line in the plan)

- **Connection seam**: `getJarvisDatabaseUrls()` (`packages/db/src/urls.ts`) → `.migration` =
  `jarvis_migration_owner`. Mirror `scripts/migrate.ts`'s usage pattern.
- **Admin identity**: `app.users` (`id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `email`,
  `is_instance_admin`, `status DEFAULT 'active'`, `is_bootstrap_owner`, `created_at`). Insert
  `is_instance_admin=true` directly — `users_guard_admin_flag()` (0055) is BEFORE **UPDATE** only,
  doesn't fire on INSERT. better-auth: `hashPassword`/`verifyPassword` from `better-auth/crypto`
  (N=16384,r=16,p=1,dkLen=64, hash=`${salt}:${hex}`) — confirmed matches spec §4.2. **Spec
  correction**: `app.auth_accounts.account_id` = the user's own **UUID** (`createdUser.id`), NOT
  email (verified in `better-auth@1.6.14/sign-up.mjs:238`) — flag this in the plan, don't silently
  follow spec. `auth_accounts` columns: `id, account_id, provider_id, user_id, access_token,
  refresh_token, id_token, *_expires_at, scope, password, created_at, updated_at` (0004). Insert
  under `SET LOCAL ROLE auth_runtime` (migration_owner already has this membership — no grant
  needed). `better_auth_sessions`: `id, expires_at, token UNIQUE, ip_address, user_agent, user_id`
  (0004) — also `auth_runtime`.
- **`app.current_actor_is_admin()`** (0050): `SECURITY DEFINER`, checks
  `app.users.is_instance_admin = true AND status = 'active'` for the GUC actor. Confirms ruling
  constraint 3 works once the admin row + GUC are set.
- **tasks** (`packages/tasks/sql/0003...`, RLS updated by `0019_tasks_owner_or_share.sql` to
  `app.has_share`): `app.tasks(id, owner_user_id, title, description, status, priority, due_at,
  completed_at, created_at, updated_at)`. `tasks_insert WITH CHECK (owner_user_id =
  current_actor_user_id())` → `app_runtime` + owner GUC.
- **calendar** (`packages/calendar/sql/0011...`): `app.calendar_events(id, connector_account_id,
  owner_user_id, title, starts_at, ends_at, location, summary, body_excerpt, external_id NOT NULL
  UNIQUE-per-account, external_metadata jsonb DEFAULT '{}', created_at, updated_at)`. Insert policy
  requires `connector_account_id` to join `app.connector_accounts` → `app.connector_definitions`
  with `provider_type='calendar'`. **`app.connector_definitions` already has a pre-seeded row**
  `provider_id='google-calendar'` (from `packages/connectors/sql/0009...`, INSERT baked into the
  migration itself) — so you only need to insert ONE `app.connector_accounts` row (`id,
  provider_id='google-calendar', owner_user_id, scopes, status='active', encrypted_secret` — jsonb
  object, NOT NULL CHECK `jsonb_typeof=object`; any deterministic placeholder object is fine, UAT
  never calls real Google) under `app_runtime` + owner GUC (`connector_accounts_insert`, `0022`),
  then the `calendar_events` rows referencing it.
- **sports** (`packages/sports/sql/0133_sports_follows.sql`): `app.sports_follows(id DEFAULT
  gen_random_uuid(), owner_user_id, competition_key, team_key nullable, created_at)`. Owner-GUC
  insert, `app_runtime`.
- **news** (`packages/news/sql/0151_news_prefs.sql`): `app.news_prefs(id DEFAULT
  gen_random_uuid(), owner_user_id, kind IN ('source','source_exclude','topic'), key, created_at)`.
  Owner-GUC insert, `app_runtime`. Spec §4.4 also wants an **active AI provider/model** bound to
  `module.news` capability (else settings 503s per `packages/news/src/settings/index.tsx:206` /
  `AiRepository.resolveModelForService`, `packages/ai/src/repository.ts:1166`) — see next bullet.
- **AI provider (for news)**: `app.ai_provider_configs(id, owner_user_id, provider_kind
  ENUM('openai-compatible','anthropic','google','ollama','custom'), display_name, base_url,
  status DEFAULT 'active', encrypted_credential jsonb NOT NULL object, purpose DEFAULT 'assistant'
  CHECK IN ('assistant','voice'), revoked_at, created_at, updated_at)` and
  `app.ai_configured_models(id, provider_config_id, owner_user_id, provider_model_id,
  display_name, capabilities text[] NOT NULL non-empty, status DEFAULT 'active', ...)`
  (`packages/ai/sql/0013...`). Per `0091_chat_model_override.sql`, INSERT is **admin-gated**
  (`current_actor_is_admin()`), not owner-GUC — same actor context as external_modules (constraint
  3), so this composes naturally once the seeded admin exists. Use `provider_kind='custom'` (or
  `openai-compatible`) with an obviously-fake `base_url`/`encrypted_credential` — nothing will call
  it in UAT; just needs to exist so `resolveModelForService('module.news', ...)` finds a row with a
  capability covering news. Check `capabilities` values expected by news — grep
  `resolveModelForService` call sites / `AiRepository` capability strings before writing the exact
  array (not yet confirmed this session — do this as the first step of that task).
- **job-search toggle**: `app.external_modules` (`packages/settings/sql/0152_external_modules.sql`)
  — `id text PK, status IN('enabled','disabled') DEFAULT 'disabled', manifest_hash, package_hash,
  disabled_reason, enabled_by uuid, enabled_at, created_at, updated_at`. INSERT/UPDATE/DELETE
  admin-gated (`current_actor_is_admin()`). "Present" = insert one row `id='job-search',
  status='enabled', manifest_hash=<fixed deterministic string>, package_hash=<fixed deterministic
  string>, enabled_by=<admin id>, enabled_at=<fixed epoch>`. "Absent" = don't insert it (no row =
  not installed — this is the actual first-party pluggable-module example per `#999`, referenced
  in `packages/module-registry/src/distribution/extract.ts:9`, ships no in-repo `sql/` dir).
- **notes — IMPORTANT, not a DB table.** `packages/notes` has `sql/.gitkeep` only — no SQL. Notes
  are **vault files on disk**, per-user root `${JARVIS_VAULT_ROOT ?? "/data/vaults"}/<userId>/`
  (`packages/vault/src/vault-config.ts`, `vault-context.ts`). `VaultContextRunner.withVaultContext
  (accessContext, work)` does `mkdir(vaultRoot, {recursive:true, mode:0o700})` then hands back a
  branded `VaultContext`. The notes chunk must write markdown files directly into that root (via
  `VaultContext`/`VaultContextRunner`, never raw untyped `fs` — CLAUDE.md hard invariant), NOT SQL
  INSERTs — independent of the privileged Postgres connection entirely. Keep content fully fixed
  (no mtime-dependent behavior) for determinism; `notes.search` embeds file content in-process
  (nomic-embed-text-v1.5) rather than reading a DB index, so no DB row is needed for notes at all.
- **multi-user / sharing — use `app.shares`, NOT `app.resource_grants`.** `app.resource_grants`
  (0001) is **dead**: `0019_tasks_owner_or_share.sql` / `0018_probe_owner_or_share.sql` (Slice 1b)
  moved tasks/probe RLS off it onto `app.has_share()`, and no INSERT policy for
  `app.resource_grants` exists anywhere in the repo (FORCE RLS + zero policies = insert impossible
  for any role short of true superuser — a dead end, don't seed it). The LIVE mechanism is
  `app.shares` (`infra/postgres/migrations/0017_shares.sql`): `app.shares(id DEFAULT
  gen_random_uuid(), resource_type, resource_id, owner_user_id, grantee_user_id, level IN
  ('view','contribute','manage'), created_at, updated_at)`, `CHECK (owner_user_id <>
  grantee_user_id)`. `shares_insert WITH CHECK (owner_user_id = current_actor_user_id())` — normal
  `app_runtime` + owner-GUC insert, exactly the ruling's established pattern. For the multi-user
  level: create a second non-admin user (own `app.users`/`auth_accounts` row via `auth_runtime`),
  then insert one `app.shares` row (e.g. `resource_type='task'`, `resource_id=<one of the admin's
  seeded tasks>, owner_user_id=<admin>, grantee_user_id=<second user>, level='view'`) under
  `app_runtime` with `app.actor_user_id` = the **admin's** id (owner-GUC check is on
  `owner_user_id`, i.e. the sharer).

## Not yet done / next steps

1. Invoke `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-13-uat-seed-levels.md`.
   Task-by-task TDD, exact file paths: likely `tests/uat/seed/levels.ts` +
   `tests/uat/seed/chunks/{admin,tasks,calendar,sports,news,notes,job-search,multi-user}.ts` per
   spec §5's proposed layout (composable, not independent per-level files — §4.3: `admin+data` =
   `solo-admin` + chunk set; `multi-user` = `admin+data` + second-user chunk).
   Include: the connection/role-switch mechanism (ruling constraints 1–4) as its own low-level
   helper task (e.g. `withOwnerRole(client, actorId, work)` / `withAdminRole(client, adminId,
   work)` wrapping `SET LOCAL ROLE` + `SET LOCAL app.actor_user_id` + `RESET ROLE`), built and
   tested FIRST since every chunk depends on it. Determinism: fixed injected base epoch parameter
   threaded through every chunk (no `Date.now()`/`new Date()` bare calls) — mirror
   `tests/unit/uat-provisioner.test.ts`'s pure-function-with-injected-fakes test style.
   One open non-blocking item to note in the plan: spec §3.2's comment implies seed runs before
   `jarv1s` (app) container up, but the actual `provisioner.ts` `main()` order runs app-up before
   the seed hook (confirmed in a prior session) — doesn't block Phase 2 since the seed talks
   straight to Postgres, but worth one line in the plan.
2. Message Coordinator: "plan ready for uat-seed-levels: <path>. Approve, or flag a fork." STOP,
   wait for approval before writing code (task #3).
3. Build via `superpowers:test-driven-development`, task by task (task #4), then wire the
   provisioner seed hook (task #5, minimal edit only — do not re-architect
   `tests/uat/provisioner.ts`), then `coordinated-wrap-up` (task #6).

No code has been written yet this build (research + escalation only). `infra/postgres/bootstrap/
0000_roles.sql` has NOT been edited yet — that's part of the plan's first task.
