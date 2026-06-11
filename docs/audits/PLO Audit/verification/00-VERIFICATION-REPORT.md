# PLO Audit — Independent Verification Report

**Date:** 2026-06-10
**Verifier:** Independent Opus 4.8 verification fleet (one agent per finding/cluster), synthesized
**Scope verified:** 6 CRITICAL findings, the top-20 HIGH findings (clustered), 2 SYSTEMIC findings, and an invariant spot-check
**Method:** Each finding was re-checked against the actual cited source files. Verdicts are CONFIRMED / PARTIAL / REFUTED, adversarial toward the finding.

---

## 1. Verification Score

**Verdict clusters returned:** 15 (covering 6 CRITs, 14 distinct HIGHs, 2 SYSTEMICs, 1 invariant spot-check).

Counting at the **cluster verdict** level (the unit the verification agents returned):

| Verdict | Count |
|---|---|
| CONFIRMED | 6 |
| PARTIAL | 8 |
| REFUTED | 1 |

At the **individual sub-finding** level (where clusters bundle multiple HIGHs), the underlying claims resolve as:

- **Fully confirmed sub-findings:** CRIT-01, CRIT-02, CRIT-05, CRIT-06, H-01, H-03, H-04, H-05*, H-06, H-08, H-09, H-11*, H-12*, H-15, H-16, H-17, H-20, SYSTEMIC-05 (≈18)
- **Partial (real but overstated / wrong file / mitigated):** CRIT-03, CRIT-04, H-07, H-13, H-14, H-18, SYSTEMIC-01, INV-SPOT-CHECK (8)
- **Refuted (claim not supported by code):** H-02, H-19 (2)

\* confirmed in substance; cited file path or line number is wrong (see §5).

**Headline:** **~18 of ~28 individual claims confirmed as stated; 8 directionally-correct-but-overstated; 2 refuted.** No CRITICAL was refuted; two CRITICALs (03, 04) are downgraded to HIGH.

---

## 2. Verdict Table

