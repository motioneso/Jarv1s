# OTNR MED/LOW Disposition — Consolidated Triage

**Grounded on:** `origin/main` @ `639e8cb` (verified current — 0 behind origin, clean tree, 2026-06-12)
**Author:** dev coordinator (run `2026-06-11-audit-remediation`, post-A–I)
**Supersedes:** the coarse `[audit-P1..P8]` series (#104–111) — all 8 **closed superseded** 2026-06-12
**Scope:** the 29 surviving `[OTNR-P*]` per-module MED/LOW buckets (#114–171). The OTNR HIGHs
were all closed by the A–I remediation run; this disposition covers the residual MED/LOW surface.

> **Method:** triage-first (per Ben, 2026-06-12). Every finding is mapped to one of:
> **FIXED** (resolved collaterally by the A–I run — close-eligible), **ACTIONABLE** (real, open —
> goes to the remediation plan), or **ACCEPT** (deliberate defense-in-depth deferral / arch-moot —
> document & WONTFIX). Cross-cutting findings are clustered, because the high-value fixes (one
> shared helper, one RLS migration) span many module buckets at once.

---

## A. Already FIXED by the A–I run (close-eligible findings)

Verified against `639e8cb`. These findings inside otherwise-open buckets are **done** — do not
re-work; check them off when the bucket is next touched.

| Finding | Bucket | Fixed by |
| ------- | ------ | -------- |
| HTTP security headers absent (`helmet`) | #164 P23 | #100 — `@fastify/helmet` registered `server.ts:64` |
| Chat/MCP/AI-tools routes unthrottled | #122 P4 | #118 — `@fastify/rate-limit` registered `server.ts:91` |
| Worker memory tables missing RLS (×9) | #146 P12 | #98 — migration 0054 (closed) |
| Account-delete leaves on-disk vault data (the substantive leak) | #171 P29 | #96 — `deleteUserVaultDir` post-COMMIT (residual: print post-delete reminder — minor) |
| `SettingsRepository` raw Kysely (not DataContextDb) | #156 P18 | #188 — Slice D per-method conversion |
| `assertDataContextDb` gaps (memory) | #146 P12 | #102 (closed) |
| REST tool-`/invoke` input-validation gap | #133 P8 | #132/#184 — `validateToolInput` + risk-gating on the read path (`packages/ai/src/routes.ts:408-461`). **Residual:** route still calls `manifestTool.execute` directly with a malformed `ToolContext` instead of `AssistantToolGateway` — remains **ACTIONABLE in #133 MED** (no live write bypass; write/destructive already gated). Do **not** check the bucket off wholesale. |
| `BETTER_AUTH` hardcoded dev secret | #164 P23 | #112 — env-first/fail-fast |
| pg-boss job payload could carry private content | (job-payload) | #157 — send-side metadata-only guard |

**No whole bucket is fully close-eligible.** (Verified #171 P29: only its vault-delete MED is
resolved by #96; it retains 3 MED + 4 LOW actionable items — see B8.)

---

## B. ACTIONABLE — cross-cutting clusters (the real remediation backlog)

These are the high-leverage fixes. Each cluster is **one coordinated change** spanning several
module buckets — far cheaper to do once than per-bucket.

### B1. `handleRouteError` → 401 masking (consolidation) — **SENSITIVE**
Per-module copies of `handleRouteError` collapse RLS-denied (would-be 404/403) into a generic 401
and/or swallow the real status, masking authz outcomes and complicating debugging.
**Buckets:** #122 (P4), #145 (P13 calendar), #147 (P14 email), #151 (P16 notifications), #156 (P18 settings).
**Fix:** one canonical `handleRouteError` in `@jarv1s/module-sdk` (or `@jarv1s/shared`); migrate all
call sites; delete the copies. Preserve correct status mapping (404 for not-found/denied, 401 only
for unauthenticated). One PR.

### B2. RLS hardening migration (TO-role + missing RLS + ownership predicate) — **SECURITY (RLS migration)**
One new migration file batching four related RLS gaps (same blast radius, one QA pass):
- **`TO <role>` clause missing** on `chat` (`packages/chat/sql/0042:16-29`) and `memory`
  (`packages/memory/sql/0041:29-42`) policies — they apply to PUBLIC; safe today because every
  predicate also requires `current_actor_user_id()` AND a table GRANT held only by the runtime
  roles, so **defense-in-depth, no active bypass** (Fable-confirmed). **Buckets:** #117 (P1),
  #146 (P12 memory), #168 (P27).
- **`app.instance_settings` and `app.admin_audit_events` have NO RLS at all** (grants only; no
  `ENABLE/FORCE ROW LEVEL SECURITY` in any migration) — the two genuine residuals from old
  audit-P1. **Bucket:** #117 (P1).
- **`task_tag_assignments` RLS gates on parent-task *visibility*, not ownership**
  (`packages/tasks/sql/0039_tasks_foundation.sql:154-157`) — a read-share recipient could mutate
  tag assignments. **Bucket:** #168 (P27).

**Fix:** new migration adding `TO`-role targeting, enabling RLS + owner policies on the two admin
tables, and tightening the tag-assignment policy to ownership. New file only — never edit applied
migrations. **Cross-model Opus QA required.**

### B3. Raw-Kysely `requireAdmin` → DataContextDb — **SENSITIVE**
`requireAdmin` round-trips query through a root Kysely handle instead of a branded `DataContextDb`,
violating the DataContextDb-only invariant.
**Buckets:** #143 (P11 connectors), #156 (P18 settings residual).
**Fix:** route admin checks through `DataContextDb` / the `any_admin_exists()` SECURITY DEFINER helper.

### B4. Duplicate crypto cipher classes — **SENSITIVE (crypto)**
Two near-identical AES-256-GCM cipher implementations; drift risk on a security-critical path.
**Bucket:** #114 (P2).
**Fix:** collapse to one shared cipher in `@jarv1s/db` (or a crypto util); single call surface.

### B5. Unbounded in-memory registries (no TTL/cap) — **SENSITIVE**
Session-token / MCP-confirmation registries grow without eviction — slow leak + stale-entry risk.
**Buckets:** #114 (P2), #123 (P3).
**Fix:** bounded LRU + TTL eviction; cap size; expire confirmations.

### B6. Dead / inert surface deletion — **ROUTINE→SENSITIVE**
Unwired code that reads as live: structured-state delete-path, module-sdk inert manifest fields.
**Buckets:** #154 (P17 structured-state), #160 (P21 module-sdk).
**Fix:** delete the dead surface (no-stale-concepts discipline).
(Note: the audit-P "workspace-CRUD in settings" item is **already gone** — Fable confirmed zero
`workspace` references remain in `packages/settings/src/` at `639e8cb`.)

### B7. React Query keys not user-scoped — **SENSITIVE (frontend data-isolation)**
Cache keys omit the actor id → risk of cross-user cache bleed on the shared house instance.
**Bucket:** #163 (P24 web).
**Fix:** namespace all query keys by `actorUserId`; align with the frontend workspace-querykey memory.

### B8. Operator-script & E2E hardening — **SENSITIVE→ROUTINE**
Operator scripts and e2e mocks have safety/coverage gaps.
**Bucket:** #171 (P29).
**Fix:** (sensitive) `restore:db --clean` must echo target host/db and require `--confirm-database`
(mirror the `confirmUserId` pattern in `delete-user-data.ts:56-58`); `delete:user` print a
post-delete vault reminder. (test-quality) e2e: add a `authenticated:false` spec (assert sign-in
gate) and an `isInstanceAdmin:false` spec (assert admin sections hidden/403); assert chat
Approve/Deny actually sends the decision. (LOW/routine) `parseEnvelope` on the cipher, validate
backup/restore URL creds, point `smoke:compose` at a DB-readiness endpoint, decompose `mock-api.ts`
(918 lines, nearing the 1000-line gate).

---

## C. ACTIONABLE — isolated (single-bucket) items

| Item | Bucket | Tier | Fix |
| ---- | ------ | ---- | --- |
| Missing FK covering indexes | #168 P27 | routine | index migration (new file) |
| Worker `graceful: false` on shutdown | #165 P25 | routine | graceful drain on SIGTERM |
| `/api/bootstrap/status` leaks `userCount` | #122 P4 (folded) | security | return `needsBootstrap` bool only |
| Social-auth OAuth paths unthrottled | #122 P4 (folded) | security | add social sign-in + callback prefixes to `THROTTLED_AUTH_PATHS` |
| Hand-rolled `validateToolInput` | #123 P3 | sensitive | schema-validate tool input (zod) |
| Last-admin demote/delete TOCTOU | #94 / #156 P18 | sensitive | advisory lock / `FOR UPDATE` around the admin-count guard |
| `x-forwarded-proto` trust at edge | #164 P23 | sensitive | trust-proxy allowlist |

---

## D. ACCEPT-RISK / WONTFIX (document, don't fix)

- **CORS not configured** (#164 P23) — single-origin architecture: the web client issues only
  relative-path fetches (`apps/web/src/api/client.ts:551`, no API base URL anywhere in
  `apps/web/src`) and the serving layer proxies `/api` server-side
  (`infra/docker-compose.yml` `JARVIS_API_PROXY_TARGET`). Browser→API is same-origin by
  construction; absent CORS headers is the browser-secure default. **Accept.**
  **⚠ Prod caveat (document this):** `infra/env.production.example` shows split hostnames
  (`JARVIS_AUTH_BASE_URL` = api host vs `JARVIS_AUTH_TRUSTED_ORIGINS` = web host), implying a
  split-origin topology the relative-path client can't support. **Production REQUIRES a same-origin
  reverse proxy (web + `/api` on one origin).** Do NOT "fix" a split-origin misdeployment by adding
  permissive CORS later — that would be the actual vulnerability.
- **Most INFO-tier OTNR findings** — observations, not defects.
- LOW items that are explicitly "future-sync hardening" (constraints that only bite when real
  connector sync lands, gated behind their own milestone/spec) — **defer to that milestone**, not
  pre-epic blockers.

---

## E. Remediation plan (ranked) & cost

Recommended order — security/RLS first, then defense-in-depth, then hygiene:

**Batch 1 (security tier) — ✅ DONE (PR #191, Fable security-QA APPROVED @ `d0e71b5`, 2026-06-12):**
- **B2** RLS hardening — split across 4 migration files (global ordering by landing): `0059`
  ENABLE+FORCE on `instance_settings` (writes admin-gated) & `admin_audit_events` (append-only,
  admin-only SELECT); `0060` `TO jarvis_app_runtime` on chat_memory_settings; `0061`
  `TO app+worker` on chat_memory_facts; `0062` `task_tag_assignments` ownership predicate
  (USING+WITH CHECK).
- **C** folded-in: `/api/bootstrap/status` → `needsBootstrap` bool only (dropped `userCount`,
  OTNR-P4 #122); `/api/auth/sign-in/social` added to `THROTTLED_AUTH_PATHS` (callback GET left
  unthrottled by design).
- Test sites: new `setInstanceSetting()` superuser helper replaced 9 raw `appDb` setting writes
  that the admin-gated policy would silently no-op.
- **Fable QA caught a real gap** (fixed in `d0e71b5`): `audit-release-hardening.ts` still exempted
  the two admin tables from FORCE-RLS coverage with now-false rationales → gate verified nothing
  about the 0059 posture. Added an `adminRlsTables` category asserting `rlsEnabled && forceRls`.
- Verified: typecheck/lint/format/file-size/`audit:release-hardening` green; integration suites
  (auth-settings, multi-user-isolation, foundation, release-hardening, api-rate-limit, memory,
  chat-recall, chat-live, tasks-73) green. _(Pending: main CI green → merge → relay.)_

**Batch 2 (sensitive tier) — in progress:**

3. **B1** `handleRouteError` consolidation — ✅ **MERGED (PR #192 @ `eb0391d`, Fable security-QA
   APPROVED, 2026-06-12).** Single canonical `handleRouteError`/`HttpError` in `@jarv1s/module-sdk`
   (`route-errors.ts`); thin per-module wrappers keep per-module status mappers +
   `invalidRequestMessage`. Scrubs its own fallthrough 500 to `{error:"Internal server error"}` +
   `reply.log.error` (never rethrows → never hits Fastify's leaky default handler). Dropped dead
   settings `"User not found"→400` branch (verified unreachable). Cross-module `instanceof
   HttpError` verified single-class. Fable non-blocking recs (B1-future): pin duplicate-key→400 /
   401-body assertions in integration tests; module-sdk `fastify` → devDependencies (cosmetic);
   optional `!reply.sent` guard before shared branches.

4. **B3** raw-Kysely `requireAdmin` → DataContextDb — ✅ **MERGED (PR #193 @ `dff5301`, Fable
   security-QA APPROVE / MERGE-READY: YES, 2026-06-12).** Connectors admin route routed off the
   root-Kysely `appDb` handle to `DataContextDb` (new `ConnectorsRepository.getUserById` executing
   `app.get_user_by_id` SECURITY-DEFINER on `scopedDb.db`); admin assertion moved inside
   `withDataContext` so check + listing share the actor's scoped txn (mirrors settings). Dead
   `appDb` removed from the shared `BuiltInRouteDependencies` bag + server wiring + connectors-google
   test — `rootDb` (settings BootstrapHelper) is now the only documented root-handle escape in the
   route layer. settings #156 was already converted by D #188, so B3 collapsed to the single
   connectors violation. Fable verified zero root-handle queries remain in connectors, exact
   401/403/200 parity, auth-before-work ordering, dead-code removal safe, 59 integration tests green.

5. **B4 + B5** crypto cipher dedup + registry TTL — ✅ **MERGED (PR #194 @ `1153ee6`, Fable
   security-QA APPROVE, 2026-06-12).** B4: hoisted one generic `JsonSecretCipher` + `EncryptedSecret`
   envelope into `@jarv1s/db` (`secret-cipher.ts`); `AiSecretCipher`/`ConnectorSecretCipher` reduced to
   thin label-binding subclasses + type aliases + env factories — byte-for-byte behavior-preserving
   (Fable mechanically diffed both old cipher bodies against the shared base: BODIES-IDENTICAL modulo
   label templating; all historical error strings reproduce exactly via the `label`/capitalized-label
   trick). ~150 duplicate lines removed. B5: `SessionTokenRegistry` gained an injectable clock + 60-min
   TTL backstop (`verify()` lazily expires + slides; `mint()` sweeps; new `touchBySessionId()` wired
   through runtime/routes to the chat manager's `lastActivity` so token-liveness ≡ session-liveness — no
   spurious 401 for a live-but-tool-idle session, guaranteed death for orphans). Zero-arg ctor preserved.
   Fable non-blocking follow-ups (B5-future): `reapIdle()` is defined but never scheduled in production
   (main-branch gap, not this PR — one degraded self-healing turn after >60-min idle); consider an
   interval scheduler or touch-at-turn-start, and a one-line comment on `touchBySessionId` resurrecting
   an expired-but-unswept entry (only reachable from the actor's own authenticated activity → benign).

**Then re-assess and continue:**

6. **B7** React Query user-scoping (sensitive, frontend).
7. **C** `validateToolInput`, `#94` TOCTOU, `x-forwarded-proto` (sensitive).
8. **B6** dead-surface deletion (routine/sensitive).
9. **B8** operator-script guards (`restore:db` confirm) + e2e negative-auth coverage (sensitive); script LOWs (routine).
10. **C** FK indexes + worker graceful shutdown (routine) — batchable.

**Cost flag:** this is ~10 remediation slices, comparable in scope to the A–I run (a multi-session
coordinated effort). Per token-budget discipline this is a **large spend** and should be
scope-approved before launch. Suggested staging: land the **security tier (1–2)** first as a small
high-value batch, re-assess, then decide whether to continue into the sensitive/routine tiers in
one coordinated run or incrementally between epic work.
