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

Your entire output to the coordinator is the compact verdict in step 4. Do not paste raw logs.

## Inputs (from your handoff / bootstrap)

- The **PR branch** (and/or worktree) to verify, the **spec** it implements, and the **coordinator
  label** to report to.

## Procedure

**1. Get on the branch.** Check out the PR branch (your own worktree/checkout), `pnpm install` if
fresh. Confirm you're on the right HEAD (`git log --oneline -3`).

**2. Run the FULL gate — real exit codes.**
```bash
pnpm verify:foundation > /tmp/qa-vf.log 2>&1; echo "VF_EXIT=$?"
pnpm audit:release-hardening > /tmp/qa-audit.log 2>&1; echo "AUDIT_EXIT=$?"
```
- **Never** pipe a gate to `tail`/`grep` as the final stage — you'd capture the filter's exit code
  and mask a failure. Redirect to a file, capture `$?`, read the exit code AND the summary line.
- Run the **full** suite (a shared-table/contract change can break other modules). Re-run a known
  flake (e.g. pg-boss worker-timeout) once before calling it red — don't wave it off either.

**3. Review the diff.** Against `main`:
```bash
git fetch origin main && git diff --stat origin/main...HEAD
```
- Run **`/code-review`** (correctness + reuse/simplification) on the diff.
- Run **`security-review`** — pay special attention to CLAUDE.md Hard Invariants: no RLS bypass,
  private-by-default, DataContextDb/VaultContext only, no secrets escaping (responses/logs/job
  payloads/exports/prompts), metadata-only job payloads, provider-agnostic AI, module isolation,
  migrations (never edited; module SQL in module `sql/`; no assumed migration numbers).
- Confirm the diff actually covers the spec's **Exit Criteria**.

**4. Report the compact verdict to the coordinator** via `herdr-pane-message`, then stop:

```
QA <slug> — VERDICT: GREEN | RED
gate: VF_EXIT=<n> AUDIT_EXIT=<n> (full suite[, flake X re-run pass])
review: <N blocking, M non-blocking>
  - BLOCKING: <file:line — one line each, or "none">
  - non-blocking: <one line each, or "none">
invariants: <ok | which one is at risk>
exit-criteria: <met | what's missing>
MERGE-READY: YES | NO  (NO if any blocking finding, red gate, or unmet criteria)
```

**5. You will be reaped.** The coordinator kills your session after consuming the verdict. Don't
start new work, don't merge, don't touch the board — verdict only.

## Red flags — STOP

- Returning "green" from a piped exit code, or from a partial (single-module) run.
- Pasting raw logs/diffs to the coordinator — that defeats the purpose. Verdict only.
- Approving a diff that doesn't meet the spec's Exit Criteria, or that risks a Hard Invariant.
- Merging or editing code — you verify, you don't change or land anything.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Gate (real exit) | `pnpm verify:foundation > /tmp/qa-vf.log 2>&1; echo "EXIT=$?"` then audit |
| Diff vs main | `git fetch origin main && git diff --stat origin/main...HEAD` |
| Reviews | `/code-review` · `security-review` |
| Report verdict | `herdr-pane-message` → coordinator label (compact block above) |

See also: `coordinate` (who spawns + reaps you), CLAUDE.md (Hard Invariants you check against).
