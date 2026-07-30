# Job Search — "nothing happens when I click Start" (handoff)

**Branch** `feat/job-search` · **Commit** `43e5efc0` (no new code) · **Epic** #1280 · **Status**
CLOSED — the click works, 6/6 live, and the three-run failure was root-caused later the same day (see
"Root cause" below). Everything above that section was written while it was still open; it is kept for
the two traps in it, which recur.

## What Ben reported and where it stands

> "so... nothing happens when I click start. It says it is but doesn't."

True at the time. Three `job-search.profile-bootstrap` jobs at 02:26–02:27 reached `completed` with
**NULL output** and wrote no row, so the empty state sat on "Setting up your job search profile…"
forever. It now works and **no code changed** — `git log` and `git status` are unmoved, and neither
the API (pid start 18:53:39) nor the worker (18:53:48) restarted in between.

Proof it works now: a real browser run advanced past the empty state to the onboarding interview
("SETUP INCOMPLETE / My job search / 0 OF 5 ANSWERED"), and four direct REST enqueues produced four
non-NULL outputs and **one** profile — the fourth send correctly deduped to `jobId: null` on the
singleton key. Only console error is the pre-auth 401.

Dev is reset to zero profiles / matches / résumés, so Ben starts at "Start your job search".

## The two traps that cost the most hours

1. **A fast completion proves nothing.** A warm module child answers a full invocation *including*
   its Postgres write in **7–10 ms** (measured: 49/7/10/7 ms across four runs that each wrote a row).
   The runtime keeps one child per `(moduleId, lane)` for 60 s after idle; cold spawn is ~650 ms. Two
   hours went into "16 ms is too fast to have reached the module," which is simply false.
2. **A pg-boss job resolving to `undefined` is recorded `completed` with NULL output in
   milliseconds** — indistinguishable from real work. Empty `output` *is* the tell, but only compared
   against the same job kind.

## Eliminated with direct evidence (don't re-run these)

~~No `trust_gate_rejected` in the worker **or** the API log (level is `info`, so `warn` does
emit);~~ **← this elimination was false; see "Root cause".** The line had been emitted, into a log
file `start-worker.sh` truncates with `>` on every restart.
module `enabled` with both candidate module dirs hashing identically to the DB pin; the shipped
`dist/worker.js` carries the correct `HANDLERS` map and a bootstrap body that returns an object
unconditionally; manifest handler name matches the registry key; one worker process; one database
with the table; every timeout path *rejects* rather than resolving `undefined`; the reconciler
registers one consumer per queue signature; job payloads byte-identical across the 3 failures and the
15 successes.

`pending.resolve(message.result)` (`worker-runtime.ts:371`) is the only host path that yields
`undefined`, and it requires the child to have sent a response with the `result` key absent — which
the SDK does when a handler resolves `undefined`. No read path explains how it did.

## Next actions

1. **Ben: go e2e.** `http://100.64.98.99:5197`, sign in, open Job Search, click Start, walk the
   onboarding interview → résumé upload → search.
2. **Harden the silence** (the real deliverable from this investigation): in
   `apps/worker/src/external-module-job-handler.ts`, log a warning when `outcome.ok` is true but
   `outcome.result === undefined`. Platform-wide, no behaviour change, and it makes a recurrence
   attributable in one grep instead of a night. Do **not** throw — some handlers legitimately return
   void. Needs a gate run.
3. Consider a client-side escape hatch: after ~20 s with no profile the empty state should offer a
   retry rather than spinning forever.

## Root cause (added 2026-07-29, after the above was written)

**Four orphaned dev worker processes** (2560848, 2696229, 2933105, 2963692) holding stale discovery
hashes, racing the correct worker through `SELECT … FOR UPDATE SKIP LOCKED` and refusing the jobs
`hash-mismatch`. Their `requestId`s matched the three failing job ids 1:1. All four are dead; one
worker tree remains.

They leaked because killing `pnpm --filter @jarv1s/worker dev` by argv match kills only the wrapper —
the `sh -c tsx watch src/worker.ts` grandchild is reparented to PID 1 and keeps running forever as a
live pg-boss consumer, pinned to whatever discovery hash it booted with. `start-worker.sh` should kill
the process group instead; it still does not.

Two lessons worth more than the fix:

- **An absent log line is not evidence of an absent event when a restart script owns that file.**
  `start-worker.sh`'s `>` redirect unlinked the inode the orphans still held open, so the
  `trust_gate_rejected` lines existed only behind `/proc/<pid>/fd/1` on the still-running orphans.
  Enumerate the writers with `ps` before believing a log.
- **"One worker process" was assumed, not checked.** The check that works, and that does not self-match
  your own command line:
  `ps -eo pid,ppid,etimes,args | grep 'ts[x] watch src/worker.ts' | cut -c1-80`

Fixed in `b3ba0152`: a refused queue job now throws its typed reason, so the row lands in `failed`
with the reason in `output` and the retry gives a correctly-pinned worker a second attempt — which
would have self-healed this incident without anyone noticing it.

## Flags for Ben

1. **Confirmed platform defect, unfixed:** in `worker-runtime.ts` `run()`, `armStall()` and the hard
   timer are armed **before** `await state.ready`, so cold-spawn time is charged against the module's
   own 30 s budget.
2. **Live divergence:** the worker reads `external-modules/`, the API reads `data/modules/`. Harmless
   only while the bytes hash identically.
3. Module UI reads still pay both a 16k-char prompt-budget tax and the shared 60/min AI-tools limit
   on data that never enters a prompt. A browser-consumer data route needs its own spec.
4. ~~`codex-bootstrap` never reported.~~ It did, and it is what cracked this: it recovered the
   refusal log lines from `/proc/<pid>/fd/1` on the live orphans after the file itself was unlinked.
5. Pre-existing and unrelated: the two cluster-global finance role gate failures, and prod container
   `jarv1s-prod-jarv1s-1` holding 15.3 GB (the #1355 leak, live on `edge`).

## Environment

Dev API 3097, web 5197. Redeploy is five steps and skipping one leaves the old bundle live: build
(`pnpm build:external:job-search`) → restage → **restart the API** → **re-enable** → restart the
worker. The queue-run REST body must be `{"jobKind":"profile.bootstrap"}` and needs an `Origin`
header; the route rate-limits to 6/min. Scratchpad helpers (`repro-start.mjs`,
`hammer-bootstrap.mjs`, `hash-both-dirs.ts`) are scratchpad-only and never committed.
