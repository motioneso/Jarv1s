# PLOO Audit — Summary & Triage
> Independent Opus pass — 2026-06-10. Read-only; findings only. Did not read the parallel Fable audit.

> [!warning] Re-validation update — 2026-06-10 (migration 0052)
> **This audit (and the table below) were grounded on a STALE local checkout (migration 0046).** The real `origin/main` tip was at migration 0052 — 8 feature merges ahead (PR #93 multi-user lifecycle → migrations 0047/0050/0051/0052, plus PRs #85/#86 and backlog #80–84). Every finding was re-validated against an `origin/main` worktree with per-claim adversarial verification. Net effect:
> - **Fixed by the unpulled work (3):** `#103` multi-user lifecycle (HIGH → fixed by PR #93); `#108` SettingsRepository raw-Kysely sub-finding (MED → functionally resolved, arch debt continues under `#95`); `#110` connectors `requireAdmin` raw-Kysely sub-finding (MED → resolved at DB layer via migration 0047 SECURITY DEFINER; structural residue under `#111`).
> - **Partial (2):** `#104(b)` `users` any-column UPDATE; `#111` connectors/`app.users` (DB query fixed, DataContextDb brand + module-isolation residue remain).
> - **Still real, untouched by the merges (8 HIGH + 2 low):** `#95` (corrected up from "partial" → still-real core invariant), `#96`, `#97`, `#98`, `#99`, `#100`, `#101`, `#102` (HIGH); `#104(d)` `app.users` ENABLE-not-FORCE (corrected from "moot" → still-real design-debt), `#106` (LOW).
> - **New, confirmed in the never-audited admin/lifecycle code:** `tools/list` not actor-scoped (filed as new issue `#172`, MED–HIGH); plus MED/LOW (REST `/invoke` schema-validation + exception-leak, admin-SELECT GUC trust, deactivate session-revocation non-atomicity, inert `ModuleJobManifest` contract) — already carried on the phase batch cross-refs.
> - **Refuted on re-validation (do not file):** SettingsRepository "txn isolation for admin checks"; registration after-hook "TOCTOU"; MemoryRetriever "ownerUserId not threaded" — all RLS-protected.
> - **Positive confirmations:** the PR #93 admin lifecycle routes are well-secured (layered `requireAdmin` + DB policy, parameterized input, correct `withDataContext` wrapping).
>
> GitHub bookkeeping done: `#103` closed; re-validation comments on `#103`/`#108`/`#110`; `#172` filed. `#108`/`#110` kept OPEN (batches with still-open sub-findings).

## Totals across all phases

| Severity | Count |
| -------- | ----- |
| CRIT     | 0     |
| HIGH     | 2     |
| MED      | 17    |
| LOW      | 21    |
| INFO     | 33    |

(Refuted across all phases: 1 — Phase 7 OAuth `/authorize` rate-limit claim.)

## CRIT & HIGH findings — the action list

| Phase | Severity | Title | File | One-line fix |
| ----- | -------- | ----- | ---- | ------------ |
| Phase 2 — Secrets, Vault & Credentials | HIGH | User deletion never removes the user's vault files — private notes orphaned on disk after account delete | scripts/delete-user-data.ts:115 | After the DB COMMIT, recursively `rm` the user's vault dir via a vault-owned helper under the same `--execute` guard, and add a vault file count to the dry-run. |
| Phase 7 — API & Worker Entry Points | HIGH | Hardcoded development BETTER_AUTH secret signs sessions whenever NODE_ENV is not exactly "production" | packages/auth/src/index.ts:354 | Require an explicit secret in all environments (throw when unset regardless of NODE_ENV), or generate a random per-process secret in dev so it is never a known committed constant. |

No CRIT findings in any phase.

## Recommended follow-up (per the audit "After the audit" section)

### One GitHub issue per CRIT/HIGH (security-tier: new PR per fix, cross-model QA, Ben merge sign-off)

Both HIGH findings touch secrets/auth, so both are security-tier:

- **[security] User deletion leaves vault files orphaned on disk (Phase 2 HIGH)** — `scripts/delete-user-data.ts` only deletes the DB row; the per-user `/data/vaults/<userId>/` directory of private notes survives. Add a vault-owned recursive purge after DB COMMIT, plus a dry-run file count and an audit-event log line. New PR, independent cross-model QA, Ben merge sign-off.
- **[security] Hardcoded BETTER_AUTH dev secret signs sessions outside production (Phase 7 HIGH)** — `readAuthSecret()` falls back to a committed constant whenever `NODE_ENV !== "production"`, allowing session forgery / full account takeover on the LAN self-host model. Fail closed (require an explicit secret everywhere) or mint a random per-process dev secret. New PR, independent cross-model QA, Ben merge sign-off. NOTE: the same `NODE_ENV === "production"`-only gate also governs the secret-encryption keyring dev-default (Phase 2 MED, `packages/db/src/keyring.ts:29`) and the secret cipher dev-default literals — fix the env-gate pattern once across all three sites in this PR or a tightly-coupled sibling.

### Batch MED/LOW into one follow-up issue per phase

- **Phase 1 (3 MED, 2 LOW):** RLS+FORCE on workspace/settings/grant/audit tables; route SettingsRepository through DataContext; column-scope the `users` app_runtime UPDATE (block `is_instance_admin` self-flip); add `TO <runtime role>` to `memory_facts` and `chat_user_memory_settings` policies.
- **Phase 2 (2 MED, 4 LOW):** fail-closed keyring env gate; salted KDF / high-entropy key requirement; move Google adapter key from `?key=` to `x-goog-api-key` header; sanitize Google token-endpoint error; complete the user-deletion dry-run table set (memory/structured-state/chat-memory/`connector_oauth_pending`).
- **Phase 3 (2 MED, 3 LOW):** real JSON-schema validation at the gateway (integer/enum/min-max/additionalProperties); call `validateToolInput` on the REST tool-invoke route; actor-scope `tools/list`; scrub handler-throw messages on the REST route; wire the AI REST resolve route to unblock the gateway confirmation waiter.
- **Phase 4 (3 MED, 2 LOW):** add harness-enforced native-tool disable to the Claude MCP launch; add worker-applicable RLS policy on `memory_chunks`/`memory_file_index` so chat embedding works (shared with Phase 6/8 — see below); install the user-tier Gemini Policy Engine deny; normalize `chat_user_memory_settings` and `chat_messages_update` policy guards/role targets.
- **Phase 5 (1 MED, 2 LOW):** route SettingsRepository through DataContext (shared with Phase 1/7); RLS-protect or retire `app.resource_grants`; return only the `needsBootstrap` boolean from `/api/bootstrap/status`.
- **Phase 6 (2 MED, 4 LOW):** add worker RLS policy on `memory_chunks`/`memory_file_index` (shared with Phase 4/8); add `assertDataContextDb` to memory/structured-state repos; add a real worker-role INSERT test for chat-recall; align structured-state `manage` share level with UPDATE/DELETE policies (or drop it from the manifest); validate `actorUserId` UUID/containment in `VaultContextRunner`.
- **Phase 7 (2 MED, 1 LOW):** RLS on admin/identity tables; route SettingsRepository through DataContext (shared with Phase 1/5); return only `needsBootstrap` from `/api/bootstrap/status` (shared with Phase 5).
- **Phase 8 (2 MED, 3 LOW):** add worker RLS policy on `memory_chunks`/`memory_file_index` (shared with Phase 4/6); make `ModuleJobManifest` metadataOnly/payloadSchema a live harness-enforced chokepoint; add metadata-only payload guards to chat's two pg-boss queues; extract a single shared AES-256-GCM secret cipher into `@jarv1s/db`; make `assertDataContextDb` structural rather than opt-in.

### Cross-phase convergences (one fix retires several findings)

- **Worker RLS policy on `memory_chunks`/`memory_file_index`** is the SAME bug surfaced from three angles: Phase 4 MED, Phase 6 MED, Phase 8 MED. One migration widening those policies to `TO jarvis_app_runtime, jarvis_worker_runtime` fixes all three (and re-enables chat episodic recall, which is currently silently broken / fails closed).
- **SettingsRepository runs on a raw root Kysely (no DataContext / actor GUC)** appears as Phase 1 MED, Phase 5 MED, and Phase 7 MED. One refactor (route admin/settings DB access through `withDataContext`) retires all three.
- **No RLS on workspace/settings/grant/audit tables** appears as Phase 1 MED and Phase 7 MED (and Phase 5 LOW for `resource_grants` specifically). The natural home is the not-yet-landed `current_actor_is_admin()` / migrations 0050–0052 work.
- **`NODE_ENV === "production"`-only env gate** governs the Phase 7 HIGH (BETTER_AUTH secret), the Phase 2 MED keyring dev-default, and the Phase 8 LOW duplicated cipher dev-defaults — fix the allowlist-the-safe-case pattern once.

### RLS shareability-map updates implied by Phase 1/2 findings

- **`app.resource_grants` is effectively legacy/dead for authorization** (Phase 5 LOW verification): live cross-user access now flows through `app.has_share()` reading the RLS-protected `app.shares`, NOT `app.has_resource_grant()` reading `resource_grants`. Update the shareability map to mark `resource_grants` as stale/admin-only (RLS-protect it or retire it as dead vocabulary) so future readers don't treat it as authorization-bearing.
- **`app.users` is ENABLE-not-FORCE by design** (Phase 1 INFO, documented owner-bypass exception for SECURITY DEFINER admin-check functions) — record in the map so the missing FORCE is not misread as a defect, and note `users_app_runtime_select` is `USING(true)` (all rows visible to app_runtime).
- **structured-state classification** (Phase 6 INFO): `preferences` = owner-only; `commitments`/`entities` = owner-or-share. The `manage` grant level is declared in the manifest but NOT enforced on UPDATE/DELETE (owner-only) — the map should record this asymmetry until reconciled.

## Scope notes

- Migrations 0050–0052 and `current_actor_is_admin()` were NOT in the tree at audit time (latest migration 0046); the Phase 1 & 5 key questions targeting them are N/A and recorded as INFO, not findings. The same applies to the user `status` column, the deactivation/last-admin/bootstrap-owner lifecycle routes, and the admin UPDATE RLS policy on `app.users` — all planned-but-unlanded (Phase 5).
- The M-A3 real-AI-provider credential-decryption worker path is not yet wired (Phase 2/3 INFO) — re-audit the decrypted-key payload/log behavior when it lands.
- This was an INDEPENDENT pass; it did not read the parallel Fable audit findings, so overlap/divergence with that audit is expected and useful.

## Per-phase index

- **Phase 1 — DB Foundation & RLS** (CRIT 0 / HIGH 0): no-RLS admin/settings/grant tables + raw-Kysely SettingsRepository + uncolumned `users` self-UPDATE are the defense-in-depth gaps; runtime roles correctly NOBYPASSRLS.
- **Phase 2 — Secrets, Vault & Credentials** (CRIT 0 / HIGH 1): account deletion orphans the user's plaintext vault notes on disk; secondary fail-open keyring dev-default and unsalted SHA-256 key derivation.
- **Phase 3 — AI Gateway & Tool Security** (CRIT 0 / HIGH 0): the gateway input validator is far weaker than manifests advertise (ignores integer/enum/bounds), and the REST tool-invoke route skips validation/error-scrubbing entirely.
- **Phase 4 — Chat & MCP Transport** (CRIT 0 / HIGH 0): native-tool lockdown is allowlist-only (missing the spike's harness-enforced deny) on both Claude and Gemini, and worker RLS gaps silently disable chat episodic recall.
- **Phase 5 — Auth, Settings & Multi-User Lifecycle** (CRIT 0 / HIGH 0): SettingsRepository bypasses DataContext; `is_instance_admin` registration-input block holds; lifecycle/status guardrails are not-yet-landed (N/A).
- **Phase 6 — Module Data Layer** (CRIT 0 / HIGH 0): worker-grant-without-policy breaks chat embedding; memory/structured-state repos skip the `assertDataContextDb` tripwire; declared `manage` share level isn't enforced on writes.
- **Phase 7 — API & Worker Entry Points** (CRIT 0 / HIGH 1): a hardcoded BETTER_AUTH dev secret signs sessions outside production (account-takeover risk); admin/identity tables lack RLS; one refuted finding (OAuth `/authorize` rate-limit).
- **Phase 8 — Cross-cutting sweep** (CRIT 0 / HIGH 0): module isolation and the DataContextDb brand hold tree-wide; the lone unpaired worker grant and the inert `ModuleJobManifest` metadata-only contract are the systemic signals behind the per-phase findings.
