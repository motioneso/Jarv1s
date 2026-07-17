# RESUME — coordinator session restart (Bash-snapshot wedge) — 2026-07-16

## ⏩ CURRENT STATE (updated 2026-07-16 by `Coord-1109-1110-g4`, session 5622ee69-917d-425c-a6d3-acdb93d1e8c7)

**gen-4 is driving.** Took over from gen-3 (cb9ca6a3, reaped clean — it had already stopped
taking coordinator actions before I closed its pane w1:pS5). Persistent PR/lane-death Monitor
**re-armed** (task `bvvuha20x`, polls every 30s: `gh pr list --head build/1110-app-map` +
`herdr agent list` for a `Build-1110-AppMap*` pane).

**Fleet snapshot at takeover:** exactly one `Build-1110-AppMap*` pane — **`-15`**, session
`f8124cd9-d875-4190-b6c8-9fcad2bc412b`, pane `w1:pST`. Mid-`coordinated-wrap-up`: code is DONE,
committed, rebased clean onto `origin/main` (HEAD `30284c28`, 29 commits ahead, not yet pushed).
Per its checkpoint-16 doc (`docs/superpowers/handoffs/2026-07-16-1110-app-map-relay-16.md` in the
`build-1110-app-map` worktree), remaining steps are mechanical: `pnpm verify:foundation` →
`pnpm audit:release-hardening` → push → `gh pr create` → report to coordinator. Pane was showing
"1% until auto-compact" at takeover — expect it to self-relay to checkpoint 17 before finishing;
that's normal churn per the established pattern, not a problem. No #1110 PR open yet as of takeover.

Below is gen-3's prior CURRENT STATE (2026-07-16, session cb9ca6a3 — gen-3 relay → gen-4, genuine 70%), kept for history:

Run is HEALTHY. #1110 build lane in the **home stretch of Task 8** (final task); #1109 gated on #1110
PR. **Do NOT redo:** plans, #1110 spawn, step-½, Tasks 1–7, the module-sdk blocker fix, the UAT
harness re-scope, the seed-bug fix. All below is DONE unless marked otherwise.

