# HIGH Findings — Verification Supplement

**Verifier:** Opus 4.8 (independent re-verification of all remaining HIGH findings)
**Date:** 2026-06-10
**Scope:** All 40 remaining HIGH findings from the PLO Audit, re-verified against source.

This supplement records the verdict, evidence, and PostgreSQL/Fastify nuance for each
finding, and lists the corrections the original 28 audit files require. The headline
result: **the findings are overwhelmingly factually accurate at the code level**, but a
large fraction were over-rated as HIGH when the live mechanism (RLS scoping, Fastify
serializer behavior, admin gating, the house/single-user model) bounds the real impact to
LOW. Two findings are not real issues at all.

---

## 1. Summary Counts

| Verdict | Count | of 40 |
| --------- | ----- | ----- |
| CONFIRMED | 35 | 87.5% |
| PARTIAL | 3 | 7.5% |
| REFUTED | 1 | 2.5% |
| (also) NUANCE-only / no-issue after verify | 1 (C-01, a PARTIAL that nets to NONE) | — |

Verdict tallies:

- **CONFIRMED:** A-01, A-02, A-03, A-04, A-05, A-06, B-01, B-02, B-03, B-04, B-05, C-02,
  C-03, D-01, D-02, D-03, E-01, E-02, F-01, F-02, F-04, G-01, G-02, G-03, G-04, H-B, H-C,
  I-01, J-01, J-02, J-03, K-02, L-02, L-03, L-04 — **35**
- **PARTIAL:** C-01, F-03, K-01, L-01 — **4** (C-01 nets to NONE; see below)
- **REFUTED:** H-A — **1**

Severity movement after verification:

- **Upgraded to CRITICAL:** none.
- **Held at HIGH (SAME):** A-01, A-02, A-03, A-04, A-05, A-06, B-01, B-02, D-01, D-03,
  E-01, F-01, F-02, F-04, G-01, G-02, G-03, G-04, I-01, L-04 — **20**
- **Downgraded to LOW:** B-03, B-04, B-05, C-02, C-03, D-02, E-02, F-03, H-B, H-C, J-01,
  J-02, J-03, K-01, K-02, L-01, L-02, L-03 — **18**
- **Dropped to NONE (not a real issue):** C-01, H-A — **2**

> Note: several "SAME" findings were already authored at LOW in the original audit (D-01,
> D-03). "SAME" means the verifier did not change the original severity, not that every one
> is HIGH. The genuinely-HIGH confirmed set is in section 7.

---

## 2. Refuted Findings (require correction in the original audit)

### H-A — `chat_memory_facts` UPDATE policy missing WITH CHECK — **REFUTED**

The claimed exploit (UPDATE `owner_user_id` to another user to steal/give away a fact) does
**not** work. PostgreSQL RLS semantics: when `WITH CHECK` is omitted on a `FOR UPDATE`
policy, the `USING` expression is reused as the post-update check. So the NEW row must still
satisfy `owner_user_id = app.current_actor_user_id()`; an attempt to set a different owner
fails the implied check and the UPDATE is rejected. `FORCE ROW LEVEL SECURITY` is also on
(`0041_memory_facts.sql:26`), so this holds for all roles including the table owner.

**Correction:** Remove H-A as a vulnerability. At most, note that adding an explicit
identical `WITH CHECK` is cosmetic/defensive, not a correctness requirement.
**correctedSeverity: NONE.**

---

## 3. Partial Findings (correct core, overstated/wrong framing)

### C-01 — `app.current_workspace_id()` is a dead function — **PARTIAL → NONE**

- **Correct:** the function was created in `0002_app_rls.sql:22-41`.
- **Wrong:** the framing as a *lingering* dead function. `0028_workspace_teardown.sql:242`
  cleanly `DROP FUNCTION`s it, and lines 221-233 first rewrite the only consumer
  (`rls_probe_items_select`) to drop its workspace arm. It is **not present in the live
  schema**. The only residue is the GUC `app.workspace_id`, which is a runtime custom
  setting that is trivially settable by anyone via `set_config` whether or not anything
  reads it — that is true of any unused GUC and is not a dangling schema object.
- **Correction:** Remove C-01 as a finding. **correctedSeverity: NONE.**

