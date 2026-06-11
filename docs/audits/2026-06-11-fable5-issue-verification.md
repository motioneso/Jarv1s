# Fable 5 verification of 30 HIGH audit issues — 2026-06-11

**Model:** claude-fable-5 (Fable 5) — confirmed, no fallback.
**Verified against:** `origin/main` @ commit `e629f3c` (HEAD == origin/main, 0 behind; migration head 0052). Read from the shared working tree (only doc files were dirty; no package code mutated).
**Method:** read every cited file on the current tree; no test gate re-run; verdicts grounded in current file:line evidence.

## Verdict counts

| Verdict | Count | Issues |
|---|---|---|
| STANDS | 19 | #97 #95 #155 #98 #174 #129 #130 #102 #144 #148 #135 #157 #141 #124 #152 #153 #120 #134 #170 |
| STANDS (line-shift) | 3 | #113 #127 #101 |
| ALREADY-FIXED | 0 | — |
| REFUTED | 0 | — |
| SEVERITY-CHANGE (all downward) | 8 | #115 #116 #132 #119 #99 #140 #149 #166 |

No issue was found stale or already fixed. Eight are real but HIGH-inflated.

## Task A — per-issue verdicts

| Issue | Verdict | Current evidence | Severity call |
|---|---|---|---|
| #113 bearer = session UUID | **STANDS (line-shift)** | `packages/auth/src/index.ts:244-247` — `if (bearerToken)` short-circuits into `legacySessions.resolveAccessContext` → `app.resolve_auth_session($1::uuid)` (`packages/db/src/auth-session.ts:17-19`). No API-key table, no scoping, no audit event. Partial mitigations since filing: expiry IS enforced server-side (`0046_auth_sessions_rls.sql:55` `AND expires_at > now()`), and a pending/deactivated status gate now runs post-resolve (`index.ts:255-269`). | HIGH stands (deliberate design per "CLI-bridge auth primary" memory, but unscoped/unaudited as described). |
| #115 resource_grants no RLS | **SEVERITY-CHANGE → MED** | Factually confirmed: no `ROW LEVEL SECURITY` for `app.resource_grants` anywhere in migrations/module SQL (grep clean); full DML grants at `0004:87`/`0005:20`; live repo CRUD `packages/settings/src/repository.ts:292-361`. BUT `app.has_resource_grant` is consulted by **no live policy** — tasks `0019_tasks_owner_or_share.sql:3` explicitly notes it is "no longer consulted" (0003's policies dropped at `0019:8-10`). Forging a grant row changes nothing about data visibility; the table is plausibly empty in any real instance. | Latent trap + metadata enumeration, not an active cross-user bypass. Fix by **deletion** (with #120/#153), not by adding RLS to a dead table. |
| #116 workspace_memberships no RLS | **SEVERITY-CHANGE → MED** | Confirmed: no RLS anywhere; live writes `packages/auth/src/index.ts:368-376`, reads `packages/settings/src/repository.ts:125-158`. But membership rows gate **no** access decision (0028 dropped `is_workspace_member`); leak = dead-concept metadata enumeration via an app-runtime flaw. | Same as #115 — dedup with #115; fix by deletion (#120). |
| #97 users UPDATE no column restriction | **STANDS** | `0045_auth_secret_rls.sql:96-102` self-row UPDATE policy unchanged, no column list; no `GRANT UPDATE (cols)` anywhere (grep clean). `0050_multi_user_accounts.sql:118-125` ADDED an admin-wide UPDATE policy (`users_app_runtime_admin_update`, all columns) and `0052` an admin SELECT — the writable surface is now broader than when filed. `UPDATE app.users SET is_instance_admin = true WHERE id = self` still passes RLS for any actor. | HIGH stands. Cheapest real fix in the set (one migration of column-level grants). |
| #132 REST tool-invoke bypasses gateway | **SEVERITY-CHANGE → MED** | `packages/ai/src/routes.ts:380-470`: write/destructive tools are **hard-blocked** — `tool.risk !== "read"` → persist pending action + `403 confirmation_required`, and nothing ever executes them via REST (`:407-431`); resolve route only marks the action (`:340-360`). Residual gap is real: read tools execute via `manifestTool.execute!` at `:453-458` with **no `validateToolInput`** (gateway runs it at `gateway/gateway.ts:62`) and a blank `chatSessionId: ""`. A rate limit was added to the route (`:383-389`). | Title's "weaker path for write/destructive tools" is no longer accurate; remaining is unvalidated input on read-only tools → MED. Fix is one line-ish (call `validateToolInput`). |
| #119 MCP allowlist not server-side | **SEVERITY-CHANGE → MED** | Confirmed: Claude pins `--allowedTools "mcp__jarvis__*"` (`cli-chat-engine.ts:222`); `buildCodexCommand` (`:236-256`) sets sandbox/no-shell but **no MCP tool allowlist**; `buildGeminiCommand` (`:258-266`) restricts servers only. Gateway has no per-session tool filter (grep `allowlist|filter` in `gateway.ts` clean). However the gateway DOES enforce server-side: token-derived identity, `validateToolInput`, and blocking human confirmation on write/destructive — so an out-of-allowlist call still only reaches the same user's tools with confirmations. | Blast radius bounded to the user's own Jarvis tools (the issue itself concedes this). Parity/hardening, not bypass → MED. |
| #95 SettingsRepository raw Kysely | **STANDS** | `packages/settings/src/repository.ts:16` (`SettingsDb = Kysely<…> | Transaction<…>`), `:93` constructor takes raw `Kysely`. No `assertDataContextDb` anywhere in the package. Partially narrowed since filing: users reads now go through SECURITY DEFINER helpers (`0047` `get_user_by_id`/`list_all_users`), but workspace/membership/grant/audit paths are still raw, GUC-less. | HIGH as design-debt; design-gated as proposed. Shrinks a lot if the workspace branch is deleted. |
| #155 /api/me unguarded reads | **STANDS** | `packages/settings/src/routes.ts:94-104` → `listWorkspacesForUser`/`listMembershipsForUser` (`repository.ts:116-131`) filter only by hand-written `where("user_id"…)`; the tables have no RLS (see #116). | Stands as defense-in-depth; dedup with #95, and evaporates entirely under the #120 deletion. |
| #98 worker has no memory RLS policies | **STANDS** | Grants to `jarvis_worker_runtime` at `packages/memory/sql/0040_memory_chat_source.sql:15-17`; ALL `memory_chunks`/`memory_file_index`/`memory_links` policies are `TO jarvis_app_runtime` only (`0030:45-77`, `0032:43-60`); FORCE RLS active (`0030:40-42`, `0032:40`). No later migration adds worker policies. (Contrast: `chat_memory_facts` policies in `0041:28-42` have no TO clause → apply to all roles, so the facts path works — exactly the boundary the issue drew.) | HIGH stands — silent functional breakage of the worker embed path, trivial fix. |
| #174 pgboss schema no RLS | **STANDS** | `infra/postgres/grants/0001_pgboss_runtime_grants.sql` still grants full DML on ALL pgboss tables to both runtime roles; zero RLS on the pgboss schema anywhere (grep clean). | HIGH-as-labelled is defensible for cross-user metadata enumeration; design-gated as proposed. |
| #129 withVaultContext no actor validation | **STANDS** | `packages/vault/src/vault-context.ts:31` — `join(this.vaultsBaseDir, accessContext.actorUserId)` with no empty/format check; `""` collapses to the shared base dir. DB sibling guards this (`packages/db/src/data-context.ts` rejects empty actor); vault does not. | HIGH stands; trivial fix. |
| #130 lexical path containment | **STANDS** | `packages/vault/src/vault-path.ts:15-22` — `resolve` + string-prefix only; no `realpath`/`O_NOFOLLOW`; no symlink handling in the walkers. | HIGH stands (defense-in-depth for the file boundary). Dedup with #129 — one PR. |
| #99 caller-supplied ownerUserId | **SEVERITY-CHANGE → MED** | Confirmed unchanged: `commitments-repository.ts:5,30`, `entities-repository.ts:5,29`, `preferences-repository.ts:6,13` write input `ownerUserId` verbatim. But the DB `WITH CHECK (owner_user_id = app.current_actor_user_id())` (`0031:62-65` etc.) is an enforced backstop — a mismatch errors. The issue itself concedes this. | App-layer hardening to match the tasks pattern → MED. |
| #102 missing assertDataContextDb | **STANDS** | grep across `packages/memory/src` + `packages/structured-state/src`: **0** occurrences. Silent-RLS-denial failure mode in worker contexts is real (and is the same mechanism as the live #98 breakage). | HIGH stands; mechanical fix. |
| #144 vectorSearch no owner predicate | **STANDS** | `packages/memory/src/repository.ts:72-95` — WHERE is `embedding IS NOT NULL AND source_kind = …` only; the lone owner-less query in the module, feeding AI prompts via recall. | HIGH stands as defense-in-depth + perf win; one-line fix. |
| #148 blank ToolContext in briefings | **STANDS** | `packages/briefings/src/repository.ts:259-266` — `manifestTool.execute(scopedDb, {}, { actorUserId: "", requestId: "", chatSessionId: "" })` verbatim. | HIGH-as-latent-landmine; cheap fix (thread `job.data.actorUserId`). |
| #135 incognito not enforced immutable | **STANDS** | `packages/chat/sql/0042_chat_memory_settings.sql:33-35` — comment claims immutability; column added with no trigger/CHECK; identity trigger (`0014:53-72`) covers only id/owner/created_at. No later migration adds enforcement. | Stands; borderline MED (toggle is owner-initiated; threat is app-bug/expectation violation, not cross-user), but the project's privacy bar makes HIGH defensible. |
| #140 no listId/parent ownership check | **SEVERITY-CHANGE → MED** | `packages/tasks/src/repository.ts:96` (create takes `input.listId` raw), `:184-187` (update writes `list_id`/`parent_task_id` raw). FK validates existence, not ownership. | Integrity-only (orphaned/invisible task pointing at a foreign list) — the issue itself states "no IDOR read leak". → MED. |
| #157 metadata-only payloads unenforced | **STANDS** | `packages/jobs/src/pg-boss.ts:14-16` — `ActorScopedJobPayload` requires only `actorUserId`; `registerDataContextWorker` (`:84-98`) has no payload shape guard; no `sendJob` chokepoint exists. Convention-not-mechanism, as filed. | HIGH stands given hard invariant #6 and #174's enumeration exposure. |
| #141 OAuth error body echoed | **STANDS** | `packages/connectors/src/oauth.ts:103-112` — `throw new Error(\`Google token endpoint returned ${response.status}: ${detail}\`)` with raw body; `routes.ts handleRouteError` re-throws unmatched plain Errors (final `throw error`) → Fastify default handler/log. | HIGH-ish for secrets-in-logs; cheap fix. |
| #149 handleRouteError → always 401 | **SEVERITY-CHANGE → MED** | `packages/notifications/src/routes.ts:111-117` — verbatim as filed: dead `if`, both branches `401 Session is missing or expired`. | Real and ugly, but it's observability/correctness (masked 500s), not data exposure → MED. |
| #127 bootstrap self-set GUC in auth hook | **STANDS (line-shift)** | Now `packages/auth/src/index.ts:306-394`: `set_config('app.actor_user_id', user.id, true)` at `:327`; workspaces insert `:357-366`; membership `:368-376`; all on the app_runtime pool inside the better-auth hook. (Grew since filing: registration gate + status logic added by PR #93.) | Stands; architectural — schedule with the workspace deletion. |
| #101 auth writes settings-owned tables | **STANDS (line-shift)** | `packages/auth/src/index.ts:357-393` — direct `insertInto("app.workspaces")` `:359`, `app.workspace_memberships` `:368`, `app.admin_audit_events` `:379`; `@jarv1s/settings` still not in auth's deps. | Stands (module-isolation). Dedup with #127/#120. |
| #124 shared schema_migrations | **STANDS** | `packages/db/src/migrations/sql-runner.ts:51-68` — applied-set keyed on `version` only; checksum branch never compares the recorded `name` to the incoming file, so a cross-directory prefix collision is either a misleading "has changed" error or a **silent never-executed migration**. | Stands. With multiple agents landing migrations concurrently (known trap: "migration numbers global by landing order"), the silent-skip mode justifies keeping this prioritized within Tier 3. |
| #152 contribute/manage unenforceable | **STANDS** | `packages/structured-state/src/manifest.ts:29-31` still advertises `["view","contribute","manage"]`; `0031_structured_state.sql:60-69,110-119` UPDATE/DELETE policies are strictly owner-only; `has_share` only in SELECT (`:52,:102`). | Stands; fix (a) — narrow the manifest — is a 2-line change. |
| #153 resource-grants surface dead | **STANDS** | Repo `repository.ts:292-361` + routes `routes.ts:232-277` live; `app.has_resource_grant` referenced only in `0002`, `0017` (comment), `0028`, and tasks `0003` whose policies were dropped by `0019:8-10`. Grant/revoke has zero effect on visibility. | Stands as a silent-no-op admin trap. Dedup with #152 conceptually, but the real pairing is #153+#120+#115+#116 (one deletion). |
| #120 dead workspaces subsystem | **STANDS** | All three legs present: bootstrap inserts (`auth/src/index.ts:357-376`), settings routes (`routes.ts:140-228` workspaces/memberships + `:232-277` resource-grants), repository methods (`repository.ts:116-280`). Even a live stale string "Workspace context is unavailable" survives in `connectors/src/routes.ts`. | Stands. This is the keystone fix — see Task B. |
| #134 dead chat_messages UPDATE grant | **STANDS** | No REVOKE migration after `0035`/`0036` (chat sql ends at 0049, no revokes); zero `updateTable("app.chat_messages")` / `UPDATE app.chat_messages` in `packages/chat/src` (grep clean). | Stands as least-privilege hygiene; MED-borderline but standing write grants on private conversation bodies keep it defensible. |
| #166 foundation shares leak across tests | **SEVERITY-CHANGE → LOW/MED** | `tests/integration/foundation.test.ts:214-217` — verbatim, including the self-incriminating comment "this share persists for the remainder of the suite (no teardown)". | Real but it is test hygiene with zero production exposure; HIGH is inflated. |
| #170 export omits memory/structured-state | **STANDS** | `scripts/export-user-data.ts:33-53` — `UserDataExportTables` is the same 19-table allowlist; grep for `memory_chunks|chat_memory_facts|commitments|entities|preferences` in the script: zero hits. | Stands; privacy/data-portability completeness (GDPR-shaped), HIGH defensible. |

