# Coordination Run — 2026-06-24-chat-stability-batch

**Date:** 2026-06-24
**Coordinator lock:** label `Coordinator`, **session `ses_104452c25ffeDI451qhvdfOm4Z`** (anchor, set by 2nd successor 2026-06-24 relay takeover), pane `w1:p0` (ephemeral). Session id = authority; label = routing; pane number = ephemeral (reflows). Predecessor coordinator (session `ses_1044afa61ffemvRK5oLlUrMRU6` — 1st successor; matched by exact session id at reap time + sole Coordinator pane after label move), pane `w1:pV`, was reaped by this (2nd) successor after label+session verification.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`. `security`-tier (none this run) would need Ben's explicit sign-off.
**Relay threshold:** security-tier merge → relay immediately; routine/sensitive `merges_since_relay` ≥ 2 → relay. Compaction summary → relay, merge nothing.
**merges_since_relay:** 8 (wave 1 = 6; wave 2 = 2: #465 routine + #466 sensitive, both merged by successor `ses_1044afa61ffemvRK5oLlUrMRU6` on 2026-06-24 after cross-model QA GREEN). **Relay trigger FIRED (≥2 routine/sensitive since last clean relay) — successor must relay immediately, merge nothing first (no-deferral rule).**

**CI mode (this run):** GitHub Actions billing is paused — `main` CI is red on billing, NOT code. **Local gate is the source of truth.** QA agents run the full gate locally (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) — do NOT trust `gh pr checks` (red from billing). Record local-gate exit codes in the QA verdict. This is noted in CLAUDE.md + the handoff template.

**Models this run:** GLM (via `opencode -m zai-coding-plan/glm-5.2`) and Gemini (via `agy` = Antigravity CLI, Gemini 3.1 Pro). No Claude/Codex build agents. QA is cross-model per Ben's rule: **opposite of the builder**.

## MID-DOING (continuation note for successor)

**Phase: PII scrub + public flip + CI repair + Task 3 prep (in progress).**

All 8 chat-stability PRs merged. Follow-up #467 filed. Repo went public. PII scrub complete (3 filter-repo passes: mailmap + replace-text + replace-message). CI re-enabled. The original chat-stability work is DONE — this section now tracks the Task 3 deploy pipeline.

**Current state (2nd successor coordinator, session `ses_104452c25ffeDI451qhvdfOm4Z`):**
- Repo is PUBLIC + PII-scrubbed (verified by Codex PII-Audit: SAFE-FOR-PUBLIC).
- CI billing unblocked. CI is GREEN except 6 pre-existing e2e failures.
- CI fixes already merged: NeverCompletingEngine lint, prod-compose-smoke RPC_SECRET + dev-default password guard, format:check on scrubbed docs, file-size exemption for cli-chat-engine.test.ts.
- **E2E-Fix build agent spawned** (Codex, pane w1:p13, worktree `fix/e2e-ci-fixes`) to fix the 6 failing e2e tests. Handoff: `docs/superpowers/handoffs/2026-06-24-e2e-ci-fixes.md`. Routine tier.
- **Next after E2E-Fix merges:** tag `v0.1.15` → CI `publish` job builds multi-arch + pushes GHCR → bump `JARVIS_IMAGE_TAG` in `~/JarvisProd` → `docker compose up -d` → e2e verify chat + notes.search.

**Immediate next actions for successor:**
1. Check E2E-Fix agent status (pane w1:p13 by label `E2E-Fix`). If done, QA + merge its PR.
2. After e2e green on main: tag `v0.1.15`, watch CI `publish` job, confirm GHCR images pushed.
3. Deploy to prod (`~/JarvisProd`): bump tag, `docker compose up -d`, e2e verify per plan Task 3 steps 2-4.
4. Save durable memory (see Notes section).
5. Close out: update this manifest, file any follow-up issues for the e2e test splits / CI debt.

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
- Plan: `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md`. Tasks 1+2 merged. Task 3 (build + deploy + e2e verify) is coordinator-owned — runs after all PRs merge + Ben says go.
- **Skill update committed (`e718a502`):** `coordinated-build` step ½ — verify spec against actual branch before planning. Catches spec drift. Already proven by #456.
- CI billing is the ONLY reason `main` looks red. Do not treat it as a code failure.
- After Task 3 lands, save durable memory for: `tool_call_mcp_elicitation=false` fix, persona rewrite, local-gate-mode decision, idle-watchdog + Stop design, verify-before-plan skill update.
- **Gemini (agy) behavior note:** Gemini agents finish work but don't reliably self-wrap to PR+report without a nudge (happened on #354/pN). GLM (opencode) wraps cleanly. Watch for this; nudge Gemini agents to push+PR+report if they go idle without reporting.