### F-03 — No input length cap on chat turn text — **PARTIAL → LOW**

- **Correct:** `live-routes.ts` `readText()` (lines 164-170) imposes no `maxLength`; the
  application-level cap is genuinely absent.
- **Overstated:** the "multi-megabyte payloads silently accepted" claim. Fastify enforces a
  default global `bodyLimit` (1 MB) on JSON bodies; megabyte payloads are rejected at the
  framework layer by default unless a `bodyLimit` override exists (none found in this file).
- **Correction:** reword to "no *application-level* length cap; the framework's 1 MB
  default `bodyLimit` is the only bound, which is coarse and not turn-aware."
  **correctedSeverity: LOW.**

### K-01 — Admin RLS policies bound to `jarvis_migration_owner`, not `jarvis_app_runtime` — **PARTIAL → LOW**

- **Correct:** `0010_connector_admin_safe_metadata.sql` defines two `FOR SELECT` policies
  (`connector_definitions_admin_metadata_select` line 4, `connector_accounts_admin_metadata_select`
  line 17), both `TO jarvis_migration_owner` (the DDL role, per `bootstrap/0000_roles.sql:67`),
  so both are dead at runtime.
- **Wrong, two ways:** (1) the finding names a policy `connector_definitions_admin_insert`
  that **does not exist** anywhere in the connector SQL; the real policies are both SELECT,
  not INSERT. (2) There is **no security/functional hole**: the live admin-metadata read
  path is the `SECURITY DEFINER` function `app.list_connector_account_safe_metadata()`
  (lines 30-73, `EXECUTE` granted `TO jarvis_app_runtime`), which does its own
  `is_instance_admin` check internally. The two policies are vestigial dead code.
- **Correction:** fix the bogus policy name, drop the "security gap" framing, reclassify as
  dead-code hygiene. **correctedSeverity: LOW.**

### L-01 — `resolveKeyring` silently crashes on malformed key JSON — **PARTIAL → LOW**

- **Correct:** `JSON.parse(keysJson)` runs with no try/catch and throws an uncaught
  `SyntaxError`; crash-on-malformed-key-env is real.
- **Wrong, two ways:** (1) **wrong file path** — it is
  `packages/db/src/keyring.ts:44-45`, **not** `packages/vault/src`. (2) The word "silently"
  contradicts the mechanism: an uncaught `SyntaxError` from `JSON.parse` emits a stack trace
  naming `JSON.parse` and fails fast and loudly — not silent, just ungraceful (no clear
  operator message).
- **Correction:** fix the file path; replace "silently crashes / no graceful error
  message" with "fails fast with an uncaught `SyntaxError` and no operator-friendly
  message." **correctedSeverity: LOW.**

---

## 4. Notable PostgreSQL / Framework Nuances

These are cases where the underlying platform behavior was subtler than the original audit
text implied, and matter for getting the fix (or the non-fix) right.

- **`WITH CHECK` defaults to `USING` on UPDATE policies (H-A).** Omitting `WITH CHECK` on a
  `FOR UPDATE` RLS policy is **not** a hole — Postgres reuses `USING` as the post-update
  check. This single fact refutes H-A and should be applied when reviewing every other
  UPDATE policy in the audit.

- **Implied no-op vs. error under RLS (H-B).** A bare-id UPDATE/DELETE targeting another
  user's row under `FORCE RLS` matches **zero rows** — a silent no-op, not an error and not
  a leak. The residual issue is UX: the API returns 204 instead of 404. This is by-design
  defense-in-depth (DataContextDb pattern), not an authorization bypass.

- **Fastify response serialization drops undeclared fields (D-02).** With
  `fast-json-stringify`, a properly-typed object schema only emits its declared
  `properties`; extra DB columns are already stripped on output. So "missing
  `additionalProperties: false`" does **not** mean extra fields leak on responses. The real
  exposure is on the **input** side, where the two `additionalProperties: true` recurrence
  objects accept arbitrary nested keys stored verbatim as jsonb.

- **Fastify per-status serializers (D-01).** Absent a 4xx response schema, Fastify runs no
  serializer for that status and returns the handler payload as-is — a spec-completeness
  gap, not a field-stripping/leak regression.

