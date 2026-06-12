# Coordination Run — 2026-06-11-audit-remediation

**Date:** 2026-06-11
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `515ad953-084d-4093-acbb-937f3f9cf6c1`** (match `agent_session.value` in `herdr pane list`). ⚠️ **Pane numbers reflow on every restart/split/reap and are USELESS as an identifier — do NOT trust any `w653f42bef3ac02-N` number written in this file; resolve the pane fresh by label+session at read time.** This session was interrupted/restarted many times (2026-06-12) and panes have renumbered repeatedly. Operative authority rule: the sole Claude pane **labelled `Coordinator`** whose `agent_session.value` matches the anchor above is the authority — re-claim the label after any restart, verify exactly one `Coordinator` pane via `herdr pane list`, before any merge. Durable run state lives in this committed manifest + GitHub (source of truth), never in the volatile pane id.
**Finding source:** `docs/audits/2026-06-11-fable5-issue-verification.md` — independent Fable 5 verification @ `origin/main e629f3c`, migration head 0052 (22 stand, 8 severity-downgraded to MED/LOW, 0 refuted, 0 already-fixed).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`. **`security`-tier sign-off DELEGATED to Fable (Ben, 2026-06-12 — "I'm not in a good place to review; have Fable review the security PRs and proceed").** Per security PR: run adversarial QA as a **Fable (`model: 'fable'`) cross-model review** + post verdict via `gh pr comment`; **Fable APPROVE → merge autonomously**; Fable `revise`/`reject` → bounce to build agent, re-QA. Ben gets a per-merge digest (not a gate). Escalate back to Ben only on a genuine design fork Fable can't settle.
**⚡ OVERNIGHT AUTONOMY (Ben, 2026-06-12 ~05:10Z — going to sleep):** _"Keep knocking out all issues, igd you need me do a fable agent to review my part."_ → Run the fleet **fully autonomous overnight across the relay chain**; do NOT pause for Ben on anything. **Fable substitutes for Ben at EVERY gate** he'd normally hold: (a) security-tier merge sign-offs (already delegated, line 6) AND (b) **spec/plan-approval for D/E/H** — where a slice would normally wait on Ben's greenlight, spawn a one-shot **Fable (`model:'fable'`) reviewer** over the spec+plan; Fable APPROVE → spawn the build agent; Fable revise → apply fixes, re-review. Escalate to Ben **only** if Fable hits a genuine design fork it cannot settle (leave it `blocked`, digest, move on to other slices — never idle the fleet waiting). Successor coordinators inherit this authorization until Ben says otherwise.

**Relay threshold:** security-tier merge → relay immediately; routine/sensitive merges\*since\*relay ≥ 2 → relay. No deferral.
**merges_since_relay:** 0 — **§E DISCHARGED; PER-FINDING RESIDUAL RECONCILIATION IN PROGRESS** (Ben re-opened 2026-06-12: _"get all of the issues tightened, especially foundation and security"_ → not a paper close-out). \_History: F #184 04:34Z, G #186 + I #185 ~04:40Z under p_38; B #187 05:09Z under p_44 (security relay); D #188 ~06:20Z under p_45 (security relay); E #189 `0baa384` (security relay, this session); H #190 `2dc204b` (§E final, all slices A–I landed); **PR-A #201 `0160245` + PR-B #202 `f1644fd` + PR-C #203 `3859934` (security relays, session `515ad953`, 2026-06-12 — per-finding residuals)**.\*

**Live state (Coordinator session `515ad953`, 2026-06-12T20:08Z — RELAY after C-routine #198 → OTNR §E FULLY DISCHARGED):** ✅ **C-routine #198 MERGED** — squash `691a0c4` @ 20:07:40Z; **#168 + #165 closed**. FK-covering indexes (`0063_tasks_fk_indexes.sql`, `0064_chat_memory_facts_source_thread_idx.sql`), worker graceful-drain on SIGTERM/SIGINT (`boss.stop({graceful:true})` raced vs 10s timeout, then pool destroy), startup queue-existence guard, migration-runner per-file transaction wrap. Fable cross-model QA **APPROVE/MERGE-READY:YES**; 3 comment-only nit-fixes batched in post-approval (immutable 0064 provenance `0041`, shutdown/crash-log comments); CI green on `3e9f1d6`. **Migration spine HEAD now 0064** (was 0062 — C added 0063 tasks + 0064 memory). Already-done (verified, not gaps): schema_migrations version-collision preflight (`assertUniqueMigrationVersions`), app.users FORCE-RLS (`authOwnerTable`), no-actor job rejection (`toAccessContext`). Document-accepted deferrals: `connector_oauth_pending.provider_id` index (immutable seed table), bootstrap dev passwords (deployment-milestone concern). **🏁 OTNR MED/LOW disposition §E is now FULLY DISCHARGED — all buckets (A–I + B-RLS + B8 + C-routine) landed. → RETURN TO PHASE-2+ EPIC WORK.** Worktrees cleaned: removed temp `/tmp/c-routine-fix` + completed build-agent `agent-af0b548b648348f01`; merged local branch deleted. Tree authoritative & clean: primary on `main @ 691a0c4` (fast-forwarded to origin/main). Another session still holds detached worktree `agent-a1f67d81` — do **not** force-prune.

**Live state (Coordinator session `515ad953`, 2026-06-12T~22:00Z — RECONCILIATION PASS, PR-A + PR-B security relays):** Ben re-opened the run ("does this cover all issues? get them all tightened, **especially foundation and security**, before epics; deferrable ones may re-home to epics"). The §E PRs (#191–#198) closed cross-cutting CLUSTERS; each bucket retains **per-finding residuals** — this pass triages each as FIXED / DO-NOW (foundation·security, Fable-gated) / DEFER-OK (re-home to epic). **4-PR DO-NOW plan:** ✅ **PR-A #201 MERGED** (`0160245`) — DB/RLS foundation: `assertUuid` at the `app.actor_user_id` GUC RLS-pivot, removed shipped RLS-bypass `unsafeSelectVisibleProbeIdsForTest`, injectable non-rethrow pg-boss `onError` (was crashing the API host on a transient DB blip), job-boundary UUID assert (residuals of #125 #158). ✅ **PR-B #202 MERGED** (`f1644fd`) — vault·secrets·connectors: vault 0600/0700 modes + `assertVaultContext` at all 7 op boundaries (#131); keyring KDF entropy floor + hardened-env required-check + `*_SECRET_KEYS` JSON-shape validation + non-auth-error propagation in legacy decrypt (#114, **SHA-256 KDF deliberately unchanged — at-rest secrets safe**); `updateAccount` no longer silently un-revokes on a scope-only PATCH (#143); OAuth rate-limit `parsePositiveIntEnv` NaN guard (#169). **Both Fable cross-model security-QA APPROVE, both CI green (Verify-foundation + Compose-smoke), merged autonomously under overnight Fable-as-Ben-proxy authority.** Migration spine **HEAD still 0064** (both PRs code-only). Tree clean: `main @ f1644fd`, both branches deleted. **⚠ Fable surfaced a security follow-up (DO-NOW this run):** the same NaN-disables-limit bug lives in 5 sibling knobs incl. `JARVIS_RL_AUTH_MAX` (login brute-force limiter) — hoist `parsePositiveIntEnv` to shared + apply to all 5 (folding into PR-C). **NEXT:** PR-C (#146 data-rights export + #150 module-isolation + 5-knob hoist), PR-D (#123 #136 prompt-injection + #161 chat DTO), then per-finding bucket triage/close. ⚠ project-state memory still wrongly says "RUN COMPLETE" — correct after reconciliation lands.

**Live state (Coordinator session `515ad953`, 2026-06-12T~22:30Z — RELAY after PR-C #203 security merge):** ✅ **PR-C #203 MERGED** (`3859934`, squash) — memory data-rights + fail-closed rate-limit hardening. **Memory #146:** `deleteAllForUser` now also wipes `memory_file_index` (was orphaning the index past `rebuildFromVault`); new `toVectorLiteral` non-finite guard at both pgvector interpolation sites (bound-param, defense-in-depth); `insertFact` no-row guard (no silent `!`); `getEmbeddingProviderConfig` validates env against the kind union + throws (was casting arbitrary env → opaque later crash); regression test extended to assert all three owner-scoped tables empty. **Rate-limit 5-knob hoist:** `parsePositiveIntEnv` moved to node-free `@jarv1s/shared/env`, applied fail-closed to AUTH/GLOBAL/AI*TOOLS/CHAT/MCP (incl. login brute-force limiter `JARVIS_RL_AUTH_MAX`); connectors' local copy removed + re-imported. **Fable cross-model security-QA APPROVE** (verified: `chat_memory_facts` omission from `deleteAllForUser` is \_correct* — facts are chat-derived, unrecoverable from vault; real wipe path is `delete-user-data.ts` → `DELETE FROM app.users` w/ `ON DELETE CASCADE` on all 4 tables; all 5 RL sites previously `Number("")→0`-disabled, now fail-closed; `@jarv1s/shared/env` pure/browser-safe; hard invariants intact). **CI green** (Verify-foundation + Compose-smoke @ run 27445738228). Migration spine **HEAD still 0064** (PR-C code-only). Tree clean: `main @ 3859934`, branch deleted. **PR-D disposition GROUNDED (briefings #150):** DO-NOW = (1) wire `idempotencyKey`→`sendJob({singletonKey})` to dedupe double-submit runs; (2) add `shareableResources:[{briefing_definition, [view,manage]}]` to the manifest to match RLS reality + the permission's own "shared with" wording (inert field, no migration, safe); (3) LOW cleanups — kill dead `===1?"visible":"visible"` ternary, log the swallowed tool-execute `catch{}`. ALREADY-FIXED (verified, skip): `/run` owner-scoped authz (RLS + explicit `owner_user_id!==actor` 404 + `generateRun` uses `getOwnedDefinitionById`). DEFER-OK → re-home to epic: `summarizeToolResult`/`displayToolName` module-isolation — the existing `ToolSummarize` seam is an _invocation_-summary signature, not a _result_-summary; a clean fix needs a NEW result-summary manifest seam across 4 modules (its own design fork, generic `summarizeUnknownResult` fallback means no correctness risk today). **NEXT:** implement PR-D (its own Fable review → autonomous merge), then PR-E (#123 #136 prompt-injection + #161 chat DTO), then per-finding bucket triage/close.

**Live state (Coordinator session `515ad953`, 2026-06-12T~23:05Z — PR-D fix pushed + PR-E APPROVED + coordinator-owned CI blocker fixed):** **PR-E #205 Fable cross-model security-QA APPROVE** (grounded `cf17727`): the `#123` prompt-injection blocker is closed — `renderSummaryBlock` now routes the rolling summary (a verbatim concat of attacker-steerable stored assistant bodies) through `neutralizeSeedFraming`, the same chokepoint as every other untrusted seed surface. Full seed-assembly re-sweep confirms every untrusted interpolant neutralized (memory chunk text + facts, replay turns, summary); the only other interpolant `chunk.date` is system-formatted. 6/6 `chat-session-manager` unit tests incl. 3 new exact-count injection tests, 33/33 chat suites, `typecheck` green. Accepted bounded residual (`#136`): a plain-text instruction can survive inside `{{userName}}` (80-char cap; markup, newlines, framing stripped; inline only) — recorded on the PR. **PR-D #204 BLOCKING fix pushed (`73efc34`):** Fable's REVISE found `migratePgBoss` broke `db:migrate` idempotency — pg-boss v12 `updateQueue` throws whenever options carry `policy` (it rejects the key, never compares values) or `partition`, so on a persistent DB run 1 = drift-recreate (exit 0) but runs 2..N = exit 1, violating the documented idempotency contract; integration tests masked it (harness drops the pgboss schema per-suite, so only `createQueue` is ever exercised). Fix strips `policy`/`partition` before `updateQueue` and skips when nothing updatable remains; re-proved with two consecutive `pnpm db:migrate` against a non-dropped pgboss schema (both exit 0); folded in a `briefing_tool_failed` log `.slice(0,200)` cap (secrets-never-to-logs) + a keyless-send dedupe-trap comment. Focused Fable re-review on `73efc34` RUNNING. **Coordinator-owned CI blocker found + fixed here:** this manifest was committed prettier-dirty on `main` (markdown underscore-emphasis mangle on the PR-C relay line), so `prettier --check .` failed on EVERY PR's merge-with-`main` tree — that, NOT its code, is what failed PR-E's Verify-foundation. Canonicalized the doc; PR CI re-runs against clean `main` after this lands. **NEXT:** land PR-D + PR-E (both gated only on clean-`main` CI now), then PR-F (`#161` dead chat DTOs + boundary-schema hardening) + the `#200` token-hashing follow-up, then per-finding bucket triage/close.

