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
| `SettingsRepository` raw Kysely (not DataContextDb) | #156 P19 | #188 — Slice D per-method conversion |
| `assertDataContextDb` gaps (memory) | #146 P12 | #102 (closed) |
| REST tool-`/invoke` bypasses MCP gateway | #133 P8 | #132 (closed) |
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
**Buckets:** #122 (P4), #145 (P12 calendar), #147 (P13 email), #151 (P15 notifications), #156 (P19 settings).
**Fix:** one canonical `handleRouteError` in `@jarv1s/module-sdk` (or `@jarv1s/shared`); migrate all
call sites; delete the copies. Preserve correct status mapping (404 for not-found/denied, 401 only
for unauthenticated). One PR.

### B2. RLS policies missing `TO <role>` clause — **SECURITY (RLS migration)**
Policies on `chat` (0042) and `memory` (0041) tables omit the `TO app_runtime`/`TO <role>` target,
so they also evaluate for other roles — defense-in-depth gap, not a known bypass.
**Buckets:** #117 (P1), #146 (P12 memory), #168 (P27).
**Fix:** new migration adding `TO`-role targeting to the affected policies. New file only — never
edit applied migrations. Cross-model Opus QA required.

### B3. Raw-Kysely `requireAdmin` → DataContextDb — **SENSITIVE**
`requireAdmin` round-trips query through a root Kysely handle instead of a branded `DataContextDb`,
violating the DataContextDb-only invariant.
**Buckets:** #143 (P10 connectors), #156 (P19 settings residual).
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
Unwired code that reads as live: structured-state delete-path, workspace-CRUD still in settings
routes (subsystem dropped in 0056), module-sdk inert manifest fields.
**Buckets:** #154 (P17 structured-state), #156 (P19 settings workspace-CRUD), #160 (P21 module-sdk).
**Fix:** delete the dead surface (no-stale-concepts discipline). Workspace-CRUD removal should
confirm no live caller post-0056.

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
| Last-admin demote/delete TOCTOU | #94 / #156 P19 | sensitive | advisory lock / `FOR UPDATE` around the admin-count guard |
| `x-forwarded-proto` trust at edge | #164 P23 | sensitive | trust-proxy allowlist |

---

## D. ACCEPT-RISK / WONTFIX (document, don't fix)

- **CORS not configured** (#164 P23) — single-origin architecture (web served same-origin via Vite
  proxy → API). CORS is genuinely unneeded; adding it would be cargo-cult. **Accept; document.**
- **Most INFO-tier OTNR findings** — observations, not defects.
- LOW items that are explicitly "future-sync hardening" (constraints that only bite when real
  connector sync lands, gated behind their own milestone/spec) — **defer to that milestone**, not
  pre-epic blockers.

---

## E. Remediation plan (ranked) & cost

Recommended order — security/RLS first, then defense-in-depth, then hygiene:

1. **B2** RLS `TO`-role migration (security) — smallest blast radius, real invariant tightening.
2. **C** folded-in security items: `userCount` leak + social-auth throttle (security, tiny).
3. **B1** `handleRouteError` consolidation (sensitive) — touches 5 modules, one helper.
4. **B3** raw-Kysely `requireAdmin` → DataContextDb (sensitive).
5. **B4 + B5** crypto cipher dedup + registry TTL (sensitive).
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