- **FK columns are not auto-indexed (E-02).** Postgres does not auto-create an index on the
  *referencing* column of an FK, and a composite `UNIQUE (owner_user_id, provider_id)` index
  cannot serve a scan keyed on `provider_id` alone (leading-column rule). Real but
  low-impact, since the parent `connector_definitions` is a tiny near-static seed table.

- **Global HNSW index + RLS post-filter (H-C).** The ANN index is global (no
  `owner_user_id` predicate), so HNSW returns the global top-k and RLS filters afterward.
  This is a **recall-quality / scalability** issue (a low-data user may get fewer than
  `limit` rows), never a cross-user leak — RLS still guarantees isolation. Negligible under
  the current house/single-user model.

- **Role-scoped dead policies (K-01).** Policies `TO jarvis_migration_owner` are inert at
  runtime because the app connects as `jarvis_app_runtime`. Dead, not dangerous — the live
  path is a `SECURITY DEFINER` function with its own admin check.

- **Simple-query implicit transaction (E-01).** A single `client.query(sql)` with multiple
  statements runs in one implicit transaction, so failure *within* a file rolls back that
  file. The real inconsistency window is **across files** in the loop (no outer
  transaction) plus the absence of any retry/idempotency guard in the runner itself.

- **`USING(true)` SELECT on `app.users` is deliberate and secret-free (A-06).** The broad
  read is documented in-migration (`0045:80-81`) for admin/membership checks; writes remain
  self-row scoped. `app.users` holds profile fields only — password hashes/tokens live in
  `auth_accounts`/`better_auth_sessions`, which are FORCE-RLS and revoked from app_runtime.

- **Global `bodyLimit` bounds "unbounded" input claims (F-03).** Fastify's default 1 MB JSON
  body limit caps the "multi-megabyte payload" scenario at the framework layer.

---

## 5. Confirmed at CRITICAL Severity (upgrades)

**None.** No HIGH finding was upgraded to CRITICAL during verification.

---

## 6. Confirmed but Downgraded (HIGH → LOW, and → NONE)

### Downgraded to LOW (18)

| findingId | title | reason for downgrade |
| --------- | ----- | -------------------- |
| B-03 | Instance setting key has no allowlist | gated behind `requireAdmin`; only an admin can write junk keys |
| B-04 | Resource grant `resourceId` no UUID validation → 500 | admin-gated; robustness defect (500 vs 400), not bypass/leak |
| B-05 | `@fastify/rate-limit` absent from `apps/api` direct deps | phantom dep; resolves via hoisting today, breaks only if deployed standalone |
| C-02 | `app.has_resource_grant_level()` dead after 0019 | inert dead schema; never dropped but no caller, no security impact |
| C-03 | `contribute` grant level functionally inert | UX/contract mismatch (advertised level == view for the task row); not escalation |
| D-02 | No `additionalProperties: false` on tasks response schemas | serializer already drops undeclared output fields; real risk is input-side recurrence jsonb |
| E-02 | `connector_oauth_pending` missing index on `provider_id` | parent is tiny static seed table; FK scan rarely fires |
| F-03 | No input length cap on chat turn text | framework 1 MB `bodyLimit` bounds it; app-level cap genuinely absent |
| H-B | Fact mutations accept bare id, no app-layer owner check | RLS `FORCE` + owner policies scope it; residual is 204-vs-404 UX |
| H-C | Global HNSW index across users | recall-quality issue; RLS guarantees no cross-user leak |
| J-01 | `createCachedEventForTest` on production public API | RLS-scoped self-only write; test-seam-on-public-surface smell |
| J-02 | PATCH briefings definitions authorizes via RLS only | inconsistent with `/run` belt-and-suspenders; impact conditional on unread RLS policy |
| J-03 | briefings `generateSummary` fabricated ToolContext | `scopedDb` carries real RLS authority; empty ctx only bites tools that read ctx.actorUserId |
| K-01 | Admin RLS policies bound to migration_owner | vestigial dead policies; live path is SECURITY DEFINER fn w/ admin check |
| K-02 | Google OAuth error body in server logs | logs only, not HTTP response; Google bodies don't echo raw secret value |
| L-01 | `resolveKeyring` crash on malformed key JSON | fail-fast crash (loud), wrong file path in original |
| L-02 | `ownerUserId` exposed in API/AI output | non-secret internal UUID; RLS scopes to actor; minimization issue, not secret leak |
| L-03 | `unsafeSelectVisibleProbeIdsForTest` on prod-exported class | reads only the RLS probe table; naming/encapsulation smell |

