# JS-04 relay 2 — continuation (mid-Task 8)

Successor: you continue js-04-source-adapters (#933) in THIS worktree, branch
`feat/js-04-source-adapters`. Plan APPROVED — build, never re-plan.

**Read first (pointers, do NOT deep-read more than named sections):**

1. `docs/superpowers/handoffs/2026-07-11-js-04-source-adapters-relay.md` — mandates, security
   tier, run bans, coordinator label/session-id, plan line map. Binding. Read in full (short).
2. Plan `docs/superpowers/plans/2026-07-11-js-04-source-adapters.md` is UNTRACKED + contains
   control bytes: read ONLY via `sed -n 'X,Yp'` per the line map (Task 9: 659–703 · Task 10:
   704–728 · Task 11: 729–741 · self-review: 742–754). Never plain grep/file/full-read.
3. `docs/coordination/2026-07-11-js-04-build-handoff.md` — coordinator handoff (read-only, NEVER
   commit it).

**Model mandate:** this lane runs `claude-fable-5`. If YOU relay, spawn successor with
`--model claude-fable-5` (overrides the sonnet default in the relay skill).

## State

- Tasks 1–5: done by predecessor (see relay.md).
- Task 6 ashby adapter: committed `7c9fbc7e`.
- Task 7 registry + barrel: committed `ec1a9b9a`.
- Task 8: **RED phase done.** Test file exists UNCOMMITTED at
  `tests/unit/external-module-job-search-adapters-fetch.test.ts` (red confirmed:
  `Cannot find module .../adapters/fetch-board.js`, exit 1). Do not rewrite it — read it, then
  implement to green.

## Task 8 next actions (design already settled — follow it)

Create `external-modules/job-search/src/adapters/fetch-board.ts`:

- `AdapterFetchResponse { status: number; bodyText: string }`;
  `AdapterFetch = (request: { url: string }) => Promise<AdapterFetchResponse>`.
- `ModuleFetchLike` — structural mirror of ctx.fetch (`packages/module-sdk/src/worker.ts:16`),
  NO sdk import (kv-port pattern): request `{ url, method?, headers? }` → response
  `{ status, headers, bodyBase64 }`.
- `fetchFromWorkerContext(moduleFetch): AdapterFetch` — decode
  `Buffer.from(bodyBase64, "base64").toString("utf8")`; ANY throw →
  `JobSearchFetchError("fetch_failed", "network request failed")` (FIXED message — upstream
  errors echo attacker URLs).
- `courtesyDue(lastCheckedAt, intervalMs, now)`: undefined → true; `Date.parse` NaN → true
  (cursor is derived state, fail open); else `now - parsed >= intervalMs`.
- `FetchBoardDeps { fetch; now(): Date; isActive?(id): boolean }` — isActive defaults to
  `(id) => getSourceAdapter(id) !== null`.
- `fetchBoard(deps, adapter, config, lastCheckedAt?)` guard order:
  1. isActive else `adapter_disabled`;
  2. courtesyDue else `courtesy_not_due`;
  3. `buildUrl` then re-assert `new URL(url).hostname ∈ adapter.fetchHosts` else `fetch_failed`
     "network request failed" (fetch never called);
  4. `deps.fetch({url})` — rethrow JobSearchFetchError, other throw → `fetch_failed` fixed msg;
  5. 404 → `board_not_found`; other non-200 → `unexpected_status` message = status number only
     (test: contains "503", never body text);
  6. `JSON.parse` fail → `malformed_payload` fixed message;
  7. `adapter.normalize` → return `{ postings, evidence }` with evidence
     `{ adapterId, host, url, httpStatus, fetchedAt: deps.now().toISOString(), postingCount,
     skippedCount }` (test asserts exact `toEqual`).

Then: add `export * from "./fetch-board.js"` to `src/adapters/index.ts`. Run the test file green
(vitest → scratchpad log + `echo "EXIT=$?"`), prettier/eslint touched files, commit
`feat(job-search): host-pinned board fetch with courtesy + SSRF adversarial coverage` — stage
ONLY: `fetch-board.ts`, `src/adapters/index.ts`, the test file. Conventional body + user-facing
summary + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

Test-file facts you'll need (already encoded in the red tests): SSRF suite drives the REAL
`createHostPinnedFetch` (relative import `packages/host-fetch/src/index.js`) with resolve/request
fakes on public IP `93.184.216.34`; module envelope mirror `moduleFetchOver` is in the test.

## Then

- Task 9 (plan 659–703): capture tools — includes mandate remainder: expose `reviewedBy` in
  sources.list output + tests (registry already exposes it: `SourceAdapterInfo.reviewedBy`).
- Task 10 (704–728): monitor.save — `monitor.run` stays JS-05 stub; ctx.kv ONLY, ZERO migrations.
- Task 11 (729–741): full gate to scratchpad with real exit codes (never `| tail`); skip
  test:integration if another session mid-build (record command+exit).
- Wrap-up via `coordinated-wrap-up`: pre-push trio + fetch/rebase origin/main, push, PR
  `Closes #933`, report terse to Coordinator (verify EXACTLY ONE `Coordinator` pane first;
  session authority `58a78927-385c-4b1d-8fa0-94db20255d6f`).

Traps: prettier may reformat test files (`--check` touched files pre-commit); `git add` explicit
paths only; never repo-wide format; never touch `docs/coordination/`; foundation.test.ts asserts
FULL migration list (we add none — keep it that way).