| Finding | Orig. Severity | Verdict | Corrected Severity | Key Evidence Phrase |
|---|---|---|---|---|
| CRIT-01 | CRITICAL | CONFIRMED | CRITICAL | 5 tables CREATEd with grants, never ENABLE/FORCE RLS; only `requireAdmin` guards them |
| CRIT-02 | CRITICAL | CONFIRMED | CRITICAL | pgboss grants full DML to both runtime roles; zero CREATE POLICY on `pgboss.*` |
| CRIT-03 | CRITICAL | PARTIAL | **HIGH** | worker GRANTs but no `TO jarvis_worker_runtime` policy → silent zero-row writes; "recall via worker" claim wrong |
| CRIT-04 | CRITICAL | PARTIAL | **HIGH** | bare `Kysely` constructor, no branding, GUC unset; but cited module-registry usage wrong & writes fail-closed |
| CRIT-05 | CRITICAL | CONFIRMED | CRITICAL | `clientSecret` in `GoogleAuthorizeRequest`, password input → POST body → route reads `body.clientSecret` |
| CRIT-06 | CRITICAL | CONFIRMED | CRITICAL | `protectedTables` = 14 hardcoded; ≥13 FORCE-RLS tables never enumerated/checked |
| H-01 | HIGH | CONFIRMED | HIGH | `requireAdmin` queries `app.users` via raw `dependencies.appDb` Kysely, no DataContextDb |
| H-02 | HIGH | **REFUTED** | n/a | cited `google/client.ts` doesn't exist; real OAuth puts secret in POST body, no API key in URL |
| H-03 | HIGH | CONFIRMED | HIGH | rate-limit registered `global:false`; `/api/mcp` sets no `config.rateLimit` |
| H-04 | HIGH | CONFIRMED | HIGH | `delete-user-data.ts` only `DELETE FROM app.users`; no vault/fs cleanup |
| H-05 | HIGH | CONFIRMED | HIGH | `eval "${OFFHOST_CMD/...}"` over operator env var (line 114, not 112) |
| H-06 | HIGH | CONFIRMED | HIGH | smoke polls `/health` (static `{ok:true}`), never `/health/ready` (DB+pgboss) |
| H-07 | HIGH | PARTIAL | HIGH | vault writes pass **no** mode (defaults ~0o644); cited file wrong (writes in `vault-ops.ts`) |
| H-08 | HIGH | CONFIRMED | HIGH | zero encrypt/cipher/aes matches in `packages/vault/src`; plaintext at rest |
| H-09 | HIGH | CONFIRMED | HIGH | `source_thread_id ... REFERENCES app.chat_threads` — memory→chat cross-module FK |
| H-11 | HIGH | CONFIRMED | HIGH | `permissionId` recorded for approval card but never checked before `execute()` |
| H-12 | HIGH | CONFIRMED | HIGH | `listTools()` calls `executableTools("")`; `listModuleManifests` takes no user arg |
| H-13 | HIGH | PARTIAL | **MEDIUM** | caller-supplied `ownerUserId` inserted directly; but DB INSERT WITH CHECK blocks forged owners |
| H-14 | HIGH | PARTIAL | **MEDIUM** | `yamlStr()` escapes only `\` and `"`, not newlines; but value stays in quoted scalar (folds) |
| H-15 | HIGH | CONFIRMED | HIGH | `assertDataContextDb` absent from all 3 structured-state repos + write-back |
| H-16 | HIGH | CONFIRMED | HIGH | `task_activity_insert` EXISTS-checks RLS-visible `app.tasks`; view-share grantee passes |
| H-17 | HIGH | CONFIRMED | HIGH | `POST /api/tasks/:id/activity` → `addActivity` with no visibility pre-check |
| H-18 | HIGH | PARTIAL | HIGH | unset `JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION` → `undefined` (defers to lib), not app-forced true |
| H-19 | HIGH | **REFUTED** | n/a | `waiters` Map keyed by unique `actionRequestId` — correct per-request isolation, no race |
| H-20 | HIGH | CONFIRMED | HIGH | notifications/calendar/email `handleRouteError` returns 401 on all errors |
| SYSTEMIC-01 | (systemic) | PARTIAL | (systemic) | true for 5 settings tables; **overstated** on connectors (admin path runs inside GUC + RLS) |
| SYSTEMIC-05 | (systemic) | CONFIRMED | (systemic) | audit allowlist omits 13 product tables; RLS tests use "no-data→empty" not adversarial |
| INV-SPOT-CHECK | (invariant) | PARTIAL | (invariant) | INV-6/INV-9 confirm; **INV-3 misstated** (omits auth/module-registry, wrongly includes structured-state) |

---

## 3. Findings Refuted or Downgraded (audit needs correction)

### REFUTED — remove or rewrite

- **H-02 — "Google API key transmitted as URL query param (`?key=...`)".** The cited file `packages/connectors/src/google/client.ts` **does not exist**, and the real Google connector (`oauth.ts`) uses OAuth: `client_secret` and tokens are sent only in the POST body (`application/x-www-form-urlencoded`); `buildAuthUrl` puts only `client_id`/`redirect_uri`/`state` in the URL. A grep for `key=` across `packages/connectors/src` returns nothing. **There is no API key and no secret in a URL query param.**
- **H-19 — "Confirmation bridge race condition — concurrent confirmations may cross wires".** `confirmation-registry.ts` keys the `waiters` Map by the unique `actionRequestId`; `awaitResolution`/`resolve` operate per-ID. This **is** correct per-request isolation, not a race. The only theoretical hazard (duplicate IDs) is not produced by the design.

### DOWNGRADED — keep finding, lower severity

- **CRIT-03 → HIGH.** The grant/policy defect and silently-broken chat-turn ingestion are real, but it is a correctness/availability defect (worker writes affect zero rows), not unauthorized disclosure; and the "recall via worker" framing is wrong (recall runs in the API path under `jarvis_app_runtime`, which the policies permit — it returns empty only because ingestion never wrote anything).
- **CRIT-04 → HIGH.** Genuine DataContextDb-only invariant violation (bare Kysely, no GUC), but impact is overstated: RLS still applies to `jarvis_app_runtime` regardless of the GUC, and the relevant write policies fail **closed** without the GUC. The only unrestricted exposure is the intentional `users_app_runtime_select USING(true)`. Not the clean data-leak the CRITICAL framing implies.
- **H-13 → MEDIUM.** Caller-supplied `ownerUserId` is a divergence from the canonical `app.current_actor_user_id()` pattern, but `sql/0031` has `FOR INSERT WITH CHECK (owner_user_id = app.current_actor_user_id())` on all three tables, so Postgres rejects a forged owner. Code smell / defense-in-depth gap, not exploitable escalation.
- **H-14 → MEDIUM.** `yamlStr()` does not escape newlines, but the injected value stays inside a double-quoted YAML scalar where a bare newline folds rather than breaking structure; trivial frontmatter break-out is not demonstrated.