### Dropped to NONE (2)

| findingId | title | reason |
| --------- | ----- | ------ |
| C-01 | `app.current_workspace_id()` dead function | cleanly dropped in 0028 with its consumer; not in live schema |
| H-A | `chat_memory_facts` UPDATE missing WITH CHECK | omitted WITH CHECK defaults to USING; exploit blocked |

---

## 7. Confirmed Findings That Stand at HIGH

These are confirmed and genuinely warrant HIGH attention (RLS-disabled tables with write
grants, unauthenticated/unthrottled endpoints, secret-at-rest/secret-in-ps exposure,
crash/consistency hazards, and a silent data-correctness bug).

| findingId | title | correctedSeverity |
| --------- | ----- | ----------------- |
| A-01 | `instance_settings` has no RLS (write grants present) | HIGH |
| A-02 | `admin_audit_events` INSERT with arbitrary `actor_user_id` by any app_runtime session | HIGH |
| A-03 | `workspaces` no RLS — any user can enumerate/create | HIGH |
| A-04 | `workspace_memberships` no RLS (full CRUD) | HIGH |
| A-05 | `resource_grants` no RLS — any user sees/writes all sharing relationships | HIGH |
| A-06 | `app.users` SELECT policy `USING(true)` — reads all user rows | HIGH (deliberate; profile-only, no secrets) |
| B-01 | `/api/bootstrap/status` leaks user count unauthenticated + unthrottled | HIGH |
| B-02 | `/api/connectors/google/authorize` has no OAuth-specific rate limit | HIGH |
| E-01 | Bootstrap/grants runner has no transaction wrapping across files, no retry guard | HIGH |
| F-01 | `clear()`/`switchProvider()` race in-flight turn — no `turnsInFlight` guard | HIGH |
| F-02 | Gemini `settings.json` with MCP session token never deleted | HIGH |
| F-04 | Codex MCP token injected via `send-keys` — visible in `ps`/`tmux show-buffer` | HIGH (documented accepted tradeoff) |
| G-01 | `toAccessContext` does not validate `actorUserId` as UUID | HIGH |
| G-02 | Briefing worker passes `actorUserId: ""` to ToolContext | HIGH (RLS via scopedDb mitigates) |
| G-03 | pg-boss `error` handler throws inside EventEmitter; uncaughtException handler only registered at entrypoint | HIGH |
| G-04 | Chat embed/extract job payloads have no metadata-only guard | HIGH (defense-in-depth gap) |
| I-01 | Cascade-close of recurring child task silently skips `generateNext` | HIGH (silent series termination) |
| L-04 | OIDC issuer validation off by default, no production guard | HIGH |

> D-01 and D-03 verdicts were "SAME" relative to the original audit but were authored at
> LOW (D-01) / contract-gap (D-03) there; they are not in this HIGH table. See the original
> files for their stated severity.

---

## 8. Recommended Audit Corrections (per original file)

Concrete edits to bring the 28 audit files in line with verification:

1. **H-A — remove or rewrite.** Delete the vulnerability claim. If kept, rewrite to: "UPDATE
   policy omits explicit `WITH CHECK`; Postgres defaults it to the `USING` expression, so
   owner-escalation is already blocked. Adding an identical explicit `WITH CHECK` is
   defensive cosmetics only." Severity NONE.

2. **C-01 — remove.** State that `app.current_workspace_id()` was cleanly dropped in
   `0028_workspace_teardown.sql:242` along with its only consumer; it is not in the live
   schema. The GUC `app.workspace_id` is an unused runtime setting, not a dangling schema
   object. Severity NONE.

3. **K-01 — fix two errors.** (a) Replace the non-existent policy name
   `connector_definitions_admin_insert` with the real pair
   `connector_definitions_admin_metadata_select` / `connector_accounts_admin_metadata_select`
   (both `FOR SELECT`). (b) Remove the "security gap" framing — admin reads work via the
   `SECURITY DEFINER` `app.list_connector_account_safe_metadata()` with an internal
   `is_instance_admin` check. Reclassify as dead-code hygiene. Severity LOW.

