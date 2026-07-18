# FIN-04 spec delta — household shared pool (#1149)

Delta to `docs/superpowers/specs/2026-07-18-finance-module-design.md` §"Household shared
pool (FIN-04, architecture level)". Everything in the epic spec stands; this document pins
the decisions that section left at architecture level, records the grounding that closed
them, and flags the one host change FIN-04 needs. Base: FIN-00's `instanceWritePolicy`
seam is SHIPPED and verified (`packages/module-sdk/src/index.ts:581` declaration,
`validate.ts` fail-closed check, `worker-rpc-host.ts` admin-bypass for policy `"module"`
with read-risk tools still blocked from all mutation).

## Manifest delta (v0.2.0 → v0.3.0)

- New storage namespace: `finance.shared` with `scopes: ["instance"]` and
  `instanceWritePolicy: "module"` — the FIN-00 D2 seam, first consumer. All other
  namespaces unchanged.
- New assistant tool `finance.account.set-shared`, `risk: "write"`, params
  `{ accountId, shared }`. Like every finance write, the web surface never calls it
  directly (D4 blocks non-read tools on the invoke route); it exists for the assistant
  surface and shares its implementation with the queue handler.
- New queue `finance.share-apply`, `retryLimit: 1`, paramsSchema
  `{ accountId: identifier, shared: boolean }` — the web twin of the tool, same
  pattern as `finance.budget-apply` (D3: all web writes ride the manual-run queue
  route; D6: metadata-only params).
- `tests/integration/external-module-finance.test.ts` asserts the FULL queue
  create/update call list with `toEqual` — add the two `finance.share-apply` entries.

## Record delta

`AccountRecord` (`external-modules/finance/src/domain/records.ts`) gains
`sharedToHousehold?: boolean`. Absent means `false` — every existing stored account is
unshared until its owner explicitly opts in (Private by default).

## Mirror contract (`finance.shared`, instance scope)

Two key kinds, both prefixed by the owning user's id (ids only in storage — display
names are never persisted):

- `{ownerUserId}:{accountId}:meta` → `SharedAccountMeta`: the subset of the owner's
  `AccountRecord` a household member needs to render the account — `accountId`,
  `ownerUserId`, `name`, `officialName`, `type`, `subtype`, `mask`, `balanceCents`,
  `isoCurrency`, `updatedAt`. No `itemId`, no item status, no Plaid identifiers beyond
  the account id the module minted.
- `{ownerUserId}:{accountId}:{YYYY-MM}` → a `TransactionChunk` projection of the
  owner's user-scoped chunk for that account/month, with `notes` STRIPPED from every
  transaction (personal annotations stay private; everything else — amounts, payees,
  dates, `categoryId`, pending state — is the data the owner chose to share).

Projection rules (binding):

- The mirror is a **projection, never a source of truth**. The owner's user-scoped
  chunks stay authoritative; the mirror is rebuilt from them and is safe to delete
  wholesale.
- Mirror writes happen ONLY from the owner's own jobs (`finance.sync-run` and
  `finance.share-apply` running with `actorUserId` = owner), through the
  `instanceWritePolicy: "module"` seam. No admin job, no other user's job, ever writes
  another owner's prefix — enforced by construction (handlers only ever write keys
  prefixed with their own `actorUserId`) and covered by unit test.
- The mirror never contains: tokens or credentials of any kind, rules, budgets
  (ledgers or state caches), link sessions, item error strings, or `notes`. A unit
  test asserts the projection strips undeclared fields (same guard posture as the
  LLM-field defense: explicit field allowlist, not field blocklist).
- Viewer-side category rendering: mirrored transactions keep the owner's `categoryId`.
  The viewer resolves it against their OWN taxonomy; the seed taxonomy ids
  (`domain/taxonomy.ts DEFAULT_CATEGORIES`) resolve for everyone, and an id the
  viewer's taxonomy doesn't know renders as uncategorized. No cross-user taxonomy
  reads.

## Share / unshare semantics

