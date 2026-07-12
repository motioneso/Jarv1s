# Relay — js-09-acceptance (2026-07-12, relay 2: after Task 1)

Successor: continue JS-09 acceptance harness (issue #938, epic #913). You are Fable (hard
policy: Job Search builder = Fable). Same worktree/branch: `feat/js-09-acceptance` off
`ba4ed180`. Coordinator label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f`
(resolve pane fresh by label; verify session id before anything destructive).

## State

- Plan APPROVED: `docs/superpowers/plans/2026-07-11-js-09-acceptance.md`. Read it BY TASK,
  never in full.
- Mission doc: `docs/coordination/handoff-js-09-acceptance.md` (READ ONLY — never `git add`
  it or anything under `docs/coordination/`).
- **Plan Task 1 DONE — commit `26a7ce7f`**: `tests/integration/external-module-job-search-acceptance.test.ts`
  (455 lines, 6 tests green, format/lint/typecheck clean). Suite: real-hash discovery+enable
  assert → six-checkpoint walkthrough over real RPC kv (sentinels seeded) → production
  job-handler sweep with real spawned worker (fixture at the `fetch.request` rpc seam,
  `checked:1 ran:1`) → sentinel scan with positive controls → same-day second sweep
  `{ran:0, skipped:1}` + derived-row counts unchanged → drift refusal (tampered
  `dist/worker.js`, restore in finally).
- Coordinator was told Task 1 done + relay in progress (2026-07-12 ~00:20).

## Next steps (in order)

1. **Plan Task 2** (~line 305): provider independence. Read that section, implement, commit.
2. **Plan Task 3** (~line 398): counts-only evidence renderer + CLI.
3. **Plan Task 4** (~line 509): full gate + bounded defect fixes + evidence dry-run.
4. Wrap up via `coordinated-wrap-up` (pre-push trio + `git fetch origin main && git rebase
   origin/main` before push; PR body MUST state sentinel constants + scan pattern; evidence
   destination = counts-only comment on issue #938).

## Hard-won facts (do not re-derive)

- **Run integration suites via** `pnpm tsx scripts/test-integration.ts <file>` — bare
  `pnpm vitest run` refuses the shared DB (assertIsolatedTestDatabase). Suite runs in ~5s.
- Discovery: `getExternalModuleRegistrations({modulesDir, coreVersion: "0.1.0"})` — root
  package.json 0.0.0 fails manifest compat. Entries FLAT `{id, dir, manifest, manifestHash,
  packageHash}`. `manifest.worker?.queues?.[0]` (double optional chain or typecheck fails).
- Fixture fetch seam: intercept rpc `fetch.request` → `{status, headers, bodyBase64}`.
- Sentinels: `JS09-ACCEPT-RESUME-SENTINEL-93d1c4` / `-PROFILE-` / `-QUERY-`. QUERY sentinel
  rides `companyName` of DISABLED monitor m2 (extra query keys dropped by validateConfig;
  enabled-monitor companyName legitimately becomes posting.company). Positive controls in
  resume/profile/monitors namespaces.
- Spawned worker uses REAL clock → monitor `dueTime: "00:00"`, `timezone: "UTC"`.
- agentmemory has these as `mem_mrhgqq4s_bc77eaa6a5a1` (project jarv1s).

## Approval bars + cadence (unchanged)

- (a) every cross-owner/admin denial paired with positive control, no BYPASSRLS;
  (b) sentinel scan proves no private content in payloads/logs/evidence — constants + pattern
  in PR body. Defect fix needing migration/endpoint/schema → STOP, escalate.
- Zero new migrations; explicit-path `git add` only; never board/milestones/merge; risk tier
  `security`; terse caveman comms to Coordinator; conventional prose in commits/PR.
- Meter 70% warning or compaction summary seen → message Coordinator, `relay` skill,
  successor Fable. Files < 1000 lines (check:file-size).
