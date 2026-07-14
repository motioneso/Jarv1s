---
name: coordinated-qa
description: Use when you are an EPHEMERAL QA AGENT spawned by a dev coordinator to independently verify one PR branch and return a compact verdict. You run the full gate + code review + security review on a branch you did NOT author, then report a short structured verdict (green/red, blocking findings, merge-ready y/n) back to the coordinator — and you are then reaped. This exists so the coordinator never burns its own context on heavy verification.
---

# coordinated-qa — independently verify a PR, return a compact verdict

## Overview

The coordinator must not spend its (long-lived, precious) context reading 10k-line logs and
diffs, and the build agent must not grade its own work (verify-never-trust). So **you** — a fresh,
throwaway agent — do the expensive verification on a branch you did not write, and hand back a
**short verdict**. The coordinator consumes the verdict and reaps you.

**Spend tokens on review, not on re-running the gate.** CI already executes the mechanical gate;
duplicating it is the single biggest QA waste. You **trust `gh pr checks`** for gate pass/fail and
spend your budget on what CI can't do: judgment review, invariant checking, and — for security
tier — an adversarial stronger-model hunt for what's NOT tested.

Your output to the coordinator is the compact verdict in step 5, **and** (always) a `gh pr comment`
posting it durably to the PR. Do not paste raw logs. **Communicate in caveman mode** (terse — drop
articles/filler/pleasantries, keep full technical accuracy; invoke the `caveman` skill if
registered) for the verdict and any narration, to save tokens.

## Inputs (from your handoff / bootstrap)

- The **PR branch** (and/or worktree) to verify, the **spec** it implements, the **risk tier**
  (`routine` | `sensitive` | `security`), and the **coordinator label** to report to. If the tier
  isn't given, infer it from the diff's content triggers and treat ambiguity as the higher tier.

## Procedure

**1. Get on the branch.** Check out the PR branch into a **fresh worktree/checkout** of your own
(never an author's tree). `[ -d node_modules ] || pnpm install` (shared pnpm store — skip if
present). Confirm you're on the right HEAD (`git log --oneline -3`).

**2. Trust CI for the mechanical gate — don't re-run it.**
```bash
gh pr checks <PR>          # required checks pass/fail
```
- If **all required checks are green**, record their result and move to review. Do **NOT** run
  `pnpm verify:foundation` / `audit:release-hardening` — CI already did; re-running duplicates cost
  2–4× and adds nothing.
- **Only if CI is red** do you reproduce locally to diagnose (real exit codes, never pipe a gate to
  `tail`/`grep` as the final stage — capture `$?` + the summary line). A known flake (e.g. pg-boss
  worker-timeout) gets one re-run before you call it red; don't wave it off either.
- A red check is **stop-the-line** unless waivable per the coordinator's CI-waiver protocol (proven
  red on `main` @ same SHA + recorded + Ben-approved) — that's the coordinator's call, not yours.
  Report it red.

**3. Review the diff (where your tokens go).** Against `main`:
```bash
git fetch origin main && git diff --stat origin/main...HEAD
```
- Run **`/code-review`** (correctness + reuse/simplification) on the diff.
- Confirm the diff actually covers the spec's **Exit Criteria**.
- Check CLAUDE.md Hard Invariants: no RLS bypass, private-by-default, DataContextDb/VaultContext
  only, no secrets escaping (responses/logs/job payloads/exports/prompts), metadata-only job
  payloads, provider-agnostic AI, module isolation, migrations (never edited; module SQL in module
  `sql/`; no assumed migration numbers).

**4. Tier-specific depth.**
- `routine`: steps 1–3 are enough.
- `sensitive`: add an explicit invariant walk-through (DataContextDb/VaultContext, metadata-only
  payloads, module isolation) naming each as ok/at-risk. Then run the changed-path e2e-UAT gate:
  1. Resolve the PR's paths through the data-driven lookup (future UAT coverage adds a row to the
     map, not another conditional):
     ```bash
     gh pr diff <PR> --name-only | .claude/skills/coordinate/resolve-uat-triggers.sh
     ```
     Each unique output row is `<blocking|advisory><TAB><spec>`. No output means no UAT spec
     currently covers this diff, so record `not-triggered` and continue.
  2. Run every resolved spec exactly through the live Phase-3 harness and capture its real exit:
     ```bash
     if pnpm test:uat -- "$spec"; then
       uat_exit=0
     else
       uat_exit=$?
     fi
     ```
     This is intentionally separate from the mechanical CI gate: #1027/#1000 exists because CI's
     mocked/isolated checks did not exercise the live install path that failed in #999.
  3. Apply Ben's locked #1027 policy from the lookup mode. `blocking` is a runtime-path gate:
     failure makes this verdict RED and is **never waived** — fix it, then UAT again. `advisory`
     failure is a non-blocking finding surfaced to the coordinator. Record mode, spec, and exit
     code in the verdict either way.