- `set-shared` (tool or queue): RMW the owner's `AccountRecord` to flip
  `sharedToHousehold`, then in the SAME handler invocation either write the account's
  full mirror (meta + every stored month) when turning ON, or delete every
  `{ownerUserId}:{accountId}:` mirror key when turning OFF. Unshare-deletes-mirror is
  verified by test (epic spec requirement).
- Both directions are idempotent SET semantics (replay at `retryLimit: 1` converges),
  matching the budget-apply replay posture.
- `finance.sync-run` mirrors shared accounts' changed months as part of the normal
  sync write path, and ends with an own-prefix reconcile: list `finance.shared`, and
  for every key under `{actorUserId}:` whose account is no longer shared (or no longer
  exists), delete it. Each owner self-heals their own prefix every sweep; no job ever
  GCs another owner's keys.

## Merged views

- `finance.accounts.list` and `finance.transactions.query` (both `risk: "read"`;
  instance-scope READS were already open to module handlers pre-FIN-00) additionally
  read `finance.shared` via `kv.list` + `kv.get`, skip keys prefixed with the actor's
  own id, and return shared entries tagged `{ ownerUserId, shared: true }`. Read tools
  cannot write (host rejects with `forbidden_kv_mutation`), so merged reads do no
  cache warming and no GC — they are pure.
- Feed UI: shared accounts appear in the account strip with an owner attribution chip;
  shared transactions carry the same attribution in the feed rows. The owner's own
  accounts gain the share/unshare control (writes via
  `runQueue("finance.share-apply", ...)` with an optimistic flip, reload-safe).
- Budgets remain strictly per-user (epic spec): shared data never enters
  `deriveBudgetMonths` inputs, the budget screen, or `state:` caches. A joint budget
  stays a named later candidate.

## Host change 1: user directory route

**Problem.** The epic spec requires "every mirrored row carries the owner's display name
— resolution client-side (ids only in storage)", but no non-admin surface can resolve
another user's name: `GET /api/admin/users` is admin-gated
(`packages/settings/src/routes.ts`), `app.users` RLS is self-row for non-admins
(migration 0047, P1 remediation #75), and `ModuleWorkerContext` exposes only
`actorUserId`. Verified alternatives all fail: admin-only resolution breaks member UX;
persisting owner labels into the mirror violates "ids only in storage" and goes stale on
rename.

**Decision.** Add `GET /api/users/directory` in `packages/settings/src/routes.ts`:
authenticated non-admin route (`resolveAccessContext` + `requireKnownUser`, the
`/api/me` idiom), returning `{ users: [{ id, name }] }` for `status === "active"` users
only. Implementation reuses `SettingsRepository.listUsers()` (the existing
`app.list_all_users()` SECURITY DEFINER helper — no migration needed; the admin gate on
the existing route was always route-level, not DB-level). Serializer emits ONLY `id` and
`name` — no emails, no admin flags, no timestamps, no status. Schema/DTO land in
`packages/shared/src/platform-api.ts` with every emitted field declared
(fast-json-stringify strips undeclared fields — that is the enforcement, not just the
trap).

**Privacy reasoning (flagged deliberately).** Migration 0047 tightened `app.users` to
stop GUC-less enumeration of full user rows including emails. This route is a narrower,
deliberate product surface: authenticated members of a self-hosted household instance
may see co-members' display names. Any household sharing UX requires exactly this (the
`app.shares` grantee picker will too), it exposes name-or-null and id only, and it keeps
the module honoring "ids only in storage". `name` may be null — the client falls back to
a neutral label, never to the email.

## Host change 2 (amendment, Task 4): host-bound actor identity at tool dispatch

**Problem (found during Task 4 grounding — corrects an assumption above).**
`ModuleWorkerContext` does NOT expose `actorUserId`: workers see only
`input/auth/fetch/kv/ai` (`packages/module-sdk/src/worker.ts`), and the worker RPC host
has no identity method. Queue jobs are fine — the host job envelope
`{ actorUserId, jobKind, idempotencyKey, params }` is built by the worker host
(`apps/worker/src/external-module-job-handler.ts`). But assistant-TOOL invocations pass
the validated caller input verbatim (`apps/api/src/external-module-tools.ts`), so the
tool paths of `finance.account.set-shared` and `finance.sync.run-now` (mirror writes)
and the merged read tools (own-prefix skip) have no way to learn whose keys are "own".

