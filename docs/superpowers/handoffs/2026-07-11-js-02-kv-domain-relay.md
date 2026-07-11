# Relay note v3 — JS-02 owner-scoped KV domain (#931)

**You are the successor build agent.** Same worktree
`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-02-kv-domain`,
branch `feat/js-02-kv-domain`. Model: **Fable** (`claude-fable-5`) — any further relay successor
stays Fable (scoped exception to the Sonnet rule). Resume via the `coordinated-build` skill.
Plan approval ALREADY GRANTED — build immediately, no re-approval.

Plan: `docs/superpowers/plans/2026-07-11-js-02-kv-domain.md` (commit 30d131ce). **Read BY SECTION
for the current task only — never in full.** Spec:
`docs/superpowers/specs/2026-07-10-job-search-js-02-kv-domain.md`. Mission/bans/coordinator
protocol: `docs/coordination/2026-07-11-js-02-kv-domain-handoff.md` (UNTRACKED — never commit).

## Coordinator rulings (already decided — do not re-litigate)

- Purge descope: owner delete-cascade/export/disable + per-owner retention/tombstones ARE
  in-slice. ONLY the platform-side cross-owner hard-purge of `module_kv` at module
  disable/uninstall is deferred to **issue #951**. PR body must reference #951 AND add a one-line
  note in the module README/persistence doc that operator-uninstall KV purge is deferred to #951.
- Namespace: `job-search.*` (manifest) wins over the design doc's `jarv1s.job-search.*`.

## Done (committed, all green)

- Tasks 1–4: `23d23239` (envelope/caps/errors), `971e5177` (keys/hashes), `7ffd3b79`
  (onboarding), `c1293864` (profile).
- Task 5 resume repo: `8e1e0dc9`. Task 6 monitors+runs: `50cead4c`. Task 7 opportunities:
  `0a0fe5af`. Task 8 feed index: `05823c10`.
- After each: suite green + bare `pnpm check:external-modules` clean.

## Resume point: Task 9 (retention engine) — test WRITTEN, red; implement retention.ts

`tests/unit/external-module-job-search-kv-retention.test.ts` exists **uncommitted** in the tree
(8 tests, reviewed, final). It fails only because
`external-modules/job-search/src/domain/retention.ts` does not exist yet. Implement it to this
settled design (interpretation already decided — cap eviction is TOTAL-count-based, since
"non-protected > 500" breaks mixed cases like 400 saved + 200 new):

- `const DAY_MS = 86_400_000;` `RetentionReport` = `{ evicted: readonly string[];
  expiredTombstones: number; prunedRuns: number; protectedOverflow: number; targetMet: boolean }`.
- `runRetentionPass(kv: JobSearchKv, now: Date): Promise<RetentionReport>` — 7 steps in order:
  1. Evict `passed`/`stale` jobs with `statusAt <` ISO of `now − PASSED_STALE_EVICT_DAYS`.
  2. Re-list; protected = `saved`/`active`. Sort non-protected ascending `lastSeenAt`; evict
     while TOTAL remaining count > `OPPORTUNITY_TARGET`. `protectedOverflow` = protectedCount if
     protectedCount > 500 else 0.
  3. Evict helper (used by 1+2): `writeRecord` tombstone
     `{schemaVersion:1, identityHash, adapterId, expiresAt: ISO(now + TOMBSTONE_TTL_DAYS)}` at
     `keys.tombstone(hash)` **THEN** `kv.delete(keys.job(hash))`; push hash to `evicted`.
     Tombstone-first makes an interrupted pass converge on retry (test plants that intermediate
     state directly — an existing tombstone must not block re-eviction of the still-present job;
     re-writing a byte-identical tombstone is fine, just re-delete the job).
  4. Scan `tombstone/` prefix in `NS.opportunities`; delete where `expiresAt <= now` ISO; count
     as `expiredTombstones`.
  5. Group `run/<mid>/<rid>` keys in `NS.runs` by monitorId; sort each group by `startedAt`
     desc; KEEP index < `RUN_RETENTION_MAX` AND `startedAt >` ISO of `now − RUN_RETENTION_DAYS`
     (intersection); delete the rest, count `prunedRuns`. Never touch `monitor/<id>/latest`
     summaries (they summarize, not reference).
  6. `rebuildFeed(kv, now)`.
  7. `targetMet` = final total job count ≤ `OPPORTUNITY_TARGET`.
- Imports mirror `feed.ts` style: `.js` extensions, `NS` from `kv-port.js`, keys/limits/records
  helpers. No `@jarv1s/*`, no ambient time, error messages carry codes/sizes/key-names only.

Then: `pnpm vitest run tests/unit/external-module-job-search-kv-retention.test.ts` green → bare
`pnpm check:external-modules` → `pnpm prettier --write` both files → `git add` the two explicit
paths → commit `feat(job-search): retention engine with tombstones and run pruning (#931)` +
release-note body + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Remaining after Task 9 (plan sections have full detail)

- **Task 10:** `src/domain/index.ts` re-exports; `pnpm build:external:job-search` still builds;
  JS-01 suites (`external-module-job-search-{manifest,bundle,failclosed,absence}.test.ts`) still
  green. Commit.
- **Task 11 (SECURITY HEADLINE):** integration isolation suite — run
  `memory_smart_search "jarv1s integration test trap"` FIRST. Copy harness from
  `tests/integration/module-worker-rpc.test.ts`; 7 cases per plan Task 11 (userA/userB nulls,
  admin nulls + zero SQL rows, cross-owner key byte-identical, >65,536-byte INSERT hits
  `module_kv_value_size_ck`, disable/re-enable preserves, export/delete lifecycle mirroring
  `module-kv-lifecycle.test.ts`). Check `scripts/test-integration.ts` arg convention before
  running.
- **Task 12:** full `pnpm verify:foundation`; pre-push trio + `git fetch origin main && git
  rebase origin/main`; then `coordinated-wrap-up` (PR references #931 + #951 descope note +
  README/persistence-doc one-liner; user-facing release-note summary). NO board/merge — the
  coordinator owns those.

## Process rules in force

- NEVER commit `docs/coordination/2026-07-11-js-02-kv-domain-handoff.md` or stage
  `.claude/context-meter.log`. `git add` explicit paths only, never `-A`.
- Never mask exit codes (`| tail`); run gates bare. Prettier-write every new file pre-commit.
- Keys carry ids/hashes only; error messages never embed record content. No migration, no core
  table, no `@jarv1s/db`, no raw fs. JS-03 worker handlers stay stubs in this slice.
- Escalations: `herdr pane list` first, message ONLY when exactly one `Coordinator`-labeled pane;
  terse caveman comms. `herdr pane read` always `--source recent --lines 12`.
- Relay at the context-meter 70% warning or on seeing a compaction summary — after real work.
