# Relay 2 — uat-harness-provisioner (#1024)

**Spec:** `docs/superpowers/specs/2026-07-12-dev-uat-harness.md` (coordinator's own worktree only,
not on this branch). **Plan:** `docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md`
(committed `754f3d0a`, amended for Coordinator conditions in `9378b3dc`).
**Branch/worktree:** `uat-harness-1024`, this worktree. Off `origin/main` @ `cdf66df0`.
**Coordinator:** Herdr label `Coordinator` — resolve pane fresh by label at read time, never a
baked `…-N`.
**Risk tier:** sensitive (dev-only privileged compose orchestration; no BYPASSRLS on runtime roles).
**Prior relay:** `docs/superpowers/handoffs/2026-07-13-uat-harness-provisioner-relay.md` (superseded
by this doc — that one covers pre-code plan-approval state, already resolved).

## State — plan APPROVED, Tasks 1-6 of 8 done and committed

Coordinator approved the plan with 2 conditions (full text in the prior relay doc, already coded):
1. TOCTOU port-bind retry — DONE, in Task 6's `main()`.
2. Port injected via existing `JARVIS_WEB_PORT` compose interpolation, no compose edits — DONE
   (confirmed zero-edit path; see prior relay doc's analysis, still valid).

Commits so far (all green, each task's own commit):
```
894093ef Task 1: run-id + reserved subnet/port constants
87a26b49 Task 2: reserved-port bind-probe (findAvailablePort)
2c3017ea Task 3: env-file writer + privileged-connection seam (JARVIS_MIGRATION_DATABASE_URL)
d92175ac Task 4: compose plan builder + volume-name derivation
6108537b Task 5: post-teardown leak verification (assertNoLeakedResources)
4fba8c00 Task 6: live provisioner runner (main()) with signal-safe teardown + TOCTOU retry
9378b3dc docs: plan-doc amendment recording the Task 2/6 condition-1 design
```

`tests/uat/provisioner.ts` now exports everything through Task 6, including `main()`, and has a
`if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) { await main(); }`
tsx entrypoint guard. `package.json` has `"uat:provision:smoke": "tsx tests/uat/provisioner.ts"`.

**Verified clean just before this relay:** `pnpm typecheck` (0 errors), `pnpm lint` (0
warnings/errors), `pnpm test:unit` (394 files / 3246 passed, 2 skipped — pre-existing skips,
unrelated to this work). Task 6 has no new unit tests by design (plan calls it an integration
entrypoint; Task 7's live run is its test).

## What's left — Tasks 7 and 8 (read plan by section, not front-to-back)

**Task 7 — live verification run.** Read the plan's Task 7 section (grep
`grep -n "^## Task 7" docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md` for the
current line number, then read that section only). Actually run
`pnpm uat:provision:smoke` (or however the plan's Task 7 steps specify) against the real
`infra/docker-compose.prod.yml`, reserved subnet `10.254.0.0/24`, ports `20000`-`20099`. Record
REAL wall-clock numbers from the `[uat] provision+teardown wall-clock: …ms` log line `main()`
already emits. Confirm `assertNoLeakedResources` passes (no leaked containers/volumes) on both a
clean run and (if the plan calls for it) a deliberately-forced port collision to prove the TOCTOU
retry path fires. **Do NOT build the template-DB-clone optimization from spec §4.5 — explicitly
deferred**, this task only measures/verifies the bare provisioner.

Docker must actually be available in this environment to run Task 7 — if `docker` isn't installed
or the daemon isn't reachable here, that's a real blocker: escalate to the `Coordinator` label
rather than skipping or faking the live run (a "trust me it works" without the real run defeats
the entire point of Task 7, and pretending unit-test-green covers it is exactly the gap
`e2e-dev-uat-for-ui-features` guidance exists to close).

**Task 8 — full gate + PR.** Read the plan's final section. Run full `pnpm verify:foundation`,
record the exit code and any output worth citing. Then invoke `coordinated-wrap-up` — open a PR
against `main` with `Part of #1000` + `Closes #1024`, a "What's new" note stating plainly this is
dev-tooling with no end-user visibility, and the Task 7 wall-clock + leak-check evidence in the PR
body. Report the PR number to the `Coordinator` Herdr pane. **Do not merge** — tier is `sensitive`;
Coordinator does QA + invariant walk first.

## Guardrails (repeat — hard, unchanged from original handoff)

- No `git add -A` / `git add .` — explicit paths only.
- Do NOT touch `docs/coordination/` (coordinator-only), do NOT run repo-wide `pnpm format`.
- No new migration; don't touch `foundation-schema-catalog`.
- Any blocker or spec-unsettled decision → escalate to `Coordinator`, don't improvise.
- **Pre-push trio before every push:** `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Generous why-comments in code citing #1024/#1000 — already the pattern used through Task 6
  (see `runCommand`/`main()` in `tests/uat/provisioner.ts` for the retry-loop comment anchor).

## Relay trigger for this handoff

Context-meter hit the 70% warning (71%) mid-Task-6, right after appending the imports for
`main()`'s dependencies. Finished Task 6 to a clean committed state (real progress past the
trigger, not a bare-plan relay) before writing this doc, per `coordinated-build`'s guidance to
relay only after real work. Successor should move straight to Task 7 — no re-planning, no
re-escalation; the plan and both Coordinator conditions are fully implemented and verified clean.
