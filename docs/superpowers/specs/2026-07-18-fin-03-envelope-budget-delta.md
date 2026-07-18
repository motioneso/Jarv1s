# FIN-03 spec delta — zero-based envelope budget engine (#1148)

Per-slice delta over `2026-07-18-finance-module-design.md` §"Envelope engine (FIN-03)".
The parent spec fixed the architecture (assignment ledger in `finance.budgets`, derived
state, YNAB semantics); this delta pins the concrete contracts against what FIN-01/02
actually shipped. Part of epic #1144; task issue #1148. Decisions D1–D7 from
`docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md` carry over
unchanged — in particular D3/D4 (web writes go through the queue run route only; web
invokes only read tools) and D6 (metadata-only job payloads).

## Manifest delta (`external-modules/finance/jarvis.module.json`)

- `version`: `0.1.0` → `0.2.0`.
- `storage`: add `{ "namespace": "finance.budgets", "scopes": ["user"] }` (owner-only,
  same RLS posture as every other finance namespace — budgets are never mirrored, per
  parent spec §FIN-04 "no tokens, no rules, no budgets").
- `worker.queues`: add a 4th queue —

  ```json
  {
    "name": "finance.budget-apply",
    "retryLimit": 1,
    "paramsSchema": {
      "type": "object",
      "fields": {
        "month": { "type": "identifier" },
        "categoryId": { "type": "identifier" },
        "amountCents": { "type": "integer", "min": -100000000, "max": 100000000 }
      }
    }
  }
  ```

  `amountCents` is a **user-chosen command parameter** (the new assignment total for
  that category/month), not transaction content — allowed under D6's "small command
  params" carve-out exactly like `categoryId` on `finance.categorize-apply`. The
  ±$1M cap bounds abuse; the handler re-validates. No new schedules.

- `assistantTools`: add
  - `finance.budget.status` — `risk: "read"`, input `{ month?: string }` (identifier
    `YYYY-MM`; defaults to current month server-side is NOT possible (no ambient
    dates) so the input is **required**: `{ month: string }`). Returns the derived
    month state (below).
  - `finance.budget.assign` — `risk: "write"`, input `{ month, categoryId,
amountCents }`, same bounds as the queue params. Assistant-path writes execute in
    the worker tool handler directly (the `finance.connect.start` precedent for
    `risk: "write"` tools); the **web** path never calls this tool — it enqueues
    `finance.budget-apply` via the queue run route (D3/D4 preserved). Both paths
    converge on one shared apply function.

## Storage contract (`finance.budgets`, user scope)

- `ledger:{YYYY-MM}` → `{ assignments: { [categoryId]: cents } }` — the assignment
  ledger, **source of truth**. `cents` is the assigned total for that category+month
  (assign sets, not increments — idempotent replay-safe for retryLimit 1).
- `state:{YYYY-MM}` → cached derived state, a pure function of (all ledgers ≤ M,
  all transaction chunks ≤ M):

  ```ts
  type BudgetMonthState = {
    computedAt: string; // ISO, from ctx clock — no ambient dates
    tbbCents: number;
    categories: {
      [categoryId: string]: {
        assignedCents: number;
        activityCents: number; // spending-positive
        availableCents: number;
      };
    };
  };
  ```

  Cache is a **performance projection only**: `budget.status` recomputes on miss and
  writes it; the sync handler and both apply paths delete `state:` keys for every
  month ≥ the earliest affected month (later months derive from earlier ones).
  Deleting the cache is always safe.

## Envelope math (pure, `domain/envelope.ts`)

Spending-positive cents throughout (FIN-01 record convention). For category C, month m:

- `activity(C, m)` = Σ `amountCents` of transactions in m with `categoryId === C`,
  **excluding** `categoryId === "transfers"`, **including** pending rows.
- `income(m)` = Σ `−amountCents` over transactions with `categoryId === "income"`
  (inflows are amount-negative under spending-positive).
