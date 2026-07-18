# FIN-01/FIN-02 Grounded Decisions (addendum to 2026-07-18-fin-01-02-plan-and-build.md)

**Read the base handoff first.** Grounding is DONE — do not re-derive; start at
`superpowers:writing-plans` and bake these decisions into the plan. Session chain:
ac6bd5fc → b6d75c0f (this doc). Tree clean @ `ae3f5c69`.

## Locked design decisions (with evidence)

- **D1 — Plaid auth goes in the JSON POST body, never headers.** The FIN-00 transport
  guard (`packages/module-registry/src/external/worker-runtime.ts` ~line 188,
  `containsSecret`) rejects any child→host RPC whose params contain a resolved credential
  as a plaintext substring — `fetch.request` headers/url included. The base64
  `bodyBase64` is the sanctioned channel; Plaid officially accepts
  `client_id`/`secret`/`access_token` as body fields. **Spec delta:** amend the spec's
  "PLAID-CLIENT-ID/PLAID-SECRET headers" wording in the plan's first task.
- **D2 — No worker-side enqueue exists.** Worker ctx = input/auth/fetch/kv/ai only.
  Adapt spec's "enqueue connect-poll / initial sync-run": `finance.connect.poll` is a
  write TOOL (assistant path, inline) sharing one handler with queue
  `finance.connect-poll` (web path via POST `/api/modules/finance/queues/<q>/run`,
  `allowManualRun`, 5s singleton — `apps/api/src/external-module-jobs.ts`). Poll takes
  no params (scans all pending link sessions for the actor). Backoff is caller-driven
  (web re-poll interval); queue declarations support only `retryLimit`/`deadLetterQueue`
  (`job-reconciler.ts:189`), no retryDelay. 30-min abandonment via `createdAt` stamp.
- **D3 — Schedules point directly at queues.** Reconciler
  (`job-reconciler.ts:126-145`) registers per-user pg-boss schedules onto
  `schedule.queue` with the job payload — no sweep handler. Declare schedule
  `finance.sync-sweep` (cron `41 */6 * * *`, scope user, queue `finance.sync-run`).
  `finance.sync.run-now` write tool shares handler `sync.run` with the queue.
  Queues/schedules need ZERO host code — fully manifest-driven.
- **D4 — REST invoke 403s all non-read tools** (`packages/ai/src/routes.ts` ~620:
  write/destructive → 403 confirmation_required + pending action). Web feed: read tools
  direct; **recategorize via a new queue `finance.categorize-apply`** (allowManualRun,
  identifier-only params; user click = confirmation — job-search run-now precedent);
  **free-text notes are assistant-only** (notes in a job payload would violate the
  metadata-only invariant). Params: ≤2 KiB, schema-validated (`module-jobs.ts`), total
  payload ≤4 KiB.
- **D5 — Token-map RMW clobber guard.** In-worker, host RPC errors are generic
  `Error("rpc_failed")` (worker-runtime collapses codes) — `credential_missing` is
  indistinguishable from transient failure. Rule: if `finance.connections` shows ≥1
  connected item but the token read fails → ABORT the run; only treat failure as
  "first connect, empty map" when no connected items exist.
- **D6 — Job invocation contract** (`apps/worker/src/external-module-job-handler.ts`):
  handler input `{actorUserId, jobKind, idempotencyKey: "<moduleId>:<jobKind>:<jobId>",
  params}`; jobs run at toolRisk **"write"** with `ai` available → categorization runs
  inside sync jobs; `setCredential` legal from queue jobs. Stale-hash/disabled rows are
  skipped silently.
- **D7 — UAT reality check (OPEN ITEM for FIN-02 planning).** `external-modules/` is
  dockerignored — the core image never ships it; job-search's UAT seed uses FAKE hashes
  so worker tools do NOT run in UAT. FIN-02's feed reads via tool invoke → needs real
  activation. Resolve during FIN-02: real install path in the UAT stack
  (`scripts/publish-module-registry.ts` + `JARVIS_MODULES_ENSURE` boot reconcile) with
  KV seeded directly via the module-KV repository, or scope the UAT to what fake-hash
  seeding can prove. Do not hand-wave this in the plan.