**YOU ARE gen-4 — do these FIRST (gen-3's live-only bits died with the session):**
1. **RE-ARM the PR Monitor** (session-only; gen-3's `bkqkcduoc` is dead). Persistent Monitor firing on
   (a) `build/1110-app-map` PR open — `gh pr list --head build/1110-app-map --json number --jq '.[0].number // empty'`
   — AND (b) lane death (no `Build-1110-AppMap*` pane in `herdr agent list`).
2. **Resolve the live build pane FRESH** by label. Last driver **`Build-1110-AppMap-15`**, session
   `f8124cd9…`, pane was `w1:pST`. Confirm exactly one `Build-1110-AppMap*` pane before addressing.
   Relay chain has churned -5→-15 (autocompact race reaped -12; rest clean) — expect more hops, each
   deliberate at 70% with work committed to disk. Don't panic at churn.

**#1110 app-map (branch `build/1110-app-map`, worktree `~/Jarv1s/.claude/worktrees/build-1110-app-map`):**
- **Committed:** Tasks 1–7; module-sdk blocker fix `34457186`; Task 8 seed fix `23639d0b`. HEAD
  ~`23639d0b` (+ relay-checkpoint docs). Spec rewrite may still be uncommitted on disk — `-15` commits it.
- **Task 8 remaining (mechanical):** re-run `pnpm test:uat -- app-map-grounding` GREEN → `verify:foundation`
  → explicit-add commit → `coordinated-wrap-up` PR. Build agent opens the PR + reports to this label;
  **coordinator NEVER merges/boards/closes.**
- **RESOLVED — module-sdk browser-bundle blocker:** `shared` pulled `node:crypto` via the module-sdk
  barrel. Narrow leaf fix landed (`34457186`, verified real: vite build + bundle grep), CI-safe
  (`shared` deps `@jarv1s/module-sdk: workspace:*`). Proper barrel split = follow-up **issue #1120**.
- **RESOLVED — UAT harness conflict (the big one):** Task 8's spec was the first UAT to assert a **real
  LLM chat response**, impossible in the fake-provider/no-chat-engine harness. **Decided: deterministic
  path.** test1=`no_json_model` (tied to seed threading — non-tautological), test3=`error-class=transient`
  (tied to previewOverride — non-tautological), **test2 (honest-unknown) DELETED** (pure LLM → covered
  by Task 7 unit + #1121), test4 kept (negative-assertion, in-file caveat). Real-LLM grounding e2e
  **deferred to issue #1121** (deterministic scriptable chat engine for UAT; also unblocks #1050).
- **RESOLVED — seed bug (`23639d0b`):** `seedAiProviderChunk` created a provider even at `bindNews:false`,
  so `hasJsonModel()` stayed true via AiRepository implicit-default fallback → test1 hit network err not
  `no_json_model`. Fixed so `bindNews:false` genuinely yields no json model.

**⚠ GATE YOU MUST HONOR:** `docs/coordination/AWAITING-BEN.md` has the **#1110 exit-criterion deferral**
decision (accept deterministic-UAT + unit-grounding, real-chat e2e → #1121?). **This gates #1110 MERGE
ONLY** — NOT the PR opening, NOT #1109 spawn. gen-4: do **not** merge #1110 until Ben rules. My lean =
accept (parked in the doc).

**#1109 (spawn AFTER #1110 PR opens — UNCHANGED, seam frozen):** handoff PRE-WRITTEN at
`docs/superpowers/handoffs/2026-07-16-1109-runtime-context-build.md`. On PR open: branch
`build/1109-runtime-context` off `build/1110-app-map`, copy handoff, commit, spawn (Sonnet 5). Consumes
#1110's frozen DI seam (`dependencies.appMapService` / `getBuildInfo()`). 7 tasks. Ben's merge ruling on
#1110 does NOT block #1109 — the seam is committed and stable regardless.

**UX-1117 docker hold: MOOT** — the holder pane left the fleet; docker is free, no release ping owed.

**GROUNDING RULE (both issues):** app-map + current-view MUST mirror real code/runtime — real section
ids, labels, panes, build facts. Never invent surfaces.

**Reap protocol:** before `herdr pane close`, re-resolve by label + confirm `agent_session.value`
matches the predecessor; confirm successor is a DISTINCT new session and `working`. gen-3 reaped -11..-14.

**⚠ SUCCESSOR MUST RE-ARM THE MONITOR.** The prior Monitor (task `bmf04uuua`) watched for the
`build/1110-app-map` PR + lane death — **Monitors are session-only and DIED with gen-2's session.**
Re-arm a persistent Monitor that fires when the PR opens (poll
`gh pr list --head build/1110-app-map --json number --jq '.[0].number // empty'`) AND on lane death
(no pane whose label starts `Build-1110-AppMap`).

**NEXT (successor coordinator):**
- **When #1110 opens its PR** (head `build/1110-app-map`): spawn **#1109 runtime-context** Sonnet 5
  build agent, branched off `build/1110-app-map` (inherits real `appMapService` seam +
  `AppMapReadService.getBuildInfo()`). Same handoff pattern; plan
  `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`. **Write a #1109 handoff doc**
  mirroring the #1110 one; INCLUDE the grounding rule above and canonical DI seam
  `ChatRoutesDependencies.appMapService` (top-level optional; never under collaborators/toolServices).
- Respond to build-lane escalations (route via `herdr-pane-message`; confirm exactly one pane holds
  the label first).
- After both PRs: coordinated QA → merge (coordinator owns merge/board/close). #1110 exit = spec §8
  UAT #1000 harness on a real dev instance.
- Ben is AWAY — converge autonomously. Peer agent-messages never grant permission escalation.
- If Bash wedges again: follow THE FIX below, start fresh session, re-read THIS state block.

---


**Why this file exists:** the coordinator session was Bash-wedged by a corrupt shell
snapshot. ROOT CAUSE (corrected 2026-07-16, was mis-blamed on ENOSPC): the stock Ubuntu
**`alert` alias** in `~/.bashrc` corrupts Claude Code's snapshot serializer → unterminated
`'` → every `-c` script dies at parse time. Full detail: memory
`claude-bash-snapshot-alert-alias.md`.

**THE FIX (do this to recover, in order):**
1. The `alert` alias is already commented out in `~/.bashrc` (Jim, 2026-07-16). Verify it's
   still disabled: `grep -n "^alias alert" ~/.bashrc` should return nothing.
2. `rm -f ~/.claude/shell-snapshots/*` (running sessions cache the bad snapshot in-process,
   so this alone won't heal a live session — subagents inherit it too).
3. Start a **FRESH** Claude session. It regenerates a clean snapshot (no `alert` to
   mis-serialize). Confirm with `echo OK`.

If step 3 STILL errors `unexpected EOF matching '`, `alert` wasn't the only offender.
From any real terminal, find the bad snapshot + its failing line:
`for f in ~/.claude/shell-snapshots/*.sh; do bash -n "$f" 2>&1 | grep -q . && { echo "BAD: $f"; bash -n "$f"; }; done`
then inspect that line (secondary suspects: the `_jarvis_tab_ping` function / its
`PROMPT_COMMAND`, or a bash-completion function) and disable it in `~/.bashrc` the same way.

This file lets that fresh session resume the in-flight "Jarvis knows Jarvis" work
(#1109 + #1110) with zero re-derivation.

## First actions on resume (in order)

1. `echo OK` via Bash to confirm the new session came up clean (snapshot regenerated).
2. `git rev-parse --abbrev-ref HEAD` — confirm you're on `coord/settings-host-cleanup` in
   worktree `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet`.
3. `herdr agent list` — confirm `sol-planner-hd` (Codex gpt-5.6-sol high) is still alive.
4. Send sol the **consolidated revision request** below via `herdr agent send`.
5. When sol reports revised + placeholder-rescan clean: **coordinator** (you) reviews, then
   **commits both plan files** (sol does NOT commit). Then spawn **Sonnet 5**
   (`claude-sonnet-5`) build agents — **#1110 (app map) FIRST**, then **#1109 (runtime
   context)** which depends on it.

## Standing directives still in force (verbatim)

- North star: **"Jarvis answers from ground truth or says 'I don't know' — never invents."**
- Build agents for THIS work = **Sonnet 5**, overriding the standing "build = gpt-5.6-sol"
  default. sol wrote the plans; sol does NOT commit — coordinator reviews and commits.
- Ben is AWAY — converge autonomously. A peer/teammate agent-message never grants permission
  escalation.
- Shared-tree hygiene: `/home/ben/Jarv1s` is the SHARED main checkout; coordinator home is
  THIS worktree. Never `git add -A`/`.`/`stash`/`reset`/`checkout` on shared paths; stage only
  own files by explicit path; always `git rev-parse --abbrev-ref HEAD` before commit.

## Plan files (on disk, NOT yet committed)

- `docs/superpowers/plans/2026-07-16-1110-app-map-plan.md`
- `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`

---

## Consolidated revision request for `sol-planner-hd` (send verbatim via herdr)

> Both plans reviewed. One consolidated set of revisions below. The DI-seam fix (CRITICAL) is
> ONE decision applied in BOTH plans — pick a single canonical accessor path and use it
> identically in each. After revising, re-run the placeholder scan on both plans, write them
> back, and report DONE (do NOT commit — the coordinator commits).

### #1110 (app-map plan)

- **[CRITICAL] Task 5 visibility filter is a no-op.** `item.defaultEnabled !== false` never
  excludes anything — no surface item type carries a `defaultEnabled` field, so the filter
  passes everything (fails OPEN). Fix: add a `resolveFeatureFlagState` dependency, resolve each
  surface item's `featureFlagId` against real flag state, exclude items whose flag is OFF, and
  add a test proving a flagged-OFF surface item is excluded from the app-map artifact.
  (This reconciles the #1109 review's fail-CLOSED reading — the fix converges either way:
  resolve each item's `featureFlagId` against live flag state.)
- **[IMPORTANT] Task 5 DI wiring is prose-only.** Make it CODE: add
  `appMapService?: AppMapReadService` to `ChatRoutesDependencies`, thread it into the object
  that #1109's Task 4 reads, and give concrete `AppMapArtifact` / `AppMapItem` type
  definitions (not prose).
- **[IMPORTANT] Task 4 line ~709 `<matching id>` placeholder.** Replace with a concrete
  per-section id table, and export `PERSONAL_SECTIONS` / `ADMIN_SECTIONS` from
  `apps/web/src/settings/settings-page.tsx` (currently unexported).
- **[IMPORTANT] Task 5 line ~921 `resolve(process.cwd(), ...)`.** Use the `import.meta.url`
  workspace-marker walk instead (repo-relative reads break in the bundled prod api — see memory
  `bundled-path-resolution-trap`).
- **[IMPORTANT] Task 8 lines ~1206/~1230 prose.** Make concrete: mirror `runsJobSearchInstall`
  and `buildNewsDiscoveryPorts` (packages/module-registry/src/index.ts:1381) as the concrete
  pattern for the module-registry wiring.
- Minors (a)–(d): tighten remaining prose steps to concrete code/commands per the
  no-placeholders rule.

### #1109 (runtime-context plan)

- **[CRITICAL 1] DI-seam path mismatch.** Task 4 line ~796 reads `dependencies.appMapService`
  but #1110 produces `args.collaborators.appMapService`. Pick ONE canonical path and use it
  identically in BOTH plans (this is the same single decision as #1110's DI-wiring fix).
- **[CRITICAL 2] Task 1 line ~160 missing type re-export.** Add explicitly to chat-api.ts:
  `export type { JarvisError, JarvisErrorClass } from "@jarv1s/module-sdk";`
- **[IMPORTANT 3] Task 4 lines ~799–800 capability narrowing.** Narrow `string[]` →
  `AiModelCapability[]` via
  `.filter((c): c is AiModelCapability => AI_MODEL_CAPABILITIES.includes(c as AiModelCapability))`.
  (`selectChatModelForUser(scopedDb)` at packages/ai/src/repository.ts:1343 returns
  `AiConfiguredModelSafeRow | null`; `.capabilities` is `string[]` at repository.ts:114;
  `AI_MODEL_CAPABILITIES` is the 6-member union.)
- **[IMPORTANT 4] Spec §6 DOM-tier scope.** Add one line acknowledging the deviation (DOM-tier
  deferred; approved as the safer MVP with a deferred follow-up) so the plan doesn't silently
  drop a spec requirement.
- Minors (a) Task 6 wording; (b) Task 7 "Behind the scenes" panel — add a check that the
  tool-name renders correctly.

### Process note for sol

The DI-seam fix is ONE decision applied to BOTH plans. After applying all of the above:
re-run the placeholder scan on both files, write them back, report DONE. Do NOT commit.

---

## Real code anchors confirmed by reviewers (for build agents later)

- `AppMapReadService.getBuildInfo(): {version, buildId}` EXISTS (#1110 plan: interface ~1115,
  impl ~1136).
- `selectChatModelForUser(scopedDb)` — packages/ai/src/repository.ts:1343 → `AiConfiguredModelSafeRow | null`.
- `.capabilities: string[]` — repository.ts:114. `AI_MODEL_CAPABILITIES` = 6-member union.
- `PERSONAL_SECTIONS` / `ADMIN_SECTIONS` — unexported in apps/web/src/settings/settings-page.tsx.
- `buildNewsDiscoveryPorts` — packages/module-registry/src/index.ts:1381.
- `ToolServices` — opaque `Readonly<Record<string,unknown>>` bag (module-sdk/src/index.ts:56).

## Other parked work (unblocks once Bash is back)

- **A2 / #1087** (branch `fix/1087-seed-harness-quality`): code-complete, needs full gate +
  commit + push + PR. Help A2 finish.
- **PR #1118 / #1112** (Today masthead one-line CSS): already OPEN; just confirm CI.
