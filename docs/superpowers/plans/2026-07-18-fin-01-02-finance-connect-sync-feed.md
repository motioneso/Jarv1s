# FIN-01/FIN-02 — Finance Connect, Sync & Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline
> execution was pre-decided — Ben token-budget rule, no subagent fan-out) to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship FIN-01 (issue #1146: Plaid Hosted Link connect + token exchange + scheduled
cursor sync + accounts/balances tool) and FIN-02 (issue #1147: transaction feed web surface +
categorization pipeline), each as its own PR stacked on PR #1151.

**Architecture:** New external module `external-modules/finance/` mirroring the job-search
reference: manifest-driven queues/schedules (zero host code), pure domain layer over a
user-scoped kv-port, a Plaid adapter that carries credentials **only in the JSON POST body
via `bodyBase64`** (D1 — the FIN-00 transport secret guard rejects plaintext secrets in RPC
params), worker tool/job handlers behind a `wrap` error envelope, and (FIN-02) a contract-v1
web feed using host React. Access tokens live only in the `finance.plaid-tokens` credential
slot (JSON map, RMW serialized by the one-sync-job-per-user queue, D5 clobber guard).

**Tech Stack:** TypeScript, `@jarv1s/module-sdk` worker runtime, esbuild via
`scripts/build-external-module.ts`, vitest unit + integration harness, Playwright #1000-harness
UAT, pg-boss (manifest-declared), Plaid REST API (`/link/token/*`, `/item/public_token/exchange`,
`/accounts/*`, `/transactions/sync`).

## Global Constraints

- **Secrets:** Plaid keys are Ben's, entered at runtime — never in repo or tests. Tests fake
  Plaid at the `ctx.fetch` seam with recorded sandbox-shaped fixtures. Access tokens only in
  `app.module_credentials` slot `finance.plaid-tokens` — never in KV, logs, job payloads,
  exports, or AI prompts. Never in fetch URL or headers (transport guard, D1).
- **Money:** integer cents, spending-positive; convert Plaid's float dollars once at the
  reducer edge (`Math.round(amount * 100)`).
- **AI:** provider-agnostic `ctx.ai.generateStructured`, `tierHint: "economy"`, batches ≤ 40,
  payee/amount/date only — no notes, no account names. AI failure never blocks sync.
- **Job payloads:** metadata-only (`{actorUserId, jobKind, idempotencyKey, params}` — host
  contract D6); params are identifier scalars ≤ 2 KiB.
- **Module isolation:** module code imports only `@jarv1s/module-sdk`; domain layer imports
  nothing (structural ports only, job-search precedent).
- **House rules:** why-comments citing issue/decision ids; `check:file-size` ≤ 1000 lines;
  `check:no-ambient-dates` (clock enters via `ports.now()` composition root only); prettier
  before every commit; explicit `git add <paths>` (never `-A`); one commit per task; every
  commit body carries a release-note summary line.
- **Never** edit applied migrations; never merge PR #1151; never remove this worktree.
- Spec: `docs/superpowers/specs/2026-07-18-finance-module-design.md`. Locked decisions D1–D7:
  `docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md`. Both are
  authoritative; where the spec conflicts with D1–D7, the decisions doc wins (Task 1 amends
  the spec accordingly).

---

## FIN-01 — Connect + sync spine (issue #1146)

### Task 1: Spec amendment (D1–D4 deltas)

**Files:**

- Modify: `docs/superpowers/specs/2026-07-18-finance-module-design.md`

**Interfaces:** none (docs only). Later tasks implement the amended wording.

- [ ] **Step 1: Amend the Plaid auth paragraph (spec lines ~98–101).** Replace the
      `PLAID-CLIENT-ID`/`PLAID-SECRET` **headers** wording with: all Plaid calls are
      `ctx.fetch` POSTs whose JSON body carries `client_id`/`secret`/`access_token` as
      body fields (officially supported by Plaid), base64-encoded via `bodyBase64` —
      required because the FIN-00 transport secret guard
      (`worker-runtime.ts` `containsSecret`) rejects any child→host RPC whose params contain
      a resolved credential as a plaintext substring, which includes headers and URLs.
