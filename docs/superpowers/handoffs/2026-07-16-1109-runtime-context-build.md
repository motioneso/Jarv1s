# Handoff — #1109 runtime current-view build agent

**Date:** 2026-07-16
**Coordinator label (escalate here):** `Coord-1109-1110-g3`
**Model:** Claude Sonnet 5
**Worktree:** `~/Jarv1s/.claude/worktrees/build-1109-runtime-context`
**Branch:** `build/1109-runtime-context` (off `build/1110-app-map` — you INHERIT #1110's landed
seam: `ChatRoutesDependencies.appMapService` + `AppMapReadService.getBuildInfo()`)

## What you're building

The **second half** of the "Jarvis knows Jarvis" pair: runtime current-view awareness. Replace the
per-turn `<page_context>` injection with an actor-scoped, live, redacted **current-view store** that
Jarvis reads only through a bounded `risk:"read"` gateway tool (`chat.getCurrentView`) when the
current screen is relevant. The web shell debounces the existing Tier-1 DOM projection to a
dedicated authenticated update route; a TTL-backed in-memory store owns the latest projected view
per actor; the tool composes that view with server-authoritative build/platform/model-capability
facts, recursively allow-lists + 16K-caps the result, and the chat turn contract + engine prompt
**no longer carry** `<page_context>`.

- **Spec:** `docs/superpowers/specs/2026-07-16-1109-runtime-context-design.md`
- **Approved plan (READ THIS, 7 tasks):** `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`

## Plan is ALREADY coordinator-approved — do NOT re-plan

Codex-planned, then coordinator-reviewed and hardened (DI-seam path, `JarvisError` re-export,
capability narrowing, DOM-tier deviation note) and committed. **Treat it as the approved plan.**
Skip the stock `writing-plans` + plan-approval gate. Instead:

1. Do coordinated-build **step ½ (verify plan premises against THIS branch)**: your branch forks
   `build/1110-app-map`, so #1110's seam already exists — grep/read each cited path + line anchor
   and confirm current. Especially confirm the canonical DI seam (below) is present as #1110 landed
   it. If any premise drifted, **escalate to `Coord-1109-1110-g3` before building** with the re-scope.
2. Then build task-by-task with **TDD**, green + committed per task, `git add` only that task's files.

## Coupling with #1110 — CONSUME the seam, do not move it

You read #1110's output through the **canonical DI seam**:

- **`dependencies.appMapService`** — top-level optional `appMapService?: AppMapReadService` on
  `ChatRoutesDependencies`. **Never** move it under Chat `collaborators`, `toolServices`, or
  persona filtering. Task 4 reads `dependencies.appMapService`.
- **`AppMapReadService.getBuildInfo(): AppBuildInfo`** — your CurrentView tool calls `getBuildInfo()`
  for the server-authoritative version/buildId stamp. `AppBuildInfo` is DEFINED in #1109 (this plan).
- If the seam looks different from the plan on this branch, **stop and escalate** — do not adapt
  silently; the pair's public surface is a coordinated contract.

## GROUNDING RULE (carry from #1110, non-negotiable)

Everything Jarvis surfaces MUST mirror actual runtime state — real build facts from `getBuildInfo()`,
real capabilities from the configured model, real projected DOM. **Never invent surfaces, versions,
capabilities, or screens.** North star: *"Jarvis answers from ground truth or says 'I don't know' —
never invents."* This is spec anti-hallucination; honor it in every tool output and test.

## Guardrails (CLAUDE.md Hard Invariants — non-negotiable)

- **Closed-world framing.** Base system prompt must NOT carry ambient app facts — app knowledge lives
  ONLY behind the map/snapshot tools. Removing the ambient app description is a task; do not regress it.
- **Redaction floor.** Any DOM projection passes the SAME projection/redaction/cap pipeline — no raw
  `innerHTML` to the model. **Tier-1 only in v1**: no fuller-DOM tool, no screenshot endpoint/tool.
  This deliberately defers spec §6's DOM tier (approved as the safer MVP; any future DOM tier reuses
  the pipeline with the 16KB ceiling). Screenshots stay out until a separate per-capture consent UX
  is approved — model must never self-escalate.
- **Capability-level model exposure only** (#953): expose capabilities, never raw model identity,
  unless the model name is already user-facing in settings.
- **RLS via `scopedDb`.** Tool runs under the gateway's existing `withDataContext`; actor-scoped
  store isolation is a required test (one actor never reads another's view).
- **Structured error contract** `{ code, class, remediationRef? }`: `class:"prerequisite"` resolves
  `remediationRef` to a named fix; every other class → classify honestly, never fabricate a fix.
- **No secrets** in the view/tool output. **No migration expected** — if you think you need one, do
  NOT assume a number; escalate to the coordinator for landing-order assignment.
- **Provider-agnostic AI.** No hardcoded provider/model; capabilities come from the router.

## Exit criteria

Spec **§8 UAT exit criteria** — real **#1000 Playwright harness** on a real dev instance (Task 7):
a seeded chat session on a real screen (News grounding, idle-turn, no-screenshot acceptance) proves
Jarvis reads the live current view through the tool. Full local gate green (`pnpm verify:foundation`).
Per memory `e2e-dev-uat-for-ui-features`, this e2e is a HARD gate, not optional.

## Escalation + closeout

- **Escalate** blockers / spec drift / forks to `Coord-1109-1110-g3` via the `herdr-pane-message`
  skill. Before messaging, run `herdr pane list` and confirm **exactly one** pane holds that label;
  if 0 or >1, halt and wait — do not guess.
- **Relay** on the context-meter 70% warning (`relay` skill; successor in THIS worktree reads the
  newest RELAY doc, not coordinator messages).
- **Closeout = `coordinated-wrap-up`** (clean tree → your gate → pre-push trio
  `format:check && lint && typecheck` + rebase on origin/main → push → open PR → report PR +
  evidence to coordinator). You do **NOT** merge, move the board, or close issues — coordinator's job.

## Start

1. `[ -d node_modules ] || pnpm install` (fresh worktree; shares pnpm store).
2. Run the CLAUDE.md agentmemory recalls for state + frontend + integration-test rows.
3. Read the plan (`…-1109-runtime-context-plan.md`) by task. Do step ½ (branch + seam verification).
   Then build task-by-task with TDD.
