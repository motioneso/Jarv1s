# Finance module (external) — Plaid connect, envelope budgets, household reports

**Status:** Approved (Ben, in-session 2026-07-18 — approach A and the FIN-00…FIN-06 slicing)
**Grounded on:** `origin/main` @ `bbe6558f`, verified current before authoring
**Prerequisite spec:** `2026-07-18-module-runtime-write-seams.md` (FIN-00)
**Reference implementation:** the `job-search` external module (`external-modules/job-search/`)
**Issue map:** epic and per-slice `task` issues are filed on GitHub and cross-linked in the
epic body (numbers recorded there; this doc intentionally names slices, not numbers).

## Product goal

Feature parity, over time, with YNAB/Monarch for a self-hosted household: connect real bank
accounts through Plaid, browse and categorize transactions, run a zero-based envelope budget,
and see spending/cash-flow/net-worth reports — with the Jarvis differentiator that the
assistant can read (and, with confirmation, act on) the same data.

Decisions locked during brainstorming:

| Question     | Decision                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| Plaid access | Ben holds production/limited-production keys; sandbox used for dev/tests    |
| Users        | Household from day one, as an **opt-in shared pool** (per-account flag)     |
| First slice  | Connect + transaction feed (the data spine)                                 |
| Budget model | **Zero-based envelope (YNAB-style)**: assignment ledger, rollover, TBB      |
| Net worth    | Balance-snapshot net worth for all account types; **no** holdings/positions |
| AI           | AI-assisted categorization from the first feed slice; read tools per slice  |
| Distribution | External module (KV data plane now; module-owned tables when #914 ships)    |

## Non-goals (v1 of the epic)

- Plaid `/investments` holdings, positions, cost basis, performance.
- Inbound Plaid webhooks — the instance is LAN-hosted; **everything is poll-based**.
- Multi-currency budgets (single household currency assumed; transactions store ISO currency
  and non-primary currencies surface unconverted in the feed only).
- Real household entity/invites/roles; goal tracking; loan amortization; bill detection;
  CSV import (explicit later candidate, not in these slices).
- A Plaid Link embedded widget — connect uses **Hosted Link** (below), so no host CSP change.

## Slices

- **FIN-00 (platform):** worker credential write + instance-KV write policy — separate spec.
- **FIN-01 — Connect + sync spine:** manifest + worker skeleton, admin-entered Plaid
  instance credentials, Hosted Link connect flow, account inventory, scheduled cursor-based
  transaction sync into KV, daily balance snapshots. Exit: real accounts sync on schedule;
  `finance.accounts.list` assistant tool returns live balances.
- **FIN-02 — Transaction feed:** web surface (browse/filter/search), category taxonomy,
  rules + AI categorization with correction learning, recategorize/notes/pending handling.
  Exit: e2e #1000-harness UAT drives the feed against a seeded dev instance.
- **FIN-03 — Envelope budget engine:** assignment ledger, month rollover, overspend
  handling, to-be-budgeted, budget web surface, `finance.budget.status` tool.
- **FIN-04 — Household shared pool:** per-account "share to household" flag, instance-KV
  mirror, merged feed/budget-context views, unshare + purge semantics.
- **FIN-05 — Reports:** spending by category/payee over time, cash flow, net worth from
  snapshots; report web surface + read tools.
- **FIN-06 (later, gated on #914):** migrate KV chunks to module-owned tables; no product
  behavior change; KV schemas below are designed to make this a mechanical ETL.

FIN-01 and FIN-02 are specified in depth here; FIN-03…FIN-05 at architecture level (each gets
a short per-slice spec update before build if its shape shifts — same pattern job-search used).

## Module contract

- **Id:** `finance` (kebab, platform id grammar). Directory `external-modules/finance/`,
  excluded from the core image exactly like job-search (`.dockerignore`, no workspace entry,
  never in `BUILT_IN_MODULES`). Build script `build:external:finance` produces
  `package.json` + `jarvis.module.json` + `dist/worker.js` (CJS, self-contained) +
  `dist/web/index.js` (ESM, host React runtime, contract v1).
- **Auth declarations** (`kind: "api-key"`):
  - `finance.plaid-client-id` — scope `instance`, admin-entered.
  - `finance.plaid-secret` — scope `instance`, admin-entered.
  - `finance.plaid-tokens` — scope `user`, **worker-written via FIN-00**: a JSON map
    `{ [itemId]: { accessToken, institutionId } }`. One declared slot, no dynamic ids.
    Per-user job queue serializes read-modify-write (FIN-00 authoring rule).
- **fetchHosts:** `production.plaid.com`, `sandbox.plaid.com`. (Environment selection is an
  instance setting in KV, not a credential; sandbox stays declared so dev/UAT instances work
  with the same artifact.)
- **Storage namespaces** (user scope unless noted):
  `finance.connections`, `finance.accounts`, `finance.transactions`, `finance.categories`,
  `finance.rules`, `finance.budgets`, `finance.snapshots`, `finance.settings`,
  `finance.shared` (**instance** scope, `instanceWritePolicy: "module"` — FIN-00 D2).
- **Worker queues/schedules:**
  - queue `finance.sync-run` (retryLimit 3, manual run allowed) — one job per user; the job
    iterates that user's Plaid items sequentially (serialization guarantee).
  - user-scoped schedule `finance.sync-sweep`, cron `41 */6 * * *` (off-minute per fleet
    guidance) → posts **directly onto queue `finance.sync-run`** per enabled user
    (_amended 2026-07-18, D3: the reconciler registers per-user pg-boss schedules onto
    `schedule.queue`; there is no sweep handler_). `finance.sync.run-now` shares handler
    key `sync.run` with the queue.
  - queue `finance.connect-poll` (retryLimit 5, manual run allowed) — short-lived Hosted
    Link session polling (web run-now path; see Connect step 2).
  - queue `finance.categorize-apply` (retryLimit 1, manual run allowed; FIN-02) — applies a
    category change from the web feed. _Added 2026-07-18 (D4): the REST tool-invoke route
    403s all non-read tools, so the web recategorize action runs as a manual-run job with
    identifier-only params — the user's click is the confirmation (job-search run-now
    precedent). Free-text notes are assistant-only via `finance.transaction.categorize`;
    notes inside a job payload would violate the metadata-only invariant._
- **Assistant tools** (`permissionId == tool name`, job-search ruling): read-risk
  `finance.accounts.list`, `finance.transactions.query`, `finance.budget.status` (FIN-03),
  `finance.reports.spending` (FIN-05); write-risk `finance.connect.start`,
  `finance.connect.poll`, `finance.transaction.categorize`, `finance.account.set-shared`
  (FIN-04), `finance.budget.assign` (FIN-03), `finance.sync.run-now`.
- **Web:** contract v1; routes `/finance` (feed, FIN-02), `/finance/budget` (FIN-03),
  `/finance/reports` (FIN-05). `jds-*` primitives, serif/mono/sans per design system, React
  Query keys `["finance", ...]`.

## Plaid integration (FIN-01)

**Environment + credentials.** Admin enters client id/secret through the existing
module-credential settings routes (#918). All Plaid calls are `ctx.fetch` POSTs whose JSON
body carries `client_id`/`secret`/`access_token` as **body fields** (officially supported by
Plaid), base64-encoded via `bodyBase64`, read via `ctx.auth.getCredential` inside the
handler. _Amended 2026-07-18 (FIN-01 grounding, D1): the original header-based wording
(`PLAID-CLIENT-ID`/`PLAID-SECRET`) is unimplementable — the FIN-00 transport secret guard
(`worker-runtime.ts` `containsSecret`) rejects any child→host RPC whose params contain a
resolved credential as a plaintext substring, which includes fetch headers and URLs;
`bodyBase64` is the sanctioned channel._ The D6 composition guard keeps credentials out of
AI inputs, and `ctx.fetch` pins hosts.

**Connect (Hosted Link — no CSP change, no webhooks):**

1. `finance.connect.start` (write tool): `POST /link/token/create` with
   `hosted_link: {}`, `products: ["transactions"]`, `client_user_id = actorUserId`,
   `transactions.days_requested: 730`. Store `{ linkToken, createdAt }` in
   `finance.connections` under a pending key; return `hosted_link_url` for the caller to
   open in a new tab, with guidance to run `finance.connect.poll` after completing the flow.
2. `finance.connect.poll` — **single-shot**, one handler shared by the write tool
   (assistant path, inline) and queue `finance.connect-poll` (web path via manual run-now).
   It takes no params: it scans all of the actor's pending link sessions, calls
   `POST /link/token/get` for each, and returns `{ completed, pending, abandoned }` —
   "still pending" is a normal result, not an error. Re-polling is **caller-driven**
   (web re-poll interval ~30 s; assistant re-invokes). Sessions older than 30 min by their
   `createdAt` are marked `abandoned` (link tokens expire at 4 h for hosted sessions, but
   abandoned connects should not poll for hours). On success:
   `POST /item/public_token/exchange` per returned session → merge
   `{ itemId: { accessToken, institutionId } }` into the `finance.plaid-tokens` slot
   (FIN-00 `setCredential`), write item metadata to `finance.connections`, fetch
   `/accounts/get` into `finance.accounts`; the result's `nextStep` directs the caller to
   trigger `finance.sync.run-now`. _Amended 2026-07-18 (FIN-01 grounding, D2): the original
   "re-enqueue itself with backoff / enqueue an initial sync" wording is unimplementable —
   the worker context has no enqueue seam (input/auth/fetch/kv/ai only), and queue
   declarations carry no retryDelay._
3. Failure/expiry marks the pending connection `abandoned` (surfaced in UI, cleanable).

**Sync (`finance.sync-run`, per user):** for each item in the tokens map:

- `POST /accounts/balance/get` → update `finance.accounts`; once per calendar day append to
  `finance.snapshots` chunk `{accountId}:{YYYY-MM}` → `{ days: { [YYYY-MM-DD]: balanceCents } }`.
- `POST /transactions/sync` with the item's cursor from `finance.connections`, `count: 100`,
  looping `has_more` (bounded 20 pages/run; response size stays far under the fetch cap).
  Apply `added`/`modified`/`removed` through a **pure reducer** (see Testing) onto month
  chunks `finance.transactions` key `{accountId}:{YYYY-MM}`.
- Categorize new transactions (pipeline below), persist cursor **last** (at-least-once
  delivery; the reducer is idempotent by Plaid `transaction_id`).
- Per-item errors never abort the run: item status → `error` with the Plaid error code;
  `ITEM_LOGIN_REQUIRED` → status `reauth-required`, fixed by a Hosted Link **update-mode**
  connect (`link/token/create` with `access_token`), reusing the same start/poll machinery.

**Transaction record** (stored shape, designed for the FIN-06 table migration):
`{ id, accountId, date, amountCents, isoCurrency, name, merchant, plaidCategory, categoryId,
pending, pendingTransactionId, categorizedBy: "rule" | "plaid-map" | "ai" | "user", notes? }`.
Amounts are **integer cents, spending-positive** (Plaid's sign convention preserved at the
edge, converted once in the reducer). Pending→posted replacement follows
`pending_transaction_id` linkage; `removed` ids are dropped from their chunk.

## Categorization (FIN-02)

Order per new transaction; first hit wins, `categorizedBy` records provenance:

1. **User rules** (`finance.rules`): normalized-payee → categoryId, created automatically
   when the user recategorizes ("always categorize Trader Joe's as Groceries" confirm),
   editable in settings.
2. **Plaid category map:** static PFC (personal finance category) → default taxonomy mapping.
3. **`ctx.ai` batch fallback:** uncategorized remainder goes to `ai.generateStructured` in
   batches ≤ 40 with the category tree + payee/amount/date only (no notes, no account names);
   schema-constrained to known category ids; `tierHint: "economy"`. AI failure leaves
   transactions `uncategorized` — never blocks the sync (`needs_config` simply means a feed
   with uncategorized rows, consistent with the news-module posture).

Default taxonomy (`finance.categories`, seeded on first enable): YNAB-ish groups —
Fixed (rent/mortgage, utilities, insurance…), Everyday (groceries, dining, transport…),
Personal, Savings/Goals, Income, Transfers. User-editable (add/rename/archive; archived
categories keep history). Transfers between connected accounts are auto-paired by
amount/date/account heuristic and excluded from spending reports and budget activity.

## Envelope engine (FIN-03, architecture level)

KV `finance.budgets`: per month `YYYY-MM` → `{ assignments: { [categoryId]: cents } }` — an
**assignment ledger**, not computed state. Derived per category/month, always recomputed from
ledger + transaction chunks (cached in `state:{YYYY-MM}` keys, invalidated by sync/assign):
`available = Σ assignments ≤ M + Σ activity ≤ M` (cash-overspend rolls negative into next
month's TBB, YNAB semantics); `toBeBudgeted = Σ income activity − Σ assignments` across
months. Pure functions, exhaustively unit-tested; the web surface is a thin view over them.

## Household shared pool (FIN-04, architecture level)

- `finance.accounts` rows gain `sharedToHousehold: boolean` (explicit per-account opt-in by
  the owning user; write tool `finance.account.set-shared` is `risk: "write"`).
- On sync and on flag flip, shared accounts' chunks are **mirrored** into instance-scope
  `finance.shared` under owner-prefixed keys (`{ownerUserId}:{accountId}:{YYYY-MM}`), written
  from the owner's own jobs via `instanceWritePolicy: "module"` (FIN-00 D2). Mirror is a
  projection: source of truth stays the owner's user-scoped chunks.
- Merged views read own + shared-by-others; every mirrored row carries the owner's display
  name resolution client-side (ids only in storage). Unsharing deletes the mirror keys for
  that account in the same handler (verified by test); user deletion purges user KV per the
  existing lifecycle, and a reconcile step in the sync job garbage-collects orphaned mirror
  keys whose owner rows are gone.
- Budgets remain **per-user** in v1 of FIN-04; the merged surface is feed + reports context.
  A truly joint budget is a named later candidate, not silently implied.

## Reports (FIN-05, architecture level)

Pure aggregation over month chunks (+ `finance.shared` when household view is on): spending by
category/payee (month/quarter/year, category drill-down), cash flow (income vs outflow),
net worth (daily snapshot series summed across accounts, liabilities negative). App-side
iteration over bounded chunk keys — at household scale (≤ ~15 accounts × 24 months) this is
tens of KV reads per report, acceptable until FIN-06 moves it to SQL.

## Security & privacy

- Plaid secrets and access tokens live **only** in `app.module_credentials`
  (instance + user scope respectively); never in KV, logs, job payloads, exports, AI inputs
  (D6 guard covers both read and — via FIN-00 — newly written values).
- Job payloads are metadata-only: `{ actorUserId (bound by host), jobKind, idempotencyKey }` —
  item ids and cursors live in KV, transaction content never enters pg-boss.
- All user data owner-only by default (user-scoped KV under existing RLS); the **only**
  cross-user surface is the explicit per-account mirror, and the mirrored projection contains
  transaction/balance data the owner chose to share — no tokens, no rules, no budgets.
- AI categorization prompts carry payee/amount/date/category-tree only.
- Fetch surface is exactly the two declared Plaid hosts; SSRF posture inherited from
  `ctx.fetch` (host-pinned, https-only, redirect re-validation).
- Export/delete: user-scoped KV + credentials ride the existing module lifecycle (metadata-only
  for credential values); FIN-04 adds the mirror GC noted above.

## Error handling & degradation

- Sync is per-item isolated; item status (`ok` / `error:<code>` / `reauth-required`) is shown
  on the accounts surface with a reconnect action. Feed/budget/report surfaces render stale
  data with a "last synced" stamp rather than failing.
- Hosted Link polling gives up (→ `abandoned`) rather than polling forever; `run-now` retries.
- Plaid rate limits: per-run page bound + 6-hourly cadence keeps usage far under limits;
  429 responses back off the item to the next sweep.
- AI unavailable → uncategorized rows, banner on feed; rules/Plaid-map still apply.

## Testing

- **Pure domain unit tests** (mirroring `job-search/src/domain/`): sync reducer (add/modify/
  remove, pending→posted, idempotent replay, sign/cents conversion), categorization pipeline
  precedence, transfer pairing, envelope math (rollover, overspend, TBB), report aggregations,
  mirror projection + GC.
- **Worker fixture tests** (`tests/unit/external-module-finance-*.test.ts` following the
  job-search pattern): handler wiring over a scripted RPC host — connect start/poll happy path,
  token-map RMW through `setCredential`, per-item error isolation, cursor-persist-last.
- **Integration** (`tests/integration/external-module-finance.test.ts`): install/enable/hash
  fixtures; a stub Plaid server is **not** used here — Plaid calls are faked at the
  `ctx.fetch` seam with recorded sandbox response fixtures.
- **e2e UAT (#1000 harness, Ben's rule for every UI slice):** FIN-02 feed drive on a seeded
  dev instance (seeded via fixture sync data, no live Plaid); FIN-03 budget and FIN-05 report
  surfaces each add their own UAT at their slice.
- **Live sandbox smoke** (env-gated, skipped without `PLAID_SANDBOX_*` keys): full
  connect→exchange→sync loop against `sandbox.plaid.com` with Plaid's test institution —
  run manually before the first production connect, not in CI.

## Open items deliberately deferred

- Surfacing `instanceWritePolicy` in the admin enable UI (FIN-00 note).
- CSV import / manual accounts; joint budgets; goals; multi-currency conversion; investments.
- FIN-06 table migration lands only after the #914 data plane ships and gets its own spec.