---

## 4. Findings Confirmed at Full Severity

These verified clean as stated and should stand without correction:

**CRITICAL (confirmed CRITICAL):**
- **CRIT-01** — 5 admin tables (`workspaces`, `workspace_memberships`, `resource_grants`, `instance_settings`, `admin_audit_events`) have grants but no RLS/policies; only app-layer `requireAdmin` protects them.
- **CRIT-02** — `pgboss.*` has full DML granted to both runtime roles with zero RLS; cross-user job *metadata* enumeration is trivial.
- **CRIT-05** — OAuth `clientSecret` travels browser→API in the request body (BYO-OAuth self-host model; see nuance §5).
- **CRIT-06** — `audit-release-hardening` checks a hardcoded 14-table allowlist; ≥13 FORCE-RLS product tables are never checked, so a dropped policy on any of them passes silently.

**HIGH (confirmed HIGH):**
- H-01 (raw-Kysely admin lookup), H-03 (no MCP rate limit), H-04 (delete leaves vault files), H-05 (`eval` over operator env var), H-06 (smoke polls trivial `/health`), H-08 (vault plaintext at rest), H-09 (cross-module FK memory→chat), H-11 (`permissionId` never enforced), H-12 (`listTools()` ignores actor identity), H-15 (no `assertDataContextDb` in structured-state), H-16 + H-17 (view-share grantee can write task_activity; route has no visibility pre-check), H-20 (blanket-401 masking in 3 modules).

**SYSTEMIC:**
- SYSTEMIC-05 — audit-list gap + weak "no-data→empty" RLS test pattern both confirmed (with the nuance that the GUC path is still exercised indirectly and the export test does a genuine cross-user exclusion).

---

## 5. Nuances and Corrections (evidence right, characterization off)

| Finding | Correction needed |
|---|---|
| CRIT-02 | Exposure is job **metadata** (actor IDs, queue, command params, idempotency key), not private content/secrets — by the metadata-only-payload invariant. Still cross-user enumeration, but reword from "all job payloads ... including those of other users" → "all job *metadata* rows across users". |
| CRIT-04 | Cited `packages/module-registry/src/index.ts` has **zero** `SettingsRepository` references; the real usage is `packages/settings/src/routes.ts` (`new SettingsRepository(dependencies.appDb)`). Fix the file citation. |
| CRIT-05 | Architecturally a self-hosted **BYO-OAuth** model: the user pastes *their own* Google Desktop-app client secret over an authenticated session to *their own* server. Real concern is TLS + not logging/persisting in plaintext, not a shared-app-secret leak to third parties. |
| H-05 | Eval is on **line 114**, not 112 (line 112 is the `if [[ -n ... ]]` guard). Vector requires someone who already controls the backup host's env/shell. |
| H-07 | Cited `vault-context.ts` is wrong — the file write is in **`packages/vault/src/vault-ops.ts:19`** (`writeFile(fullPath, content, "utf8")`). And no `0o644` is *set*; **no mode is passed at all** (Node default). Reword "written with 0o644" → "written with no explicit mode (no 0o600/0o700)". |
| H-11, H-12 | Both cite `packages/module-sdk/src/` (a **types-only** package). The actual `listTools`/execution/enforcement lives in **`packages/ai/src/gateway/gateway.ts`**; `resolveActiveModules` ignores `actorUserId` and `listModuleManifests` takes no user arg. Behavior is accurate; fix the file paths. |
| H-18 | Unset env var yields `requireIssuerValidation: undefined`, deferring to better-auth's library default (not verifiably "false" from this repo). `infra/env.production.example:40` sets it `true` (operator config, not code default). Reword "off by default" → "not forced on at the app layer; defaults to the library's behavior when unset". |
| SYSTEMIC-01 | **Overstated on connectors.** The connectors admin path runs **inside** `withDataContext` and is gated by a GUC-actor RLS policy (`connector_accounts_admin_metadata_select`) plus a SECURITY DEFINER `is_instance_admin` re-check — it does **not** bypass the GUC. The systemic claim holds only for the 5 settings tables + SettingsRepository's raw appDb. |
| INV-SPOT-CHECK (INV-3) | The audit's exception list is wrong both ways: it **omits** real raw-Kysely exceptions (`auth`, `auth-session`, `module-registry`) and **falsely includes** structured-state, which correctly takes `scopedDb: DataContextDb`. INV-6 (chat metadata guard missing; `idempotencyKey` never wired to `singletonKey`) and INV-9 (genuine cross-module FK) confirm. |

