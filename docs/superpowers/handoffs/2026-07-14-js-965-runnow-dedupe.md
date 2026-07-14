# Handoff — Run-now dedupe fix (#965, Option A ONLY)

**Tier:** sensitive (host code: `packages/jobs` + `apps/api` + `module-registry`; job-send-path
change). **No migration expected.** **Model:** Codex `gpt-5.6-sol`. **Coordinator:** label
`Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f`.

**Worktree / branch:** `.claude/worktrees/js-965-runnow-dedupe` / `js-965-runnow-dedupe`
(off `origin/main` @ `e0553ed5`).

**Read first:** issue **#965** in full on GitHub — it is the Opus-adjudicated micro-design (the
approved design for this fix; the JS-06 spec set the requirement, Opus ruled the implementation).
It carries exact file:line pointers, but they were written @ `6fbeb720` and have **drifted** — you
MUST re-verify every pointer against the current tree before editing (e.g. the manual `singletonKey`
now lives at `apps/api/src/external-module-jobs.ts:~75`, not :147).

## The bug (already confirmed — do not re-litigate)

External-module job queues are created with pg-boss **STANDARD policy** (`reconcileQueue` in
`packages/module-registry/src/external/job-reconciler.ts` passes only `retryLimit`+`deadLetter`,
no `policy`). pg-boss's `singletonKey` dedupe is backed by a **policy-filtered partial unique
index** (`packages/jobs/src/pg-boss.ts`, `WHERE policy='<policy>'`), so under STANDARD there is
**no backing index → dedupe never fires**. The manual run-now path already sets a per-user
`singletonKey` (`manual:${moduleId}:${queueName}:${actorUserId}`) but a second send under STANDARD
returns a fresh UUID. Net: JS-05's merged RunNowButton "already queued" (`jobId === null`) branch is
dead in prod (no user harm today — `jobId` is always non-null).

## Fix — Option A ONLY (Opus-ruled; Option B is EXPLICITLY REJECTED)

Thread **`singletonSeconds`** through the **manual-run send path**, scoped to manual runs, retaining
the existing per-user `singletonKey`:

- `sendModuleJob` is typed `Pick<SendOptions, "singletonKey">` (in `packages/module-registry`'s
  `module-jobs.ts`) — **widen it to also accept `singletonSeconds`**.
- `singletonSeconds` uses pg-boss index **`job_i4`** (policy-INDEPENDENT) → it works under STANDARD
  **without touching queue policy**. Semantics become "already queued within N s" (a time-throttle
  anti-double-click). Pick a **small window** (a few seconds — enough to catch a double-click, not
  so long it blocks a legitimate re-run). Document the chosen window value + why in a code comment
  citing #965.
- Touch points are **two host files + the manual route**: the `packages/jobs` `SendOptions`-derived
  type, the `module-registry` `sendModuleJob` signature, and the `apps/api` manual run-now route
  that calls it.

**DO NOT do Option B** (flipping external queues to `policy=short` in the reconciler). It is wrong:
`reconcileQueue` does create-if-absent + `updateQueue` only and **cannot flip policy on
already-deployed queues** (pg-boss requires DROP+RECREATE) → silently no-ops on existing queues AND
changes semantics queue-wide for every external module. If you find yourself editing
`job-reconciler.ts` queue policy, STOP — you're on the rejected path.

## Guardrails (HARD)

- **`docs/coordination/` is coordinator-only — never edit it.**
- **No repo-wide `pnpm format` / `git add -A`** — stage explicit paths only (shared tree).
- **No migration** — this fix uses an existing pg-boss index (`job_i4`). If you think you need a
  migration or an index change, STOP and escalate to `Coordinator` — that means you're off Option A.
- **Invariants (confirm untouched):** metadata-only job payload; module isolation; owner-only RLS.
  `singletonKey` is per-user (`actorUserId` in the key) so it CANNOT dedupe across owners — preserve
  that. DataContextDb/VaultContext discipline unchanged.
- Keep the change minimal and mechanical — a typed option thread-through + a window constant.

## Exit criteria

- **The one integration test that must prove it:** two manual `POST /run` for the same
  `(module, queue, user)` within the window → first returns `202 {jobId:<uuid>}`, second returns
  `202 {jobId:null}`. That is exactly what makes RunNowButton's currently-dead branch fire. This
  test is the definition of done — write it, prove it passes.
- No cross-owner dedupe: a different `actorUserId` within the window still gets its own `jobId`
  (add/keep coverage or assert the key includes the user).
- Full local gate green: `pnpm verify:foundation` (or record exact commands + exit codes if CI is
  the gate). File-size + format:check + typecheck + lint must pass.

## Process

- STEP 1: `pnpm install`. STEP 2: read this handoff + issue #965 in full, re-verify all pointers,
  then follow the **coordinated-build** skill: **escalate your PLAN to label `Coordinator` before
  building** (sensitive lane — plan first). Tag any job-payload/RLS question `[SECURITY]`.
- Open a PR titled for #965; include the release-note-language user summary (CLAUDE.md rule): this
  fixes a real dedupe defect so it IS mildly user-facing — e.g. "Run-now on an external module now
  correctly reports 'already queued' when clicked twice in quick succession, instead of silently
  enqueuing a duplicate." Report PR # + green evidence to label `Coordinator` when done.
