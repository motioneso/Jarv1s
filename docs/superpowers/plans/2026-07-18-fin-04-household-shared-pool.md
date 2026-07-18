# FIN-04 implementation plan — household shared pool (#1149)

Executes `docs/superpowers/specs/2026-07-18-fin-04-household-shared-pool-delta.md`
(committed 94cfda33) on branch `worktree-finance-module`. Same execution rules as the
FIN-01/02/03 plans: TDD, one commit per task with the verbatim message below, explicit
`git add <paths>` never `-A`, prettier before every commit, no subagent fan-out.
Single-branch caveat: PR #1151 owns the branch — Task 7 comments the summary there
instead of opening a PR.

Standing traps (verified this epic, do not re-learn):

- Queue handlers receive the host job envelope — command fields live in
  `input.params`, never flat (a6023cb7).
- `tests/integration/external-module-finance.test.ts` asserts the FULL queue
  create/update call list with `toEqual` — the share-apply queue adds 2 entries.
- Read-risk tools cannot mutate KV (`forbidden_kv_mutation`) — merged reads must be
  pure; no cache warming, no GC-on-read.
- fast-json-stringify strips undeclared response fields — the directory route schema
  declares exactly `{ users: [{ id, name }] }` and that IS the redaction enforcement;
  the integration test asserts emails absent from the serialized body.
- Prettier oscillates on markdown bullets whose inline code spans wrap — keep code
  spans single-line in docs.
- UAT: host-code (`packages/*`, `apps/*`) changes require a full image rebuild — Task
  2 touches `packages/settings` + `packages/shared`, so the FIN-04 UAT CANNOT use
  `JARVIS_UAT_BUILD=0`. Detached run + self-excluding pgrep wait; afterEach
  diagnostics verbatim from the FIN-03 spec.

### Task 1: mirror projection domain (TDD)

- [ ] **Red:** `tests/unit/external-module-finance-shared.test.ts` — projection
      cases from the delta: `toSharedAccountMeta` emits exactly the allowlisted
      subset (no `itemId`, no status); `toSharedChunk` strips `notes` from every
      transaction and keeps amounts/payees/dates/categoryId/pending; allowlist (not
      blocklist) semantics — an unknown extra field on the input record does NOT
      pass through; mirror key builders `{ownerUserId}:{accountId}:meta` and
      `{ownerUserId}:{accountId}:{YYYY-MM}` + a prefix matcher used by reconcile.
- [ ] **Green:** `external-modules/finance/src/domain/shared-pool.ts` — pure
      projection + key helpers; `SharedAccountMeta` type; add the optional
      `sharedToHousehold` boolean to `AccountRecord` in `domain/records.ts`.
- [ ] Verify: module unit suite green; prettier.
- [ ] Commit (verbatim):
      `feat(finance): shared-pool projection domain — allowlisted mirror, key contract (#1149)`
      body: `Pure projection of shared accounts into the household mirror shape. Not yet user-visible.`

### Task 2: user directory route (host, TDD)

- [ ] **Red:** extend the settings routes integration coverage
      (`tests/integration/` — follow the existing settings-routes test file
      placement): non-admin actor GET `/api/users/directory` → 200 with active
      users' `{ id, name }` only; serialized body contains NO `email` substring;
      deactivated and pending users excluded; unauthenticated → 401.