---

## 6. Overall Confidence in Original Audit

**MEDIUM-HIGH.**

The audit's core security thesis is sound and well-evidenced: every CRITICAL survived verification in substance, and the two most consequential systemic claims (admin-tier-no-RLS and the false-confidence audit allowlist) are confirmed. The technical observations are almost always real — the verifiers rarely found that *nothing* was there. However, the audit has a recurring discipline problem that drags confidence down from HIGH: (1) **severity inflation** — two findings were filed CRITICAL that are really HIGH because RLS/INSERT-CHECK mitigations the audit didn't account for fail closed; (2) **wrong file/line citations** — H-02 cites a non-existent file, H-07 cites the wrong file and an unwritten mode, H-11/H-12 cite a types-only package, CRIT-04 cites an unrelated module; and (3) **two outright misreads** (H-02 API-key-in-URL, H-19 race condition) that the code refutes. The pattern is "right smell, imprecise sourcing." The findings are actionable, but the audit file needs a correction pass before any of it is quoted as authoritative.

---

## 7. Action — required corrections to the audit file

1. **H-02 — DELETE / REWRITE.** Remove the "Google API key in URL query param" claim. There is no API key; the Google connector is OAuth with all secrets in POST bodies. If a residual concern exists, re-file against the real file `packages/connectors/src/oauth.ts` — but as written it is unsupported. (Also remove the matching line from §Strengths/Systemic-4 "(a) Google API key in URL".)
2. **H-19 — DELETE / REWRITE.** Remove "confirmation bridge race condition." The `waiters` Map is correctly keyed per `actionRequestId`. If kept at all, reframe only as the narrow duplicate-ID hypothetical and mark it not-exploitable.
3. **CRIT-03 — DOWNGRADE to HIGH** and correct the description: it is silent worker write/availability failure (zero-row DML), not disclosure; remove the "recall via worker" mechanism (recall runs API-side under `jarvis_app_runtime` and is permitted).
4. **CRIT-04 — DOWNGRADE to HIGH**, fix the file citation to `packages/settings/src/routes.ts`, and note that writes fail closed without the GUC (only the intentional `users_app_runtime_select USING(true)` is unrestricted).
5. **H-13 — DOWNGRADE to MEDIUM**; note the `INSERT WITH CHECK` RLS policy blocks forged `ownerUserId`.
6. **H-14 — DOWNGRADE to MEDIUM**; note the value stays inside a quoted YAML scalar (newline folds, no structural break-out demonstrated).
7. **H-05 — fix line citation** to `scripts/backup-full.sh:114`.
8. **H-07 — fix file citation** to `packages/vault/src/vault-ops.ts:19` and reword from "0o644" to "no explicit file mode set".
9. **H-11 / H-12 — fix file citation** from `packages/module-sdk/src/` to `packages/ai/src/gateway/gateway.ts`.
10. **H-18 — reword** "off by default" to "not forced on at the app layer; defers to library default when the env var is unset".
11. **CRIT-02 — reword** "all job payloads of other users" to "all job *metadata* rows across users".
12. **SYSTEMIC-01 — narrow scope**: remove connectors from the "bypasses GUC" claim (that path runs inside `withDataContext` + RLS + SECURITY DEFINER admin check); keep it scoped to the 5 settings tables + SettingsRepository.
13. **INV-3 (invariant table / spot-check) — correct the exception list**: add `auth`, `auth-session`, `module-registry` as raw-Kysely exceptions; remove the false claim that structured-state skips DataContextDb (it uses `scopedDb: DataContextDb`).