- [ ] **Step 2: Amend the connect-poll flow (spec lines ~103–117).** Replace "re-enqueue
      itself with backoff" with the D2 design: no worker-side enqueue seam exists (worker ctx
      is input/auth/fetch/kv/ai only). `finance.connect.poll` is a single-shot write tool
      sharing one handler with queue `finance.connect-poll` (web path = manual run-now,
      caller-driven re-poll); it takes no params and scans all pending link sessions for the
      actor; "still pending" is a normal result; abandonment after 30 min via the pending
      record's `createdAt`. Same replacement for "enqueue an initial `finance.sync-run`":
      the poll handler cannot enqueue — the web/assistant caller triggers
      `finance.sync.run-now` after a successful poll (the handler's result says so).
- [ ] **Step 3: Amend the schedule wording (spec lines ~81–86).** `finance.sync-sweep` is a
      user-scoped schedule posting **directly onto** queue `finance.sync-run` (D3 — the
      reconciler registers per-user schedules onto `schedule.queue`; there is no sweep
      handler). Note `finance.sync.run-now` shares handler key `sync.run` with the queue.
- [ ] **Step 4: Add a FIN-02 web-write paragraph (after categorization section).** REST tool
      invoke 403s all non-read tools (D4), so the web recategorize action runs via a new
      manual-run queue `finance.categorize-apply` (identifier-only params; the user's click
      is the confirmation, job-search run-now precedent). Free-text notes are assistant-only
      (`finance.transaction.categorize` tool) — notes in a job payload would violate the
      metadata-only invariant.
- [ ] **Step 5: Prettier + commit**

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-07-18-finance-module-design.md
git add docs/superpowers/specs/2026-07-18-finance-module-design.md
git commit -m "docs(finance): amend spec for transport guard + platform seams (#1146)" \
  -m "Plaid auth moves to JSON body fields (FIN-00 secret guard forbids header transport); connect-poll becomes a single-shot shared handler with caller-driven re-poll; schedules post directly onto queues; web recategorize via run-now queue. Not user-visible."
```

### Task 2: Manifest, build wiring, worker skeleton

**Files:**

- Create: `external-modules/finance/jarvis.module.json`
- Create: `external-modules/finance/package.json` (mirror
  `external-modules/job-search/package.json` — name `@jarv1s-external/finance`, private,
  no deps)
- Create: `external-modules/finance/tsconfig.json` (copy job-search's)
- Create: `external-modules/finance/src/worker/index.ts`, `src/worker/registry.ts`,
  `src/worker/wrap.ts`, `src/worker/validate.ts`
- Create: `external-modules/finance/src/domain/kv-port.ts`, `src/domain/errors.ts`
- Create: `external-modules/finance/src/adapters/index.ts`, `src/adapters/types.ts`
  (port job-search's `fetchFromWorkerContext` + `JobSearchFetchError` → `FinanceFetchError`,
  same scrubbed-by-construction messages)
- Modify: `package.json` (root) — add script
  `"build:external:finance": "tsx scripts/build-external-module.ts external-modules/finance"`
- Test: `tests/unit/external-module-finance-manifest.test.ts`,
  `tests/unit/external-module-finance-bundle.test.ts`

**Interfaces:**

- Produces: `FinanceKv` (structural user-scoped kv port, exactly job-search's `JobSearchKv`
  shape), `NS` namespace map, `HANDLERS: Record<string, ToolFactory>`,
  `ToolFactory = (ports: WorkerPorts) => ToolHandler`,
  `ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>`,
  `wrap(handler)` envelope converting `FinanceKvError | FinanceFetchError | InputError` to
  `{status:"error", code, message}` and rethrowing everything else,
  `WorkerPorts = { kv: FinanceKv; fetch: FinanceFetch | null; ai: FinanceAi | null; tokens: TokensPort; settings: InstanceSettingsPort; isAdmin: boolean; now: () => Date }`
  (tokens/settings/isAdmin defined in Tasks 4–5; declare the type here, wire stubs).

Manifest (FIN-01 version — worker-only, no `web`/`navigation` yet; both are optional in
`validate.ts`):

```json
{
  "schemaVersion": 1,
  "id": "finance",
  "displayName": "Finance",
  "description": "Bank accounts, transactions, and budgets via Plaid.",
  "auth": [
    {
      "id": "finance.plaid-client-id",
      "displayName": "Plaid client id",
      "kind": "api-key",
      "scope": "instance"
    },
    {
      "id": "finance.plaid-secret",
      "displayName": "Plaid secret",
      "kind": "api-key",
      "scope": "instance"
    },
    {
      "id": "finance.plaid-tokens",
      "displayName": "Plaid access tokens",
      "kind": "api-key",
      "scope": "user"
    }
  ],
  "storage": [
    { "namespace": "finance.connections", "scopes": ["user"] },
    { "namespace": "finance.accounts", "scopes": ["user"] },
    { "namespace": "finance.transactions", "scopes": ["user"] },
    { "namespace": "finance.categories", "scopes": ["user"] },
    { "namespace": "finance.rules", "scopes": ["user"] },
    { "namespace": "finance.snapshots", "scopes": ["user"] },
    { "namespace": "finance.settings", "scopes": ["user", "instance"] }
  ],
  "runtime": { "workerEntrypoint": "dist/worker.js", "workerContractVersion": 1 },
  "assistantTools": [
    {
      "name": "finance.accounts.list",
      "permissionId": "finance.accounts.list",
      "description": "List connected bank accounts with live balances.",
      "risk": "read",
      "handler": "accounts.list"
    },
    {
      "name": "finance.connect.start",
      "permissionId": "finance.connect.start",
      "description": "Start connecting a bank via Plaid Hosted Link; returns a link URL to open.",
      "risk": "write",
      "handler": "connect.start"
    },
    {
      "name": "finance.connect.poll",
      "permissionId": "finance.connect.poll",
      "description": "Check pending bank connections and finish token exchange.",
      "risk": "write",
      "handler": "connect.poll"
    },
    {
      "name": "finance.sync.run-now",
      "permissionId": "finance.sync.run-now",
      "description": "Sync accounts and transactions from Plaid now.",
      "risk": "write",
      "handler": "sync.run"
    }
  ],
  "worker": {
    "queues": [
      {
        "name": "finance.sync-run",
        "handler": "sync.run",
        "retryLimit": 3,
        "allowManualRun": true
      },
      {
        "name": "finance.connect-poll",
        "handler": "connect.poll",
        "retryLimit": 5,
        "allowManualRun": true
      }
    ],
    "schedules": [
      {
        "id": "finance.sync-sweep",
        "cron": "41 */6 * * *",
        "scope": "user",
        "jobKind": "sync.run",
        "queue": "finance.sync-run"
      }
    ]
  },
  "fetchHosts": ["production.plaid.com", "sandbox.plaid.com"]
}
```

Before committing, diff field-by-field against `external-modules/job-search/jarvis.module.json`
for any required manifest field this omits (e.g. exact tool `inputSchema` presence, version
fields) and fix to match the validator, keeping the values above.

`finance.settings` carries `["user", "instance"]`: the instance key `plaid` →
`{ environment: "production" | "sandbox" }` (default production; admin-gated by the default
instance-KV write policy — do NOT set `instanceWritePolicy: "module"` here).

- [ ] **Step 1: Write the failing manifest test** — mirror
      `tests/unit/external-module-job-search-manifest.test.ts`: parse the JSON, run the real
      validator, assert zero errors; pin the tool-name→handler map, queue/schedule
      declarations, auth ids/scopes, all 7 namespaces, and fetchHosts.
- [ ] **Step 2: Run it, expect FAIL** (file missing):
      `pnpm exec vitest run tests/unit/external-module-finance-manifest.test.ts`
- [ ] **Step 3: Create the module skeleton.** Manifest above; `registry.ts` maps every
      handler key (`accounts.list`, `connect.start`, `connect.poll`, `sync.run`) to
      `notImplemented` factories; `index.ts` is the thin `defineModuleWorker` dispatch shell
      (copy job-search's `index.ts` structure, including the nullable-ai/fetch guards);
      `wrap.ts`/`validate.ts` ported from job-search with finance error types.
- [ ] **Step 4: Write the failing bundle test** — mirror
      `tests/unit/external-module-job-search-bundle.test.ts` (build output exists, CJS worker
      self-contained, no `@jarv1s/*` runtime imports leak).
- [ ] **Step 5: Add root `build:external:finance` script, build, run both tests → PASS.**
      `pnpm build:external:finance && pnpm exec vitest run tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts`
- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write external-modules/finance tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts package.json
git add external-modules/finance tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts package.json
git commit -m "feat(finance): module manifest, build wiring, worker skeleton (#1146)" \
  -m "New Finance module scaffold: Plaid credential slots, KV namespaces, sync queues/schedule, tool surface. Not yet user-visible."
```

### Task 3: Domain foundation — keys, records, chunk helpers

**Files:**

- Create: `external-modules/finance/src/domain/keys.ts`, `src/domain/records.ts`
- Test: `tests/unit/external-module-finance-domain.test.ts`

**Interfaces:**

- Produces (used by every later task):

```ts
// keys.ts — deterministic KV addressing (grounded-decisions "KV/key design")
export function monthKey(accountId: string, isoDate: string): string; // "acc1:2026-07" from "2026-07-18"
export function prevMonthKey(accountId: string, isoDate: string): string;
export function itemKey(itemId: string): string; // "item:{itemId}"
export function cursorKey(itemId: string): string; // "cursor:{itemId}" — isolated write so cursor-last stays atomic
export function linkKey(linkToken: string): string; // "link:{contentHash(linkToken)}" — hash so the token itself never becomes a KV key
export function contentHash(value: string): string; // fnv-1a hex, port job-search's if one exists, else 8-char impl
export function normalizePayee(name: string): string; // lowercase, strip digits/punctuation/whitespace runs — rules key
// records.ts — stored shapes (spec "Transaction record", FIN-06-migration-friendly)
export type TransactionRecord = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  isoCurrency: string;
  name: string;
  merchant: string | null;
  plaidCategory: string | null;
  categoryId: string | null;
  pending: boolean;
  pendingTransactionId: string | null;
  categorizedBy: "rule" | "plaid-map" | "ai" | "user" | null;
  notes?: string;
};
export type TransactionChunk = { transactions: TransactionRecord[] }; // sorted date desc, id asc
export type AccountRecord = {
  accountId: string;
  itemId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balanceCents: number;
  isoCurrency: string;
  updatedAt: string;
};
export type ItemRecord = {
  itemId: string;
  institutionId: string | null;
  connectedAt: string;
  status: "connected" | "reauth-required" | "error";
  lastSyncAt?: string;
  lastError?: string;
};
export type LinkSessionRecord = {
  linkToken: string;
  hostedLinkUrl: string;
  createdAt: string;
  status: "pending" | "completed" | "abandoned";
};
export type SnapshotChunk = { days: Record<string, number> }; // YYYY-MM-DD -> balanceCents
```

Note the deliberate exception: `LinkSessionRecord` stores the **link token** (short-lived,
non-secret session handle required for `/link/token/get`) — never access tokens.

- [ ] **Step 1: Write failing tests** for `monthKey`/`prevMonthKey` (December→January
      boundary), `linkKey` determinism, `normalizePayee` ("Trader Joe's #123 " →
      "trader joes"), and a record round-trip through JSON.
- [ ] **Step 2: FAIL run** → **Step 3: implement** → **Step 4: PASS run**
      (`pnpm exec vitest run tests/unit/external-module-finance-domain.test.ts`)
- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src/domain tests/unit/external-module-finance-domain.test.ts
git add external-modules/finance/src/domain tests/unit/external-module-finance-domain.test.ts
git commit -m "feat(finance): domain keys and record shapes (#1146)" \
  -m "Internal groundwork for transaction storage; not user-visible."
```

### Task 4: Plaid adapter (body-field auth per D1)

**Files:**

- Create: `external-modules/finance/src/adapters/plaid.ts`
- Test: `tests/unit/external-module-finance-plaid-adapter.test.ts`

**Interfaces:**

- Consumes: `FinanceFetch` port from Task 2 adapters (job-search shape:
  `(request: ModuleFetchRequest) => Promise<{status, bodyBase64,...}>` — copy the exact
  request/response decode from `external-modules/job-search/src/adapters/`).
- Produces:

```ts
export type PlaidEnv = "production" | "sandbox";
export type PlaidCreds = { clientId: string; secret: string };
export class PlaidError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number
  ) {}
} // message = code only, NEVER response body (secret hygiene)
export function createPlaid(fetchPort: FinanceFetch, env: PlaidEnv, creds: PlaidCreds): PlaidClient;
export interface PlaidClient {
  linkTokenCreate(input: {
    clientUserId: string;
    daysRequested: number;
    accessToken?: string;
  }): Promise<{ linkToken: string; hostedLinkUrl: string }>;
  linkTokenGet(
    linkToken: string
  ): Promise<{ status: "pending" | "success" | "expired"; publicTokens: string[] }>;
  itemPublicTokenExchange(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  accountsGet(
    accessToken: string
  ): Promise<{ institutionId: string | null; accounts: PlaidAccount[] }>;
  accountsBalanceGet(accessToken: string): Promise<{ accounts: PlaidAccount[] }>;
  transactionsSync(
    accessToken: string,
    cursor: string | null
  ): Promise<{
    added: PlaidTx[];
    modified: PlaidTx[];
    removed: { transaction_id: string }[];
    nextCursor: string;
    hasMore: boolean;
  }>; // count: 100 fixed
}
```

Core request builder — **credentials go in the JSON body, base64-masked; headers carry only
content-type** (D1, transport guard):

```ts
function request(path: string, body: Record<string, unknown>): ModuleFetchRequest {
  const payload = { client_id: creds.clientId, secret: creds.secret, ...body };
  return {
    url: `https://${env}.plaid.com${path}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    bodyBase64: Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  };
}
```

`linkTokenCreate` body: `{ user: { client_user_id }, client_name: "Jarvis", language: "en",
country_codes: ["US"], products: ["transactions"], transactions: { days_requested: 730 },
hosted_link: {} }` (+ `access_token` for update-mode reauth). `linkTokenGet` maps
`link_sessions[].results.item_add_results[].public_token` → `publicTokens`. Non-2xx →
`PlaidError(json.error_code ?? "http_" + status, status)`.

- [ ] **Step 1: Write failing tests** with a fake fetch port capturing requests + returning
      recorded sandbox-shaped fixtures (inline in the test file): (a) every method sends
      POST, correct host per env, secrets present ONLY inside decoded `bodyBase64` — assert
      `JSON.stringify({url, method, headers})` contains neither secret; (b) response
      mappings incl. hosted link URL and public-token extraction; (c) error mapping keeps
      the response body out of `PlaidError.message`.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS**
      (`pnpm exec vitest run tests/unit/external-module-finance-plaid-adapter.test.ts`)
- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src/adapters tests/unit/external-module-finance-plaid-adapter.test.ts
git add external-modules/finance/src/adapters tests/unit/external-module-finance-plaid-adapter.test.ts
git commit -m "feat(finance): Plaid adapter with body-field auth (#1146)" \
  -m "Plaid client for link/exchange/balances/transactions sync; credentials travel only in the request body per the module transport guard. Not yet user-visible."
```

### Task 5: Connect handlers (start + single-shot poll) and token RMW

**Files:**

- Create: `external-modules/finance/src/worker/auth-port.ts`,
  `src/worker/handlers/connect.ts`
- Modify: `external-modules/finance/src/worker/registry.ts` (wire `connect.start`,
  `connect.poll`), `src/worker/index.ts` (build real `WorkerPorts`: tokens/settings ports,
  `isAdmin` from ctx if exposed — check `ModuleWorkerContext` at execution; if absent, drop
  the admin-only env input and document it)
- Test: `tests/unit/external-module-finance-handlers-connect.test.ts`

**Interfaces:**

- Consumes: `PlaidClient` (Task 4), keys/records (Task 3), `FinanceKv` (Task 2).
- Produces:

```ts
// auth-port.ts — the ONLY code that touches ctx.auth. TokenMap = { [itemId]: { accessToken: string; institutionId: string | null } }
export interface TokensPort {
  read(): Promise<TokenMap | null>; // null on ANY error — worker-runtime collapses host RPC errors to generic "rpc_failed", so credential_missing is indistinguishable from transient failure (D5)
  write(map: TokenMap): Promise<void>; // JSON.stringify → ctx.auth.setCredential("finance.plaid-tokens", ...)
}
export interface InstanceSettingsPort {
  getEnvironment(): Promise<PlaidEnv>;
} // finance.settings instance key "plaid", default "production"
// handlers/connect.ts
export const connectStartHandler: ToolFactory; // input {} (optional { environment } admin-only if isAdmin available)
export const connectPollHandler: ToolFactory; // input {} — shared by tool finance.connect.poll AND queue finance.connect-poll (D2)
```

`connect.start`: resolve creds via a `CredsPort` (thin `ctx.auth.getCredential` pair — throw
`InputError("needs_config", ...)` when read fails → "admin must enter Plaid keys"), call
`linkTokenCreate`, write `LinkSessionRecord` (status pending) at `linkKey(linkToken)`,
return `{ status: "pending", hostedLinkUrl }` plus guidance text telling the caller to open
the URL and then run `finance.connect.poll`.

`connect.poll` (single-shot, no params): list `finance.connections` keys with prefix `link:`;
for each pending session: older than 30 min (`ports.now()` vs `createdAt`) → mark
`abandoned`; else `linkTokenGet` → still pending → count it; success → for each publicToken:
`itemPublicTokenExchange` → **token-map RMW with D5 guard**:

```ts
const existing = await ports.tokens.read();
const connectedItems = itemRecords.filter((r) => r.status !== "error").length;
if (existing === null && connectedItems > 0) {
  // D5: read failure with items on record could be transient — writing {} would clobber every access token. Abort.
  throw new InputError("token_read_failed", "credential read failed; retry poll");
}
await ports.tokens.write({ ...(existing ?? {}), [itemId]: { accessToken, institutionId } });
```

then `accountsGet` → write `AccountRecord`s + `ItemRecord` (status connected), mark session
`completed`. Result: `{ status, completed: n, pending: n, abandoned: n, nextStep }` where
`nextStep` tells the caller to run `finance.sync.run-now` when `completed > 0` (no worker
enqueue seam, D2).

- [ ] **Step 1: Write failing tests** (fake kv map + fake plaid + fake tokens port):
      start happy path (session stored under hashed key — raw token not a key; result carries
      URL); start without creds → `needs_config`; poll pending; poll success (token map
      merged not replaced, accounts written, session completed); poll 30-min abandonment;
      **D5 abort** (tokens.read → null while an `item:` record exists → error result, write
      never called); reauth update-mode (existing `accessToken` passed through to
      `linkTokenCreate`).
- [ ] **Step 2: FAIL** → **Step 3: implement (handlers + auth-port + index wiring)** →
      **Step 4: PASS** (`pnpm exec vitest run tests/unit/external-module-finance-handlers-connect.test.ts`)
- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src tests/unit/external-module-finance-handlers-connect.test.ts
git add external-modules/finance/src tests/unit/external-module-finance-handlers-connect.test.ts
git commit -m "feat(finance): Hosted Link connect + single-shot poll handlers (#1146)" \
  -m "Users can connect banks through Plaid Hosted Link; token exchange stores access tokens in the encrypted credential vault."
```

### Task 6: Sync engine — pure reducer + sync.run handler

**Files:**

- Create: `external-modules/finance/src/domain/reduce.ts`,
  `src/worker/handlers/sync.ts`
- Modify: `src/worker/registry.ts` (wire `sync.run`)
- Test: `tests/unit/external-module-finance-reduce.test.ts`,
  `tests/unit/external-module-finance-handlers-sync.test.ts`

**Interfaces:**

- Produces:

```ts
// reduce.ts — PURE. ChunkMap = Record<string /* monthKey */, TransactionChunk>
export function reduceSyncPage(
  chunks: ChunkMap, // only the months this page touches, caller-loaded
  page: { added: PlaidTx[]; modified: PlaidTx[]; removed: { transaction_id: string }[] },
  index: Record<string, string> // transaction_id -> monthKey, from finance.settings user key "tx-index:{itemId}"? NO — build from loaded chunks + prev-month probe (see below)
): { chunks: ChunkMap; touched: string[] };
export function toRecord(tx: PlaidTx): TransactionRecord; // sign/cents conversion happens HERE only
// handlers/sync.ts
export const syncRunHandler: ToolFactory; // shared by queue finance.sync-run + tool finance.sync.run-now (D3); categorization is a seam: categorize(records) => records, identity in FIN-01, real pipeline in FIN-02 Task 9
```

Reducer rules (spec): idempotent by `transaction_id` (re-applying a page is a no-op);
`added`/`modified` upsert into `monthKey(accountId, date)`; a posted tx with
`pending_transaction_id` removes its pending twin — search the tx's month chunk AND
`prevMonthKey` chunk (grounded doc), carrying the twin's user `categoryId`/`notes`/
`categorizedBy:"user"` forward; `removed` ids dropped from any loaded chunk; `modified` that
changes month = delete from old month + insert into new.

`sync.run` handler flow per item (items iterated sequentially — one job per user IS the
serialization): read tokens map (D5 guard exactly as Task 5 — abort run, not just item, on
null-with-connected-items); `accountsBalanceGet` → update accounts; snapshot append at
`{accountId}:{YYYY-MM}` only if `days[today]` absent (`today` from `ports.now()`);
`transactionsSync` loop `count:100` bounded 20 pages: per page load touched month chunks
(+prev month), reduce, write chunks, **persist `cursorKey(itemId)` only after its page's
chunks are written** (at-least-once + idempotent reducer); item-level `PlaidError` →
`ItemRecord.status = "error"` (+`lastError` = code), `ITEM_LOGIN_REQUIRED` →
`"reauth-required"`, and continue to the next item — never abort the run; success →
`lastSyncAt`. Result `{ status: "ok", items: [{itemId, status, added, modified, removed, pages}] }`.

- [ ] **Step 1: Failing reducer tests:** cents conversion (12.34 → 1234, sign preserved
      spending-positive), idempotent re-apply, pending→posted twin replacement carrying user
      category+notes (same-month and previous-month twin), removed, month-move on modified,
      stable sort.
- [ ] **Step 2: FAIL** → **Step 3: implement reduce.ts** → **Step 4: PASS**
      (`pnpm exec vitest run tests/unit/external-module-finance-reduce.test.ts`)
- [ ] **Step 5: Failing handler tests** (fake kv/plaid/tokens): happy multi-page run with
      cursor persisted after chunk writes (assert write ordering via a recording kv);
      snapshot written once per day (second run same day = no snapshot write); per-item
      error isolation (item A `ITEM_LOGIN_REQUIRED` → reauth-required, item B still syncs);
      D5 abort; 20-page bound.
- [ ] **Step 6: FAIL** → **Step 7: implement handlers/sync.ts + registry wiring** →
      **Step 8: PASS** (`pnpm exec vitest run tests/unit/external-module-finance-handlers-sync.test.ts`)
- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src tests/unit/external-module-finance-reduce.test.ts tests/unit/external-module-finance-handlers-sync.test.ts
git add external-modules/finance/src tests/unit/external-module-finance-reduce.test.ts tests/unit/external-module-finance-handlers-sync.test.ts
git commit -m "feat(finance): scheduled transaction sync with cursor-safe reducer (#1146)" \
  -m "Accounts, balances, daily snapshots, and transactions now sync from Plaid every 6 hours and on demand."
```

### Task 7: accounts.list read tool + full registry + integration test + FIN-01 gate/PR

**Files:**

- Create: `external-modules/finance/src/worker/handlers/accounts.ts`
- Modify: `src/worker/registry.ts` (all 4 keys real — no `notImplemented` remains)
- Test: `tests/unit/external-module-finance-handlers-accounts.test.ts`,
  `tests/integration/external-module-finance.test.ts`

**Interfaces:**

- Produces: `accountsListHandler: ToolFactory` — reads `finance.accounts` +
  `item:` records, returns `{ accounts: [{accountId, name, mask, type, subtype, balanceCents, isoCurrency, institutionId, itemStatus, updatedAt}] }`;
  empty state returns `{ accounts: [], nextStep: "connect a bank with finance.connect.start" }`.

- [ ] **Step 1: Failing unit test** (list with balances; empty state) → **Step 2: FAIL** →
      **Step 3: implement** → **Step 4: PASS**.
- [ ] **Step 5: Integration test** — mirror
      `tests/integration/external-module-job-search.test.ts`: build the bundle, install the
      trust set through the real registration path, invoke `finance.accounts.list` through
      the real worker runtime for a seeded user (KV seeded via `setModuleKvValue` from
      `@jarv1s/settings`), assert queue/schedule reconciliation registered
      `finance.sync-run`/`finance.connect-poll`/`finance.sync-sweep`. Run single-file:
      `pnpm exec tsx scripts/test-integration.ts tests/integration/external-module-finance.test.ts`
- [ ] **Step 6: Full gate (isolated DB — handoff recipe verbatim):** create throwaway DB via
      a `create-gate-db.tmp.mts` script inside the worktree (bootstrap URL against the
      `postgres` maintenance DB), then
      `JARVIS_PGDATABASE=jarvis_fin01_gate pnpm verify:foundation` as a background task
      (>600 s); drop the DB and delete tmp scripts after. Expected: exit 0.
- [ ] **Step 7: Commit, push, open PR #1146**

```bash
pnpm exec prettier --write external-modules/finance/src tests/unit/external-module-finance-handlers-accounts.test.ts tests/integration/external-module-finance.test.ts
git add external-modules/finance/src tests/unit/external-module-finance-handlers-accounts.test.ts tests/integration/external-module-finance.test.ts
git commit -m "feat(finance): accounts.list tool + module integration coverage (#1146)" \
  -m "Ask Jarvis for your account balances once a bank is connected."
git push -u origin worktree-finance-module
gh pr create --title "FIN-01: Finance module — Plaid connect + scheduled sync (#1146)" \
  --body "Part of #1144, closes #1146. Stacked on #1151 — merge that first.

**What's new:** Connect your bank through Plaid Hosted Link, and Jarvis keeps accounts, balances, and transactions synced automatically every 6 hours (or on demand). Ask for your balances with the new accounts tool.

Gate: pnpm verify:foundation exit 0 on isolated DB (jarvis_fin01_gate).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(If a PR already exists for this branch — #1151 — `gh pr create` will fail; in that case the
stack shares one branch and FIN-01 cannot be its own PR until #1151 merges. Then: comment the
FIN-01 summary on PR #1151, note "FIN-01 commits stacked here", and continue — do NOT merge
anything. Record whichever path happened in the PR/issue comments.)

---

## FIN-02 — Transaction feed + categorization (issue #1147)

### Task 8: Manifest v2 — feed tools, categorize-apply queue, web/navigation

**Files:**

- Modify: `external-modules/finance/jarvis.module.json`
- Modify: `tests/unit/external-module-finance-manifest.test.ts`
- Create: `external-modules/finance/src/web/` skeleton: `runtime.ts`, `jsx.d.ts`,
  `styles.ts` (all ported from job-search — runtime global read, `h`/`Fragment` factories),
  `index.ts` (entrypoint exporting the root per job-search's `web/index.ts` contract)
- Test: bundle test already covers `dist/web/index.js` once web entrypoint exists — extend
  `tests/unit/external-module-finance-bundle.test.ts` (no own React in bundle, ESM output)

**Interfaces:** manifest additions —

- `web`: `{ "entrypoint": "dist/web/index.js", "contractVersion": 1 }`; `navigation`: one
  entry route `/finance`, label `Finance` (copy job-search's navigation entry shape).
- assistantTools += `finance.transactions.query` (read, handler `transactions.query`),
  `finance.transaction.categorize` (write, handler `transaction.categorize`).
- worker.queues += `{ "name": "finance.categorize-apply", "handler": "categorize.apply", "retryLimit": 1, "allowManualRun": true, "paramsSchema": { "accountId": {"type":"identifier"}, "month": {"type":"identifier"}, "transactionId": {"type":"identifier"}, "categoryId": {"type":"identifier"} } }`
  — verify `paramsSchema` field shape against `ModuleParamsSchema` in
  `packages/module-sdk/src/module-params.ts` at execution and against job-search's queue
  declaration; all four are `identifier`-safe (regex verified, grounded doc).

- [ ] **Step 1: Extend manifest test** (new tools/queue/web/navigation pinned) → FAIL →
      **Step 2: manifest v2 + web skeleton + registry keys (`transactions.query`,
      `transaction.categorize`, `categorize.apply` as `notImplemented`)** → build → PASS.
- [ ] **Step 3: Commit**

```bash
pnpm exec prettier --write external-modules/finance tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts
git add external-modules/finance tests/unit/external-module-finance-manifest.test.ts tests/unit/external-module-finance-bundle.test.ts
git commit -m "feat(finance): manifest v2 — feed tools, categorize queue, web surface (#1147)" \
  -m "Declares the transaction feed page and categorization actions; UI lands next. Not yet user-visible."
```

### Task 9: Categorization pipeline (rules → PFC map → AI) + default taxonomy

**Files:**

- Create: `external-modules/finance/src/domain/taxonomy.ts`, `src/domain/categorize.ts`,
  `src/worker/ai-port.ts` (port job-search's `ai-port.ts` structural read of
  `ctx.ai.generateStructured`)
- Test: `tests/unit/external-module-finance-categorize.test.ts`

**Interfaces:**

- Produces:

```ts
// taxonomy.ts
export const DEFAULT_CATEGORIES: readonly Category[]; // Category = { id, group, name, archived: false }
// groups: fixed (rent-mortgage, utilities, insurance, subscriptions), everyday (groceries, dining, transport, shopping, fuel),
// personal (entertainment, health, personal-care, travel), savings-goals (savings), income (income), transfers (transfers)
export const PFC_MAP: Readonly<Record<string, string>>; // Plaid personal_finance_category.primary -> categoryId
// e.g. FOOD_AND_DRINK->dining, GENERAL_MERCHANDISE->shopping, RENT_AND_UTILITIES->utilities, TRANSPORTATION->transport,
// TRAVEL->travel, MEDICAL->health, ENTERTAINMENT->entertainment, INCOME->income, TRANSFER_IN/TRANSFER_OUT->transfers,
// LOAN_PAYMENTS->rent-mortgage, BANK_FEES->subscriptions, PERSONAL_CARE->personal-care, GENERAL_SERVICES->subscriptions,
// GOVERNMENT_AND_NON_PROFIT->subscriptions, HOME_IMPROVEMENT->shopping
// categorize.ts — PURE apart from the injected ai callback
export type Rule = { payeeKey: string; categoryId: string; createdAt: string };
export function categorize(
  records: TransactionRecord[],
  rules: Rule[],
  categories: Category[],
  ai: null | ((batch: AiTxInput[], categoryIds: string[]) => Promise<Record<string, string>>) // txId->categoryId, schema-constrained by caller
): Promise<TransactionRecord[]>;
// precedence per record with categoryId===null: rule match on normalizePayee(name) -> "rule";
// else PFC_MAP[plaidCategory] -> "plaid-map"; else collect for AI batches (<=40, payee/amount/date ONLY);
// ai null/throw/unknown-id -> leave uncategorized (never blocks sync)
```

- [ ] **Step 1: Failing tests:** precedence order (rule beats PFC beats AI); user-categorized
      records untouched; batch chunking at 40 with only payee/amount/date in the AI input
      (assert via captured input); AI failure → uncategorized, others still applied; unknown
      category id from AI dropped; taxonomy seed contains every PFC_MAP target id.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS**
      (`pnpm exec vitest run tests/unit/external-module-finance-categorize.test.ts`)
- [ ] **Step 5: Wire into sync (replace Task 6's identity seam):** in `handlers/sync.ts`,
      after reducing each item's pages: load rules + categories (seed `DEFAULT_CATEGORIES`
      into `finance.categories` on first read — key `taxonomy`), run `categorize` over
      newly-added records with the real `ctx.ai` port (`tierHint: "economy"`), write chunks.
      Extend a sync handler test: new tx gets PFC category; ai-null leaves uncategorized.
- [ ] **Step 6: PASS both test files** → **Step 7: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src tests/unit/external-module-finance-categorize.test.ts tests/unit/external-module-finance-handlers-sync.test.ts
git add external-modules/finance/src tests/unit/external-module-finance-categorize.test.ts tests/unit/external-module-finance-handlers-sync.test.ts
git commit -m "feat(finance): rules + Plaid-map + AI categorization pipeline (#1147)" \
  -m "New transactions are auto-categorized: your rules first, then Plaid's category, then a light AI pass."
```

### Task 10: Feed handlers — transactions.query, categorize tool, categorize-apply job

**Files:**

- Create: `external-modules/finance/src/worker/handlers/feed.ts`
- Modify: `src/worker/registry.ts` (wire the three keys)
- Test: `tests/unit/external-module-finance-handlers-feed.test.ts`

**Interfaces:**

- Produces:

```ts
export const transactionsQueryHandler: ToolFactory;
// input { month?: "YYYY-MM", accountId?, categoryId?, search?, pendingOnly?, limit? (default 50, max 200) }
// default month = current (ports.now()); loads month chunks across accounts (or one), filters,
// returns { transactions: TransactionRecord[], categories: Category[], accounts: AccountSummary[] } for one-call feed rendering
export const transactionCategorizeHandler: ToolFactory; // assistant path
// input { transactionId, accountId, month, categoryId, createRule?: boolean, notes?: string }
// sets categoryId + categorizedBy:"user" (+notes); createRule -> upsert finance.rules at contentHash(normalizePayee(name))
export const categorizeApplyHandler: ToolFactory; // queue finance.categorize-apply (web path, D4)
// input = the four identifier params; same category-set logic, NO notes/createRule (metadata-only payload)
// both share one applyCategory(ports, {transactionId, accountId, month, categoryId}) helper; unknown tx/category -> InputError("not_found"/"invalid_category")
```

- [ ] **Step 1: Failing tests:** query filters (month default via now, category, search on
      name/merchant, pending, limit cap); categorize sets provenance `user` and persists;
      createRule writes the rule (then a later `categorize` run applies it — assert via
      pipeline call); categorize-apply job path rejects unknown ids; notes only on the
      assistant tool.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS**
      (`pnpm exec vitest run tests/unit/external-module-finance-handlers-feed.test.ts`)
- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src tests/unit/external-module-finance-handlers-feed.test.ts
git add external-modules/finance/src tests/unit/external-module-finance-handlers-feed.test.ts
git commit -m "feat(finance): transaction query + recategorize handlers (#1147)" \
  -m "Browse and search transactions, fix a category (optionally as an always-rule), and add notes via the assistant."
```

### Task 11: Web feed surface

**Files:**

- Create: `external-modules/finance/src/web/api.ts` (port job-search's `invokeTool` +
  `ToolOutcome`; add `runQueue(name, params)` posting
  `/api/modules/finance/queues/<name>/run` — verify the exact route in
  `apps/api/src/external-module-jobs.ts` at execution), `src/web/store.ts`,
  `src/web/format.ts` (cents → `$1,234.56`, date grouping), `src/web/root.tsx`,
  `src/web/screens/feed.tsx`, `src/web/states.tsx` (loading/empty/error/disabled — port
  job-search's authored states)
- Test: extend `tests/unit/external-module-finance-bundle.test.ts` (web bundle builds,
  no own React)

**Interfaces:**

- Consumes: `finance.transactions.query` + `finance.accounts.list` (read invoke);
  `finance.categorize-apply` + `finance.connect-poll` + `finance.sync-run` via `runQueue`.
- Feed screen: month picker (prev/next), account + category filter chips, search box,
  grouped-by-date rows (name, merchant, category chip, amount right-aligned mono,
  pending badge), recategorize via category select → `runQueue("finance.categorize-apply", ...)`
  → optimistic update + refetch after ~2 s. Header: balance summary from accounts.list,
  "Sync now" button (`finance.sync-run` run-now), connection status pills; a pending link
  session shows "Finish connecting" → `runQueue("finance.connect-poll", {})` with
  caller-driven re-poll (30 s interval, stop at completed/abandoned — D2). Empty state:
  "Connect a bank" instructions pointing at the assistant connect flow. **Design system:**
  `jds-*` primitives, serif headings/mono eyebrows/sans body, raw colors only from
  `tokens.css` vars, authored empty/loading states — no new CSS colors.

- [ ] **Step 1:** Build the screens (this is UI composition over already-tested handlers —
      test coverage is the bundle test + Task 12 UAT; job-search precedent has no web unit
      tests). `pnpm build:external:finance` clean; bundle test PASS.
- [ ] **Step 2: Commit**

```bash
pnpm exec prettier --write external-modules/finance/src/web tests/unit/external-module-finance-bundle.test.ts
git add external-modules/finance/src/web tests/unit/external-module-finance-bundle.test.ts
git commit -m "feat(finance): transaction feed web surface (#1147)" \
  -m "New Finance page: browse, search, and filter synced transactions, fix categories inline, and trigger a sync."
```

### Task 12: UAT — #1000-harness e2e on a real activated module (D7)

**Files:**

- Create: `tests/uat/finance-feed.uat.test.ts` (match the existing harness naming — check
  `tests/uat/*.test.ts` siblings at execution), plus a finance seed chunk in the harness's
  seed layout (mirror how job-search/UAT seeds module KV — but with REAL module activation).

**Activation recipe (D7 — `JARVIS_MODULE_REGISTRY_URL` is refused under
`NODE_ENV=production`, so no mock registry):**

1. `pnpm build:external:finance`.
2. Provision the UAT stack; `docker cp` the trust set (`jarvis.module.json`, `dist/**`,
   `sql/**` if present, module `package.json`) into the container's modules dir (resolve the
   exact in-container path from `resolveModulesDir` at execution — the `jarv1s-modules`
   volume).
3. `restartUatStack` → boot reconcile phases 4 (scan-disk) + 6 (DB-install) install it with
   real hashes → worker tools genuinely execute.
4. Seed: user + `setModuleKvValue` rows for `finance.accounts`, `finance.transactions`
   (one month chunk, a few records incl. one uncategorized), `finance.categories` taxonomy,
   an `item:` record. No credentials seeded — the UAT never talks to Plaid.

**Spec assertions:** /finance renders seeded transactions with balances header; month filter
narrows rows; search narrows rows; recategorize a row → categorize-apply job runs → chip
updates after refetch; empty-month state renders the authored empty state. Remember the
uat-spec-gotchas memory: seeded owner lands on onboarding (Skip setup → Skip anyway);
`getByLabel` needs `{exact:true}`; on failure read `error-context.md`.

- [ ] **Step 1: Write the spec + seed, run it against a provisioned UAT stack, iterate to
      green.** Run command: match the existing `test:uat-*` script family in `package.json`.
- [ ] **Step 2: Commit**

```bash
pnpm exec prettier --write tests/uat/finance-feed.uat.test.ts
git add tests/uat/finance-feed.uat.test.ts
git commit -m "test(finance): e2e UAT for the transaction feed on a real activated module (#1147)" \
  -m "Verifies the Finance feed end-to-end in a production-shaped stack. Not user-visible."
```

(Also `git add` whatever seed/harness files the chunk required — explicit paths.)

### Task 13: FIN-02 gate + PR

- [ ] **Step 1: Full gate** — isolated-DB recipe as Task 7 Step 6, DB `jarvis_fin02_gate`,
      exit 0 required (includes the finance unit/integration suites).
- [ ] **Step 2: Push + PR**

```bash
git push
gh pr create --title "FIN-02: Finance transaction feed + categorization (#1147)" \
  --body "Part of #1144, closes #1147. Stacked on #1151 and FIN-01 (#1146).

**What's new:** A new Finance page shows your synced transactions — browse by month, search, filter by account or category, and fix categories inline (optionally as an always-rule via the assistant). New transactions are auto-categorized by your rules, Plaid's category, then a light AI pass.

Gate: pnpm verify:foundation exit 0 on isolated DB (jarvis_fin02_gate); UAT finance-feed spec green on a real activated module.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(Same single-branch caveat as Task 7 — if `gh pr create` refuses because the branch already
has an open PR, comment the FIN-02 summary there instead and note it on issue #1147.)

---

## Self-Review Notes

- **Spec coverage:** module contract → Task 2/8; Plaid integration → Tasks 4–6; transaction
  record/reducer → Tasks 3/6; categorization + taxonomy + rules → Tasks 9–10; web feed →
  Task 11; UAT exit criterion → Task 12; spec deltas D1–D4 → Task 1. FIN-03…05 explicitly
  out of scope (own slices). Budgets/shared namespaces deliberately undeclared until their
  slices.
- **Known execution-time verifications** (flagged inline, not placeholders — environment
  facts): manifest required-field diff vs job-search (Task 2), `isAdmin` availability on
  worker ctx (Task 5), queue `paramsSchema` field shape (Task 8), run-now route path
  (Task 11), UAT harness naming + in-container modules dir (Task 12), single-branch PR
  stacking behavior (Tasks 7/13).
- **Type consistency check:** `ToolFactory`/`WorkerPorts` defined Task 2, consumed 5–10;
  `TokensPort.read(): TokenMap | null` consistent Tasks 5/6; `monthKey`/`cursorKey` naming
  consistent Tasks 3/6/10; `categorize` signature consistent Tasks 9 (def) and 6/10 (use).
- **Secret hygiene walked:** secrets appear only in `bodyBase64` (Task 4 asserts), token map
  only via `TokensPort` (Task 5), `PlaidError.message` = code only, job params identifier-only
  (Task 8), notes never in job payloads (Task 10), UAT seeds no credentials (Task 12).