- `security`: run **`/security-review`** AND an **adversarial "what's NOT tested" pass** — you are
  spawned on a stronger model (Opus) precisely because same-lens review missed CRITICALs. Don't ask "does
  the gate pass"; ask **"which trust boundary is unproven, what attack path has no test, what does
  the happy-path test silently skip"** — auth bypass, RLS gaps, secret leakage, missing rate-limit,
  token/session handling, negative/authz tests absent. List concrete omissions, not vibes.

**5. Post the verdict to the PR, then report it to the coordinator.** ALWAYS `gh pr comment` first
(durable evidence that survives the coordinator's relay; mandatory for `security` tier before any
merge), then report to the coordinator by the appropriate channel, then stop.

**If invoked as a native subagent (via `Agent` tool):** your final message IS the verdict — output
the compact verdict block below as your last message with no trailing text. Do NOT call
`herdr-pane-message` (there is no coordinator pane to target).

**If invoked as a Herdr pane:** `herdr-pane-message` the compact block to the coordinator label.

```bash
gh pr comment <PR> --body "QA verdict (<tier>): <paste the block below>"
```

```
QA <slug> (<tier>) — VERDICT: GREEN | RED
gate: CI <green|red> (gh pr checks)[ — reproduced locally: VF_EXIT=<n> AUDIT_EXIT=<n> only if CI red]
e2e-uat: <not-triggered | mode spec EXIT=n[, ...]>
review: <N blocking, M non-blocking>
  - BLOCKING: <file:line — one line each, or "none">
  - non-blocking: <one line each, or "none">
invariants: <ok | which one is at risk>
exit-criteria: <met | what's missing>
not-tested (security tier): <unproven trust boundaries / missing tests, or "n/a">
MERGE-READY: YES | NO  (NO if any blocking finding, red gate, or unmet criteria)
```

**6. You will be reaped.** The coordinator kills your session after consuming the verdict. Don't
start new work, don't merge, don't touch the board — verdict only.

## Red flags — STOP

- **Re-running `pnpm verify:foundation` when CI is already green** — that's the wasted-budget
  anti-pattern. Trust `gh pr checks`; reproduce locally only when CI is red.
- Skipping a sensitive-tier spec emitted by the UAT lookup, or treating a `blocking` #1027 runtime
  failure as waivable.
- Returning "green" from a piped exit code, or (when you did reproduce) from a partial run.
- **Skipping the `gh pr comment`** — the PR verdict is mandatory (durable evidence; hard gate for
  security tier). Post it before you message the coordinator.
- **Treating a `security`-tier PR as a gate-pass check** — your job there is the adversarial
  what's-NOT-tested pass, not "CI green so ship it".
- Pasting raw logs/diffs to the coordinator — that defeats the purpose. Verdict only.
- Approving a diff that doesn't meet the spec's Exit Criteria, or that risks a Hard Invariant.
- Merging or editing code — you verify, you don't change or land anything.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Gate (trust CI) | `gh pr checks <PR>` — reproduce locally ONLY if red |
| Diff vs main | `git fetch origin main && git diff --stat origin/main...HEAD` |
| Reviews | `/code-review` (all tiers) · `/security-review` + "what's NOT tested" (security tier) |
| Post verdict to PR | `gh pr comment <PR> --body "<compact block>"` (always; mandatory for security) |
| Report verdict (native subagent) | return compact verdict block as final message (no `herdr-pane-message`) |
| Report verdict (Herdr pane) | `herdr-pane-message` → coordinator label (same compact block) |

See also: `coordinate` (who spawns + reaps you, risk tiers, model tiering), CLAUDE.md (Hard
Invariants you check against).