- `carry(C, m) = max(available(C, m), 0)` — only positive balances roll forward.
- `available(C, m) = carry(C, m−1) + assigned(C, m) − activity(C, m)`.
- `overspend(m) = Σ_C min(available(C, m), 0)` (≤ 0) — cash overspend does not
  haunt the category next month; it debits TBB instead (YNAB semantics, parent spec).
- `tbb(M) = Σ_{m ≤ M} income(m) − Σ_{m ≤ M} Σ_C assigned(C, m) + Σ_{m < M} overspend(m)`.

Deliberate v1 scoping, named here so it is a decision and not an omission:
**transfer auto-pairing (amount/date/account heuristic) is deferred to FIN-05** — for
budget activity, exclusion is by the `transfers` category id (PFC map already routes
`TRANSFER_IN`/`TRANSFER_OUT` there, and rules/user recategorization can correct the
rest). The pairing heuristic lands with reports, which need it anyway, and then feeds
both surfaces. Future months with ledgers but no transactions derive normally
(activity 0); month iteration is bounded by the union of ledger keys and chunk keys.

## Worker delta

- `worker/handlers/budget.ts`: `budget.status` (read tool), `budget.assign` (write
  tool), and the `finance.budget-apply` queue handler (host job envelope — ids in
  `input.params`, the a6023cb7 lesson). Tool and queue paths share one
  `applyAssignment(ports, { month, categoryId, amountCents })` that validates month
  format + category exists + bounds, RMWs `ledger:{month}`, then invalidates
  `state:` caches ≥ month.
- `handlers/sync.ts`: after writing a month chunk, delete `state:` keys ≥ that month
  (cheap, correct; recompute happens lazily on next status read).

## Web delta

- Adopt the job-search in-module router idiom (`useModulePath`/`ModuleLink` —
  `external-modules/job-search/src/web/router.ts`); finance root grows tabs
  **Feed** (`/`) and **Budget** (`/budget`) under the host's `/m/finance/*` wildcard.
- `screens/budget.tsx`: month navigation (same idiom as the feed), TBB headline,
  category groups (taxonomy group order) with rows category / assigned (inline
  editable amount) / activity / available. Editing an assignment enqueues
  `finance.budget-apply` `{ month, categoryId, amountCents }` via the queue run
  route with an optimistic override; persistence is proven the FIN-02 way (reload
  drops the override, poll until the derived state reflects the worker's write).
  Reads go through `finance.budget.status` (read tool, D4-compliant). Amounts render
  with `font-variant-numeric: tabular-nums`; empty/negative states use existing
  authored patterns (negative available uses an existing danger token, no new CSS
  colors).

## Testing & exit criteria

- Pure unit tests for `domain/envelope.ts`: rollover carry, cash-overspend → next
  month's TBB, TBB across months, transfers excluded, pending included, income sign,
  assign-is-set-not-increment, cache-free determinism.
- Worker fixture tests (`tests/unit/external-module-finance-handlers-budget.test.ts`):
  status derive+cache write, apply via tool path, apply via queue envelope path,
  cache invalidation on sync.
- `tests/integration/external-module-finance.test.ts`: expected queue create/update
  call list gains `finance.budget-apply` (the 78a275aa trap — this test asserts the
  full list with `toEqual`).
- **e2e UAT exit criterion** (Ben's rule, #999): `tests/uat/specs/finance-budget.uat.spec.ts`
  on the same D7 docker-cp activated stack — navigate to Budget tab, assign to a
  seeded category, prove persistence through the real queue via reload-poll, and
  assert derived available/TBB math against the seeded fixture amounts. Seed chunk
  gains no credentials (unchanged secret posture); it may gain a prior-month
  assignment ledger row to prove rollover on a real instance.

## Secret hygiene (unchanged, restated for the new surfaces)

Budget data is user-scoped KV only; never mirrored, never in job payloads beyond the
three command params above, never in logs (amounts are fine in KV values, not in key
material — keys carry `YYYY-MM` only). No Plaid interaction anywhere in this slice.
