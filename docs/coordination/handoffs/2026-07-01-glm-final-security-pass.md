# GLM Final Security Pass — PRs #654 and #655

You are an external final-review agent using opencode/GLM.

## Goal

Do one final independent pass over two security-tier PRs before merge:

- PR #654: `coord/652-perm-prompts`
- PR #655: `coord/650-sync-wedge`

If both are safe, return a compact GREEN verdict. If either has a blocker, return RED and name the blocker.

## Context

- Coordinator: Herdr pane label `Coordinator`, pane `w1:pD`.
- Repo root in normal docs should be referred to as `~/Jarv1s`.
- Do not edit code, do not merge, do not update GitHub board state.
- Use GitHub/PR data as source of truth.
- Trust CI for mechanical gates; focus on security/correctness review and missing trust-boundary coverage.

## Existing Evidence

PR #654 already has:

- CI green.
- Claude Opus security QA GREEN in PR comment: `https://github.com/motioneso/Jarv1s/pull/654#issuecomment-4849887686`.
- Scope: in-container permission prompts, fail-closed Claude PreToolUse hook, loopback `/internal/permission`, bearer token in `0600` file, no forbidden Claude flags.

Known non-blocking follow-ups from prior QA:

- Native path does not call `recordAudit`.
- Glob fast-path checks path but not pattern.
- Native action result may read as executed/approved.
- Hook self-deadline can be tuned.

PR #655 already has:

- Foundation and compose CI green; image publish may be queued/non-required depending on timing.
- Claude Opus security QA GREEN in PR comment: `https://github.com/motioneso/Jarv1s/pull/655#issuecomment-4849940726`.
- Scope: worker-owned pg-boss `supervise:true`, worker-only grants for `pgboss.queue` `UPDATE` and `pgboss.job`/`pgboss.job_common` `DELETE`, regression for stale-active singleton recovery.

Known non-blocking follow-up from prior QA:

- No negative test that app runtime is denied the new pg-boss DELETE/UPDATE grants; prior QA found boundary holds because grant file is worker-only.

## Review Checklist

For #654:

- Identity comes only from verified bearer/session token, not request body.
- Permission endpoint/hook fails closed on bad token, missing token, network failure, bad JSON, timeout, and unexpected exceptions.
- Token path is not exposed in argv/logs/frontend/reasons.
- No `--dangerously-skip-permissions` or bypass flag is introduced.
- DataContextDb / AccessContext invariants are preserved.

For #655:

- App runtime is not granted pg-boss supervisor privileges.
- Grant scope is minimal and idempotent.
- Worker supervision is enabled only in worker runtime; API remains non-supervising.
- No RLS, app schema, payload shape, route, or UI changes.
- Regression proves stale singleton recovery through the real worker role path.

## Start

1. Inspect PR states:
   - `gh pr view 654 --json state,mergeStateStatus,headRefOid,baseRefOid,statusCheckRollup,comments,url`
   - `gh pr view 655 --json state,mergeStateStatus,headRefOid,baseRefOid,statusCheckRollup,comments,url`
2. Review diffs:
   - `gh pr diff 654 --stat`
   - `gh pr diff 655 --stat`
   - Inspect changed files needed to answer the checklist.
3. Return only this compact block to the Coordinator:

```text
GLM final pass — VERDICT: GREEN | RED
#654: <one-line gate/review result>
#655: <one-line gate/review result>
blocking: <none or list>
non-blocking: <only if material and not already known>
MERGE-READY: YES | NO
```