- [ ] **Green:** `UserDirectoryEntryDto` + `ListUserDirectoryResponse` + route
      schema in `packages/shared/src/platform-api.ts` (declare every emitted
      field); route in `packages/settings/src/routes.ts` per the delta —
      `resolveAccessContext` + `requireKnownUser`, `repository.listUsers()`,
      serialize id+name for `status === "active"` rows only. Comment the privacy
      reasoning inline (cites #75 / migration 0047).
- [ ] Verify: `pnpm exec tsx scripts/test-integration.ts <that file>`; typecheck;
      prettier.
- [ ] Commit (verbatim):
      `feat(platform): authenticated user directory — active members, id and name only (#1149)`
      body: `Household members can now be shown by name where modules share data. Names only — emails and account details stay admin-only.`

### Task 3: manifest v0.3.0 + reconcile expectations

- [ ] Manifest per delta: version `0.3.0`; `finance.shared` namespace
      `{ scopes: ["instance"], instanceWritePolicy: "module" }`; tool
      `finance.account.set-shared` (write, params accountId + shared); queue
      `finance.share-apply` (retryLimit 1, paramsSchema accountId identifier +
      shared boolean).
- [ ] Update `tests/integration/external-module-finance.test.ts` queue call list
      (+2 entries) and any manifest unit assertions (namespace/tool/queue counts).
- [ ] Verify: `pnpm build:external:finance`; manifest unit test; single-file
      integration run of the external-module-finance test.
- [ ] Commit (verbatim):
      `feat(finance): manifest v0.3.0 — finance.shared namespace, set-shared tool, share-apply queue (#1149)`
      body: `Declares the household mirror storage and sharing contract. Not yet user-visible.`

### Task 4: share/sync worker handlers (TDD)

- [ ] **Red:** `tests/unit/external-module-finance-handlers-shared.test.ts`
      (scripted RPC host pattern): set-shared ON flips the account record and
      writes meta + every stored month to `finance.shared`; OFF deletes the full
      account prefix in the same invocation; queue path reads the host envelope
      (`input.params`); replay of either direction converges (SET semantics);
      handlers only ever write keys under their own `actorUserId` prefix; sync
      mirrors changed months for shared accounts and own-prefix reconcile deletes
      keys for unshared/deleted accounts; secret-hygiene case — mirror writer
      never reads tokens/rules/budgets namespaces (scripted host records every
      namespace touched).
- [ ] **Green:** `external-modules/finance/src/worker/handlers/shared.ts`
      (shared `applyShareFlag` used by tool + queue handler), registry wiring for
      `finance.account.set-shared` + `finance.share-apply`, instance-scope mirror
      port alongside `domain/kv-port.ts` (kv-port pins scope "user" — the mirror
      port pins scope "instance" over the same structural WorkerKv), sync-handler
      mirror + reconcile hook.
- [ ] Verify: finance unit suites green; module tsc; prettier.
- [ ] Commit (verbatim):
      `feat(finance): share handlers — mirror writes, unshare cleanup, sync reconcile (#1149)`
      body: `Sharing an account now mirrors it to the household pool; unsharing removes it. Not yet user-visible.`

### Task 5: merged reads + web surface

- [ ] Merged reads (TDD in the existing handler test files): `accounts.list` and
      `transactions.query` additionally read `finance.shared` (list + get), skip
      own-prefix keys, and tag results `{ ownerUserId, shared: true }`; both
      remain pure (no writes). Layer split (the worker cannot call host HTTP
      routes, and the directory is a host route): handlers return raw
      `ownerUserId` tags only; the WEB layer resolves names against the directory
      response and applies the fail-closed drop for owners absent from it.
      Unit-test that web-side filter as a pure helper.
- [ ] Web: `api.ts` gains a `fetchUserDirectory()` GET; feed screen — shared
      accounts in the strip with owner chip (name from directory, neutral
      fallback when null, entry DROPPED when owner absent from directory), shared
      transaction attribution, share/unshare control on OWN accounts via
      `runQueue("finance.share-apply", ...)` with optimistic flip; budget screen
      untouched (per-user invariant).
- [ ] Verify: `pnpm build:external:finance`; unit tests for the new pure web
      helpers; prettier.
- [ ] Commit (verbatim):
      `feat(finance): merged household feed — shared accounts, attribution, share controls (#1149)`
      body: `Share a bank account with your household from the Finance page: members see shared accounts and transactions with owner attribution.`

### Task 6: UAT e2e — owner shares, member sees

- [ ] Seed delta: second loginable user via the existing `UAT_SECOND_OWNER_*`
      helpers; finance data chunks for the ADMIN owner only (no data for user 2;
      no credentials, `finance.plaid-tokens` never seeded).
- [ ] `tests/uat/specs/finance-shared.uat.spec.ts` from the FIN-03 template
      (D7 activation + afterEach diagnostics verbatim): owner signs in → shares
      one account (real `finance.share-apply` queue → first real
      `instanceWritePolicy: "module"` write) → reload-poll proves the persisted
      shared state; sign out → second user signs in → merged feed shows the
      shared account + owner attribution; assert the owner's UNSHARED account and
      budget data are absent for user 2.
- [ ] Full image rebuild (Task 2 touched `packages/*`) — no `JARVIS_UAT_BUILD=0`.
      Run detached; iterate on red via the afterEach diagnostics.
- [ ] Commit (verbatim):
      `test(finance): e2e UAT for the household shared pool on a real activated module (#1149)`
      body: `Verifies account sharing end-to-end across two real users in a production-shaped stack. Not user-visible.`

### Task 7: FIN-04 gate + summary

- [ ] Full gate, isolated DB `jarvis_fin04_gate`, piecewise foreground (12 stages,
      8 integration batches), every stage exit 0. Drop DB + tmp scripts after.
- [ ] `git push`; comment the FIN-04 summary (what's-new line, commit chain, gate
      record, UAT result) on PR #1151; note completion on issue #1149.
- [ ] Update epic-resume memory; next slice FIN-05 (#1150).
