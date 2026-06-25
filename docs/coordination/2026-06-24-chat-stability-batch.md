# Coordination Run — 2026-06-24-chat-stability-batch

**Date:** 2026-06-24
**Coordinator lock:** label `Coordinator`, **session `ses_104452c25ffeDI451qhvdfOm4Z`** (anchor, set by 2nd successor 2026-06-24 relay takeover), pane `w1:p0` (ephemeral). Session id = authority; label = routing; pane number = ephemeral (reflows). Predecessor coordinator (session `ses_1044afa61ffemvRK5oLlUrMRU6` — 1st successor; matched by exact session id at reap time + sole Coordinator pane after label move), pane `w1:pV`, was reaped by this (2nd) successor after label+session verification.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`. `security`-tier (none this run) would need Ben's explicit sign-off.
**Relay threshold:** security-tier merge → relay immediately; routine/sensitive `merges_since_relay` ≥ 2 → relay. Compaction summary → relay, merge nothing.
**merges_since_relay:** 8 (wave 1 = 6; wave 2 = 2: #465 routine + #466 sensitive, both merged by successor `ses_1044afa61ffemvRK5oLlUrMRU6` on 2026-06-24 after cross-model QA GREEN). **Relay trigger FIRED (≥2 routine/sensitive since last clean relay) — successor must relay immediately, merge nothing first (no-deferral rule).**

**CI mode (this run):** GitHub Actions billing is paused — `main` CI is red on billing, NOT code. **Local gate is the source of truth.** QA agents run the full gate locally (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) — do NOT trust `gh pr checks` (red from billing). Record local-gate exit codes in the QA verdict. This is noted in CLAUDE.md + the handoff template.

**Models this run:** GLM (via `opencode -m zai-coding-plan/glm-5.2`) and Gemini (via `agy` = Antigravity CLI, Gemini 3.1 Pro). No Claude/Codex build agents. QA is cross-model per Ben's rule: **opposite of the builder**.

## RUN COMPLETE

**All 3 plan tasks done. 8 PRs merged + PII scrub + public flip + CI repair + v0.1.15 deployed to prod.**

- Wave 1 (6 PRs) + Wave 2 (2 PRs) merged.
- Follow-up #467 filed (scheduled vault-cleanup sweep).
- Repo flipped public 2026-06-24. PII scrubbed (3-pass filter-repo). Codex PII audit: SAFE-FOR-PUBLIC.
- CI unblocked: NeverCompletingEngine lint, prod-compose-smoke fixes, e2e alignment (#468), file-size exemption.
- `v0.1.15` tagged → CI built + published multi-arch images → deployed to `~/JarvisProd` (project `jarv1s-prod`). API healthy, DB + pg-boss OK.
- **Ben doing manual e2e verify** (basic chat + notes.search tool call) at time of manifest close.
- Issue #456 closed (shipped in #466). #467 remains open (follow-up).

**Remaining follow-ups (not blocking):**
1. #467 — scheduled vault-cleanup sweep (pg-boss cron).
2. Flaky `auth-bootstrap-recovery.test.ts` race test — file issue.
3. `cli-chat-engine.test.ts` (1095 lines) — split to remove file-size exemption.
4. Contact GitHub Support to GC dangling `refs/pull/*` objects (optional, for pristine public state).

## Wave 1 — COMPLETE (all 6 merged)

| Spec | Issue | Tier | Status | PR |
| ---- | ----- | ---- | ------ | -- |
| Plan Task 1 (chat-mcp-flag) | — | routine | merged 21:03 | #463 ✅ |
| Plan Task 2 (chat-persona) | — | routine | merged 21:10 | #464 ✅ |
| #453 (embed-provider-cli-runner) | #453 | routine | merged 21:03 | #460 ✅ (scope-overreach accepted: auto-formatted a doc + deleted dead NeverCompletingEngine — both harmless) |
| #452 (install-sh-posix) | #452 | routine | merged 21:03 | #459 ✅ |
| #444 (data-export-cleanup) | #444 | sensitive | merged 21:09 | #462 ✅ (inline-only cleanup per coordinator decision; scheduled sweep is a follow-up issue to file) |
| #448 (web-search-key-observability) | #448 | routine | merged 21:04 | #461 ✅ |

All on `main`. Follow-up issue filed: **#467** — scheduled vault-cleanup sweep via pg-boss cron (mirrors `packages/notes/src/schedule.ts` pattern) for data-export jobs never re-accessed after expiry. Routine tier.

## Wave 2 — COMPLETE (both merged 2026-06-24 by successor ses_1044afa61ffemvRK5oLlUrMRU6)

| Spec | Issue | Tier | Status | Built by | QA by | QA pane | PR |
| ---- | ----- | ---- | ------ | -------- | ----- | ------- | -- |
| docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md | #456 | sensitive | merged 22:18 | GLM (`w1:pJ`) | Gemini (`w1:pN`) | w1:pN | #466 ✅ |
| (issue #354, handoff-scoped) | #354 | routine | merged 22:18 | Gemini (`w1:pN`) | GLM (`w1:pJ`) | w1:pJ | #465 ✅ |

**QA verdicts (both GREEN, captured 2026-06-24 by successor before merge):**
- **#466 (sensitive):** GREEN. gate vitest/typecheck/format/lint all exit 0. invariants: auth=pass, rate-limit=pass, no-db-write-on-stop=pass, provider-agnostic=pass, lock-release=pass. No findings. merge-ready=y. Local-gate mode (CI billing red, not code).
- **#465 (routine):** GREEN. gate typecheck/format/lint/build:web all exit 0. One non-blocking finding: contrast fix #3 improved (2.17→2.86 light / 2.99→3.38 dark) but still below WCAG AA-normal 4.5:1 for small text — meets AA-large 3:1 only. QA flagged as follow-up token nudge, NOT a merge blocker. merge-ready=y.

**Sensitive-tier digest (per policy):** #466 chat-heartbeat-stop — idle watchdog (180s default, resets on emission, accurate status on trip, no persist) + RPC deadline activity-aware (resetActivityDeadline on turn verbs, #445 preserved) + stopTurn/POST /api/chat/turn/cancel (AbortController, kill engine, emit "Stopped by user." SSE, zero DB writes per ruling (a)) + web Stop button. Authenticated, rate-limited, no IDOR, lock releases via finally. 4 commits. Coordinator pre-reviewed diff; QA confirmed gate + invariants.

## Deferred (not in this run)

- #455 (notes folder picker / text-input fallback) — deferred per Ben.
- #454 (admin settings UI epic) — deferred per Ben; needs its own spec pass.
- #354 hardening items (4 of 6 remaining: focus-trap audit, non-color cues, skip-to-content link, lint rules) — deferred; only contrast fixes + 2 hardening shipped in #465.

## CI waivers

Local-gate mode (see CI mode note above). `gh pr checks` is expected red on billing for the whole run.

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| `pnpm lint` (repo-wide) | all lanes | `202c638b` (origin/main) | `tests/unit/chat-live-manager.test.ts:92` 'NeverCompletingEngine' unused. Not any lane's file. (Likely FIXED now by #460 — verify on current main.) | y (2026-06-24, local-gate-mode standing approval) |
| `pnpm format:check` (repo-wide) | all lanes | `202c638b` (origin/main) | warns on pre-existing plan docs. None are any lane's code file. | y (2026-06-24, local-gate-mode standing approval) |

**Push policy:** lanes push when their OWN lane-files pass format+lint+typecheck+vitest individually, even if repo-wide is red from pre-existing main breakage. QA agents re-verify per-PR.

## Outstanding escalations

- [x] File follow-up issue: scheduled vault-cleanup sweep (pg-boss cron) for data-export #444 — **filed as #467** (2026-06-24).

## Reaped sessions

- 7 wave-1 panes reaped 2026-06-24: w1:pK, w1:pM, w1:pP (build), w1:pQ, w1:pR, w1:pS, w1:pT (QA).
- Old coordinator (session `ses_111f40556ffeVraVZuie2X8ScJ`, pane `w1:p6`) — **reaped 2026-06-24 by successor** after label+session verification. Successor = `ses_1044afa61ffemvRK5oLlUrMRU6` (pane `w1:pV`).

## Notes for successor / relay

- Run ID: `2026-06-24-chat-stability-batch`. Manifest: this file.
- Plan: `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md`. All 3 tasks complete.
- **Skill update committed (`e718a502`):** `coordinated-build` step ½ — verify spec against actual branch before planning. Catches spec drift. Already proven by #456.
- **Repo went PUBLIC 2026-06-24.** CI billing unblocked. Local-gate-mode retired — CI is now the source of truth (all 4 jobs green on `v0.1.15`).
- **Durable decisions (save to memory):**
  - Codex MCP chat hang fix — TWO iterations. v1 (#463): `tool_call_mcp_elicitation=false` (disables elicitation globally). v2 (post-deploy live refinement by Ben, uncommitted): `mcp_servers.jarvis.default_tools_approval_mode="approve"` — auto-approves ONLY the generated Jarv1s MCP server, narrower scope. The hidden TUI no longer blocks on a per-tool approval menu the web user can't see. `approval_policy=never` / `-a never` cover shell approvals but do NOT suppress MCP elicitation. **v2 is the current truth** if it's in the tree; else v1 is what shipped in v0.1.15.
  - Persona rewrite (#464): model now told it HAS tools + `notes.search` as 2nd brain. Was previously told "no tools."
  - Idle watchdog + Stop (#466): 180s default, resets on emission, zero DB writes on stop. `AbortController` kills engine, emits "Stopped by user." SSE.
  - Verify-before-plan skill update (`e718a502`): build agents must verify spec against actual branch before planning. Catches spec drift.
  - PII scrub: 3-pass filter-repo (mailmap + replace-text + replace-message). Operator email → GitHub noreply. All branches deleted, main only. Accepted residual: GitHub server-side `refs/pull/*` retain old SHAs (not anonymous-fetchable).
  - CI fixes: `NeverCompletingEngine` dead-code removal, prod-compose-smoke `JARVIS_CLI_RUNNER_RPC_SECRET` interpolation + dev-default password guard, e2e spec alignment (#468), file-size exemption for `cli-chat-engine.test.ts` (1095 lines, follow-up to split).
- **Flaky test:** `tests/integration/auth-bootstrap-recovery.test.ts` — "rejects disabled-registration bootstrap recovery racers" times out under CI load (race-condition test). Passes on rerun. File follow-up to add retry or loosen timing.
- **Gemini (agy) behavior note:** Gemini agents finish work but don't reliably self-wrap to PR+report without a nudge (happened on #354/pN). GLM (opencode) wraps cleanly. Codex (codex) wraps cleanly + thoroughly. Watch for this; nudge Gemini agents to push+PR+report if they go idle without reporting.
