# Handoff: Finance Epic #1144 — Plan and Build FIN-01/FIN-02

**Date:** 2026-07-18. **Mode:** autonomous (Ben: "Automate this to completion" — no approval
gates between spec, plan, and build). **Predecessor:** session ac6bd5fc (FIN-00 shipped).

## State

- You are in the harness-owned worktree `~/Jarv1s/.claude/worktrees/finance-module`,
  branch `worktree-finance-module`, base `origin/main` @ `bbe6558f`. `node_modules` is
  already installed. Never remove this worktree; never `git add -A` (explicit paths only).
- **FIN-00 (#1145) is shipped: PR #1151 is open. Do not merge it.** FIN-01/FIN-02 stack on
  this same branch; their PRs note "stacked on #1151".
- Issue map: epic #1144; FIN-01 #1146, FIN-02 #1147, FIN-03 #1148, FIN-04 #1149,
  FIN-05 #1150. FIN-06 gated on #914 (not filed).
- Durable resume memory (read it — richer detail than this doc):
  `/home/ben/.claude/projects/-home-ben-Jarv1s/memory/finance-module-epic-resume.md`

## Task

1. **Ground**, then **write the implementation plan** for FIN-01 (#1146, Plaid Hosted Link
   connect + token exchange + scheduled sync + accounts/balances) and FIN-02 (#1147,
   transaction feed UI + categorization pipeline) using the `superpowers:writing-plans`
   skill. Save to `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md`,
   run its self-review, prettier, commit.
2. **Execute the plan inline** with `superpowers:executing-plans` (no subagent fan-out —
   Ben's token-budget preference). One commit per task, TDD throughout.
3. Ship each slice as its own PR: `pnpm verify:foundation` green first (isolated-DB recipe
   below), body "Part of #1144, closes #1146" / "closes #1147", release-note summary line.
4. Continue the epic: FIN-03 → FIN-04 → FIN-05 (per-slice spec delta if shape shifted →
   plan → build → PR).

## Grounding (read before authoring the plan)

- Spec (authoritative, trust verbatim):
  `docs/superpowers/specs/2026-07-18-finance-module-design.md` — module contract, auth
  declarations, KV namespaces, queues/schedules, assistant tools, Plaid flow, transaction
  record shape, categorization precedence, testing strategy, non-goals.
- FIN-00 seams spec: `docs/superpowers/specs/2026-07-18-module-runtime-write-seams.md`;
  executed plan (shows house TDD style):
  `docs/superpowers/plans/2026-07-18-fin-00-module-runtime-write-seams.md`.
- Reference implementation `external-modules/job-search/`: `jarvis.module.json` manifest;
  `src/worker/` (index, registry, wrap, handlers/); `src/domain/` (pure modules over a
  `kv-port`); `src/web/`; build script `build:external:job-search` in root `package.json`.
- Test patterns: `tests/unit/external-module-job-search-{manifest,bundle,schedule,handlers-*,kv-*}.test.ts`;
  `tests/integration/external-module-job-search.test.ts` (+ `-acceptance`, `-kv-isolation`);
  `docs/module-developer-guide.md` §13 (includes the new setCredential/instanceWritePolicy docs).
- FIN-02 UAT: e2e #1000-harness Playwright test on a seeded dev instance is a hard exit
  criterion (Ben rule; see `tests/e2e/` harness and uat-spec-gotchas memory).

## Guardrails (verbatim, non-negotiable)

- Plaid production keys are Ben's, entered at runtime via admin settings — **never in repo
  or tests**. Tests fake Plaid at the `ctx.fetch` seam with recorded sandbox fixtures.
- Access tokens live only in `app.module_credentials` (user slot `finance.plaid-tokens`,
  JSON map, RMW serialized by the one-sync-job-per-user queue) — never in KV, logs, job
  payloads, exports, or AI prompts. Audit events metadata-only.
- Module isolation; provider-agnostic AI (`ctx.ai`, `tierHint: "economy"` for categorize);
  integer cents; metadata-only job payloads; never edit applied migrations.

## Gate recipe (verify:foundation)

Shared dev DB trips the #1082 uat-seed guard. Create a throwaway DB via a `*.tmp.mts`
script written INSIDE the worktree (bootstrap URL against the `postgres` maintenance DB),
then `JARVIS_PGDATABASE=jarvis_finNN_gate pnpm verify:foundation` as a background task
(>600s), drop the DB and delete tmp scripts after. Single integration file:
`pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts`.

## Start

1. Read the resume memory file, the finance design spec, then the job-search reference
   files listed above.
2. Invoke `superpowers:writing-plans`; author the FIN-01/FIN-02 plan; commit.
3. Invoke `superpowers:executing-plans`; build FIN-01, PR; build FIN-02 (+UAT), PR.