4. **L-01 — fix file path and the word "silently".** Change the path from
   `packages/vault/src/...` to `packages/db/src/keyring.ts:44-45`. Replace "silently
   crashes / no graceful error message" with "fails fast with an uncaught `SyntaxError`
   (loud stack trace) and no operator-friendly message." Severity LOW.

5. **F-03 — add the `bodyLimit` caveat.** Note Fastify's default 1 MB JSON `bodyLimit`
   already rejects multi-megabyte payloads; scope the finding to the missing
   *application-level / turn-aware* cap. Severity LOW.

6. **D-02 — correct the mechanism.** State that response serialization
   (`fast-json-stringify`) already drops undeclared fields, so the output-leak framing
   overstates the risk; the genuine concern is the two `additionalProperties: true`
   recurrence **input** objects accepting arbitrary jsonb. Severity LOW.

7. **H-B — reframe as UX, not bypass.** Note RLS (`FORCE` + owner-scoped UPDATE/DELETE
   policies) reduces a cross-owner mutation to a silent no-op; the real defect is returning
   204 instead of 404. Severity LOW.

8. **H-C — reclassify as recall/scalability.** Make explicit this is never a cross-user
   leak (RLS post-filters); it degrades recall in a multi-user corpus and is negligible
   under the current house/single-user model. Severity LOW.

9. **A-06 — annotate as deliberate + secret-free.** Add that `USING(true)` is documented
   in `0045:80-81` for admin/membership reads, writes stay self-row, and `app.users` holds
   no secrets (hashes/tokens live in FORCE-RLS `auth_accounts`/`better_auth_sessions`).
   Keep HIGH but record the deliberate-design context.

10. **B-03, B-04 — record the `requireAdmin` gate.** Both are admin-gated; reframe as
    admin-careless/robustness rather than arbitrary-user attack. Severity LOW.

11. **J-01, L-03 — note the RLS/probe-table mitigations.** `createCachedEventForTest`
    writes only self-scoped rows via DataContextDb; `unsafeSelectVisibleProbeIdsForTest`
    reads only `app.rls_probe_items`. Reframe both as test-seam-on-public-surface
    encapsulation smells. Severity LOW.

12. **J-02 — flag the conditional dependency.** State the security impact depends on the
    (unread) RLS UPDATE policy on `app.briefing_definitions`; if owner-only it is safe, if
    it grants manage-level share grantees UPDATE it is exploitable. Recommend reading that
    policy. Severity LOW pending policy confirmation.

13. **G-02 / J-03 (same code, `repository.ts:254-262`) — note the duplicate.** These two
    findings describe the *same* fabricated-`ToolContext` line. Cross-reference them and
    state the `scopedDb` first-arg carries the real RLS authority; the empty ctx only
    affects tools that read `ctx.actorUserId` directly. Severity LOW for J-03; G-02 stays
    HIGH only insofar as it flags the latent risk.

14. **K-02 — clarify logs vs response.** The Google error body reaches the server log via
    Fastify's default error handler, **not** the HTTP response body, and does not echo the
    raw `client_secret`. Severity LOW.

15. **L-02 — reclassify as minimization.** `ownerUserId` is a non-secret internal UUID,
    not in the Hard-Invariants secret list; RLS already scopes responses to the actor.
    Reframe as information-tidiness, not a secret/privilege leak. Severity LOW.

16. **E-01, F-02, F-04 — tighten line numbers.** E-01 mechanism is correct but should state
    the inconsistency window is *across* files (intra-file runs in an implicit transaction).
    F-02 write block is lines 78-96 (write itself 92-95), kill 175-177 (cited "78-95" /
    "175-176" are off by one). F-04 is accurate and self-documented as an accepted tradeoff.

17. **C-02, C-03 — reclassify as dead-code / contract hygiene.** `has_resource_grant_level`
    is never dropped (truly inert dead schema); `contribute` grant confers nothing beyond
    `view` on the task row (one caveat: a contribute/view grantee who can SELECT a task can
    still INSERT task_activity rows, so it is not 100% identical across every surface).
    Severity LOW for both.
