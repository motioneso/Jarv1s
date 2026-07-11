# Relay — JS-02 owner-scoped KV domain (#931)

Successor: continue this build in THIS worktree/branch (`feat/js-02-kv-domain`). You are
**Fable** (`claude-fable-5`); any further relay successor must also be spawned
`--model claude-fable-5` (scoped exception to the Sonnet rule — see the mission handoff).

## Pointers (read these, in this order)

1. `docs/coordination/2026-07-11-js-02-kv-domain-handoff.md` — mission, bans, coordinator
   protocol. UNTRACKED — never commit it; also never stage `.claude/context-meter.log`.
2. `docs/superpowers/plans/2026-07-11-js-02-kv-domain.md` — THE PLAN (committed `30d131ce`).
   Authoritative for remaining Tasks 5–12. Read ONLY the section for your current task.
3. Spec: `docs/superpowers/specs/2026-07-10-job-search-js-02-kv-domain.md` (by section only,
   only if a plan task is unclear).

## Coordinator rulings (all gates cleared — BUILD)

- **Plan APPROVED** (2026-07-11, coordinator label `Coordinator`, session
  `58a78927-385c-4b1d-8fa0-94db20255d6f`). "Proceed to TDD build now."
- **Purge-descope fork ruled DESCOPE-OK.** Owner delete-cascade/export/disable + per-owner
  retention/tombstone ARE in-slice — ship with the adversarial owner-only RLS test. ONLY the
  platform-side cross-owner hard-purge of `module_kv` at module disable/uninstall is deferred →
  **issue #951**. PR body must reference #951 AND add a one-line note in the module
  README/persistence doc that operator-uninstall KV purge is deferred to #951.
- **Namespace ruling:** `job-search.*` (manifest) wins over the design doc's `jarv1s.job-search.*`.

## State — Tasks 1–4 of 12 done, each a green commit

- `23d23239` Task 1 foundations: `limits.ts`, `errors.ts`, `kv-port.ts`, `records.ts` +
  records tests (10) + `tests/unit/helpers/job-search-memory-kv.ts` (dump(), failAfterSets(n),
  65,536-byte set() mirror of DB check).
- `971e5177` Task 2 keys/hashes: `keys.ts` (sha256Hex32, opportunityIdentity,
  contentHash, evaluationIdentity, assertId, `keys` ABI) + tests (13).
- `7ffd3b79` Task 3 onboarding repo (unknown-key privacy guard) + tests (3).
- `c1293864` Task 4 profile repo (immutable revisions, canonicalJson no-op vs conflict,
  pointer-only approve, fail-closed dangling pointer) + tests (9).

**Resume at Task 5 (resume repo).** Then 6 monitors+runs, 7 opportunities, 8 feed,
9 retention, 10 domain index + wiring sanity, 11 isolation integration (SECURITY HEADLINE —
copy harness from `tests/integration/module-worker-rpc.test.ts`), 12 gate +
`coordinated-wrap-up` (PR refs #931 + #951 descope note; NO board/merge — coordinator owns).

## Established patterns (reuse, don't reinvent)

- All repos go through `writeRecord`/`readRecord` in `records.ts` (schemaVersion 1 + 65,535-byte
  cap). `writeRecord` is generic `<T extends object>` — interfaces lack index signatures.
- `canonicalJson` for byte-identical-content comparison (immutability no-op vs
  `immutable_revision_conflict`).
- `assertId` before key building; time-dependent fns take `now: Date` / `approvedAt: Date`
  params and store `.toISOString()` — no ambient time.
- ALL domain-internal imports use explicit `.js` extensions (root tsconfig NodeNext pulls domain
  in via tests; module tsconfig is bundler — both must resolve). Typecheck:
  `pnpm check:external-modules`.
- Tests: `pnpm vitest run tests/unit/external-module-job-search-kv-<area>.test.ts`; helpers
  `expectKvError(promise, code)` and `recordOfExactSize(bytes)` live in existing test files.
- Error messages carry codes/sizes/key-names only — NEVER record content.

## Process rules (each bit a predecessor)

- **NEVER mask exit codes with `| tail`** — a piped typecheck hid a TS error inside a commit
  chain. Run `pnpm check:external-modules` bare; check `$?`.
- `herdr pane read` must use `--source recent --lines 12` (hook blocks other forms).
- Escalate only after `herdr pane list` shows EXACTLY ONE `Coordinator`-labeled pane.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add` explicit
  paths only. Prettier-write every new file before committing.
- Relay at the context-meter 70% warning or on seeing a compaction summary; terse caveman comms
  to coordinator.
