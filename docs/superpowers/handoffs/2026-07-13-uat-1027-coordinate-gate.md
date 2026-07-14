# Handoff — #1027: UAT harness Phase 4 (wire into coordinate e2e-UAT gate)

You are a **build agent**. Model: **Codex gpt-5.6-sol**. Tier: **sensitive** (it changes the QA
machinery the coordinator depends on + encodes a merge-gating policy). Coordinator: label
`Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f` — report the PR number there.

Worktree: `.claude/worktrees/uat-coordinate-1027` (branch `uat-coordinate-1027`, off `origin/main`
@ `3af43aae` — this ALREADY contains P1 `tests/uat/provisioner.ts`, P2 `tests/uat/seed/*`, and P3
`tests/uat/specs/job-search-install.uat.spec.ts` + `playwright.uat.config.ts` + `run-uat.ts` +
the `test:uat` script). STEP 1: `pnpm install`.

## Read first (in full — decision-dense)
- The APPROVED spec `docs/superpowers/specs/2026-07-12-dev-uat-harness.md`: **§7** (declaring a
  test's level + plugging into coordinate — THIS is your scope), **§8 item 4** (Phase 4 build
  scope), **§5** (the `uatLevel` named-export convention a spec uses to declare its own level).
- `gh issue view 1027` — **contains Ben's locked gate decision (below); do not re-litigate it.**
- The just-landed P3 spec `tests/uat/specs/job-search-install.uat.spec.ts` and its `uatLevel`
  export — you wire the lookup that decides when THIS spec runs.
- The machinery you extend: `.claude/agents/coordinated-qa.md` and the `coordinated-qa` skill under
  `.claude/skills/coordinate/` (its step 4 "Tier-specific depth"). Read how sensitive-tier depth
  works today before extending it.

## Scope — Phase 4 (§7 + §8.4)
1. **Trigger-path lookup.** Add an **e2e-UAT step** to `coordinated-qa`'s step 4 for
   `sensitive`-tier PRs: when the PR diff touches a path that has a matching UAT spec, the QA agent
   runs that spec (via the P3 `test:uat` harness / `provision()`). Make it a **data-driven lookup**
   (path-glob → spec) that future specs extend by adding a row — do NOT hardcode a single spec.
   Seed the lookup with (per §7):
   - `packages/module-registry/**`, `scripts/module-reconcile.ts`, `scripts/start-jarv1s.ts`,
     `apps/web/src/settings/settings-module-registry-section.tsx`
     → `tests/uat/specs/job-search-install.uat.spec.ts`.
2. **Gate policy — Ben's locked decision (#1027, 2026-07-13):** the e2e-UAT gate is **BLOCKING**
   for **runtime-path PRs** (install / sync / export-import / nav / CLI-runner) — *"if UAT fails,
   fix it and UAT again,"* **never waived**. For non-runtime-path surfaces it is **advisory**
   (surfaced by the coordinator, non-gating). Encode both modes: a diff hitting a runtime-path
   trigger → blocking; advisory otherwise. Document the decision inline where the tier depth is
   defined (cite #1027).
3. **Prove it would have caught #999.** Reconstruct a real **#999-shaped diff** (the extract-ratio
   install bug — `git show 3614ad1e` is the fix; invert it to get the broken shape, or synthesize
   the pre-fix diff) and run your new lookup against it locally to CONFIRM the trigger fires and
   the gate would have blocked it. Capture the evidence (command + outcome) in the PR body. This is
   the exit criterion — a lookup that doesn't actually fire on the #999 path is a failed build.

## HARD constraints
- **Do NOT edit `apps/web/src/settings/settings-module-registry-section.tsx`.** It appears ONLY as
  a string in the trigger-path lookup — never modify the file itself. (The UX Coordinator fleet has
  reserved it for issue #1042; editing it collides with their run.)
- You MAY edit `.claude/skills/coordinate/**` and `.claude/agents/coordinated-qa.md` — that IS the
  deliverable. **Do NOT touch `docs/coordination/**`** (coordinator-only).
- **No `git add -A` / `git add .`** — stage explicit paths only (shared working tree).
- **No repo-wide `pnpm format`** — format only files you changed; `prettier --write` any `.md` you
  author before commit.
- If a decision the spec/issue didn't settle comes up, message the `Coordinator` pane — do not
  improvise across locked decisions.

## Determinism / comment density
- Generous why-comments citing **#1027 / #1000** at each non-obvious step — especially the
  blocking-vs-advisory branch (cite Ben's #1027 decision) and the trigger-path lookup rows.
- No wall-clock/random in any test you add.

## Gate + PR
- `pnpm verify:foundation` green; record exit codes in the PR body. Include the #999-diff proof
  evidence (command + result).
- PR: `Part of #1000` + `Closes #1027`, base `main`, short "What's new" (dev-tooling — say plainly
  it's not user-visible: "Internal: the coordinate QA flow now runs the live UAT harness as a
  blocking gate on module-install/runtime-path PRs, so an install regression like #999 is caught
  before merge.").
- Report the PR number to the `Coordinator` pane. Tier **sensitive** → sensitive QA (CI +
  code-review + invariant walk + confirm the #999-diff proof). **You do not merge.**
