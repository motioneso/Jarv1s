# QA Native Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `coordinate` and `coordinated-qa` skills to spawn QA agents as native Claude Code subagents instead of Herdr panes, with the Herdr path retained as documented fallback.

**Architecture:** Two skill-file edits only — no product code, no migration, no schema changes. `coordinate` Phase 3 gains a native `Agent(run_in_background: true, isolation: "worktree")` spawn path with an inline QA prompt; `coordinated-qa` gains a clause covering the native-subagent return convention (final message = compact verdict). The Herdr path is preserved verbatim as a documented fallback in both files.

**Tech Stack:** Markdown skill files only.

---

### Task 1: Update `coordinate` Phase 3 — native subagent QA spawn

**Files:**

- Modify: `.claude/skills/coordinate/SKILL.md`
  - Phase 3 step 1 (old Herdr spawn → native Agent + Herdr fallback)
  - Quick Reference table (split build-agent row from QA-agent row)

- [ ] **Step 1: Confirm exact line numbers of Phase 3 step 1**

```bash
grep -n "Spawn an ephemeral" .claude/skills/coordinate/SKILL.md
grep -n "Spawn build / QA agent" .claude/skills/coordinate/SKILL.md
```

Expected: one hit each — note the line numbers.

- [ ] **Step 2: Replace Phase 3 step 1 (Herdr spawn → native Agent + Herdr fallback)**

In `.claude/skills/coordinate/SKILL.md`, find and replace this entire block:

```
1. **Spawn an ephemeral `coordinated-qa` agent** on the PR branch (`herdr agent start … -- claude
   … coordinated-qa`), passing the spec's **risk tier**. QA **trusts CI for the mechanical gate**
   (`gh pr checks`) and does NOT re-run `pnpm verify:foundation` unless CI is red — it spends tokens
   on review only. By tier:
   - `routine` / `sensitive`: **Sonnet** QA — `/code-review` + exit-criteria (+ invariant check for
     `sensitive`). Compact verdict back to you.
   - `security`: **cross-model Opus** QA (model escalation policy) — `/security-review` + an
     adversarial *what's NOT tested / which trust boundary is unproven* pass. It **must `gh pr
     comment` its verdict** before you act. (Same-lens Sonnet missed the CRITICALs in the real run;
     this is the budgeted place to spend up.)
   Consume the compact verdict (cheap — never the body); **reap the QA agent.**
```

Replace with:

```
1. **Spawn an ephemeral `coordinated-qa` agent** on the PR branch via the **`Agent` tool**,
   passing the spec's **risk tier**. QA **trusts CI for the mechanical gate**
   (`gh pr checks`) and does NOT re-run `pnpm verify:foundation` unless CI is red — it spends tokens
   on review only.

   **Primary path — native subagent:**
```

Agent(
description: "QA: <slug>",
subagent*type: "coordinated-qa",
run_in_background: true,
isolation: "worktree",
model: "opus", ← security tier only; omit for routine/sensitive
prompt: """
JARVIS_PGDATABASE=jarvis_qa*<n>
PR: <PR number>
Branch: <branch>
Spec: <spec-path>
Tier: <routine|sensitive|security>

You are a QA agent. Invoke the coordinated-qa skill. Return ONLY the compact verdict as your
final message.
"""
)

```
Await the background agent notification. Extract the compact verdict from the agent's final
message. No reap needed — native subagents clean themselves up.

**Fallback (Herdr):** If the `Agent` tool is unavailable (e.g., running in a context without
native subagent support), fall back to `herdr agent start` with the same QA prompt and collect
the verdict via `herdr pane read`. Document any fallback activation in the manifest.

By tier:
- `routine` / `sensitive`: **Sonnet** QA — `/code-review` + exit-criteria (+ invariant check for
  `sensitive`). Compact verdict back to you.
- `security`: **cross-model Opus** QA (`model: "opus"` in `Agent(...)`) — `/security-review` + an
  adversarial *what's NOT tested / which trust boundary is unproven* pass. It **must `gh pr
  comment` its verdict** before you act. (Same-lens Sonnet missed the CRITICALs in the real run;
  this is the budgeted place to spend up.)
Consume the compact verdict (cheap — never the body).
```

- [ ] **Step 3: Update the Quick Reference table — split build-agent row from QA-agent row**

Find this row in the Quick Reference table:

```
| Spawn build / QA agent (window 1!) | `herdr agent start "<Label>" --tab <ws>:1 --cwd <path> --no-focus -- claude …` |
```

Replace with two rows:

```
| Spawn build agent (window 1!) | `herdr agent start "<Label>" --tab <ws>:1 --cwd <path> --no-focus -- claude …` |
| Spawn QA agent (native subagent) | `Agent(description: "QA: <slug>", subagent_type: "coordinated-qa", run_in_background: true, isolation: "worktree", prompt: "...")` |
```

- [ ] **Step 4: Verify the edited sections look correct**

```bash
grep -A 40 "Spawn an ephemeral" .claude/skills/coordinate/SKILL.md | head -50
grep -A 2 "Spawn build agent" .claude/skills/coordinate/SKILL.md
grep -A 2 "Spawn QA agent" .claude/skills/coordinate/SKILL.md
```

Expected: Phase 3 step 1 shows `Agent(...)` primary path + Herdr fallback block; quick-ref shows two distinct rows.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/coordinate/SKILL.md
git commit -m "feat(skills): coordinate Phase 3 QA spawn via native Agent tool

Replace herdr agent start QA spawn with Agent(run_in_background: true,
isolation: worktree). Retain Herdr path as documented fallback. Split
Quick Reference build-agent and QA-agent rows.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Update `coordinated-qa` — add native subagent return clause

**Files:**

- Modify: `.claude/skills/coordinated-qa/SKILL.md`
  - Step 5 reporting block: differentiate native-subagent path (final message = verdict) from Herdr-pane path (herdr-pane-message)

- [ ] **Step 1: Confirm exact location of Step 5 in coordinated-qa**

```bash
grep -n "Post the verdict" .claude/skills/coordinated-qa/SKILL.md
```

Expected: one hit — note the line number.

- [ ] **Step 2: Replace Step 5 reporting block**

Find and replace this block in `.claude/skills/coordinated-qa/SKILL.md`:

```
**5. Post the verdict to the PR, then report it to the coordinator.** ALWAYS `gh pr comment` first
(durable evidence that survives the coordinator's relay; mandatory for `security` tier before any
merge), then `herdr-pane-message` the same compact block to the coordinator label, then stop:
```

Replace with:

```
**5. Post the verdict to the PR, then report it to the coordinator.** ALWAYS `gh pr comment` first
(durable evidence that survives the coordinator's relay; mandatory for `security` tier before any
merge), then report to the coordinator by the appropriate channel, then stop.

**If invoked as a native subagent (via `Agent` tool):** your final message IS the verdict — output
the compact verdict block below as your last message with no trailing text. Do NOT call
`herdr-pane-message` (there is no coordinator pane to target).

**If invoked as a Herdr pane:** `herdr-pane-message` the compact block to the coordinator label.
```

- [ ] **Step 3: Verify the edited section looks correct**

```bash
grep -A 12 "Post the verdict" .claude/skills/coordinated-qa/SKILL.md | head -15
```

Expected: Step 5 shows the `gh pr comment` preamble, then the two-branch if/else for native vs Herdr.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/coordinated-qa/SKILL.md
git commit -m "feat(skills): coordinated-qa returns verdict as final message when native subagent

When invoked via the Agent tool (not a Herdr pane), the compact verdict
block is returned as the final message rather than sent via
herdr-pane-message. Herdr-pane path retained for pane-based invocation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Pre-push verification trio

**Files:** none modified — gate only

- [ ] **Step 1: Run the pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all three pass with zero warnings. If lint/format fail on the `.md` files, check whether the project's eslint/prettier config scopes to `.md`; skill files under `.claude/` are typically ignored by the project linter. Confirm with:

```bash
cat .eslintignore 2>/dev/null || grep -r "\.claude" .eslintrc* .eslintignore .prettierignore 2>/dev/null | head -10
```

- [ ] **Step 2: Rebase on origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: clean rebase, no conflicts (skill files are only touched by this branch).

- [ ] **Step 3: Report to coordinator**

Message the `Coordinator` label via `herdr-pane-message` that the PR is ready:

- confirm both skill edits committed and pre-push trio green
- invoke `coordinated-wrap-up` for final PR open + full verdict

---

## Self-review against spec exit criteria

| Exit criterion                                                                 | Covered by                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `coordinate` Phase 3 spawns QA via `Agent(run_in_background: true)`            | Task 1 Step 2                                                 |
| `coordinated-qa` returns compact verdict as final message when subagent        | Task 2 Step 2                                                 |
| Herdr QA path retained and documented as fallback                              | Task 1 Step 2 (Fallback block)                                |
| Trial run completed; token spend + wall clock recorded on issue #84            | **Post-landing** — noted explicitly in PR body per HANDOFF.md |
| Verdict contract end-to-end verified (coordinator consumes without pane reads) | Trial run (post-landing)                                      |
