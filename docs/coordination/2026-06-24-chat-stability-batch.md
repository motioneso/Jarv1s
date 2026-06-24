# Coordination Run — 2026-06-24-chat-stability-batch

**Date:** 2026-06-24
**Coordinator lock:** label `Coordinator`, **session `ses_1044afa61ffemvRK5oLlUrMRU6`** (anchor, set by successor 2026-06-24 relay takeover), pane `w1:pV` (ephemeral). Session id = authority; label = routing; pane number = ephemeral (reflows). Predecessor coordinator (session `ses_111f40556ffeVraVZuie2X8ScJ` — note: manifest originally had a typo `VraVZu2X8`, corrected from live `herdr pane list` at reap time; matched by 20-char prefix `ses_111f40556ffeVra` + sole other Coordinator pane + tab w1:t5), pane `w1:p6`, was reaped by this successor after label+session verification.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`. `security`-tier (none this run) would need Ben's explicit sign-off.
**Relay threshold:** security-tier merge → relay immediately; routine/sensitive `merges_since_relay` ≥ 2 → relay. Compaction summary → relay, merge nothing.
**merges_since_relay:** 6 (wave 1 merged; relay triggered, in progress)

**CI mode (this run):** GitHub Actions billing is paused — `main` CI is red on billing, NOT code. **Local gate is the source of truth.** QA agents run the full gate locally (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) — do NOT trust `gh pr checks` (red from billing). Record local-gate exit codes in the QA verdict. This is noted in CLAUDE.md + the handoff template.

**Models this run:** GLM (via `opencode -m zai-coding-plan/glm-5.2`) and Gemini (via `agy` = Antigravity CLI, Gemini 3.1 Pro). No Claude/Codex build agents. QA is cross-model per Ben's rule: **opposite of the builder**.

## MID-DOING (continuation note for successor)

**I am mid-relay. Two QA agents are running and will return verdicts imminently. You take over from here.**

Current state at relay: wave 2 has two PRs open, both in cross-model QA. When verdicts come back GREEN, merge by tier. After both merge, the run is at image-bump readiness — but Ben said more work may be added before the build, so check with him.

**Immediate next actions for successor:**
1. Re-claim `Coordinator` label on your pane; record your session id as the new anchor above.
2. Reap the old coordinator (session `ses_111f40556ffeVraVZu2X8ScJ`, resolve by label+session — do NOT trust pane `w1:p6`, it may have reflowed).
3. Poll the two QA panes for verdicts (see Wave 2 table below).
4. On GREEN: merge by tier (#466 sensitive = auto-merge + Ben digest; #465 routine = auto-merge). Re-confirm YOUR session id against the anchor before every merge.
5. After both merge: ask Ben if more work rides this image bump, or if it's time for Task 3 (tag + multi-arch build + push GHCR + bump env tag + `docker compose up -d` + e2e verify per plan).

## Wave 1 — COMPLETE (all 6 merged)

| Spec | Issue | Tier | Status | PR |
| ---- | ----- | ---- | ------ | -- |
| Plan Task 1 (chat-mcp-flag) | — | routine | merged 21:03 | #463 ✅ |
| Plan Task 2 (chat-persona) | — | routine | merged 21:10 | #464 ✅ |
| #453 (embed-provider-cli-runner) | #453 | routine | merged 21:03 | #460 ✅ (scope-overreach accepted: auto-formatted a doc + deleted dead NeverCompletingEngine — both harmless) |
| #452 (install-sh-posix) | #452 | routine | merged 21:03 | #459 ✅ |
| #444 (data-export-cleanup) | #444 | sensitive | merged 21:09 | #462 ✅ (inline-only cleanup per coordinator decision; scheduled sweep is a follow-up issue to file) |
| #448 (web-search-key-observability) | #448 | routine | merged 21:04 | #461 ✅ |

All on `main`. Follow-up issue to file (not yet filed): scheduled vault-cleanup sweep via pg-boss cron (mirrors `notes/src/schedule.ts` pattern) — for data-export jobs never re-accessed after expiry. Routine tier.

## Wave 2 — IN QA (successor takes over here)

| Spec | Issue | Tier | Status | Built by | QA by | QA pane | PR |
| ---- | ----- | ---- | ------ | -------- | ----- | ------- | -- |
| docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md | #456 | sensitive | qa | GLM (`w1:pJ`) | Gemini (`w1:pN`) | w1:pN | #466 |
| (issue #354, handoff-scoped) | #354 | routine | qa | Gemini (`w1:pN`) | GLM (`w1:pJ`) | w1:pJ | #465 |

**#466 (chat-heartbeat-stop, sensitive) — verified by coordinator pre-QA:**
- 4 commits: idle watchdog (resets on emission, 180s default, accurate status on trip, no persist), RPC deadline activity-aware (resetActivityDeadline on turn verbs, #445 preserved), stopTurn + POST /api/chat/turn/cancel (AbortController, kill engine, emit "Stopped by user." SSE, persist NOTHING per ruling (a)), web Stop button.
- Spec drift caught by build agent: items 1/3/5 already shipped (poll cap gone, ActivityPeek exists, TIMEOUT_MESSAGE gone). Real work = watchdog + RPC reset + Stop. This triggered the verify-before-plan skill update (committed `e718a502`).
- Cancel route: authenticated (resolveOr401), session implied by actor (no IDOR), rate-limited, no body (metadata-only). `turnsInFlight` lock releases via `submitTurn` finally. Zero DB writes on stop.
- Coordinator already reviewed the full diff and approved. QA is confirming the gate + invariants.

**#465 (a11y-contrast, routine) — verified by coordinator pre-QA:**
- 8 files, all a11y-related (tokens.css, settings-panes.css, components-core.css, settings-feedback.tsx + style files). Contrast fixes #2-#6 (skip #1, already done at tokens.css:296) + H1 aria-live assertive region + H2 44px touch hit area.
- pN (Gemini) originally scope-creeped into data-export.test.ts but dropped it after coordinator nudge — confirmed clean.

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

- [ ] File follow-up issue: scheduled vault-cleanup sweep (pg-boss cron) for data-export #444 — after wave 2 settles.

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
