# RESUME — coordinator session restart (Bash-snapshot wedge) — 2026-07-16

## ⏩ CURRENT STATE (updated 2026-07-16 by `Coord-1109-1110-g3`, session cb9ca6a3 — gen-3 relay → gen-4)

Run is HEALTHY and mid-build. #1110 build lane in its final task (Task 8 UAT gate); #1109 gated on
#1110 PR. **Do NOT redo:** plans, #1110 spawn, step-½, Tasks 1–7.

**YOU ARE gen-4 — do these FIRST (gen-3's session died with these live-only bits):**
1. **RE-ARM the PR Monitor** (monitors are session-only, died with gen-3). Persistent Monitor that
   fires on (a) `build/1110-app-map` PR open — poll
   `gh pr list --head build/1110-app-map --json number --jq '.[0].number // empty'` — AND (b) lane
   death (no pane whose label starts `Build-1110-AppMap` in `herdr agent list`).
2. **Resolve the live build pane FRESH** by label from `herdr agent list` (pane numbers reflow).
   Last driver was **`Build-1110-AppMap-12`**, session `17b54d76…`, pane was `w1:pSK`. Confirm
   exactly one pane holds a `Build-1110-AppMap*` label before addressing/reaping.

**#1110 app-map build lane (branch `build/1110-app-map`, worktree
`~/Jarv1s/.claude/worktrees/build-1110-app-map`):**
- **Committed:** Tasks 1–7 (T5 `5fc87016`, T6 `a274d98d`, T7 `08e6a716`; earlier T1 `2ffadbf1`,
  T2 `432fe68e`, T3 `25e44f86`). Relay checkpoint HEAD ~`b75aa94a`.
- **Task 8 = FINAL task, mid-flight:** #1000 UAT grounding spec. Plan text for T8 is STALE — the
  authoritative T8 guide is `docs/superpowers/handoffs/2026-07-16-1110-app-map-relay-8.md` (per-spec
  `uatLevel` export, NOT `run-uat.ts` selector; SKIP `seed/member.ts` — id collides with
  `UAT_SECOND_OWNER_ID`; thread `withoutNewsJsonBinding` additively).
- **BLOCKER I ADJUDICATED (done, -12 building the fix):** T8 UAT surfaced a browser-bundle break —
  `packages/shared` re-exports the runtime `const AI_MODEL_CAPABILITIES` from the `@jarv1s/module-sdk`
  barrel, which transitively pulls `rate-limit-key.ts`'s `node:crypto` → vite `createHash` error in
  `apps/web`. **Directed NARROW fix** (NOT moving rate-limit-key = 6-file server blast radius):
  extract `AI_MODEL_CAPABILITIES` + `AiModelCapability`/`AiModelTier` into node-clean leaf
  `packages/module-sdk/src/ai-capabilities.ts`; barrel re-exports from it; add subpath export
  `"./ai-capabilities"` to module-sdk `package.json`; `packages/shared/src/ai-types.ts` imports the
  leaf subpath, not the barrel. Filed follow-up **issue #1120** (proper barrel browser-safe split via
  `./server` subpath) — -12 cites #1120 in the regression-fix commit. **If -12 escalates the fix is
  bigger than scoped, hold and reassess — do not let it balloon T8.**
- **After T8 green:** `verify:foundation` → pre-push trio → rebase origin/main → `coordinated-wrap-up`
  (build agent opens PR + reports to `Coord-1109-1110-g3`; coordinator NEVER merges/boards/closes).

**⚠ CROSS-SESSION HOLD YOU OWE A RELEASE:** pane label **`UX 1117 UAT 6ca14fca`**, session
`61c9ee5d…` (was pane `w1:pSH`) is HOLDING all docker UAT for us to avoid a 10.254.0.0/24 subnet
collision (no overlap guard — memory `uat-docker-subnet-map`). **Ping it "clear — build UAT done,
docker free"** via `herdr-pane-message` the moment -12's UAT run finishes (or when #1110 PR opens).
Do not leave it blocked.

**#1109 (spawn AFTER #1110 PR opens):** handoff PRE-WRITTEN at
`docs/superpowers/handoffs/2026-07-16-1109-runtime-context-build.md` (coord branch). On PR open:
create branch `build/1109-runtime-context` off `build/1110-app-map`, copy handoff onto it, commit,
spawn build agent (Sonnet 5). Handoff already folds in grounding rule + canonical DI seam
(`dependencies.appMapService` / `getBuildInfo()`). #1109 plan = 7 tasks.

**GROUNDING RULE (both issues):** app-map + current-view MUST mirror actual code/runtime — real
section ids, labels, panes, build facts. Never invent surfaces. Spec anti-hallucination.

**Reap protocol:** before `herdr pane close`, re-resolve by label + confirm `agent_session.value`
matches the predecessor you mean to kill; confirm successor is driving. gen-3 cleanly reaped -5..-11.

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