## Task B — priority-ordering critique

### The big mis-tiering: #115/#116 don't belong in Tier 1, and #120 doesn't belong in Tier 3

The proposed tiers treat "no RLS on resource_grants/workspace_memberships" as active cross-user
exposure and "delete the workspaces subsystem" as hygiene. Verification shows the opposite
relationship: **no live RLS policy consults either table** (tasks 0019 retired the last
`has_resource_grant` consumer), so forging rows in them grants nothing, and the right fix for
#115/#116 is the Tier-3 deletion, not new RLS policies on dead tables. The dedup cluster is much
bigger than the proposed pairs:

> **One spec'd deletion slice closes #120 + #153 + #115 + #116 outright, removes the workspace
> halves of #127/#101, and deletes the exact rows #155 exposes.** That slice should be Tier 1 —
> not because the tables are exploitable today, but because it retires six issues and a standing
> trap in one pass at modest cost.

### Per-issue tier agreement

- **#113** — agree Tier 1, with the caveat that exploitation requires a leaked session UUID and expiry IS enforced (0046). It is a hardening of a deliberate design (CLI-bridge), not an open door. Keep in Tier 1 but behind #97.
- **#115/#116** — disagree: move out of Tier 1 into the deletion slice (above). Severity MED.
- **#97** — agree Tier 1; it is also the cheapest fix in the whole set (one column-grant migration + test). Do it first. Note 0050's admin-wide UPDATE policy widened the surface since filing.
- **#132** — disagree with Tier 1: write/destructive tools are already hard-blocked on the REST path. The residual (validateToolInput on read tools) is a Tier-2/3 one-liner.
- **#119** — disagree with Tier 1: the gateway already enforces identity, input validation, and destructive-tool confirmation server-side; the missing per-tool allowlist is parity hardening → Tier 2.
- **#95/#155** — agree Tier 1 as a design-gated pattern migration, but sequence it AFTER the workspace deletion (which removes most of #155 and shrinks #95's surface).
- **#98** — disagree with Tier 2: this is a live, silent functional breakage of the worker memory-write path with a trivial one-migration fix. Promote to Tier 1 by fix-cost × certainty.
- **#174, #157** — agree Tier 2 (design-gated, and they pair: the payload chokepoint #157 bounds what #174 can leak).
- **#129/#130** — agree Tier 2; #129 is a five-line guard, do it immediately as part of one vault PR.
- **#99, #102, #144, #148** — agree Tier 2; bundle as one "repository hardening" pass (memory + structured-state + briefings). #102 is the same failure mechanism that made #98 real — that's the argument for not letting this tier slip.
- **#135, #140** — agree Tier 2-ish; both MED in honest severity, both small fixes (one trigger; one RLS-scoped lookup).
- **Tier 3** — agree on #141 (cheap, do early in tier), #149, #124 (keep despite MED severity: silent-skip mode × multi-agent migration landing), #152 (2-line manifest narrowing — do alongside the deletion slice), #134, #166 (LOW), #170 (schedule sooner if any GDPR/export story matters — it's the only Tier-3 item with end-user privacy impact).