## KV/key design (carry into plan)

`finance.connections` (user): `link:{contentHash(linkToken)}` →
`{linkToken, hostedLinkUrl, createdAt, status}`; `item:{itemId}` →
`{itemId, institutionId, connectedAt, status: connected|reauth-required, lastSyncAt?,
lastError?}`; `cursor:{itemId}` → `{cursor}` (separate key so cursor-persist-LAST stays
an isolated write). `finance.transactions` + `finance.snapshots`: month chunks
`{accountId}:{YYYY-MM}`. `finance.rules`: key `contentHash(normalizedPayee)`.
`finance.settings` instance key `plaid` → `{environment}`, default `production`; set via
optional admin-only `environment` input on `finance.connect.start` (instance-KV default
write policy admin-gates it — rpc host has `isActorAdmin`). Declare only namespaces
FIN-01/02 use (connections, accounts, transactions, snapshots, settings, categories,
rules); budgets/shared land with FIN-03/FIN-04. Pending→posted linkage: search tx month
+ previous month chunk for the `pending_transaction_id` twin; carry user
categoryId/notes forward.

## Verified seams (don't re-check)

`ModuleFetchRequest` = `{url, method?: GET|POST, headers?, bodyBase64?}`
(`module-sdk/src/index.ts:648`); GET+body rejected. Host fetch pins to manifest
`fetchHosts`. Worker handler results are secret-scanned too (never return tokens).
FIN-00 error codes + setCredential rules: dev guide §13. Slice scopes: spec lines
41–58. House plan format: `docs/superpowers/plans/2026-07-18-fin-00-module-runtime-write-seams.md`.

## Resolved lookups (2nd pass)

- `identifier` param regex = `/^[a-z0-9][a-z0-9_.:-]{0,63}$/i`
  (`packages/module-sdk/src/module-params.ts:63`) — Plaid account/tx ids, `YYYY-MM`
  month keys, and kebab category ids all pass → FIN-02 `finance.categorize-apply`
  queue params can be plain `identifier` scalars.
- Module-KV/credential repo exports from `@jarv1s/settings`: `getModuleKvValue`,
  `setModuleKvValue`, `listModuleKvKeys`, `deleteModuleKvKey`, `upsertModuleCredential`,
  `readModuleCredentialSecret` — the seed chunk writes finance KV rows via
  `setModuleKvValue`.
- **D7 resolved:** `JARVIS_MODULE_REGISTRY_URL` is refused when
  `NODE_ENV=production` (`registry-source.ts:25`) and the UAT stack runs production →
  no mock registry. Instead: build the finance bundle
  (`pnpm build:external:finance`), `docker cp` the trust set (`jarvis.module.json` +
  `dist/**` + `sql/**`) into the UAT container's modules dir, then `restartUatStack`
  → boot reconcile (`scripts/module-reconcile.ts` phases 4 scan-disk + 6 DB-install)
  installs it with REAL hashes — registry install has no separate manual-enable step,
  so tools genuinely work. Seed finance KV data via `setModuleKvValue` in a seed
  chunk. Verify at execution time: exact in-container modules dir path
  (`resolveModulesDir`) and per-user activation (drive any user-level enable through
  the UI in the spec itself if needed).

## Next actions (unchanged from base handoff)

1. `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md`,
   self-review, prettier, commit (explicit paths).
2. `superpowers:executing-plans` inline — TDD, one commit per task, no subagent fan-out.
3. FIN-01 PR ("Part of #1144, closes #1146", stacked on #1151) → FIN-02 (+UAT) PR
   ("closes #1147"). Gate via the isolated-DB recipe in the base handoff.