**Decision.** The API host injects the actor's identity into tool input at the single
dispatch chokepoint in `apps/api/src/external-module-tools.ts`:
`runtime.invoke(module, tool.handler, { ...toolInput, actorUserId: context.actorUserId }, rpc)`.
Handlers on both paths read the SAME top-level field: queue envelopes already carry
host-bound `actorUserId`, so `input.actorUserId` is uniform.

**Spoof resistance.** `validateToolInput` (the REST/gateway input chokepoint,
`packages/ai/src/gateway/input-validation.ts`) deliberately does not enforce
`additionalProperties`, so a caller CAN smuggle an `actorUserId` key through schema
validation. The host value is therefore spread LAST — spread order, not schema
rejection, is the binding defense, and the injection-site comment must say so. The
generic injection is safe for existing modules: finance and job-search handlers read
named keys only (`validate.ts` readers ignore unknown input keys).

**Scope note.** This supersedes "the one host delta" phrasing: FIN-04 carries two host
deltas, both small and generic (a name directory; identity plumbing every future
sharing-capable module needs). No SDK/RPC surface change — identity rides the existing
input channel, matching the queue envelope shape.

## Deleted-owner mirror keys (bounded deferral)

Instance-scope `app.module_kv` rows have `owner_user_id NULL` (the owner id lives only
in the key string), so user deletion's FK cascade purges the owner's user-scoped data
but NOT their mirror keys — and no surviving job runs as that owner to self-heal the
prefix. The module SDK explicitly defers executable purge hooks ("This slice:
cascade-only… deferred", `packages/module-sdk/src/index.ts`). FIN-04 therefore:

- **Fails closed at display:** merged reads drop mirror entries whose `ownerUserId` is
  not in the active-user directory, so a deleted (or deactivated) owner's shared data
  disappears from every member's view immediately.
- **Defers storage purge** to the SDK purge-hook seam, noted here explicitly rather
  than silently: the residue is data the owner had explicitly shared to the household,
  bounded to the mirror projection (no tokens, no notes), and invisible in the product.

## Secret hygiene (restated, binding)

Unchanged from the epic spec and FIN-01/02/03: Plaid keys are Ben's and never appear in
repo or tests; access tokens live only in the `finance.plaid-tokens` credential slot and
never in KV (including `finance.shared`), logs, job payloads, exports, or AI prompts;
error surfaces name codes only; `finance.share-apply` params are metadata-only ids; the
UAT stack never talks to Plaid and seeds no credentials.

## Testing

- Unit (TDD): projection allowlist (meta subset, `notes` stripped, forbidden namespaces
  never read by the mirror writer); share flip ON writes meta + all months; flip OFF
  deletes the full prefix; sync mirrors changed months for shared accounts and
  reconciles the own prefix; merged query tags shared rows and skips own-prefix mirror
  keys; deleted-owner entries dropped when absent from the directory; replay
  idempotence both directions.
- Integration: manifest reconcile queue list (+`finance.share-apply`); directory route
  — non-admin actor gets active users' `{ id, name }` only (assert emails absent from
  the serialized body), deactivated users excluded, unauthenticated 401.
- e2e UAT (exit criterion, issue #1149): seed the existing second loginable user
  (`UAT_SECOND_OWNER_*`, `tests/uat/seed/admin.ts`) plus finance data for the admin
  owner only. Owner signs in, shares one account through the real
  `finance.share-apply` queue (the first real `instanceWritePolicy: "module"` write),
  reload-proves the shared state; second user signs in and sees the shared account +
  owner attribution in their merged feed, and does NOT see the owner's unshared
  account or any budget data. Same D7 activation template as the FIN-02/03 specs.