### Recommended fix order

1. **#97** — column-level grants on `app.users` (tiny migration; closes the only true self-escalation backstop gap).
2. **#98** — worker RLS policies for `memory_chunks`/`memory_file_index`/`memory_links` (tiny migration; un-breaks a live feature path).
3. **Deletion slice: #120 + #153 + #115 + #116** (+ trims #127/#101/#155) — spec'd, one PR: drop bootstrap workspace writes, settings workspace/membership/resource-grant routes+repo, then a migration dropping `app.workspaces`/`app.workspace_memberships`/`app.resource_grants`. Add #152's manifest narrowing in the same pass.
4. **#129 + #130** — one vault PR: actor-id validation + realpath/symlink handling.
5. **#113** — bearer-path hardening (API-key table or env-gate; needs a small design decision).
6. **#95 (+ residual #155)** — migrate SettingsRepository to DataContextDb (design-gated; much smaller after step 3).
7. **AI pass: #132 (add validateToolInput on REST read path) + #119 (server-side per-session tool allowlist) + #148 (real ToolContext in briefings).**
8. **Repo-hardening pass: #102 + #144 + #99** (one PR across memory/structured-state).
9. **#157 then #174** — payload chokepoint first, then pgboss read-scoping design.
10. **#140, #135, #141, #149, #134, #124, #166, #170** — hygiene tail; #141 and #170 first within it (log-secrets and export completeness have real-world consequences; the rest are correctness/cleanliness).

### Dedup map (one fix closes both/all)

- {#120, #153, #115, #116} — workspace/resource-grants deletion (and most of #155, parts of #127/#101).
- {#95, #155} — SettingsRepository DataContextDb migration (post-deletion remainder).
- {#129, #130} — one vault PR.
- {#127, #101} — same bootstrap function; refactor together (remainder after deletion slice).
- {#102, #98} — same mechanism (missing guard ↔ the silent denial it would have caught); fix #98's policies and add #102's asserts in adjacent PRs.