**Live state (p_44, 2026-06-12T05:09Z):** ✅ **B #187 MERGED** — squash commit `4a82dcc` @ 05:08:59Z. Bookkeeping DONE; tree clean (main only). Migration spine HEAD now **0056**. Security-tier merge → relay fired.

**Live state (p_45, 2026-06-12T~07:00Z):** D plan fixed (3-round Fable gate → APPROVE @ 60fa688). SliceD-build spawned in Agents tab (pane `w653f42bef3ac02-5`, worktree `.claude/worktrees/audit-slice-d`, branch `audit-slice-d`, `JARVIS_PGDATABASE=jarvis_qa_d`). E build agent HELD (pane `w653f42bef3ac02-4`) — waiting for D to merge (E plan's pre-flight requires `insertAuditEvent(db: DataContextDb)` on origin/main). H blocked until D merges (migration number dependency).
**Live state (p_45, 2026-06-12T~06:20Z — RELAY after D #188 security merge):** ✅ **D #188 MERGED** by Ben @ 06:15:47Z — squash commit `596755a`. Issues #95 #155 closed. Migration spine HEAD still **0056** (D was code-only, no migration). ✅ **E UNHELD** — messaged SliceE-build pane `w653f42bef3ac02-4` "D merged — rebase on origin/main and proceed"; confirmed active (rebasing + running pre-flight). **H migration numbers CONFIRMED: 0057+0058** (D added no migration). SliceD-build pane `w653f42bef3ac02-5` still alive — reap pending (successor task). Security-tier merge → relay now.
**Available worker panes (p_45, 2026-06-12):** Coordinator = `w653f42bef3ac02-2` (me, p_45; herdr compacted on predecessor reap). Codex pane = `w653f42bef3ac02-1` = candidate cross-model security-tier QA path. Build agents require an **isolated worktree** + own `JARVIS_PGDATABASE`. Predecessor `p_44` reaped at relay.

**→ CONTINUATION NOTE (2026-06-12, plans written + Fable-reviewed):** Slices A+C merged/closed. All 7 remaining specs (B,D,E,F,G,H,I) authored + Fable-reviewed + prettier-formatted (035c4d6/7eba4c5). **Ben greenlit the build** ("write up the plans, have Fable review, spin up the agents") — spec-review gate SATISFIED. 7 TDD plans written (`docs/superpowers/plans/2026-06-12-audit-slice-*.md`); Fable adversarial review over all 7 → **all `revise`** (false intermediate-gate expectations; claimed-tested-but-uncaught security tests; fabricated line refs; **+1 spec-level security defect: H #134 chat_messages_update was `USING(true) WITH CHECK(true)` → removes owner-scoping; fixed in spec+plan**). Per-slice fix agents applied Fable's exact FIX text (workflow w78euq8lv). NEXT: format+commit+push the 7 plans → Phase-1 spawn parallel-safe (B,F,G,I) off origin/main; hold D(after B)/E(after D)/H(after B+G) on the spine. **Security-tier merges still need Ben's per-merge sign-off** (build greenlight ≠ merge greenlight). Coordinator @ pane `w653f42bef3ac02-2` / `$HERDR_PANE_ID=p_38`.

**→→ SUCCESSOR CONTINUATION NOTE (2026-06-12 ~05:10Z — RELAY after B #187 security merge; fresh coordinator picks up here):**
Wave-1 + B fully resolved: **A, B, C, F, G, I all MERGED** (PRs #181/#187/#182/#184/#186/#185); every
issue closed, all worktrees/branches/agents reaped, board Done, **tree clean (main only)**. Migration
spine HEAD is **0056** (B's DROP). **Remaining slices: D, E, H** — all now **CLEARED to spawn** under
Ben's overnight authorization (⚡ block up top: Fable substitutes for Ben at the spec/plan gate AND the
security-merge gate; run autonomous, never idle the fleet waiting on Ben). **YOUR IMMEDIATE WORK:**

1. **Re-adopt + verify you're the sole Coordinator.** `herdr pane list` → exactly one `Coordinator`
   (you); confirm `$HERDR_PANE_ID` matches the lock line below before any merge. Fleet is currently
   **idle (no build agents running)** — nothing to reap; you are spawning fresh.
2. **Spawn the D/E/H wave** into the "Agents" tab (`w653f42bef3ac02:3`), **3×1 grid**. Each gets its
   own worktree off current `origin/main` + own `JARVIS_PGDATABASE` (`jarvis_qa_d/e/h`). Gate each
   spec+plan through a one-shot **Fable (`model:'fable'`) reviewer** first (stands in for Ben) →
   APPROVE → spawn build agent via `coordinated-build`. Order/constraints:
   - **E (auth, code-only) — spawn NOW, parallel-safe.** `packages/auth/src/index.ts` single file,
     serialize internally. Rebases on B (#127/#101 bootstrap, landed). No migration.
   - **D (settings→DataContextDb) — spawn NOW, parallel to E.** #155 overlap with B (landed). If it
     adds a grant migration it is **0057**.
   - **H (migration/job infra) — spawn LAST, after D merges.** ×2 versioned migrations + grants file;
     its numbers (0058+0059, or 0057+0058 if D adds none) are only real once D lands. Don't let H
     assume a migration number on the spine before D merges.
3. **Each D/E/H is security-tier** → Fable QA + `gh pr comment` verdict + autonomous merge on APPROVE.
   **Every security merge → relay immediately** (you'll likely relay 2–3× more before the run ends).
4. **Task #8 — update the `coordinate` skill** (still pending, do once the build wave settles): codify
   (a) build/QA agents share ONE "Agents" tab; (b) 2×2 for 4-agent / 3×1 for 3-agent waves; (c) build
   agents NEVER touch `docs/coordination/` + must scope `pnpm format` to own paths; (d) message panes
   with `herdr pane run <pane> "<msg>"` (text+Enter atomic) — agents using `send-text`/`agent send`
   weren't hitting Enter (Ben flagged 04:40Z). NOTE: in THIS environment `herdr pane message` and
   `herdr agent send` failed — the reliable path is `herdr pane send-text <pane> "<msg>"` **followed
   by** `herdr pane send-keys <pane> Enter` (two calls). Use that to message agents.
5. **Pending Q from Ben (unanswered, non-blocking):** "Are we having codex QA?" — default stays Fable
   per the overnight authz. Codex pane `w653f42bef3ac02-1` is idle if Ben later switches.
6. **Session-end housekeeping:** remove plan/spec copies from the obsidian vault (git copy is
   canonical); confirm durable memories saved (overnight-Fable-authz, prettier discipline, build-agent
   scope-creep, G-off-spine, B-landed/0056). p_44 saved these at relay time — verify, don't duplicate.

Lock NOW: Coordinator = `$HERDR_PANE_ID=p_45` pane `w653f42bef3ac02-2` (replaces p_44, pane volatile; compacted on reap).
Re-confirm yours matches before any merge.

**→→→ SUCCESSOR CONTINUATION NOTE (2026-06-12 ~06:20Z — RELAY after D #188 security merge; p_46 picks up here):**
D #188 MERGED (596755a). E BUILDING (pane `w653f42bef3ac02-4`, branch `audit-slice-e`). Migration spine HEAD **0056** (D code-only). **H migration numbers: 0057+0058** (D added no migration). YOUR IMMEDIATE WORK:

1. Re-adopt fleet. `herdr pane list` — exactly one Coordinator. Re-confirm HERDR_PANE_ID matches. Fleet: SliceE-build = `w653f42bef3ac02-4` BUILDING; SliceD-build = `w653f42bef3ac02-5` — REAP (kill pane + remove worktree `audit-slice-d`).
2. QA worktree cleanup: remove `.claude/worktrees/agent-a7da45c19221381eb` (Fable QA leftover).
3. Spawn H: migration numbers **0057+0058** confirmed. Create worktree off origin/main, write handoff at `docs/coordination/handoffs/2026-06-12-audit-slice-h.md`, spawn SliceH-build into `w653f42bef3ac02:3` with `JARVIS_PGDATABASE=jarvis_qa_h`.
4. Supervise E: when DONE — Fable security QA via Agent tool (model fable, isolation worktree); APPROVE → squash merge → close #101 #127 #141 → relay immediately.
5. Supervise H: same pattern — Fable QA → APPROVE → squash merge → close H issues → relay.
6. Board updates: `gh project item-list 1 --owner motioneso` — update D/E/H items to Done.
7. Task #8 (coordinate skill update) — still pending; do after E+H settle.

Lock line: Coordinator = label `Coordinator`, stable anchor = session `515ad953-084d-4093-acbb-937f3f9cf6c1`. Pane ids reflow and are USELESS — resolve by label+session at read time; sole `working` Claude pane labelled `Coordinator` = authority. Re-claim label + verify uniqueness after any restart.

**→→→→ LIVE STATE (2026-06-12 — ✅ RUN COMPLETE; pane numbers reflow — labels are authority):**

Current panes: Coordinator = sole Claude pane (session `515ad953`); codex = idle. All build/QA panes + worktrees reaped; tree is **main-only**.

**▶ POST-A–I MED/LOW REMEDIATION (2026-06-12, continuing per Ben "nail those down before epics"):**
Triage in `docs/audits/DISPOSITION-2026-06-12-otnr.md` (B1–B8 + C plan). Solo coordinator builds
each slice inline; Fable (model:fable) substitutes for Ben at every security gate.

- **✅ Batch 1 (security tier) MERGED** — PR #191 @ `d0e71b5`. B2 RLS hardening (migrations
  0059–0062: admin-table ENABLE+FORCE, chat-memory `TO`-role targeting, tag-assignment ownership)
  - C bootstrap/throttle folds. Fable APPROVED. **Migration spine HEAD now 0062.**
- **✅ Batch 2 / B1 MERGED** — PR #192 @ `eb0391d`. `handleRouteError`/`HttpError` consolidated
  into `@jarv1s/module-sdk`; per-module wrappers; scrubbed-500 closes the info-leak. Fable
  APPROVED. (Code-only, spine unchanged.) Main CI on `eb0391d` confirmed green.
- **✅ Batch 2 / B3 MERGED** — PR #193 @ `dff5301`. Connectors admin check (`GET
/api/admin/connectors/accounts`) routed off the root-Kysely `appDb` handle through
  `DataContextDb` (new `ConnectorsRepository.getUserById` on `scopedDb.db` via
  SECURITY-DEFINER `app.get_user_by_id`); admin assertion moved inside `withDataContext` so
  check + listing share the actor's scoped txn — mirrors settings. Dead `appDb` removed from
  the shared `BuiltInRouteDependencies` bag + server wiring + connectors-google test; `rootDb`
  (settings BootstrapHelper) is now the only documented root-handle escape in the route layer.
  Fable security QA **APPROVE / MERGE-READY: YES** (5 hard items VERIFIED: zero root-handle
  queries remain in connectors, exact 401/403/200 parity, auth-before-work ordering, dead-code
  removal safe, 59 integration tests green). settings #156 was already fixed by D #188 → B3 =
  connectors only. (Code-only, spine unchanged → **HEAD 0062**.) Main CI on `dff5301`: confirmed green.
- **✅ Batch 2 / B4 + B5 MERGED** — PR #194 @ `1153ee6`. **B4**: hoisted generic `JsonSecretCipher`
  - `EncryptedSecret` envelope into `@jarv1s/db` (`packages/db/src/secret-cipher.ts`);
    `AiSecretCipher`/`ConnectorSecretCipher` reduced to thin label-binding subclasses + type aliases +
    env factories. Byte-for-byte behavior-preserving — Fable mechanically diffed both old cipher bodies
    vs the shared base (BODIES-IDENTICAL modulo label templating); all historical error strings exact via
    the `label`/capitalized-label trick. ~150 dup lines removed. **B5**: `SessionTokenRegistry` gained an
    injectable clock + 60-min TTL backstop (`verify()` lazily expires + slides; `mint()` sweeps; new
    `touchBySessionId()` wired runtime→routes→manager `lastActivity` so token-liveness ≡ session-liveness;
    no spurious 401 for live-but-tool-idle, guaranteed orphan death). Zero-arg ctor preserved. Fable
    security QA **APPROVE** (B4 behavior-preserving, B5 sound; no secret/token reaches logs or errors;
    scope = 9 files, no migration). B5-future follow-ups (non-blocking): `reapIdle()` defined but never
    scheduled in production (main gap — one self-healing degraded turn after >60-min idle) → consider an
    interval scheduler or touch-at-turn-start; one-line comment on `touchBySessionId` resurrecting an
    expired-but-unswept entry (benign — actor's own authenticated activity only). (Code-only, spine
    unchanged → **HEAD 0062**.) Main CI on `1153ee6` confirmed green (`completed/success`).
- **✅ Batch 2 / B7 MERGED** — PR #195 @ `fbb131e` (#163, P24 web). Cross-user React Query cache
  bleed on the shared house instance closed via **clear-on-identity-boundary** in
  `apps/web/src/app.tsx` `handleAuthenticated`: `await queryClient.resetQueries()` evicts every
  cached query (incl. inactive prior-user entries) + refetches mounted identity queries under the
  new cookie. Fail-closed. **Deliberate deviation from disposition's literal "namespace keys by
  actorUserId"** — Fable QA upheld it as _strictly stronger_ for this single-`QueryClient` SPA
  (fail-closed vs fail-open; no persister exists so eviction is complete across reloads; namespacing
  NOT additionally required). Fable's first pass was **REQUEST_CHANGES**: the initial `clear()` +
  `refetchQueries()` hung sign-in (query-core 5.101.0 `clear()` destroys queries _without_ notifying
  observers → no refetch). Fixed with prescribed `resetQueries()`; `pnpm test:e2e` **14/14 green**
  (incl. the sign-in→shell test that failed pre-fix). Code-only, spine unchanged → **HEAD 0062**.
  Main CI on `fbb131e` green (`completed/success`, HEAD-verified before merge). B7 follow-up
  (non-blocking, out of #163 scope): no global 401→AuthScreen handler — session-expiry leaves stale
  view until reconnect; candidate for a later slice.
- **✅ Batch 2 / C-sensitive MERGED** — PR #196 squash `1863dac` @ 2026-06-12T18:54:08Z (#94, #164,
  #133). **#94 last-admin TOCTOU** closed on **every** removal path (deactivate/demote/reject +
  `DELETE /api/admin/users/:id`): per-database `pg_advisory_xact_lock(hashtext('jarv1s:last-active-admin'))`
  - under-lock re-check, taken both in the repository methods (app-runtime conns, via
    `assertRemovingActiveAdminIsSafe` — lock-first, re-read target under lock) **and** folded into
    `scripts/delete-user-data.ts`'s own bootstrap-connection transaction (held through DELETE+COMMIT).
    Route pre-check demoted to fast-path 409; in-tx re-check (`LastActiveAdminError` → 409) is the
    authoritative serialized guard. **#164**: `apps/api/src/server.ts` URL reconstruction now
    trustProxy-aware (`request.protocol`/`request.host`, gated by `JARVIS_TRUST_PROXY`); removed the
    unconditional `X-Forwarded-Proto` trust. **#133**: `validateToolInput` rewritten dependency-free +
    recursive (object/required/type/enum/array-items), JSDoc honest about unenforced
    format/pattern/bounds/additionalProperties/composition → ajv when needed. **Fable cross-model QA:
    round-1 REQUEST_CHANGES caught a real BLOCKER** (DELETE path still open — route pre-check committed
    & released the lock before the separate bootstrap-conn delete ran with no re-check); fixed by
    folding the lock+recheck into `deleteUserData`; **round-2 APPROVE** (cross-connection per-database
    serialization verified structurally; READ COMMITTED confirmed, no isolation override; clean
    rollback/no connection-leak; no refactor regression). +1 deterministic regression test
    (auth-settings 21/21). Code-only, spine unchanged → **HEAD 0062**. Main CI on `76683d0` green
    (`completed/success`, head_sha-verified === PR HEAD before merge). Security-tier merge → relay fired.
  * C-sensitive ops follow-up (non-blocking, docs-only): note in ops docs that #164 makes proxied
    deployments without `JARVIS_TRUST_PROXY` emit `http` URLs instead of accidental spoofable-`https`.
  * #156 was already fully resolved by D #188 + B3 #193 → not part of C-sensitive. #122 folded items
    (`/api/bootstrap/status` userCount leak, social-auth `THROTTLED_AUTH_PATHS`) landed in Batch 1 #191.
- **✅ B6 DISPOSITIONED (no deletion) — #154 #160 CLOSED.** Grounding falsified the "delete dead
  surface" premise: module-sdk manifest fields (`payloadSchema`/`requestSchema`/`responseSchema`/
  `ownedTables`/`shareableResources`/`grantLevels`) are **live contract populated by all 10 modules**;
  `metadataOnly` is redundant with the `ALLOWED_PAYLOAD_KEYS` structural guard (H #157);
  structured-state is **registered ahead-of-consumer infra** for Tasks/commitments (module-registry
  imports its manifest + migration 0031); assertDataContextDb already landed via G/#102. Feature-level
  items (version column, worker grant, `validateManifest` boot seam, JsonSchema structural tightening)
  deferred to their consuming milestones — captured in DISPOSITION §B6. No PR (triage-and-close).
- **✅ Batch 2 / B8 MERGED** — PR #197 squash `9a17503` @ 2026-06-12T19:30:20Z (#171, OTNR-P29
  E2E + operator-script hardening). All 8 MED/LOW findings landed in one bundle. **MED:** (1)
  `delete:user` now removes the user's on-disk vault subtree via **VaultContext** (`deleteUserVaultDir`,
  strict `startsWith(base+sep)` containment) **after** the DB COMMIT, with observable `vaultDeleted`
  result field + operator reminder; (2) `restore:db` requires `--confirm-database <name>` to match the
  resolved target before destructive `--clean --if-exists` (guard binds at plan construction, `--execute`
  only — mirrors `delete-user-data` confirmUserId); (3) chat Approve/Deny e2e now assert the decision
  body (`{status:"confirmed"}`/`{status:"rejected"}`) + action-request id go over the wire; (4) new
  `authenticated:false` (sign-in gate, no owner-data leak) + `isInstanceAdmin:false` (admin panels hidden)
  specs. **LOW:** (5) `parseEnvelope(json:unknown)` + `MalformedSecretEnvelopeError` on `JsonSecretCipher`
  — zero decryption, distinguishes shape vs decrypt failures; `rewrap-secrets`'s 3 blind-cast sites routed
  through it (per-row try/catch + FOR UPDATE + exit-1-on-skip preserved); (6) backup/restore validate
  `url.username` non-empty before PGPASSWORD; (7) `smoke:compose` now hits `/health/ready` and asserts
  `db==="ok" && pgboss==="ok"` (endpoint already existed — no new route); (8) `mock-api.ts` decomposed
  into `mock-ai-api.ts` + `mock-connectors-api.ts` siblings (922→~470 lines; registered route set
  byte-identical, Playwright precedence intact). **Fable cross-model QA: APPROVE** (grounded `d844a79`;
  all 8 findings genuinely addressed; finding-1 deletion mechanism landed earlier in #177, this PR
  completes operator visibility + coverage; invariants clean — VaultContext not raw fs, no secret leak,
  no migration; tsc/eslint/file-size/unit-18 + full e2e 16/16 all exit 0). Non-blocking nits: restore
  usage string omits `--confirm-database` (drill output has it); `vaultDeleted:true` reported even when
  user row absent (benign idempotent rm). **Code-only, spine unchanged → HEAD 0062.** Main CI on PR head
  green (Compose smoke + Verify foundation both pass). Issue #171 closed. Security-tier merge → relay fired.
- **✅ C-routine DONE — #198 MERGED (`691a0c4`), #168 + #165 closed.** (1) **#168** FK covering
  indexes landed as `0063` (tasks) + `0064` (memory) → **spine HEAD now 0064**; (2) **#165** worker
  graceful drain on SIGTERM/SIGINT + startup queue guard. **OTNR MED/LOW disposition (§E) is FULLY
  DISCHARGED.**
- **▶ NEXT: PHASE-2+ EPIC WORK.** The audit-remediation run is complete end-to-end — all OTNR buckets
  (A–I + B-RLS + B8 #197 + C-routine #198) merged. Orientation: GitHub board + epics #46–#50 are the
  source of truth; re-recall `"jarv1s current project state"` and pick up the next phase milestone.

---

**🎉 A–I RUN COMPLETE — all slices A–I MERGED.** Every A–I audit issue closed. Migration spine
HEAD was **0058** at A–I close (now 0062 after MED/LOW Batch 1).

- **✅ E #189 MERGED** — squash `0baa384`. Fable security QA GREEN (0 blocking). Issues #101 #127 #141 closed. Reaped. (E code-only, spine unchanged.)
  - E non-blocking follow-ups (candidates, not blockers): (1) no direct 401/403 negative test on new revoke-sessions route (transitive via shared `assertAdminUser` + demote-403); (2) revoke-sessions writes no audit event though other lifecycle actions do; (3) `oauth.ts:46` reflects redirect `error` param into Error message (pre-existing, no secret).
- **✅ D #188 MERGED** (`596755a`). Reaped.
- **✅ H #190 MERGED** — squash `2dc204b` @ 2026-06-12 (this session). Fable security QA **GREEN, MERGE-READY: YES** (0 blocking, 4 non-blocking; verdict comment 4689753519; #134 owner-scoping preserved verbatim from 0036, 0057/0058 correct, consume-side guards intact, #174 strictly least-priv). Issues #124 #134 #135 #157 #174 closed. SliceH-build pane + worktree + branch + QA worktree all reaped. **Migrations 0057+0058 landed → spine HEAD 0058.**
  - H non-blocking follow-ups (candidates): (1) `pg-boss.ts` ALLOWED_PAYLOAD_KEYS is keys-only/global (values unvalidated at send; consume guards still validate → net strengthening); (2) #124 wiring proven via unit test, no e2e duplicate-file-abort test; (3) #134 denial asserted via `has_table_privilege`/`pg_policies` text, not a live denied UPDATE-as-app_runtime.
- **Final relay fired** (security-tier H merge). **✅ Main CI on `2dc204b` CONFIRMED GREEN** (`completed/success`, 2026-06-12T~09:45Z) — run fully verified end-to-end. Durable memory saved ([[project-state]] @ 0058, Fable-as-Ben-proxy pattern + anti-patterns). Vault plan/spec cleanup + `coordinate`-skill update (Task #8) are the only remaining session-end housekeeping.

> Coordinator's externalized memory. Keep CURRENT. GitHub is source of truth for spec/issue/board
> status; this file holds only in-flight operational state.

## Phase-0 gate status

- **CI on `main`:** ✅ green @ 7eba4c5 (verified 2026-06-12)
- **Ben manifest approval:** ✅ approved (Slice A first — 2026-06-11)
- **Ben build greenlight:** ✅ 2026-06-12 ("write up the plans, have Fable review, spin up the agents") — spec-review gate satisfied; security-tier MERGES still need per-merge sign-off
- **Slice A spec/plan:** ✅ merged (PR #181)
- **Remaining slices B–I:** specs ✅ + TDD plans ✅ written + Fable-reviewed (all `revise` → fixes applied 2026-06-12)

## Queue (proposed slices — each needs a spec before it can spawn)

Severity post-Fable. Tier by content trigger (most of this backlog is `security`).

| Slice                                    | Issues                                                                                                                                                  | Tier                               | Adds migration?                                                | Spec                                                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — RLS least-priv migrations**        | #97 users-column UPDATE restriction, #98 worker memory RLS policies                                                                                     | security                           | **yes (×3: 0053+0054+0055)**                                   | `docs/superpowers/specs/2026-06-11-audit-slice-a-rls-least-priv.md` ✅          | **MERGED** PR #181 @ 2026-06-12T00:13:10Z — issues #97 #98 closed, board Done                                                                                                                                                                                                                                                                                                                                                 |
| **B — Dead subsystem deletion**          | #120 workspaces, #153 resource-grants no-op, #115 + #116 (resolved by deletion), fold #152 manifest-narrowing; advances #155/#127/#101 workspace-halves | sensitive→**security**             | **yes (DROP, 0056)**                                           | `docs/superpowers/specs/2026-06-12-audit-slice-b-dead-subsystem-deletion.md` ✅ | **DONE — ready for QA+merge** PR #187 (SliceB-build pane `-3`, alive, status `done`). Rebased on b19f916; VF_EXIT=0 AUDIT_EXIT=0 (366/366 integration + 97 unit). **Migration spine HEAD (0056).** ⚠️ G+I LANDED FIRST → B must rebase BOTH shared test files (`foundation.test.ts` ↔I, `structured-state.test.ts` ↔G) on current origin/main before merge — task SliceB-build to do it. Security-tier → Fable QA then merge. |
| **C — Vault containment**                | #129 actorUserId validation, #130 symlink real-path containment                                                                                         | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-11-audit-slice-c-vault-containment.md` ✅       | **MERGED** PR #182 @ 2026-06-12T00:13:23Z — issues #130 closed, board Done                                                                                                                                                                                                                                                                                                                                                    |
| **D — Settings → DataContextDb**         | #95 SettingsRepository raw Kysely, #155 /api/me cross-user read                                                                                         | security                           | maybe (grant)                                                  | `docs/superpowers/specs/2026-06-12-audit-slice-d-settings-datacontext.md` ✅    | **MERGED** PR #188 by Ben @ 2026-06-12T06:15:47Z — squash `596755a`. Issues #95 #155 closed. Fable QA: GREEN (0 blocking; comment 4688009922 on PR). Migration spine still **0056** (code-only).                                                                                                                                                                                                                              |
| **E — Auth module hardening**            | #101 module-isolation, #127 bootstrap actor-GUC, #141 OAuth error-body leak (#113 deferred → issue #183)                                                | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-e-auth-hardening.md` ✅          | **DONE — QA in flight** PR #189 OPEN, MERGEABLE, both CI GREEN. Branch `audit-slice-e`, SliceE-build idle. Fable security QA running (background Agent `a1c75f3d31e30caf9`) → verdict via `gh pr comment 189`. On APPROVE → squash merge → close #101 #127 #141 → board Done → relay. Issues: #101 #127 #141.                                                                                                                 |
| **F — AI tool-path hardening**           | #132 REST validateToolInput, #119 server-side allowlist, #148 blank ToolContext, #172 tools/list actor-scope                                            | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-f-ai-toolpath-hardening.md` ✅   | **MERGED** PR #184 @ 2026-06-12T04:34Z (sha b19f9165) — Fable APPROVE; issues #119/#132/#148/#172 closed; worktree+branch reaped; board Done                                                                                                                                                                                                                                                                                  |
| **G — Data-layer defense-in-depth**      | #102 assertDataContextDb, #144 vectorSearch owner predicate, #99 structured-state WITH CHECK                                                            | security                           | **no** (#99 = app-layer; 0031 WITH CHECK already owner-scoped) | `docs/superpowers/specs/2026-06-12-audit-slice-g-datalayer-defense.md` ✅       | **MERGED** PR #186 @ ~2026-06-12T04:40Z — Fable APPROVE (migration claim VERIFIED by direct read of 0031: WITH CHECK present at claimed lines); issues #102/#144/#99 closed; worktree+branch+agent reaped; board Done                                                                                                                                                                                                         |
| **H — Migration/job infra**              | #124 schema_migrations per-dir, #134 worker dead grant REVOKE, #135 incognito trigger, #157 metadata-only payload guard, #174 pgboss RLS                | security/sensitive                 | **yes (×2 versioned + 1 grants file)**                         | `docs/superpowers/specs/2026-06-12-audit-slice-h-migration-job-infra.md` ✅     | **MERGED** PR #190 squash `2dc204b` @ 2026-06-12 (this session). Fable security QA **GREEN** (0 blocking, 4 non-blocking). Issues #124 #134 #135 #157 #174 closed. **Migrations 0057+0058 → spine HEAD 0058.** Pane+worktree+branch+QA worktree reaped. #134 owner-scoping preserved verbatim from 0036. **FINAL slice — run A–I complete.**                                                                                  |
| **I — Portability + observability tail** | #170 export omits private, #149 handleRouteError, #140 list ownership, #166 test hygiene (LOW)                                                          | sensitive/routine→**security-bar** | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-i-portability-tail.md` ✅        | **MERGED** PR #185 @ ~2026-06-12T04:40Z — Fable APPROVE (#170 secret/derived-column audit CLEAN; owner-scoped double-guard); issues #170/#149/#140/#166 closed; worktree+branch+agent reaped; board Done. Non-blocking follow-up: breakdown.ts parent-visibility-not-ownership (same class as #140, pre-existing)                                                                                                             |

Not yet sliced: the aggregate `MED/LOW findings —` batch issues (#104–#111, #114, #117, #122–#171 even, #156…) — a later backlog pass after the HIGH/MED individual findings land.

## Dependency / collision map

**Dominant constraint: migration numbers are global, assigned by landing order** — every
migration-adding slice must land in a fixed sequence. No two migration slices spawn in parallel
without a pre-assigned number, and a serialized slice must NOT assume its number until its
predecessor merges.

- **Serialized migration spine (merge order):** **A → B → D(if migration) → G(#99) → H**.
  Each waits for its predecessor to land before its migration number is real.
- **Parallel-safe (code-only, distinct modules) — may run alongside the spine:**
  - **C (vault)** — `packages/vault` only; no overlap with spine.
  - **E (auth)** — `packages/auth/src/index.ts`; #101/#113/#127/#141 all touch this one file ⇒
    **serialize internally** (one agent, one slice), but parallel to spine/C/F.
  - **F (ai)** — `packages/ai` + briefings; parallel to spine/C/E.
- **Cross-slice overlaps to honor:**
  - #155 appears in both **B** (workspace-half) and **D** (raw-Kysely read) → **D after B**.
  - #127/#101 bootstrap touched by both **B** (workspace writes) and **E** (auth isolation) →
    coordinate the bootstrap edit; **B lands the workspace removal first, E rebases**.
  - #98 (A) and #102/#144 (G) both touch memory repos → **G after A**.
- **Recommended first wave (smallest blast radius, highest value):** **Slice A** (two tiny
  security migrations, live-breakage fix for #98) → then **Slice B** (the deletion that collapses
  #120/#153/#115/#116/#152 and de-risks D/E). Author specs A and B first.

## Risk-tier note

8 of 9 slices are **security-tier** ⇒ each gets cross-model adversarial QA + a posted
`gh pr comment` verdict. **SIGN-OFF SUPERSEDED (Ben, 2026-06-12):** security-tier merge sign-off is
**DELEGATED to Fable**, not Ben (see Merge policy, line 6). Per security PR: run the adversarial QA
as a **Fable (`model: 'fable'`) cross-model review** → post verdict via `gh pr comment` → **Fable
APPROVE merges autonomously**; Fable `revise`/`reject` bounces to the build agent for re-QA. Ben
gets a per-merge digest (not a gate); escalate to Ben only on a design fork Fable can't settle.
Plan token spend accordingly (security QA is the budgeted place to spend up; the resident loop runs
cheap on Sonnet).

## Fleet layout (Ben, 2026-06-11)

- **One shared tab for all build/QA agents: "Agents"** (`w653f42bef3ac02:3`) — never the
  coordinator's own pane, never "window 1". The coordinator pane spawns only its own relay successor.
- **Grid layout convention:** **2×2 for a 4-agent wave, 3×1 for a 3-agent wave** — set at spawn time
  via alternating `herdr pane split --direction down|right` (herdr has no in-place re-tile; layout is
  fixed by split order at creation, so running agents are not retiled mid-build). The current wave-1
  (B/F/G/I) predates this convention and stays as-spawned; the next release-held wave (D/E/H = 3
  agents → 3×1) is the first to use it.

## Wave-1 spawn (2026-06-12, parallel-safe B/F/G/I — all `building`)

Spawned into the "Agents" tab (`w653f42bef3ac02:3`), Sonnet 4.6, bypass-permissions, off
`origin/main @ e0a9e2a`. Each executes its pre-written + Fable-reviewed plan via
`superpowers:executing-plans` (execute-not-replan; no plan-approval round-trip). Handoffs:
`docs/coordination/handoffs/2026-06-12-audit-slice-{b,f,g,i}.md` (committed bb7f994).

> **Pane IDs are VOLATILE — route by LABEL, not number.** The reaped SliceA/C panes freed `-3..-6`
> and herdr compacted this wave's IDs down by one (was `-4..-7` at spawn → now `-3..-6` per
> `herdr pane list` @ 20:45 sweep). Labels (`SliceX-build`) + cwd are stable; re-resolve the numeric
> pane from `herdr pane list` before any send/read/reap.

| Agent        | Pane (volatile) | Branch          | Migration                        | Test-file collisions                                       |
| ------------ | --------------- | --------------- | -------------------------------- | ---------------------------------------------------------- |
| SliceB-build | `-3`            | `audit-slice-b` | 0056 (spine HEAD)                | `foundation.test.ts` (↔I), `structured-state.test.ts` (↔G) |
| SliceF-build | `-4`            | `audit-slice-f` | none (code-only)                 | none — collision-free                                      |
| SliceG-build | `-5`            | `audit-slice-g` | #99 (number at merge, after B+D) | `structured-state.test.ts` (↔B)                            |
| SliceI-build | `-6`            | `audit-slice-i` | none (code-only)                 | `foundation.test.ts` (↔B; B merges first)                  |

**Sweep 1 (20:45):** all 4 `working`, no stalls/escalations. B at 59% ctx/$5.12 mid-deletion
(Task 1b done, 2-9 pending), auto-compacting — expect a self-relay (successor in same worktree).

**Sweep 2 (21:07):** all 4 `working`, no escalations. **G ahead** — impl done (5 files), running
`pnpm verify:foundation` (final gate); likely first done. **B COST WATCH** — still Task 1b/2 after
52 min, re-compacted (55% ctx), **$8.81** (largest slice; throughput healthy, not stalled, but
pricey — flag to Ben). F/I working, nominal. No relay yet (B held pane `-3`).

**F DONE (21:1x):** PR #184 (closes #119/#132/#148/#172), security-tier, collision-free (merges
independent of spine once green). Pane-id authority re-confirmed `p_38` ✅. CI **pending** at QA
dispatch. **Fable** (`model: fable`) security QA spawned via Agent tool (general-purpose +
coordinated-qa skill, isolation worktree, bg) — adversarial trust-boundary pass (allowlist
server-side enforcement, validateToolInput 400, actorUserId always-populated, listToolsForActor
scoping) + must `gh pr comment` an APPROVE/REVISE/REJECT verdict. Merge gated on Fable APPROVE **and**
green CI. (Ben's Codex-vs-Fable choice still open — verdict is reversible before merge.)

**21:2x — F CI GREEN ✅, I CI RED ❌ (stop-the-line):**

- **F #184:** both required checks PASS. Merge now gated only on Fable QA APPROVE (running). First to be merge-ready.
- **I #185:** agent self-reported `VF_EXIT=0` but CI `Verify foundation` **FAILED in 50s** (run 27393989565) — too fast for tests ⇒ early gate step (lint/format/typecheck/migrate); local pass + CI fail ⇒ uncommitted/unstaged file or stale node_modules masking. **Bounced to SliceI-build** (idle, 40% ctx/$7.07) with diagnose+fix pointer; it's running `gh run view --log-failed`. NOT QA'd until green. Self-report-vs-CI divergence = textbook reason we don't trust agent "done".
- **Merge-order note:** F merges independent of spine (collision-free). I is code-only too; once green it can merge before B (B then rebases its `foundation.test.ts` `it`-block edit) — I no longer strictly "after B".

**Merge sequencing for the collisions:** B merges first (spine HEAD) → G and I rebase their shared
test-file edits on top of B before their own merge. F is collision-free, merges as soon as green.

## CI waivers

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding escalations

- [ ] **Ben spec review** — all 7 specs (B, D, E, F, G, H, I) authored 2026-06-12, awaiting
      Ben's review and approval before writing-plans are invoked and build agents are spawned.
      Specs in `docs/superpowers/specs/2026-06-12-audit-slice-*.md`.
- [x] **Spec authoring strategy** — resolved: slice-by-slice, now complete.
- [x] **#113 bearer-token design fork** — resolved: deferred to GitHub issue #183 (proper API-key
      milestone). Slice E scoped to #101/#127/#141 only.

## Incident log

- **2026-06-12 ~04:15 — Coordinator broke main (prettier).** Coordination-doc commits this
  session landed unformatted markdown → `prettier --check .` (format:check gate step) failed on
  main for 3 consecutive runs. Poisoned every agent rebasing onto main. **Root cause:** coordinator
  skipped `format:check` before its own commits (skill rule violated). **Fix:** reformatted all 5
  coordination docs, pushed `87189c5`; `format:check` now MANDATORY before every coordinator commit.
  **Collateral:** PR #185 (I) "CI red" was 100% this — failing log listed only `docs/coordination/*.md`,
  zero of I's files; I was unfairly bounced, told to just rebase.
- **2026-06-12 — Build-agent scope creep (F + G).** Both PR #184 and #186 swept in the 5
  coordination docs (likely `pnpm format` rewriting the whole repo + a broad `git add`), violating
  the "git add only your task's files" compact. Both told to `git checkout origin/main -- docs/coordination/`
  - rebase. **Skill fix (task #8):** instruct build agents to never touch `docs/coordination/` and
    to scope `pnpm format` to their own paths.

## Reaped sessions

- SliceA-build (pane -3) — reaped post-merge PR #181
- SliceA-QA (pane -5) — reaped post-verdict
- SliceC-build (pane -4) — reaped post-merge PR #182
- SliceC-QA (pane -6) — reaped post-verdict
- SliceF-build (pane -4 of wave-1) — reaped post-merge PR #184
- SliceG-build (pane `w653f42bef3ac02-4`) — reaped post-merge PR #186
- SliceI-build (pane `w653f42bef3ac02-5`) — auto-gone post-merge PR #185 (worktree deleted)
