# RESUME — coordinator session restart (Bash-snapshot wedge) — 2026-07-16

## ⏩ CURRENT STATE (updated 2026-07-16 by successor coordinator `Coord-1109-1110`, session ed4b90d8)

Resumed clean. Progress so far — **do NOT redo these**:

1. ✅ sol-planner-hd revised BOTH plans. Canonical DI seam = `ChatRoutesDependencies.appMapService`.
2. ✅ Coordinator reviewed both plans (all CRITICAL/IMPORTANT resolved, placeholder scan clean) and
   **committed** them on branch `coord/settings-host-cleanup` → commit `9c59bd37`.
3. ✅ Spawned **Sonnet 5** build agent **`Build-1110-AppMap`** (app-map FIRST).
   - Worktree `~/Jarv1s/.claude/worktrees/build-1110-app-map`, branch `build/1110-app-map` (off
     `origin/main`; specs+plans+handoff cherry-picked/committed there).
   - Handoff: `docs/superpowers/handoffs/2026-07-16-1110-app-map-build.md` (in that worktree).
   - Status at spawn: working (Sonnet 5, high, bypass-permissions on).

**NEXT (what a successor must do):**
- A persistent Monitor watches for the `build/1110-app-map` PR. **When #1110 opens its PR** (seam
  landed + pushed), spawn the **#1109 runtime-context** Sonnet 5 build agent, branched off
  `build/1110-app-map` so it inherits the real `appMapService` seam + `AppMapReadService.getBuildInfo()`.
  Use the same handoff pattern; plan is `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`.
- Respond to Build-1110-AppMap escalations (spec drift from step-½ verification, blockers).
- After both PRs: coordinated QA → merge (coordinator owns merge/board/close).
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
