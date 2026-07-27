# Job Search Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-07-26-job-search-module-design.md` (read it first — it holds
the rulings this plan implements)
**UI reference:** `apps/web/src/job-search-prototype/`, variant `?v=flow` (throwaway; direction
approved, visual style not locked)

**Goal:** Ship a Job Search external module that crawls public job portals, scores every posting on
two independent axes (Fit and Want), and surfaces the results through a board, a notification, a nav
badge, and the daily briefing.

**Architecture:** An external module at `external-modules/job-search/`, built exactly like
`external-modules/finance/` — a `jarvis.module.json` manifest plus a worker bundle and a web bundle,
owning five Postgres tables reached through `ctx.db`. Logic lives in a pure `src/domain/` layer with
no SDK imports so it unit-tests without a runtime; the worker layer is a thin adapter wiring SDK
ports into those functions. Six small core-platform additions are prerequisites (Phase 0) — each is
a generic seam every module gets, not job-search plumbing.

**Tech stack:** TypeScript (ES2022, `moduleResolution: bundler`), `@jarv1s/module-sdk/worker`, plain
`fetch` via `ctx.fetch`, Postgres + pgvector (768-dim, nomic-embed-text-v1.5), Vitest for unit and
integration, Playwright for e2e, `scripts/build-external-module.ts` for packaging.

## How to read this plan

**This plan carries contracts, invariants, and test cases. It deliberately does not carry
implementation code.** Exported types, function signatures, manifest JSON, and SQL DDL appear
verbatim, because those are decisions — a signature is how the next task's implementer learns what
this one produces, and a migration is hash-checked and can never be edited once applied. Function
bodies do not appear, because they are the implementer's work and pre-writing them buys nothing.

**Every task is test-driven, and this is stated once rather than repeated per task.** For each task:
write the failing tests from the behaviour statements in its **Tests** section, run them and watch
them fail, implement against the **Contracts** and **Constraints**, run them green, run the task's
**Verify** commands and confirm a real exit code, then commit with a `feat(job-search):` or
`test(job-search):` message and a one-line user-facing summary. Never pipe a gate to `tail` — a
command ending in `tail` reports exit 0 for a failing run.

Task numbering is frozen. Tasks cross-reference each other by number throughout, and by constraint
ID into the **Constraints proven against the tree** section below.

## Global Constraints

Every task's requirements implicitly include this section.

- **Two axes, never one score.** No screen, API response, export, tool result, or briefing line may
  present a blended, weighted, or averaged Fit/Want number. The two travel together and travel
  labelled.
- **Render from records, never from model prose.** Every UI element is built from a stored field. No
  screen region is "whatever the model wrote."
- **Structured failure causes.** Every failure carries portal id, kind
  (`rate_limited | login_required | parse_failed | network`), what was retrieved before it stopped,
  when the portal last worked, and what happens next. Never a bare "failed".
- **The triage score never reaches the screen.** It is a cost-control device. Only Fit and Want are
  displayed.
- **Recall protection.** The triage cut reserves a slice for postings outside the user's stated
  criteria but relevant to their broader profile. Filtering strictly to stated criteria is a spec
  violation.
- **No login-walled or paywalled sources.** A portal that demands an account hard-stops and disables
  itself with cause `login_required`. Never sign in to a job board.
- **No autonomous application submission.** Per-item human approval only.
- **`actorUserId` envelope trap.** The host spreads `actorUserId` onto every external tool input.
  Every strict validator MUST strip it at the worker boundary or the call dies with
  `unknown key: actorUserId`.
- **Metadata-only job payloads.** Queue payloads carry actor id, resource ids, job kind, idempotency
  key, and small command params. Never posting bodies, prompts, résumé content, or secrets.
- **Secrets never escape** to frontend responses, logs, pg-boss payloads, exports, or AI prompts.
- **All module tables FORCE RLS, owner-only**, including for admins. No `BYPASSRLS`.
- **Provider-agnostic AI.** Capability requests only. No hardcoded provider or model.
- **Never edit an applied migration.** Module SQL lives in `external-modules/job-search/sql/`, never
  `infra/postgres/migrations/`.
- **Design tokens only.** `apps/web/src/styles/tokens.css` is the only file permitted hex/rgb
  literals. `--font-sans` and `--font-display` only — no mono (retired 2026-07-08), no serif (sports
  nameplate only).
- **1000-line cap** on every source file including CSS (`pnpm check:file-size`).
- **No module-level chat button.** The core header already has one. The module must not add its own.
- **Module id is `job-search`, display name "Job Search".** The word "Compass" appears nowhere in
  code, UI, or docs.
- **`pnpm test:integration <file>` does not narrow to that file.** The script is
  `tsx scripts/test-integration.ts tests/integration` (`package.json:49`) and it forwards
  `process.argv.slice(2)` straight into `vitest run` (`scripts/test-integration.ts:68,97`), so the
  baked-in directory arrives as a filter alongside yours and matches everything. Every
  `pnpm test:integration …` command below runs the **whole** integration suite — expected, not a
  mistake, and it takes minutes. Name the file anyway: it documents what the step checks. To iterate
  on one file, take the runner's passthrough branch (`test-integration.ts:19-21`) by setting
  `JARVIS_PGDATABASE` yourself and calling vitest directly — that skips the per-run database
  isolation, so use a scratch database, never the shared dev one.
- **Every task ends green on its own gate**, and the milestone ends green on
  `pnpm verify:foundation` with a real exit code.

## Decisions required before Phase 1 (Ben)

**1. Dynamic per-user fetch-host grants are assumed DEFERRED.** Spec §10.1 is a hard blocker for
"add your own job portal": `packages/host-fetch/src/policy.ts:assertValidFetchHosts` requires
literal lowercase hostnames validated at manifest load, so a module physically cannot fetch a host
the user names at runtime. v1 ships the declared sources; `freehire.me` alone covers ~50 ATS boards
under one declared host. User-nominated portals become their own spec and milestone. If Ben wants
them in v1, this plan grows a Phase 0 task and the milestone gets materially bigger — his call, not
the implementer's.

**2. Phase 0 is six core changes, not two.** Grounding against the tree turned up four platform gaps
behind features Ben asked for by name, on top of the embedding port and the briefing seam: an in-app
notification port (`ModuleWorkerContext` has no `notify`), a nav badge (`navigation[]` entries are
`{id,label,path,icon?,order?}` — no badge field), per-profile chat threads (surfaces are fully built
server-side; only `apps/web/src/shell/app-shell.tsx` hardcodes one stream), and the invocation
deadline (Task 2e). All are generic seams every module would use, which is the bar Ben set for
touching core — "if it's something that would make sense to add to the core and then expose it to
this new module, that's fine." Weighed against his other ruling — "the module should just touch the
module, not the core" — this is his call to confirm. **If he declines any of them, cut the
corresponding module feature rather than faking it inside the module.**

Everything else in the spec is in scope.

---

## File Structure

**Phase 0 — core (all additive; every one a generic seam, none job-search-specific):**

| File                                                        | Responsibility                                                                                     | Task  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `packages/module-sdk/src/worker.ts`                         | add `ctx.embed` to `ModuleWorkerContext`                                                           | 1     |
| `packages/module-registry/src/external/worker-rpc-host.ts`  | service `embed.*` and `notify.post` RPC methods                                                    | 1, 2b |
| `packages/module-sdk/src/index.ts`                          | `briefing` + `navigation[].badge` on `JsonJarvisModuleManifest` (L740 — there is no `manifest.ts`) | 2, 2d |
| `packages/module-registry/src/external/validate.ts`         | keep those blocks through manifest reconstruction (it drops unknowns)                              | 2, 2d |
| `packages/briefings/src/compose-shared.ts`                  | `ComposeDeps.invokeExternalBriefing?` injected invoker                                             | 2     |
| `apps/api/src/…` composition root                           | wire the invoker to the module runtime                                                             | 2     |
| `packages/module-sdk/src/worker.ts` + notifications package | `ctx.notify` port → existing in-app notification store                                             | 2b    |
| `apps/web/src/shell/chat-surface-key.ts` (new)              | hash (moduleId, key) into a surface that passes `CHAT_SURFACE_PATTERN`                             | 2c    |
| `apps/web/src/shell/app-shell.tsx`                          | honour the surface argument the seam already anticipates                                           | 2c    |
| `packages/notifications/src/repository.ts` + `routes.ts`    | per-module unread counts (`unreadByModule`) beside the existing total                              | 2d    |
| `packages/shared/src/notifications-api.ts`                  | `unreadByModule` on the DTO **and the response schema**                                            | 2d    |
| `apps/web/src/shell/…nav`                                   | render the module's unread count on a nav entry that opts in                                       | 2d    |
| `packages/module-registry/src/external/worker-runtime.ts`   | stall budget + hard ceiling + queue/tool/briefing lanes                                            | 2e    |

**Phase 1+ — the module:**

| File                                                        | Responsibility                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `external-modules/job-search/jarvis.module.json`            | manifest: tools, queues, schedules, storage, tables, hosts |
| `external-modules/job-search/package.json`                  | artifact package metadata                                  |
| `external-modules/job-search/tsconfig.json`                 | copy of finance's, `jsx: react`, `jsxFactory: h`           |
| `external-modules/job-search/sql/0001…0006_*.sql`           | five tables + pgvector column, all FORCE RLS owner-only    |
| `src/domain/records.ts`                                     | every record type + `FailureCause`. No logic.              |
| `src/domain/criteria.ts`                                    | conversation output → structured `SearchCriteria`          |
| `src/domain/excludes.ts`                                    | stage-1 hard-exclude filter                                |
| `src/domain/triage.ts`                                      | stage-2 embedding cut, incl. the reserved recall slice     |
| `src/domain/score.ts`                                       | stage-3 prompt construction + Fit/Want result validation   |
| `src/domain/dedupe.ts`                                      | cross-portal posting identity                              |
| `src/domain/surface.ts`                                     | new-match counting + briefing payload shaping              |
| `src/domain/store-port.ts`                                  | storage interface the handlers are written against         |
| `src/adapters/types.ts`                                     | `Portal`, `CrawlResult`, `CrawlFailure`                    |
| `src/adapters/{freehire,linkedin}.ts`                       | one file per source                                        |
| `src/worker/index.ts`                                       | `defineModuleWorker` registration only                     |
| `src/worker/ports.ts`                                       | per-invocation dependency set (finance `ports.ts` pattern) |
| `src/worker/validate.ts`                                    | strict input validation; strips `actorUserId`              |
| `src/worker/store-sql.ts`                                   | `ctx.db` implementation of `store-port`                    |
| `src/worker/stages/{crawl,score}.ts`                        | the two pass stages — pure functions, never registered     |
| `src/worker/handlers/*.ts`                                  | the handlers actually named in the manifest                |
| `src/web/index.ts`                                          | web entrypoint                                             |
| `src/web/root.tsx`                                          | onboarding-vs-board branch                                 |
| `src/web/screens/{onboarding,board,inspector,settings}.tsx` | one screen each                                            |
| `src/web/styles.css`                                        | module styles, tokens only                                 |

**Tests:**

| File                                           | Covers                                      |
| ---------------------------------------------- | ------------------------------------------- |
| `tests/unit/job-search-*.test.ts`              | the whole domain layer, no SDK, no network  |
| `tests/integration/job-search.test.ts`         | RLS, payload shape, `actorUserId` stripping |
| `tests/uat/specs/job-search-board.uat.spec.ts` | the required real-stack UI path             |

---

## Constraints proven against the tree

Facts about this repository and decisions taken, each verified against the source at the cited
`file:line`. **These are requirements, not background.** Tasks cite them by ID. Line numbers drift —
treat them as locators and re-read the file before acting on any single one; the surrounding claim is
what must hold, not the number.

Verified 2026-07-26 against `751c7f14`.

## A. Module schema, migrations, RLS

**A1 — The ownership column is `owner_user_id`, always.** External-module RLS is _generated_, not
hand-written: `generateModuleTableRlsSql()` emits `owner_user_id = app.current_actor_user_id()`
(`packages/db/src/module-rls-emitter.ts:24,46`). A table using `user_id` installs and then fails
when the generated policy references a column that does not exist. Finance's migrations declare
`owner_user_id` and contain **no** hand-written RLS, policies, or grants
(`external-modules/finance/sql/0001_create_finance_items.sql:1`) — copying that machinery into a
module migration duplicates platform-owned security. _(r1 #1)_

**A2 — One DDL statement per external-module migration file.** `validateModuleMigrationSql`
enforces exactly-one-statement plus a first-command allowlist
(`packages/db/src/migrations/module-sql-runner.ts:25-46`). This applies **only to external module
migrations**. Core package `sql/` directories legitimately hold multi-statement files — the live
`packages/notifications/sql/0071_notifications_worker_insert_grant.sql` is a grant plus two
policies in one file. Do not "fix" a core migration to satisfy a rule that does not govern it.
_(r1 #1; confirmed r6 #3)_

**A3 — A foreign key is not an RLS boundary.** Generated RLS checks only the _child row's_
`owner_user_id` (`module-rls-emitter.ts:46`). A child table with an independent `owner_user_id` and
a single-column FK to the parent UUID lets actor A insert a row owned by A that references B's
parent, if the UUID is known. Owner-bound composite FKs
(`FOREIGN KEY (owner_user_id, parent_id) REFERENCES … (owner_user_id, id)`, requiring
`UNIQUE (owner_user_id, id)` on the parent) are the fix, and each `ALTER`/`CREATE` is its own file
under A2. _(r5 #1)_

**A4 — `pnpm db:migrate` does not install module SQL.** It runs core and built-in package SQL only
(`scripts/migrate.ts:30,43`). Module SQL installs through `installModule()` and is recorded in a
separate ledger, `app.module_schema_migrations` (`scripts/module-install.ts:38`). External-module
migrations must **never** be added to the core migration catalog — that list lives in
`tests/integration/foundation-schema-catalog.test.ts:230`, not in `foundation.test.ts`. The install
test to model is `tests/integration/finance-tables-install.test.ts`. _(r1 #2)_

**A5 — Module runtime roles are `NOLOGIN`.** `packages/db/src/module-role-broker.ts:63` creates
every module role `NOLOGIN NOSUPERUSER`; only the _install_ role is briefly flipped to LOGIN
(`:103,:114`). A test cannot connect as `jarvis_mod_<id>_runtime`. The real pattern is: connect as a
parent role, then `BEGIN; SET LOCAL ROLE jarvis_mod_<id>_runtime; select
set_config('app.actor_user_id', $1, true)` — the shape used by
`packages/db/src/module-storage-rpc.ts:89` and `packages/db/src/data-context.ts:64,90`. _(r2 B4b)_

**A6 — A constraint violation aborts its transaction.** A negative DDL case (e.g. asserting a check
constraint rejects a value) must run in **its own** transaction; a following assertion in the same
block dies with `current transaction is aborted` instead of testing anything. _(r2, Task 4 rework)_

**A7 — Never edit an applied migration.** The runner hash-checks applied files (`CLAUDE.md`). This
is why DDL is a _decision_, not an implementation detail, and why migration SQL stays verbatim in
any thinned plan.

## B. Worker runtime, lanes, and invocation

**B1 — One child process and one mutable `state.current` per module.** `worker-runtime.ts:31,43,95`
holds a single process state per module id, and every child RPC is dispatched through whichever
invocation currently occupies that slot (`:182`). Splitting only the _serialization map_ into lanes
lets two invocations run concurrently in the same child: the second overwrites `state.current`, so
the first invocation's later RPCs execute under the second actor's RPC closure, data context, risk
level, and secret set — and the first `finally` can clear the slot while the other is still live.
**Per-module serialization is a security boundary.** Any lane split must key the `states` map (not
just the queue) by `${module.id}:${lane}`, or track invocations by id and bind every RPC to one.
_(r3 #1; also memory `module-runtime-one-state-current-per-module`)_

**B2 — The runtime verifies nothing.** `ExternalModuleWorkerRuntime.invoke` simply starts the
supplied discovery (`packages/module-registry/src/external/worker-runtime.ts:55`). Enabled status,
`manifest_hash` and `package_hash` are checked by **`createExternalModuleJobHandler`**
(`apps/worker/src/external-module-job-handler.ts:50,54,59`), which then constructs the actor-scoped
RPC handler (`:66-84`). Therefore: _any new caller of `runtime.invoke` — a briefing invoker, a tool
path, anything — inherits no trust checking whatsoever._ A disabled, stale, or tampered module can
contribute content through an unverified path. Every invoker must go through one shared verifying
helper; two copies of a trust gate is one copy that rots. _(r6 #2)_

**B3 — Child processes get a three-key environment.** `worker-runtime.ts:120` passes only `LANG`,
`LC_ALL`, `TZ`. No test/fixture/feature env var can reach module code inside the child. A test seam
must therefore be a **host composition** seam, not a module-side branch. _(r4 F2)_

**B4 — The host-side fetch injection already exists.** `createExternalModuleRpcHandler` takes an
optional `createFetch` (`worker-rpc-host.ts:99`, used at `:134`). An e2e fetch fixture is a
composition-root wiring job, not net-new platform work. The module keeps calling `ctx.fetch`
unchanged, so the real worker/RPC path is still exercised. _(r4 F2, verified)_

**B5 — A test-mode bypass must be gated positively.** Gating on `NODE_ENV !== "production"` plus a
fixture variable fails **open**: a deployment with a missing or misspelled `NODE_ENV` enables the
bypass. Gate on an explicit affirmative mode (e.g. `JARVIS_RUNTIME_MODE === "e2e"`) **plus** the
fixture var, and fail startup if the fixture var appears without the mode. Cover `NODE_ENV` unset,
`development`, `test`, and `production`. _(r5 #11)_

**B6 — The worker gets a deadline, never a signal.** An `AbortSignal` cannot cross JSON-RPC. The
host owns one `AbortController` per invocation and passes its signal only into host-side fetch and
AI implementations; the worker receives a **deadline timestamp** it can compare against a clock and
can only stop its own loops. `ModuleFetchRequest` is `{url, method?, headers?, bodyBase64?}` —
no signal (`packages/module-sdk/src/index.ts:682`), and `generateStructured` accepts none
(`packages/module-sdk/src/worker.ts:38`). Do not reintroduce a worker-side signal. _(r4 F1, r5 #4 —
settled and frozen from round 5 onward)_

**B7 — A deadline checked only between requests is not isolation.** With no per-request timeout,
one in-flight fetch can consume the entire remaining invocation and starve every later portal. Either
`ModuleFetchRequest` gains a generic, serializable, **host-clamped** `timeoutMs`, or the plan must
stop claiming per-portal isolation. _(r6 #11)_

**B8 — Manifest `timeoutMs` reaches the runtime only if the validator rebuilds `worker`.** Queue
normalization _spreads_ the queue object and preserves unknown fields
(`packages/module-registry/src/external/validate.ts:133`); only the top-level manifest
reconstruction is allowlisted. So "unknown queue fields are silently dropped" is **false**, and a
test asserting field preservation passes against today's implementation. The behaviour worth
testing is rejection of non-integer / negative / excessive `timeoutMs`, the clamp on normalized
output, and that the job handler actually passes it into `runtime.invoke`. _(r3 #10)_

## C. AI budget and the RPC host

**C1 — Eight AI calls per invocation, counted before the call.** The cap is shared across the whole
invocation and enforced at eight (`worker-rpc-host.ts:77,212`); the counter increments **then**
checks, so attempt nine is rejected. Consequences: (a) a batch of eight plus one retry is nine
calls and fails; retries must consume the same budget, checked before every initial call _and_
every retry; (b) for a sweep, eight is across **all** profiles together, not eight each — a profile
receiving zero budget in a sweep is legal and leads the next sweep; (c) flooring every profile at
one budget token means nine active profiles need nine calls, which cannot happen. _(r1 #5, r3 #6,
r5 #5)_

**C2 — The authoritative call counter is private to the parent RPC closure.**
`worker-rpc-host.ts:111` — the worker cannot read it, and a stage that throws returns no usage. Any
"calls spent by a profile that threw still count" rule must be implemented by a handler-level
`AiPort` wrapper shared across profiles, deriving remaining budget from the wrapper even on a throw.
_(r4 F9)_

**C3 — `generateStructured` returns an envelope, not a value.** `{ok:true, object}` or
`{ok:false, error}` (`packages/module-sdk/src/worker.ts:34,45`) with five typed errors:
`needs_config | validation_failed | provider_error | usage_limited | aborted`. `provider_error` is a
**returned member, not a thrown exception**, so nothing retries implicitly. Passing the envelope
straight to a parser rejects every result. _(r1 #5, r4 F10)_

**C4 — `aborted` must halt the stage.** The core emits `aborted` when the operation's abort signal
fires or the adapter throws `AbortError`
(`packages/ai/src/structured/generate-structured.ts:130,154`). Continuing to issue AI calls after
cancellation is wrong; it is not a malformed result isolated to one posting. `validation_failed`
stays per-posting. _(r3 #15)_

**C5 — Structured prompts are byte-bounded.** The host limit is 65,536 bytes
(`packages/ai/src/structured/schema-bounds.ts:5`). A prompt that concatenates unbounded posting
bodies, résumé content, and context fails at runtime on ordinary real data. Every prompt section
must be deterministically bounded, and parsers must enforce the schema's own character limits rather
than trusting the model. _(r1 #19)_

**C6 — In a per-item loop, `continue` advances the item.** "Retry the same item" needs a nested
attempt loop or a labelled retry; a bare `continue` silently skips. _(r4 F10)_

## D. The module worker context and DB port

**D1 — `ModuleWorkerContext` is `{input, auth, fetch, kv, ai, db, attachments}`.**
(`packages/module-sdk/src/worker.ts:13`.) There is **no enqueue port**, no memory/context-retrieval
port, no notify port and no embed port in the base contract. Anything a module needs beyond that
list is a core addition that must be justified as a generic seam every module gets. _(r1 #3, #6, #8)_

**D2 — A worker handler cannot enqueue.** Following from D1: any "stage A enqueues stage B" design
is unimplementable. Crawl → triage → score must compose inside one queue handler, or the module
needs a real generic `ctx.jobs.enqueue()` capability designed and serviced end to end. _(r1 #3)_

**D3 — `ctx.db.query(text, params?)` is raw bounded SQL with positional `$1`, SELECT/INSERT/UPDATE/
DELETE only, and no transaction control** (`packages/module-sdk/src/worker.ts:57,64`). No `BEGIN`.
Atomicity must be achieved in a single statement or a bounded retry. The port forwards parameters
exactly; it cannot invent a `$2` an interface did not declare. _(r3 #5, r5 #13)_

**D4 — A single statement is not automatically concurrency-safe.**
`INSERT … SELECT COALESCE(MAX(version),0)+1` lets two callers read the same maximum before either
inserts. _(r5 #6)_

**D5 — `FOR UPDATE` does not refresh the statement's snapshot for other relations.** Under READ
COMMITTED, Postgres re-evaluates the **locked row** after the lock is released (EvalPlanQual), but
an aggregate over a _different_ relation in the same statement keeps the snapshot taken when the
statement began — before the wait. So locking a parent profile row does not make
`MAX(child.version)+1` safe. The safe shape is a bounded retry:
`INSERT … ON CONFLICT DO NOTHING RETURNING`, retrying with a **fresh statement** when no row
returns, and distinguishing "no such parent" from "contended out". _(r6 #4; also memory
`jarv1s` bug entry)_

**D6 — The KV port stores `Record<string, unknown>` only** (`packages/module-sdk/src/worker.ts:20`).
A bare JSON number is not a legal value. A cursor is `{index}`, validated on read (finite,
non-negative integer) with invalid or absent defaulting to zero. _(r5 #7)_

**D7 — A persisted index cursor requires a deterministic list order.** Without a stable
`ORDER BY` on the listing it indexes into, the cursor is meaningless. _(r3 #9 / r4 F9)_

**D8 — A cursor must not advance past unserved work.** If the invocation deadline expires, later
items return "deadline" without being served; advancing the cursor over them skips them, possibly
wrapping. Check the clock before each item, stop at the deadline, report deadline exhaustion
explicitly, and persist the cursor at the first item **not started**. _(r6 #10)_

**D9 — Sequential, not `Promise.allSettled`, when order or budget matters.**
`Promise.allSettled` starts every promise before any finishes, so it cannot honour "portal two must
not start after portal one crosses the deadline", and rotating an order does not decide who gets a
scarce shared budget. Use `for…of` with per-item `try/catch`. _(r3 #6, #7)_

## E. Host fetch

**E1 — The fetch host policy forbids IP literals, ports, and `http:`.**
`packages/host-fetch/src/policy.ts` — `validateUrl` requires `https:`, requires the port to be empty
or `443`, and `isPinnableHost` rejects hostnames containing `:` and rejects IPv4 literals. Resolved
addresses then go through `isBlocked`, which rejects loopback and private space
(`packages/host-fetch/src/index.ts:146,273`). `http://127.0.0.1:4599` is unreachable three times
over. A local fixture server cannot be reached through `ctx.fetch`, and Playwright cannot intercept
requests made by the **worker** process. _(r3 #4)_

**E2 — `ctx.fetch` is not the shape adapters want.** `ModuleFetchResponse` is
`{status, headers, bodyBase64}` (`packages/module-sdk/src/index.ts:689-693`) — no `ok`, no `text()`.
A bridge is required, and it inherits three host behaviours worth stating: only four response
headers survive (**no `set-cookie`, so no adapter can hold a session**), a host missing from
`fetchHosts` throws `invalid_rpc` rather than returning a status, and redirects are followed inside
the host. _(r2 M10)_

**E3 — 401/403 is not proof of a login wall.** A 403 can be public-page anti-bot denial. Classifying
every 401/403 as `login_required` permanently disables public sources for the wrong reason.
_(r1 #20)_

## F. Manifest, validation, queues, and the job envelope

**F1 — The manifest validator defensively reconstructs and drops unknown top-level fields**
(`validate.ts:656`). A test that imports the raw JSON and asserts fields passes while the field is
absent from the loaded manifest. Manifest tests must go through
`validateExternalModuleManifest()` and assert the **validated** output. _(r1 #13)_

**F2 — A JSON manifest cannot import a TypeScript constant.** Finance's `jarvis.module.json:42`
carries a literal owned-table array. A `TABLES` constant is not a source of truth by assertion; the
only enforceable seam is a test asserting
`validated.database.ownedTables` deep-equals `TABLES.map(t => "app." + t)`. _(r4 F11)_

**F3 — `assistantTools` entries require `name`, `permissionId`, `description`, `risk`,
`inputSchema`, `handler`, and a `runtime` block on the manifest** (`validate.ts:425,436-450`). A
fixture missing any of them returns `ok:false` before the behaviour under test is reached. _(r2 M8)_

**F4 — A schedule naming an undeclared queue is rejected by validation**, not silently dropped
(`validate.ts:176`). The reconciler's `continue` is silent (`job-reconciler.ts:127`) but a validated
install cannot reach it. Keep manifest assertions as defence in depth; state the correct rationale.
_(r4 F12)_

**F5 — Job execution always invokes `queue.handler`.** Scheduling selects a queue and sends its
payload (`job-reconciler.ts:126`); the handler that runs is the queue's declared handler
(`external-module-job-handler.ts:88`). Registering a handler name that no manifest queue points at
does nothing. Two behaviours ⇒ two declared queues. **Ruled and frozen: two queues, not one queue
with two handlers.** _(r3 #2)_

**F6 — The queue envelope is `{actorUserId, jobKind, idempotencyKey, params}` and the payload
requires `manifestHash`.** `packages/jobs/src/module-jobs.ts:7` types it and `:75` validates it
(`sha256:` + 64 hex); `job-reconciler.ts:137` populates it. A test asserting an exact key set must
include `manifestHash` — it is metadata, not forbidden content. Params never arrive as top-level
fields. _(r1 #4, #23; r4 F3)_

**F7 — `actorUserId` is first-class in the queue envelope and is never stripped there.** It is
stripped only at the **tool** boundary. The host also spreads `actorUserId` onto every external tool
input, so a strict unknown-key validator at the worker boundary must strip it or every call dies.
_(settled r4; memory `external-module-actoruserid-envelope`)_

**F8 — The params DSL has no `required` and no enum.** `packages/module-sdk/src/module-params.ts`
rejects unknown keys but has no required concept, so `{type:"object",fields:{}}` accepts `{}` and
nothing else, and any `paramsSchema` accepts `{}`. `assertModuleJobPayload` skips validation when
`params` is absent. **A handler must therefore validate its own required params and return a typed
failure** — the platform will not do it. Note also that this DSL is a _different language_ from
`assistantTools[].inputSchema`, which is JSON Schema. _(r3, entanglement section)_

**F9 — An envelope parser that claims strictness must be strict.** Accepting unknown top-level keys,
accepting arrays as `params`, or coercing a missing/scalar `params` to `{}` contradicts the claim.
Require an exact plain-object shape and a non-array plain-object `params`, with rejection tests for
extras, arrays, null, scalars, and absence. _(r3 #9)_

**F10 — `manifest_hash` is not a content anchor; `package_hash` is.** The trust gate must compare
`package_hash` — the normalized-manifest digest goes stale on a core change alone and silently kills
module queues. _(pre-existing ruling, memory `manifest-hash-kills-module-queues`; reflected in B2)_

## G. Notifications core

**G1 — Read state is a separate table.** `app.notification_reads`
(`packages/notifications/src/repository.ts:249,251`). Updating a notification row leaves the read row
intact, so a keyed re-post does **not** return the item to unread and the badge stays cleared.
"Return to unread" requires deleting the actor's read row in the same statement/CTE as the upsert.
_(r3 #8 / r4 F8)_

**G2 — `CreateNotificationInput` is `{moduleId, title, body?, metadata?, urgency?}`** — no event key
and no href (`repository.ts:29`), and creation always inserts a new random row (`:203`). Any
key-based dedupe/update and any href are core additions, and the module-facing port's `key` must be
mapped to the repository's `eventKey` **at the host boundary** — the two names are deliberately
different. _(r3 #11, r5 #8)_

**G3 — `jarvis_worker_runtime` has only `SELECT, INSERT` on `app.notifications`
(`packages/notifications/sql/0071_notifications_worker_insert_grant.sql:16`) and `SELECT` only on
`app.notification_reads` (`packages/notifications/sql/0166_worker_notification_reads_grant.sql:5`).**
The app role's grants are at `sql/0008_notifications_module.sql:24`. Notifications posted by a crawl
originate in the **worker**, not the app — so an upsert-plus-delete CTE granted only to
`jarvis_app_runtime` cannot execute in production even on the first keyed notification. Every
grant-and-policy pair needs a worker twin, and `0071` is the template, including its reason for
granting `SELECT` alongside: `RETURNING *` requires `SELECT` privilege on the returned columns.
**Corollary for tests: an app-role-only test is green against a migration that forgot the worker
grants entirely.** Widening the app policy for the worker would be privilege escalation dressed as a
grant. _(r6 #3)_

**G4 — `markRead` reads the parent without locking it** (`repository.ts:249`). A concurrent
mark-read can insert after a refresh's snapshot/delete and leave the refreshed event read, violating
"re-fire returns unread". Both operations must be serialized on the notification row. _(r5 #9)_

**G5 — A keyed refresh that always posts will resurrect the badge.** Because a keyed re-post
deliberately returns the item to unread, posting on every pass — including passes with zero new
results — un-reads a notification the user has already dismissed. Post only when the current
invocation produced something, and count only what that invocation created. _(r6 #9)_

**G6 — `NotificationDto.moduleId` already exists** (`packages/shared/src/notifications-api.ts:20`),
and `countUnread` (`repository.ts:355`) is the template for a per-module count. A module badge can
therefore be defined as _that module's unread notification count_ — a small generic core seam
(`unreadByModule: Record<string, number>` on the list result) rather than a new tool-result channel.
The shell already runs the query it needs (`app-shell.tsx:227`) and already has `formatUnreadCount`
(`:386`). **Decision taken (r2 B2): the badge counts notifications.** _(r2 B2)_

**G7 — Fastify response schemas silently drop undeclared fields.** Any new field on a REST response
must be added to the shared schema in `packages/shared/*-api.ts` or `fast-json-stringify` strips it.
Recurring trap. _(memory `fast-json-stringify-schema-strip`; flagged in r2 B2's fix)_

## H. Chat surfaces and the assistant surface

**H1 — `CHAT_SURFACE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/`** (`packages/shared/src/chat-api.ts:14`).
No colons, ≤32 chars, must start with a lowercase letter. `module:job-search:profile-1` and a
`gen_random_uuid()::text` default both fail; every route runs `normalizeChatSurface`
(`chat-api.ts:16-21`) and throws `Invalid chat surface`, so the thread 400s on every turn. The host
must **hash** `(moduleId, key)` — FNV-1a, not sha256, because `crypto.subtle` is async and this is a
synchronous render path. _(r2 B1; memory `chat-surface-pattern-trap`)_

**H2 — A per-module surface is already bound today.**
`createAssistantSurfaceHandle(subscribeRecords, surface?, seedComposer?)`
(`apps/web/src/chat/assistant-surface/handle.ts`) already wraps `Surface`, passes `scopedSurface` to
`sendChatTurn`, and curries `subscribeRecords`; `apps/web/src/app.tsx:352-357` calls it with
`props.moduleId`. So the module id **is** the surface today. A per-profile surface is an extension
(`setSurfaceKey(key)` → hash, falling back to the bare module id), not new machinery. The real
contract file is `apps/web/src/chat/assistant-surface/contracts.ts`;
`AssistantSurfaceViewProps.surface?` already exists. _(r2, verified facts section)_

**H3 — Thread seeding already has a working precedent.** `packages/chat/src/live-routes.ts:67-70`
defines `EveningInterviewSeed {context, openingPrompt}`; `:383-403` resolves a seed then calls
`manager.seedContext(actorUserId, userName, seed.context, undefined, surface)` followed by
`manager.submitTurn(…, seed.openingPrompt, undefined, surface)` — **both take a surface**.
`resolveEveningInterviewSeed?` is an optional runtime dep (`packages/chat/src/routes.ts:172-175,397`).
A per-surface seed resolver rides this shape. `seedComposer` is **not** the right seam: it plants a
visible draft the user reads as their own text. _(r2 M11)_

**H4 — Ordering is the consent boundary.** `setSurfaceKey` must run **before** any seed, or the
main drawer gets framed with the module's seed — the exact leak Ben ruled out. Assert call order,
not just call presence. _(r2 M11 fix)_

**H5 — `hostActions.openAssistant` only inserts an unsent editable draft**
(`apps/web/src/external-modules/host-actions.ts:14,18`). It submits nothing and returns no
completion signal. **Ruled: that is the consent boundary, not a UX gap to be smoothed over.**
Consequence: any "opened once" latch plus a poll waiting for a result runs forever if the user
closes the drawer, edits without sending, or the assistant fails. Polls must be bounded by elapsed
time or attempts, suspended while `document.hidden`, offer a retry on expiry, and reset when the
assistant closes without producing anything. _(r3 #5, r4 F7)_

**H6 — A bootstrap latch must be actor- and resource-scoped and must persist.** An in-memory set
survives only one mounted lifetime; a remount, navigation, StrictMode double-render, or reload
re-fires it. Persist under `actorScopeKey + profileId` in module-local storage, and let an explicit
manual action bypass the bootstrap latch entirely. _(r6 #8)_

## I. The external-module web contract

**I1 — `Root` receives `{hostActions, assistantSurface?}` and nothing else**
(`apps/web/src/external-modules/loader.ts:11-20`; confirmed by
`external-modules/finance/src/web/root.tsx:34`). No records, no profile, no `invokeTool` prop. A test
that renders `<Root profile={…}>` or passes an invented transport prop can produce a component the
real loader cannot mount. _(r1 #21, r2 M7, r4 F6)_

**I2 — `ExternalModuleHostActionsV1` requires `actorScopeKey`**
(`apps/web/src/external-modules/host-actions.ts:14`). A stub supplying only `openAssistant` does not
typecheck. `actorScopeKey` is also the correct cache-key and storage-key prefix. _(r4 F6)_

**I3 — Browser reads go through the module's own transport, mirroring
`external-modules/finance/src/web/api.ts:33` (`invokeTool`) and `:96` (`runQueue`,
`POST /api/modules/:id/queues/:name/run`, which requires `allowManualRun: true` and a
`paramsSchema`).** These are the only two paths from a module screen to its worker. _(r5 #2)_

**I4 — A `write` or `destructive` tool cannot be invoked from the browser at all.** The REST invoke
route executes `read` tools inline; for anything else it creates a **pending assistant action** and
returns **403 with `blockedReason: "confirmation_required"` before `execute`**
(`packages/ai/src/routes.ts:645-668`). A button wired to `invokeTool` on a write tool silently does
nothing and never errors. Writes from a module screen must go through `runQueue`; the write tool
survives as the **assistant-only** path. _(found while applying r6 #5 — round 6 understated this;
finance's own comment says the route "403s non-read tools", which is right about the status code and
wrong about the mechanism)_

**I5 — A queue-backed write is asynchronous.** The UI must specify optimistic application plus
reconciliation on the next poll; there is no synchronous result to render. _(r6 #5b)_

**I6 — A module surface only receives a tool result if the tool opts in.** `surfacesResultToUi` in
the manifest, plus an `outputSchema` for the result to be projected through. **Note: the commit that
added this (`915672f2`) was on an abandoned build and did not survive the 2026-07-26 repo reset —
verify against HEAD before relying on it.** _(r2 B2, corrected; memory
`module-ui-needs-tool-result-allowlist`)_

**I7 — External-module JSX needs an explicit `key?: string`.** Modules compile with their own `h`
factory so `key` is not compiler-stripped; every keyed component prop type needs it or TS2322. Only
`pnpm typecheck` covers external modules. _(memory `external-module-jsx-key-prop`)_

**I8 — A hoisted `vi.mock` of a hook applies to the whole file.** Mocking `use-profiles.ts` at the
top and then claiming to test "the real hook" later in the same file tests the mock. Real-hook cases
belong in a separate file where only the transport (`api.ts`) is mocked. _(r6 #7;
same class as r4 F6, where `vi.mock` after a static import could not vary per test —
use `vi.hoisted` for a mutable mock)_

## J. Briefings

**J1 — `ComposeDeps.moduleManifests` is `readonly JarvisModuleManifest[]`, supplied only by
`getBuiltInModuleManifests()`** (`packages/module-registry/src/index.ts:1311,1318`). External JSON
manifests never enter it, so a `m.briefing` filter over it matches zero modules **forever** — in
production, silently, while every unit test that hand-injects manifests passes. External briefing
manifests need their own dependency field. _(r2 B3)_

**J2 — `registerBriefingsJobWorkers` is called from exactly one place**, inside the briefings
module's own `registerWorkers` in `packages/module-registry/src/index.ts` (~`:1306`), and an
injection point already exists: `RegisterBriefingsJobWorkersOptions.composeDeps`
(`packages/briefings/src/jobs.ts:136`), with a large literal passed at ~`:1318-1345`. But
`packages/module-registry` has **no external-module discovery and no external worker runtime** —
those live in `apps/worker/src/worker.ts`. So the invoker and the external manifests must arrive as
_dependencies of_ `registerWorkers`, not be constructed there. Importing worker internals into
briefings would break module isolation. `packages/modules/` and any
`@jarv1s/modules/briefing-seam` do **not exist**. _(r1 #9, r2 B3)_

**J3 — `collectExternalBriefingContributions` swallows rejections.** A trust-gate test must
therefore assert on the **composed briefing output**, not on a thrown error — a test that expects a
rejection passes whether the gate works or not. _(r6 #2 fix)_

**J4 — A briefing invocation must not share the queue lane.** A six-hourly crawl can hold the queue
lane for minutes; putting briefings behind it delays the briefing, and putting them in the tool lane
delays the assistant. Hence a third lane. _(r6 #1)_

## K. Test-harness realities

**K1 — `pnpm test:integration <file>` does not narrow.** The script bakes in the directory
(`package.json:49`) and forwards your argument alongside it (`scripts/test-integration.ts:74,97`), so
you get the whole suite. Use the passthrough escape hatch (and note it skips per-run DB isolation),
or `pnpm exec tsx scripts/test-integration.ts <file>`. _(r1 #27, r2 M14)_

**K2 — `createExternalModuleRpcHandler` takes seven inputs and returns a three-argument handler.**
`(module, toolRisk, actorUserId, requestId, workerDataContext, cipher, isActorAdmin)` →
`(method, params, rememberSecret)` (`worker-rpc-host.ts:89`). The harness to copy is
`tests/unit/external-module-attachment-port.test.ts:56-67,76`, including its
`null as unknown as DataContextRunner` casts. _(r2 M5)_

**K3 — `ExternalModuleRpcError` has a closed code union and `super(code)` makes message === code**
(`worker-rpc-host.ts:26`). Two different regexes cannot both match one message. Assert with
`.rejects.toMatchObject({code, detail})`, and if a new code or a `detail` param is needed, say so
explicitly as a change to that class. _(r2 M5)_

**K4 — RPC branches that need no DB must be served before `withDataContext`.** Like
`attachments.readText`: after `const params = record(rawParams)` (~`:129`) and before
`withDataContext` (~`:152`). A harness passing a null `workerDataContext` depends on this. _(r2 M5)_

**K5 — A new host port must be threaded at every RPC construction site.** There are exactly two
today: `apps/api/src/external-module-tools.ts:44` (assistant tools) and
`apps/worker/src/external-module-job-handler.ts:67` (queue jobs) — and B2 adds the briefing path as
a third caller. Make the dependency **required**, so missing a site is a typecheck failure rather
than an `invalid_rpc` at runtime on the scheduled path. _(r2 M6; generalised to every Phase 0 port)_

**K6 — Per-invocation counters belong in the per-invocation factory closure**, beside
`let aiCalls = 0` (`worker-rpc-host.ts:111`). Inside the returned function the cap never trips; at
module scope it leaks across invocations. A single test catches only one of the two wrong
placements — build a second handler from the same factory. _(r2 M12)_

**K7 — Playwright tests are isolated and may run in parallel.** A sequence of cases each depending
on state the previous one created needs either one end-to-end test with `test.step` phases, or a
per-test API fixture seeding exactly its prerequisites. Never rely on execution order or backend
leftovers. **Ruled and frozen: one journey test with `test.step`, not eleven tests.** _(r4 F4)_

**K8 — The real full-stack harness is `pnpm test:uat`, and it is not `tests/e2e/`.**
`package.json:43` runs `tsx tests/uat/run-uat.ts`, which boots a prod-shaped Compose stack from
`infra/docker-compose.prod.yml` under its own project name and its own `/24` subnet
(`tests/uat/provisioner.ts:32`) on a bind-probed port, migrates and seeds it for real, then drives
Playwright through `tests/uat/playwright.uat.config.ts`. Specs live in `tests/uat/specs/` and each
must `export const uatLevel = {...} as const`, which `run-uat.ts:36-45` parses out of the source
before the stack boots. **External modules already ship specs there** —
`tests/uat/specs/finance-{budget,feed,reports,shared}.uat.spec.ts` prove the finance module end to
end, including the install/enable/restart activation recipe. `tests/e2e/` is the **mocked** tier by
design: every spec intercepts routes and `playwright.config.ts:19` starts only Vite, so a real-stack
test never belongs there. There is no `pnpm dev:instance` script and nothing needs one. The genuine
gap for a _crawling_ module is a delta on that provisioner: a fixture HTTP origin reachable from
**inside** the container (`127.0.0.1` there is the container, not the runner) and
`JARVIS_E2E_MODULE_FETCH_BASE` written by `writeUatEnvFile` (`provisioner.ts:88-140`) before
`docker compose up`, since a worker-facing variable applied after boot reaches nothing. Note the
adjacent trap documented at `provisioner.ts:80-83,142-160`: `env_file:` feeds container env only,
never compose-file `${…}` interpolation. _(r6 #6, restated 2026-07-27 against the tree; the earlier
"there is no harness" form of this finding was wrong.)_

**K9 — `defineModuleWorker()` returns `void` and starts the stdio protocol**
(`packages/module-sdk/src/worker.ts:82`). There is no `__invokeForTest`; the existing harness spawns
a real worker process (`tests/unit/module-sdk-worker.test.ts:45`). _(r1 #26)_

**K10 — A tsconfig with `"include": ["src"]` and no `src/` fails with `TS18003`**
(`external-modules/finance/tsconfig.json:1`). A task that adds a module to `check:external-modules`
before creating any source cannot finish green. _(r1 #14)_

**K11 — Production execution refuses missing discovery or mismatched enabled/hash state**
(`external-module-job-handler.ts:52`). Any "real gateway" integration harness must therefore build
`dist/worker.js`, discover the package, hash it, insert and enable its registry row, start its queue
worker, and configure embed/AI/notification dependencies — installing SQL alone does none of that.
Split DB/RLS tests from process/gateway tests if one harness cannot honestly do both. _(r3 #13)_

## L. Product decisions taken (do not re-litigate)

**L1 — Indeed is cut from v1.** Live-probed 403 behind Cloudflare; the documented GraphQL endpoint is
on `apis.indeed.com` (not the declared host) and its job APIs are partner/authenticated,
contradicting `auth: []` and the no-login-walled-sources rule. Re-probe before trusting any note that
says it works.

**L2 — Phase 0 may touch core**, on the condition that each addition is a **generic seam every module
gets**. Whether a given addition meets that bar is reviewable; the permission is not.

**L3 — No per-item autonomous application submission in v1.** A requirement, not an omission.

**L4 — Task numbering is frozen.** Tasks are cross-referenced by number throughout; "renumber" is
never an accepted fix. Scope may move; numbers do not.

**L5 — Two declared queues, not one queue with two handlers.** See F5.

**L6 — The AI budget of 8 is per invocation**, shared across all profiles in a sweep. A zero-budget
profile is legal and leads the next sweep. See C1.

**L7 — The store interface is closed by design.** Adding a method is a change to the store task, not
a local convenience. There is deliberately no `setPortalEnabled` — `PortalState` already carries
`enabled`, so a read-modify-write covers it.

**L8 — The badge is unread notifications**, and the e2e asserts the notification-read definition
(`unreadByModule` → 0 after marking read), not board acknowledgement. Clearing or dismissing matches
does not mark notification rows read. See G6.

**L9 — Two axes are never blended into one score, and the UI is never made of model output.** A
weighting slider in settings would smuggle the blended score back in and is explicitly forbidden.

**L10 — Hard dealbreakers are distinct from soft preferences.** The spec names location, a
compensation floor, and an explicit no-list as hard excludes; a design that refuses to filter them
silently changes an approved product ruling.

**L11 — The recall slice needs a legitimate source.** A module may not query goals, notes, memory, or
chat tables (module isolation). Either a generic context/retrieval capability exists, or the broader
profile summary is persisted into the module's own record through a user-confirmed tool. Provenance,
bounds, and refresh must be stated at the definition: a single named writer, raw transcript never
stored, bounded and **rejected not truncated**, replaced wholesale never appended, cleared with
`null` — which is why `""` is rejected.

**L12 — A recall reservation must not starve the primary pool.** `Math.max(1, floor(budget * 0.2))`
makes recall 100% of budget 1 and 50% of budget 2. Cap the reservation at `budget - 1` when primary
candidates exist, backfill unused seats from the other pool, and treat a missing similarity as
"defer", not as a legitimate zero.

**L13 — Dedupe identity must not merge distinct roles.** Normalized company + title with all
parentheticals stripped collapses "Staff Engineer (Security)" and "(ML)". Prefer canonical URLs or
external IDs; strip only a parenthetical proven to be a location. In-memory dedupe within one pass
does not persist — cross-portal identity needs a stored canonical key with a per-owner unique
constraint.

**L14 — A portal that returns an unrecognised envelope is disabled with `parse_failed`** — it must
never report zero results as if the search succeeded. Likewise, do not trust a source's own relevance
ranking: over-fetch and narrow locally.

**L15 — Timestamps are stored structured and formatted in the user's timezone.** Slicing characters
11–16 out of an ISO string displays UTC as if it were local. A "portal failed" summary must be
conditional on whether anything was retrieved.

**L16 — A failure kind that means "we ran out of time" must not disable a portal.** `deadline` is not
brokenness: the summary must not describe the portal as broken, `disabled` stays `false`, and
`retryAt` is preserved.

**L17 — `href` must be a validated relative path** (`/…`, no scheme, no `//`); a module-supplied
absolute or protocol-relative URL is rejected.

## M. Claims that were checked and found false — do not re-derive

Each of these was asserted at some point during review and did not survive a read of the cited file.
They are recorded so the same wrong conclusion is not reached twice.

**M1 — "`setPortalEnabled` is missing from the store" is only partly valid.** `PortalState` already
carries `enabled`; a `setPortalState` read-modify-write covers it. A named convenience method is
optional, not required. See L7.

**M2 — "The queue path has no `ctx.ai`" is false.** The queue path does get `ctx.ai`
(`apps/worker/src/external-module-job-handler.ts:38-42,86`; `apps/worker/src/worker.ts:266`).
Queue-driven scoring is fine.

**M3 — "Unknown queue fields are silently dropped" is false.** Queue normalization spreads and
preserves them (`validate.ts:133`); only the top-level manifest is allowlisted. A test built on that
premise passes today and proves nothing. See B8.

**M4 — "A missing schedule queue fails silently" is false.** `validateWorker` rejects it
(`validate.ts:176`). The reconciler's silent `continue` is unreachable for a validated install.
See F4.

**M5 — "`surfacesResultToUi` landed in `915672f2`" is false against HEAD.** That commit was on an
abandoned build and did not survive the 2026-07-26 repo reset. Verify before relying on it. See I6.

**M6 — "`pnpm dev:instance` exists" is false, and so is the stronger claim that no full-stack
harness exists.** The script is gone from `main` since the 2026-07-26 reset; `pnpm test:uat` is the
harness, it predates this plan, and external modules already use it. See K8.

**M7 — "The runtime verifies enabled status and package hash" is false.** See B2. This was asserted
by an earlier draft of this plan, which is why B2 exists.

**M8 — "A locking CTE (`FOR UPDATE`) makes `MAX(version)+1` safe" is false.** See D5. This was an
accepted fix in one review round and was correctly overturned in the next — an accepted finding is
not immune to a later, better reading of the same file.

**M9 — "A `write` tool just needs to be called explicitly from the board" understates it.** A write
tool cannot be called from the browser at all. See I4.

**M10 — Renumbering is rejected on sight.** Any finding whose fix is "renumber" or "reorder so the
numbers read cleanly" is out of scope by L4.

---

## Phase 0 — Core platform prerequisites

### Task 1: `ctx.embed` on the module worker contract

The designed triage needs the instance embedder, and `ModuleWorkerContext` has no embed port (D1), so
a module cannot embed anything today. This adds one — a generic capability any module doing semantic
retrieval wants, not job-search plumbing.

**Depends on:** nothing.

**Files**

- Modify: `packages/module-sdk/src/worker.ts` — the port, beside the existing `attachments` port
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service the methods, and widen
  `ExternalModuleRpcError` with an optional `detail`
- Modify: `apps/api/src/external-module-tools.ts:44` — RPC construction site 1 of 2
- Modify: `apps/worker/src/external-module-job-handler.ts:67` — site 2 of 2, the one the scheduled
  crawl actually runs on (K5)
- Test: `tests/unit/external-module-embed-port.test.ts`

**Contracts**

Consumed, unchanged, from `packages/memory/src/embedding-provider.ts`:

```ts
export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  readonly modelVersion: string;
  /** Embed a document for indexing. The provider applies any required task prefix. */
  embedDocument(text: string): Promise<number[]>;
  /** Embed a search query. The provider applies any required task prefix. */
  embedQuery(text: string): Promise<number[]>;
}
```

Produced, reachable as `ctx.embed` on `ModuleWorkerContext`:

```ts
export interface ModuleEmbedPort {
  /** Embed postings/documents for indexing. One vector per input, same order. */
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  /** Embed a search query (criteria text). Different task prefix from documents. */
  embedQuery(text: string): Promise<number[]>;
  /** Dimensionality of the configured embedder, so callers validate their
   * pgvector column instead of hardcoding 768. */
  dimensions(): Promise<number>;
}
```

Widened, keeping the code union closed and every existing single-argument call site valid:

```ts
export class ExternalModuleRpcError extends Error {
  constructor(
    readonly code: /* …existing closed union, unchanged… */ "invalid_rpc",
    /** Human-readable reason. Never crosses the worker boundary to the module —
     * it is for host logs and tests. The module still sees only the code. */
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ExternalModuleRpcError";
  }
}
```

Wire contract — three methods, each with the exact params and result shape the SDK port unwraps:

| Method                 | Params      | Result                    |
| ---------------------- | ----------- | ------------------------- |
| `embed.dimensions`     | `{}`        | `{ dimensions: number }`  |
| `embed.embedQuery`     | `{ text }`  | `{ vector: number[] }`    |
| `embed.embedDocuments` | `{ texts }` | `{ vectors: number[][] }` |

`EMBED_BATCH_MAX = 128`, declared once and shared by the host validation and the SDK, so one module
cannot pin the instance embedder with an unbounded batch. `embedDocuments([])` returns `[]` without
an RPC round trip.

**Constraints**

- **The document/query split is load-bearing.** nomic applies a different task prefix to each;
  collapsing them into one `embed(texts)` silently degrades retrieval. The provider takes one string
  at a time — the port batches host-side, **sequentially**, because the in-process embedder is
  CPU-bound and a 128-wide `Promise.all` would stall the worker host for every other module.
- **Serve these branches before `withDataContext`.** After `const params = record(rawParams)`
  (`worker-rpc-host.ts:~129`) and before the `withDataContext` call at `~:152` — beside
  `fetch.request`, not beside `ai.generateStructured` (`:197`), which sits inside it (K4). Embedding
  touches no table, and opening a data context for a CPU-bound transform holds a pooled connection
  for a whole batch. It is also what makes the test harness legal: `workerDataContext` is `null`
  there, so a branch inside `withDataContext` would throw on the null before any assertion runs.
- **`embeddingProvider` is a required field on the handler's input type, not optional** (K5). There
  are exactly two production construction sites; Job Search embeds during a scheduled crawl, which
  runs on the worker one. Thread the api site only and every scheduled crawl dies with `invalid_rpc`
  while every manual test passes. Required means a missed site is a `pnpm typecheck` failure.
- **Never name a provider or model here.** Both sites already resolve app services; take the provider
  from the same seam that constructs it for memory search
  (`rg "EmbeddingProvider|StubEmbeddingProvider" apps packages --files-with-matches`).
- **Validate params, throw `invalid_rpc` with a `detail`.** Follow `ai.generateStructured`'s
  discipline: reject a non-array `texts`, a batch over the cap, a non-string or empty entry, and an
  empty query — all before touching the provider.
- **Resolve the worker contract version before committing.** Read
  `MODULE_WORKER_CONTRACT_VERSION` in `packages/module-sdk/src/worker-protocol.ts` and every place
  the host compares it (`rg "MODULE_WORKER_CONTRACT_VERSION|contractVersion" packages/module-registry apps`).
  If the host only rejects a worker declaring a **higher** version, adding a context property is
  backward-compatible — leave the version alone and change nothing in finance. If it requires an
  exact match, bump it and update `external-modules/finance/jarvis.module.json` in the same commit,
  then re-run `pnpm check:external-modules`. State which branch applied in the commit body. Do not
  guess.
- **The SDK side is covered by `pnpm typecheck`, not by a unit test.** `defineModuleWorker` returns
  `void` and drives a JSON-RPC-over-stdio readline loop; there is no `__invokeForTest` and no
  exported context factory (K9). Do not invent a second test seam in the SDK.

**Tests** (`tests/unit/external-module-embed-port.test.ts`)

Harness: copy `tests/unit/external-module-attachment-port.test.ts:56-67,76` — a synthetic
`ExternalModuleDiscovery`, all seven `createExternalModuleRpcHandler` inputs including its
`null as unknown as DataContextRunner` casts, and the three-argument handler with its
secret-remembering third argument (K2).

1. **Returns one document vector per input, in order** — two texts in, two vectors out, each of the
   provider's dimensionality, and the two not equal. Catches a port that returns the batch's first
   vector for every input, or that drops order.
2. **A query routes through `embedQuery` and never through `embedDocument`** — spy on both. Fails
   against the plausible implementation that reuses the document path, which applies the wrong task
   prefix and degrades retrieval invisibly.
3. **Reports the provider's dimensionality** — `embed.dimensions` returns 768 from the stub. Catches
   a port that hardcodes a constant instead of reading the configured provider.
4. **A batch over `EMBED_BATCH_MAX` is rejected without calling the provider** — assert
   `.rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 128/ })` **and** that
   `embedDocument` was never called. Assert on `detail`, never on `message`: `super(code)` makes the
   message the bare code (K3), so a message regex can never pass. The provider-not-called half is
   what proves the cap is a guard rather than a post-hoc check.
5. **A non-string entry is rejected rather than embedded as a coerced value** — `["ok", 7]` throws
   `invalid_rpc`. Catches a validator that checks only `Array.isArray`.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-embed-port.test.ts   # exit 0
pnpm typecheck                                                  # exit 0
pnpm check:external-modules                                     # exit 0
```

Commit body carries the user-facing line: "Modules can now use the instance embedder for semantic
search. No user-visible change on its own."

---

### Task 2: Generic module→briefing contribution seam

Core modules reach a briefing by registering an in-process assistant tool the composer resolves and
calls (`findExecute`, `packages/briefings/src/compose-shared.ts:165,307`). An external module ships a
**JSON** manifest — it has no `execute` function and can never have one, so today it cannot reach a
briefing by any route. The fix is an **injected invoker** on `ComposeDeps`, following the existing
optional-dependency precedent there (`focusReadiness`, `connectorSyncAt`, `resolveUserName`).

**Depends on:** nothing. Task 2e defines the `"briefing"` lane this task's invoker passes.

**Files**

- Read first: `packages/briefings/src/compose-shared.ts` (`ComposeDeps` ~23–48, `findExecute`
  ~160–175, the section helper ~295–340) and `packages/briefings/src/jobs.ts:121`
  (`defaultComposeDeps`)
- Modify: `packages/module-sdk/src/index.ts` — the `briefing` block on `JsonJarvisModuleManifest`
- Modify: `packages/module-registry/src/external/validate.ts` — validate it **and** re-emit it
- Create: `packages/briefings/src/external-contributions.ts`
- Modify: `packages/briefings/src/compose-shared.ts` — two new optional `ComposeDeps` fields
- Modify: `packages/briefings/src/compose.ts` and `compose-evening.ts` — append external sections
- Modify: `packages/module-registry/src/index.ts:~1306-1345` — the only call site of
  `registerBriefingsJobWorkers`
- Create: `apps/worker/src/external-module-invoke.ts` — the shared trust gate
- Modify: `apps/worker/src/external-module-job-handler.ts` — rewritten to call that helper
- Modify: `apps/worker/src/worker.ts` — the only place holding both external-module discovery and the
  external worker runtime; builds the invoker and hands it down
- Test: `tests/unit/module-briefing-seam.test.ts`,
  `tests/unit/external-module-briefing-manifest.test.ts`, and integration cases in
  `tests/integration/job-search.test.ts`

**Contracts**

Manifest block:

```jsonc
"briefing": {
  "handler": "briefing.contribute",     // worker handler name
  "sections": ["morning", "evening"],   // which briefings it may appear in
  "toolName": "job-search.briefing"     // the name the user selects in briefing settings
}
```

```ts
// packages/module-sdk/src/index.ts — on JsonJarvisModuleManifest
/** Briefing contribution (external modules cannot register an in-process assistant
 * tool, so the composer reaches them through an injected worker invoker instead). */
readonly briefing?: ExternalModuleBriefingDeclaration;

export interface ExternalModuleBriefingDeclaration {
  /** Worker handler name. Requires runtime.workerEntrypoint. */
  readonly handler: string;
  readonly sections: readonly ("morning" | "evening")[];
  /** The name the user selects in briefing settings; conventionally `<moduleId>.briefing`. */
  readonly toolName: string;
}
```

```ts
// packages/briefings/src/external-contributions.ts
export interface BriefingContribution {
  /** Module id, so the composer can attribute and the user can mute per module. */
  readonly moduleId: string;
  /** Short headline the composer may use verbatim. Rendered from records. */
  readonly headline: string;
  /** Zero or more structured items. The composer decides how many to include based on
   * the user's configured detail level; the module sends its full set and never
   * pre-truncates. Hard-capped at MAX_ITEMS so one module cannot flood a briefing. */
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly href?: string;
  }[];
}

export type ExternalBriefingInvoker = (args: {
  readonly moduleId: string;
  readonly handler: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly section: "morning" | "evening";
}) => Promise<unknown>;

export function collectExternalBriefingContributions(args: {
  readonly manifests: readonly JsonJarvisModuleManifest[];
  readonly selectedToolNames: readonly string[];
  readonly section: "morning" | "evening";
  readonly actorUserId: string;
  readonly requestId: string;
  readonly invoke: ExternalBriefingInvoker;
}): Promise<BriefingContribution[]>;
```

Caps, declared in that file: `MAX_ITEMS = 20`, `MAX_HEADLINE = 200`, `MAX_TITLE = 200`,
`MAX_DETAIL = 500`.

Two new optional fields on `ComposeDeps`:

```ts
/** External modules ship JSON manifests with no in-process `execute`, so the composer
 * cannot resolve them through findExecute(). The composition root injects a worker
 * invoker instead. Absent in tests and in defaultComposeDeps → no external sections. */
readonly invokeExternalBriefing?: ExternalBriefingInvoker;

/** External manifests, injected separately — NOT read off `moduleManifests` (J1). */
readonly externalBriefingManifests?: readonly JsonJarvisModuleManifest[];
```

The shared trust gate, `createVerifiedExternalModuleInvoker(deps)` in
`apps/worker/src/external-module-invoke.ts`, where `deps` is the set the job handler already receives
(`workerDb`, `discoveryById`, `dataContext`, `cipher`, `ai`, `runtime`, `listActiveUserIds`):

```ts
type VerifiedInvoke = (args: {
  readonly moduleId: string;
  readonly handler: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
  readonly lane: WorkerLane; // Task 2e
  readonly toolRisk: "read" | "write";
  readonly timeoutMs?: number;
  /** Returned instead of thrown when the module fails a trust check, so the caller can decide.
   *  The briefing composer drops the section; the queue handler returns without acking a retry. */
}) => Promise<
  | { ok: true; result: unknown }
  | { ok: false; reason: "not-active" | "not-discovered" | "not-enabled" | "hash-mismatch" }
>;
```

The briefing adapter calls it with `jobKind: manifest.briefing.handler`,
`idempotencyKey: \`${moduleId}:briefing:${requestId}\``, `params: { section }`, `lane: "briefing"`,
and `toolRisk: "read"` — a briefing contribution reads; it does not inherit the queue's write risk.

**Constraints**

- **The validator drops unknown top-level keys (F1).** Validating the `briefing` block is only half
  the job: it must also be re-emitted in the reconstruction literal at the end of the function
  (`...(briefing !== undefined ? { briefing } : {}),`). Missing that line is the exact failure this
  step exists to prevent — validation still returns `ok: true` and the block vanishes.
- **Validate positively:** `handler` a non-empty well-formed handler name **and**
  `runtime.workerEntrypoint` present (a briefing handler with no worker to run it is the real error
  case); `sections` a non-empty subset of `["morning","evening"]`; `toolName` matching
  `/^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/`. There is no `worker.handlers` list to cross-check
  against — the worker block validates only `queues`, `schedules`, and `reconcileJobs`
  (`validate.ts:100-243`) and handler names are declared inline and never enumerated.
- **There is deliberately no `briefingOnly` flag.** An external briefing handler is a worker handler,
  not an `assistantTools` entry, so it is already invisible to the chat tool registry — the flag
  would describe a property the shape guarantees. (`packages/sports/src/briefing-tool.ts` needs such
  a flag because core briefing tools _are_ assistant tools; that mismatch is pre-existing core work,
  out of scope.)
- **The manifests are threaded, not filtered in place (J1).** The obvious shortcut — filtering
  `deps.moduleManifests` for `m.briefing` inside the composer — matches zero modules **forever**:
  that array is `readonly JarvisModuleManifest[]` and its only production supplier is
  `getBuiltInModuleManifests()` (`packages/module-registry/src/index.ts:1311,1318`). Every unit test
  here hand-injects manifests, so the shortcut leaves all of them green and the dead path shows up
  only in UAT.
- **`selected_tool_names` is the user's gate**, exactly as for every core section. A module that
  declares a briefing but is not selected does not run at all.
- **Sanitize what the module returns.** `headline` and each item's `id`/`title`/`detail` are non-empty
  strings within their caps; one malformed item is dropped without costing the user the section; a
  malformed headline drops the whole contribution. `href` is accepted only as a same-origin path
  (`/…`, not `//`) or an `http:`/`https:` absolute URL (L17) — a module is sandboxed content, and a
  `javascript:` or `data:` href in a briefing line is an injection vector.
- **A module that cannot answer must not take the briefing down.** Failures are swallowed and the
  user still gets every other section. **Corollary (J3): a test that asserts a rejection proves
  nothing** — assert on the composed briefing output.
- **The runtime verifies nothing (B2, M7).** `ExternalModuleWorkerRuntime.invoke` takes a discovery
  and starts it (`worker-runtime.ts:55`). Every check — active-user membership, `status !==
"enabled"`, and both `manifest_hash` and `package_hash` against the on-disk discovery — lives in
  `createExternalModuleJobHandler` (`external-module-job-handler.ts:50-61`), which also constructs
  the actor-scoped RPC with its `toolRisk`, cipher, and admin probe (`:66-84`). Calling
  `runtime.invoke` directly from the briefing adapter means a disabled, stale, or tampered module
  contributes briefing content with nothing failing. So the gate is **extracted into one helper and
  the job handler is rewritten to call it** — a refactor of the job path, not an addition beside it.
  Two copies of a trust gate is one copy that rots. The helper performs, in this order:
  `listActiveUserIds` membership, `discoveryById` lookup, the `app.external_modules` row read, the
  `status`/`manifest_hash`/`package_hash` comparison, `createExternalModuleRpcHandler` with the
  actor-scoped data context, and only then `runtime.invoke`. Compare `package_hash`, not
  `manifest_hash` alone (F10).
- **Both new `registerWorkers` dependencies are optional** — a host with zero external modules must
  still boot, and every existing unit test constructs that object without them. They arrive as
  _dependencies of_ `registerWorkers`, never constructed inside `packages/module-registry`, which has
  neither external discovery nor the external runtime; importing them there would violate module
  isolation (J2).
- **Leave `defaultComposeDeps` (`packages/briefings/src/jobs.ts:121`) unchanged** — it has no module
  runtime, so it correctly produces no external sections.
- **Do not migrate sports and news to this seam** in this task. Separate cleanup, separate issue.

**Tests**

`tests/unit/module-briefing-seam.test.ts` — against `collectExternalBriefingContributions` with a
`vi.fn()` invoker and two hand-built manifests, one declaring a briefing and one not:

1. **Invokes only modules that declare a briefing handler** — one call, with the exact argument
   object (`moduleId`, `handler`, `actorUserId`, `requestId`, `section`), and one contribution out.
   Assert the argument, not just the call count: a caller that passes the wrong actor would still be
   "called once".
2. **Skips a module the user has not selected** — empty `selectedToolNames` means the invoker is
   never called. Catches an implementation that invokes first and filters after, which would run a
   worker the user has switched off.
3. **Skips a module that does not declare this section** — a `["morning"]` module is not invoked for
   `"evening"`.
4. **A handler that throws drops that module without failing the briefing** — result is `[]`, no
   rejection.
5. **A wrongly-shaped contribution is dropped rather than trusted** — `{ headline: 42 }` yields `[]`.
6. **One bad item does not discard the whole contribution** — two items in, one malformed; the good
   item survives. This is the difference between a strict parser and a hostile one.
7. **Items are capped at `MAX_ITEMS`** — 40 in, 20 out. Catches a module flooding a briefing.
8. **A non-`http(s)` href is dropped, not emitted** — `javascript:alert(1)` leaves the item with no
   `href` property at all (assert `not.toHaveProperty`, so a `href: undefined` that a renderer might
   still stringify also fails).

`tests/unit/external-module-briefing-manifest.test.ts` — all three assert through
`validateExternalModuleManifest()` and its **validated output**, never the raw JSON (F1):

9. **The block survives manifest reconstruction** — `res.manifest.briefing` deep-equals what went in.
   This is the test that fails if the re-emit line is missing, and nothing else catches it.
10. **A briefing block on a module with no `runtime` is rejected** — a handler with no worker to run
    it.
11. **An unknown section is rejected** — `["lunchtime"]` fails validation rather than being silently
    normalized away.

Integration (`tests/integration/job-search.test.ts`, real database) — **on the briefing path
specifically**; the job path passing proves nothing about the new caller:

12. **A module row with `status = 'disabled'` contributes no section.**
13. **A module whose stored `package_hash` differs from the discovery's contributes no section.**
14. **A module whose stored `manifest_hash` differs contributes no section.**
15. **The happy path contributes a section** — without this, 12–14 all pass against an invoker that
    never invokes anything.

All four assert on the **composed briefing output**, not on a thrown error (J3).

**Verify**

```bash
pnpm vitest run tests/unit/module-briefing-seam.test.ts tests/unit/external-module-briefing-manifest.test.ts   # exit 0
pnpm typecheck                                                                                                 # exit 0
```

---

### Task 2b: `ctx.notify` port for in-app notifications

Ben asked for an in-app notification when new matches land. `ModuleWorkerContext` has no `notify`
port (D1), so a module worker currently has no way to tell the user anything. Generic seam — finance
would use it for a sync failure, news for a breaking story.

**Depends on:** Task 1 (it widened `ExternalModuleRpcError` with `detail`; this task adds one member
to its code union).

**Files**

- Read first: `rg -n "notification" packages/notifications/src --files-with-matches` — the existing
  store and the shape the shell already renders
- Modify: `packages/module-sdk/src/worker.ts` — the port
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service `notify.post`
- Create: `packages/notifications/sql/<next>_notification_event_keys.sql`
- Modify: `packages/notifications/src/repository.ts`, `routes.ts`;
  `packages/shared/src/notifications-api.ts` (**DTO and response schema**);
  `tests/integration/foundation-schema-catalog.test.ts`; the web notification list component
- Modify: `apps/api/src/external-module-tools.ts:44` and
  `apps/worker/src/external-module-job-handler.ts:67` — both RPC construction sites
- Test: `tests/unit/external-module-notify-port.test.ts`, plus integration cases

**Contracts**

```ts
export interface ModuleNotifyPort {
  /** Post an in-app notification for the invoking actor. Rendered from these
   * fields — never from model prose. Rate-limited host-side per module. */
  post(input: {
    /** Stable per-event key. Re-posting the same key updates rather than duplicates. */
    readonly key: string;
    readonly title: string;
    readonly body: string;
    /** In-app route to open. Same-origin path only. */
    readonly href?: string;
  }): Promise<void>;
}
```

reachable as `ctx.notify`. Host-side, on the RPC handler input type:

```ts
readonly postNotification?: (
  access: AccessContext,
  input: CreateNotificationInput
) => Promise<void>;
```

`CreateNotificationInput` gains `eventKey?: string` and `href?: string`.
`ExternalModuleRpcError`'s code union gains `"rate_limited"`.

The keyed upsert, verbatim — one modifying CTE, the shape `markRead` already uses
(`repository.ts:249-257`):

```sql
WITH upserted AS (
  INSERT INTO app.notifications
    (id, module_id, actor_user_id, recipient_user_id, title, body, metadata, href,
     event_key, urgency, deferred_until, created_at, updated_at)
  VALUES ($1, $2, app.current_actor_user_id(), app.current_actor_user_id(), $3, $4, $5, $6,
          $7, $8, $9, now(), now())
  ON CONFLICT (recipient_user_id, module_id, event_key) WHERE event_key IS NOT NULL
  DO UPDATE SET title = excluded.title,
                body = excluded.body,
                metadata = excluded.metadata,
                href = excluded.href,
                urgency = excluded.urgency,
                deferred_until = excluded.deferred_until,
                updated_at = now()
  RETURNING *
),
cleared AS (
  DELETE FROM app.notification_reads
  WHERE notification_id IN (SELECT id FROM upserted)
    AND user_id = app.current_actor_user_id()
)
SELECT * FROM upserted;
```

`markRead` gains a row lock so a concurrent refresh cannot interleave:

```sql
INSERT INTO app.notification_reads (notification_id, user_id, read_at)
SELECT n.id, app.current_actor_user_id(), now()
FROM (
  SELECT id FROM app.notifications
   WHERE id = $1::uuid
   FOR UPDATE
) n
ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
RETURNING notification_id, read_at
```

**Constraints**

- **Serve `notify.post` before `withDataContext`**, beside `attachments.readText` (~:117) and ahead
  of the call at `:152` — the injected `postNotification` takes an `AccessContext` and opens its own
  data context, exactly as `readAttachmentText` does, which is also what keeps `workerDataContext`
  legal as `null` in the unit harness (K4).
- **Caps, rejected not coerced:** `key` ≤ 200, `title` ≤ 200, `body` ≤ 2000, all non-empty;
  five notifications per invocation, then `rate_limited`. Silently shortening a module's copy would
  make the tray disagree with what the module thinks it said. A crawl summarises; it does not
  narrate.
- **The per-invocation counter lives in the factory closure**, beside `let aiCalls = 0;`
  (`worker-rpc-host.ts:110-113`) — not inside the returned `async (method, …) =>`, where it resets
  every call and never trips, and not at module scope, where it leaks across invocations and silences
  the second crawl of the day (C4).
- **`href` is a same-origin path**: starts with `/`, never `//`, no scheme (L17). Rejected at the RPC
  boundary **and** validated again in the repository — a module-supplied absolute URL in the
  notification tray is an open-redirect surface, and the rpc guard is the second belt, not the only
  one.
- **The rename `key` → `eventKey` happens at the host boundary and nowhere else.** `key` is what the
  published SDK port declares; `eventKey` is the repository's field. Type `postNotification` against
  the repository's real `CreateNotificationInput` imported from `@jarv1s/notifications`, never an
  inline `{…}` — an inline shape lets the two names drift while both sides typecheck and the field
  silently vanishes.
- **`postNotification` is optional on the handler input** (unlike Task 1's `embeddingProvider`), with
  an explicit `if (!input.postNotification) throw invalidRpc(...)` guard in the branch, so a host that
  chooses not to offer a tray fails loudly. It must still be threaded at **both** construction sites —
  the crawl that posts these runs on the worker one (K5).
- **Ruling: a keyed re-fire returns the notification to unread.** Three new matches this afternoon is
  not "already seen" because you read this morning's two. Task 2d's badge count and Task 22's badge
  test both derive from this sentence.
- **Unread is the _absence_ of a row in `app.notification_reads`** — left join,
  `where reads.notification_id is null` (`repository.ts:355-369`). Updating the notification row
  alone leaves the read row intact and the badge stays cleared, which is exactly the bug the ruling
  exists to prevent. Two separate statements are not good enough either: a failure between them
  leaves a refreshed notification that still reads as seen, and there is no reconciliation pass.
  Hence the single CTE.
- **Three details in that CTE that are easy to get wrong.** `created_at` is deliberately absent from
  the `DO UPDATE` list, which is why `updated_at` must exist — the tray orders by `created_at DESC`
  (`0008_notifications_module.sql:18`), so a refreshed notification would stay buried. Ordering
  becomes `coalesce(updated_at, created_at) desc` with a matching index; `updated_at` need not reach
  the DTO. `deferred_until` is **recomputed** on the re-fire exactly as `create` computes it today
  (`repository.ts:193-201`), so a keyed event re-firing inside quiet hours does not ping. The
  `user_id` predicate on the delete is load-bearing: without it the statement would clear other
  actors' read rows if the policy ever widened.
- **The migration must ship four grant-and-policy pairs that do not exist today.** Multiple
  statements in one file is correct here — the one-statement rule
  (`validateModuleMigrationSql`, A3) governs _external_ module migrations, and the live
  `0071_notifications_worker_insert_grant.sql` is itself a grant plus two policies. The file does six
  things: add `event_key text`, `href text`, `updated_at timestamptz NOT NULL DEFAULT now()`; the
  partial unique index on `(recipient_user_id, module_id, event_key) where event_key is not null`
  (partial, so keyless behaviour is untouched); then
  - `GRANT UPDATE ON app.notifications TO jarvis_app_runtime` **plus** a `notifications_update`
    policy — the grant today is `SELECT, INSERT`
    (`packages/notifications/sql/0008_notifications_module.sql:24`) and the only policies are
    `notifications_select` and `notifications_insert` (`:39`, `:48`), so `ON CONFLICT … DO UPDATE`
    fails with a permission error without both. Mirror the insert predicate,
    `recipient_user_id = app.current_actor_user_id()`, in `USING` and `WITH CHECK`.
  - `GRANT DELETE ON app.notification_reads TO jarvis_app_runtime` **plus** a
    `notification_reads_delete` policy — grant today is `SELECT, INSERT, UPDATE` (`:25`), three
    policies (`:61`, `:75`, `:89`). Copy `notification_reads_update`'s `USING` clause verbatim,
    including its `EXISTS` guard against a visible parent.
  - **The same two grants and two policies again for `jarvis_worker_runtime`, or none of this runs in
    production.** The crawl posts from the worker, whose grants are `SELECT, INSERT` on
    `app.notifications` (`0071…:16`) and `SELECT` only on `app.notification_reads` (`0166…:5`), so the
    upsert dies on the first keyed notification while the api-side path passes every test. `0071` is
    the template, including its reason for granting `SELECT` alongside: `RETURNING *` requires
    `SELECT` on the returned columns or the statement errors and poisons the transaction. Mirror the
    app-role predicates **exactly** — widening them for the worker would be a privilege escalation
    dressed as a grant.
- **Migration placement:** a new file in `packages/notifications/sql/`, discovered by directory scan
  (`packages/notifications/src/manifest.ts:38-40`). The manifest's `database.migrations` array is
  **not** the gate (`0166` and `0170` are live and absent from it); the gate is
  `tests/integration/foundation-schema-catalog.test.ts:289`, which asserts the full catalog with
  `toEqual` (A2) — add the new `{version, name}` row or the gate fails.
- **`href` must be declared in the response schema** (`packages/shared/src/notifications-api.ts`), not
  only the DTO type: the Fastify serializer silently drops undeclared fields, so it would vanish
  between the database and the browser with nothing failing (I8).
- **This write path must populate `notifications.module_id`** — Task 2d's per-module counts depend on
  it. The column already exists (`NotificationDto.moduleId`, `notifications-api.ts:20`).

**Tests**

`tests/unit/external-module-notify-port.test.ts` — same synthetic discovery and seven-input harness
as Task 1 (K2), with `postNotification` injected as a `vi.fn()`:

1. **Writes a notification scoped to the invoking actor** — assert `postNotification` was called with
   **two** arguments, `(access, input)`, the first containing the actor id and the second containing
   `moduleId: "job-search"` and **`eventKey`**, and assert the input does **not** have a `key`
   property. Asserting `key` here would pass against a host that forwards a field the repository
   ignores — the exact drift this case exists to catch.
2. **A cross-origin `href` is rejected rather than posted** — `https://evil.example/steal` throws
   `invalid_rpc` and the store was never called.
3. **An over-long body is rejected rather than truncated** — 2001 characters throws `invalid_rpc`,
   store never called.
4. **The per-invocation cap trips** — five succeed, the sixth throws `rate_limited`, and the store was
   called exactly five times.
5. **Each invocation gets its own budget** — exhaust one handler's five, then build a **second**
   handler from the same factory and assert its first post resolves. Only a second handler catches
   both misplacements of the counter; a single-handler test passes against either bug.

Integration (real database, both roles):

6. **The same `eventKey` twice yields one row**; **different `eventKey` yields two**; **an absent
   `eventKey` always creates a new row** (unchanged behaviour).
7. **An absolute or protocol-relative `href` is rejected** by the repository, independent of the RPC
   guard.
8. **`href` survives the REST response schema** — asserted through `app.inject`, never against the
   repository's return value, which cannot observe the serializer.
9. **Return-to-unread, run under the worker role.** Post, mark read, repost the identical
   `event_key`, assert the unread count is back to one **at both tiers** — repository count and REST
   response — because the failure mode is a projection disagreeing with the row. Run the repost
   through a real `jarvis_worker_runtime` data context: an app-role-only test is green against a
   migration that forgot the worker grants entirely. Assert the app-role path too, since the tray's
   own mark-read runs there.
10. **Read rows belong to their reader** — with actor A's read row present, run the upsert as actor B
    and assert A's row survives.
11. **A concurrent `markRead` and refresh leave the notification unread** — open **two** data contexts
    for the same actor, run `markRead` on one inside an explicit transaction held open, fire the
    refresh on the other, then commit; assert unread and that neither statement errored. Both
    statements on one connection serialize for free, so a single-connection version of this test
    passes against the unlocked SQL and proves nothing (K10).

**Verify**

```bash
pnpm vitest run tests/unit/external-module-notify-port.test.ts   # exit 0
pnpm typecheck                                                   # exit 0
pnpm test:integration tests/integration/notifications.test.ts    # exit 0 (runs the whole suite)
```

---

### Task 2c: Honour the chat surface the shell already anticipates

**Read this before assuming scope.** Per-surface chat is **already built end-to-end** (H1–H5):
`ChatSurface` is a branded string with `DEFAULT_CHAT_SURFACE = "drawer"` and `normalizeChatSurface()`
(`packages/shared/src/chat-api.ts`); `useChatStream(surface)` opens `EventSource(chatStreamUrl(surface))`
and lists threads per surface; the turn route and privacy start/end/state all read it
(`packages/chat/src/live-routes.ts`); sessions and subscriptions are keyed by **actor + surface**
(`gateway-notifier.ts`), so no cross-surface transcript path exists; migration `sql/0174_chat_surface.sql`
has shipped. The **only** gap is `apps/web/src/shell/app-shell.tsx`, which calls `useChatStream()` with
no surface and returns `recordsForSurface: () => records` — its own comment says so. This task closes
that one file. Bounded shell wiring, not a new subsystem.

**Depends on:** nothing. Tasks 17 and 22 depend on it.

**Files**

- Create: `apps/web/src/shell/chat-surface-key.ts`
- Modify: `apps/web/src/shell/app-shell.tsx` (~100–190)
- Modify: `apps/web/src/app.tsx` — `ExternalModuleMount` binds the surface handle to the module id
  alone today; accept a module-supplied **key** (never a surface)
- Modify: `apps/web/src/chat/assistant-surface/{contracts.ts,handle.ts}` — `setSurfaceKey`,
  `seedContext`
- Modify: `packages/chat/src/live-routes.ts` — the generic seed route
- Modify: `packages/shared/src/chat-api.ts` — its client function
- Test: `tests/unit/app-shell-chat-surface.test.tsx`, `tests/unit/chat-seed-route.test.ts`

**Contracts**

```ts
// apps/web/src/shell/chat-surface-key.ts
export function moduleChatSurface(moduleId: string, key: string): string;

// AssistantSurfaceHandleV1
/** Called when the active profile changes; `null` returns the shell to the drawer. */
setSurfaceKey(key: string | null): void;
/** Frames the thread on this surface BEFORE the user's first turn. Surface is curried
 *  by the handle, exactly as submitTurn already does — the module never names one. */
seedContext(seed: string, idempotencyKey: string): Promise<void>;
```

`POST /api/chat/seed` — body `{ seed: string, idempotencyKey: string, surface?: string }`, returns
**204 with no body**; `400` on a seed that is empty or over 8000 characters, on an
`idempotencyKey` that is empty or over 128, and on a surface `normalizeChatSurface` rejects; `401`
unauthenticated. Same rate-limit bucket and `keyGenerator` as the other chat mutations. It delegates
to the existing `ChatSessionManager.seedContext(actorUserId, userName, seed, idempotencyKey?, surface?)`
(`packages/chat/src/live/chat-session-manager.ts:376-392`).

**Constraints**

- **The surface string is not free-form.** `chat-api.ts:14` constrains it to
  `/^[a-z][a-z0-9-]{1,31}$/` — 2–32 chars, lowercase, digits and hyphens, **no colons**, must start
  with a letter — and every chat route runs `normalizeChatSurface`, which throws `Invalid chat
surface`. The obvious `module:job-search:profile-1` would 400 **every single turn** (H3). Neither
  input can be concatenated in: `MODULE_ID_RE` (`validate.ts:28`) is unbounded and may start with a
  digit, and the module-supplied key is arbitrary text.
- **So the shell derives the wire surface by hashing, and the module never supplies one.**
  `moduleChatSurface` computes 64-bit **FNV-1a** over `` `${moduleId}:${key}` `` — two 32-bit lanes,
  one over the input forwards and one backwards — and returns `` `m-${hi}${lo}` `` with each lane as
  8 zero-padded hex characters: 18 characters, leading letter guaranteed, under the 32 cap. `:` is a
  safe separator precisely because `MODULE_ID_RE` forbids it in a module id, so `(id, key)` pairs
  cannot alias. FNV rather than sha256 because this runs in a **synchronous render path** and
  `crypto.subtle` is async; collision resistance is not a security boundary here — surfaces are
  namespaces inside one user's own account and both inputs are host-known.
- **The host owns the binding** (#1196, `apps/web/src/app.tsx:353`: "the surface name comes from the
  host mount, never from module code"). `setSurfaceKey` takes a key; the shell combines it with the
  **host-held** module id. Deterministic across reloads, so a profile's transcript stays re-findable.
  The surface is opaque on the wire; the human-readable scope pill comes from the module's label.
- **`recordsForSurface(surface)` returns `records` only when `surface === activeSurface`, `[]`
  otherwise.** Ben's ruling: a job-search thread must never appear in the main drawer.
- **Reset to `DEFAULT_CHAT_SURFACE` on `null` and on unmount.**
- **Why a seed seam, and why this one.** A module-owned thread that opens with no framing is a
  generic assistant that happens to render inside Job Search. The three existing mechanisms are each
  wrong: `hostActions.openAssistant({starterPrompt})` and `seedComposer` insert an **editable draft**
  the user reads as their own text and can delete (I5) — right for "help me tighten this search",
  wrong for framing; `submitTurn` posts the seed as a visible user message. `seedContext` submits to
  the engine **without a visible user turn**, and its `idempotencyKey` (`session.seededContextKeys`)
  makes a re-seed a no-op, so a remount cannot re-frame a live conversation.
- **Generalise the evening-interview route rather than copying it.** `seedContext`'s only caller today
  is a route dedicated to one feature (`live-routes.ts:387-402`). One generic route serves every
  surface owner.
- **Trust note — put it in the code comment too.** The seed is module-authored text entering the
  model's context and carries exactly the authority a user turn carries, no more. It must never be
  described as, or given the standing of, a system prompt: an installed module that could rewrite the
  assistant's instructions is a privilege escalation.
- **The 8000-character cap is checked server-side** because the browser is not the trust boundary.
- **204 with no body is deliberate** — a Fastify response schema silently drops undeclared fields
  (I8), and a route with no body has nothing to lose.

**Tests**

`tests/unit/app-shell-chat-surface.test.tsx` — mock `useChatStream` so the assertions are about the
**surface argument the shell passes**, not SSE behaviour. Mock the specifier `app-shell.tsx:43`
actually imports (`../chat/use-chat-stream`); there is no `shell/use-chat-stream`, and mocking a path
that resolves to nothing silently does nothing while the real hook opens an EventSource in jsdom
(K7). Write `renderWithModuleMount` inline against real exports — do not add a test-only export to
production code.

1. **Opens `"drawer"` by default.**
2. **Switches to the module surface when a module sets a key** — last call equals
   `moduleChatSurface("job-search", "profile-1")`.
3. **Derives a surface the server will actually accept** — feed the derived value to the **real**
   `normalizeChatSurface`, unmocked, and assert it does not throw. Deliberately not a golden string:
   this is the assertion that rejected the original `module:<id>:<key>` scheme.
4. **Derives a legal surface from hostile inputs** — a module id starting with a digit and 120
   characters long, plus a key containing spaces, punctuation and an emoji, still normalizes.
5. **Two profiles of the same module get different surfaces.**
6. **Module records stay out of the drawer transcript** — with a module surface active,
   `recordsForSurface("drawer")` is `[]`.
7. **Unmount returns the shell to `"drawer"`.**

`tests/unit/chat-seed-route.test.ts` — `app.inject` against the real route:

8. **Seeds the requested surface and returns 204** — assert `manager.seedContext` received the actor,
   the seed, the key, **and the surface**, in that positional order.
9. **A repeat with the same idempotency key still reaches the manager** — assert the _second_ call's
   arguments. The manager owns the dedupe; the route's job is to pass the key through. This guards the
   real failure: a module remount re-framing a conversation already in progress.
10. **An 8001-character seed is a 400.**
11. **An illegal surface is a 400, not a 500** — `module:job-search:p1` must be mapped by
    `handleLiveRouteError`, not escape as an unhandled throw.
12. **An unauthenticated call is a 401.**

**Verify**

```bash
pnpm vitest run tests/unit/app-shell-chat-surface.test.tsx tests/unit/chat-seed-route.test.ts  # exit 0
pnpm --filter @jarv1s/web typecheck                                                             # exit 0
```

---

### Task 2d: Manifest-declared nav badge, counted from the module's own notifications

Ben asked for a count badge on the Job Search nav entry. `navigation[]` entries validate to
`{id, label, path, icon?, order?}` only — there is no badge field, and the validator drops one (F1).

**Where the count comes from — settle this before designing anything.** A badge cannot be polled from
a module assistant tool. At HEAD the gateway emits `action_result` with `{actionRequestId, toolName,
outcome}` and never populates `result`; the field exists on the wire and nothing fills it, so a module
surface reading `record.result` gets `undefined` forever, silently (I6, M5). Building that opt-in is a
core project in its own right and is not needed here.

The count the badge wants is already a first-class core concept. Task 2b gives the module
`ctx.notify.post`, and `NotificationDto` already carries `moduleId` (G6). So the badge is **this
module's unread notification count** — no polling, no new channel, and the badge and the notification
bell can never disagree, which is what a user expects anyway. The only core addition is a per-module
breakdown of a number the API already computes.

**Depends on:** Task 2b — the core count change stands alone, but the badge is only ever non-zero once
the module can post notifications. Task 22 asserts the badge end to end (L8).

**Files**

- Modify: `packages/notifications/src/repository.ts` — `countUnreadByModule` beside `countUnread`
  (:355), returned from `listVisible` (:153)
- Modify: `packages/notifications/src/routes.ts` — pass it through the list handler
- Modify: `packages/shared/src/notifications-api.ts` — `unreadByModule` on `ListNotificationsResult`
  / `ListNotificationsResponse` **and on the response schema** (near the `required` list at :93)
- Modify: `packages/module-sdk/src/index.ts` — `ExternalModuleNavigationEntry.badge?`
- Modify: `packages/module-registry/src/external/validate.ts` — validate it and re-emit it in the
  navigation entry literal (~:640)
- Modify: the shell nav renderer (`rg -n "navigation" apps/web/src/shell --files-with-matches`)
- Modify: `packages/shared/src/platform-api.ts` — `badge?` on `ModuleNavigationEntryDto` (:34-40)
  **and** on `moduleNavigationEntrySchema` (:143-154, `additionalProperties: false`), declared in
  `properties` but NOT in `required`. Follow the `#918` `web` precedent at :193-198.
- Modify: `apps/api/src/server.ts` — `serializeExternalModule` (:896-902) hand-enumerates the
  navigation fields, so it must re-emit `badge` conditionally. NOT the mapper at :863; badge is
  external-only. **Ruling G8** — without these two the badge validates, renders, and never
  arrives, and a type-level assertion still passes.
- Test: `tests/unit/external-module-nav-badge.test.ts`,
  `tests/integration/notifications-unread-by-module.test.ts`

**Contracts**

```ts
// packages/module-sdk/src/index.ts — on ExternalModuleNavigationEntry
readonly badge?: {
  /**
   * Closed enum with one member today. A badge is always derived from a core-owned count —
   * never from module-supplied text or a module tool result — so the module can only choose
   * *which* core count, never the number itself.
   */
  readonly source: "notifications";
};
```

```ts
// packages/shared/src/notifications-api.ts — on ListNotificationsResult / ListNotificationsResponse
readonly unreadByModule: Readonly<Record<string, number>>;
```

`unreadByModule` is keyed by `module_id` across **all** of the actor's visible notifications, not just
the returned page. Core notifications (`module_id IS NULL`) are excluded from the map; they are already
covered by the existing top-level `unreadCount`.

Response-schema fragment, verbatim — this field is dropped on the wire without it (G7):

```json
{ "type": "object", "additionalProperties": { "type": "integer", "minimum": 0 } }
```

**Constraints**

- **The count is a SQL aggregate under RLS, mirroring `countUnread` (:355) exactly** — same left join
  to `app.notification_reads`, same `deferred_until` guard — but grouped by `module_id`, with
  `module_id IS NOT NULL`. Read state lives in a separate table (G1); a count that forgets the join
  counts read notifications.
- **Add `unreadByModule` to the response schema, not just the TypeScript interface** (G7). Leave it
  out of `required` only if the client also defaults it to `{}`.
- **Validate `badge` positively** — an object, exactly the key `source`, value strictly
  `"notifications"` — and re-emit it in the `validated.push({…})` literal. The validator defensively
  reconstructs and drops anything it does not know about (F1), so validating without re-emitting
  passes its own test and still ships nothing.
- **The shell renders `unreadByModule[moduleId] ?? 0`** from the notifications query it already runs
  (`apps/web/src/shell/app-shell.tsx:227`), reusing `formatUnreadCount` (:386) so 100+ renders as
  `99+` exactly like the bell. Nothing at 0 or while loading. **Never** render a badge from any
  module-supplied value (L9).
- **A badge test that omits `runtime` or a complete `assistantTools` entry fails the manifest before
  the badge logic is reached** and reads as a badge bug. `assistantTools` entries require `name`,
  `permissionId`, `description`, `risk`, `handler` (F3), and declaring any assistant tool makes
  `runtime` required (`validate.ts:425`). Build the fixture from
  `external-modules/finance/jarvis.module.json`.

**Tests**

`tests/unit/external-module-nav-badge.test.ts` — against the real `validateExternalModuleManifest`:

1. **A declared badge survives manifest reconstruction** — `manifest.navigation[0].badge` equals
   `{source: "notifications"}`. Fails against a validator that checks the field but forgets to re-emit
   it, which is the failure mode F1 makes likely.
2. **An unknown badge source is rejected** — `{source: "tool"}` fails. Fails against a validator that
   accepts any string, which would let a future source ship by accident.
3. **A badge that is not an object is rejected** — `badge: "notifications"`.
4. **A navigation entry with no badge still validates** — the field is optional and no existing
   module manifest may break.

`tests/integration/notifications-unread-by-module.test.ts` — integration, not unit: the count is a
SQL aggregate under RLS and the thing most likely to be wrong is the join to `notification_reads`,
which a mocked repository never exercises.

5. **Counts unread notifications per module, for the actor only.** Seed an owner with two
   `job-search` notifications, one `news`, one core (`module_id IS NULL`), one already marked read,
   plus one `job-search` notification belonging to a different user. Assert
   `unreadByModule` equals `{"job-search": 2, news: 1}` and `unreadCount` is 4. Every number here
   catches a distinct broken implementation: `news: 1` proves the result is keyed rather than one
   filtered count; the absence of `"job-search": 4` proves both the read notification and the other
   user's are excluded; `unreadCount === 4` proves the core notification stays out of the map but
   still reaches the bell.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-nav-badge.test.ts                                            # exit 0
pnpm vitest run --config vitest.integration.config.ts tests/integration/notifications-unread-by-module.test.ts  # exit 0
pnpm typecheck                                                                                          # exit 0
```

---

### Task 2e: Invocation stall budget, per-lane isolation, and a deadline the module can see

**A blocker for Phase 4, not a nice-to-have.** `ExternalModuleWorkerRuntime.run()` caps every
external-module invocation at 30 s of wall clock (`worker-runtime.ts:88-92`,
`this.options.invocationTimeoutMs ?? 30_000`; neither construction site overrides it —
`apps/api/src/external-module-tools.ts:38`, `apps/worker/src/worker.ts:211`). That clock keeps running
while the **host** services the module's own RPCs back to it: every `fetch.request`, every
`ai.generateStructured`. A handler doing nothing but waiting on the host is charged for the wait and
then killed.

Three problems share this one seam, and this task fixes all three:

1. **One pass cannot fit.** A worker handler cannot enqueue (D2), so crawl → triage → score must run
   in a single invocation (Task 15) — up to ten HTTP requests per portal plus up to eight
   `ai.generateStructured` calls (C1), any one of which routinely takes 10–30 s. The pass is killed
   long before it finishes, at a different point every time, because whether it trips depends only on
   model latency. **And the failure is invisible**: an audit row of `failed / handler_error` with
   nothing in the API log, because `runHandler` in `packages/ai/src/gateway/gateway.ts` swallows
   handler throws with a bare `catch {}`. Confirm it by comparing timestamps — if the audit
   `occurred_at` precedes the matching `ai.structured usage` line, the AI finished after the
   invocation was already dead. There is no bug in the module.
2. **Every call to a module shares one lane** (B1). While a six-hourly crawl runs, the user's own chat
   tool calls queue behind it — "the assistant hangs when I ask about my job search".
3. **Nothing tells the module how long it has** (D1, B6). Task 14's per-portal deadline and Task 15's
   `CRAWL_SHARE` both depend on a value that does not exist anywhere in the protocol today. And the
   module could not cancel host-held work even with a signal: no module-facing port accepts one and
   an `AbortSignal` cannot cross JSON-RPC. The deadline the module can see and the cancellation of
   work the host is holding are two different problems; both are solved here, the second host-side.

**Depends on:** Task 2 (its `apps/worker/src/external-module-invoke.ts` becomes the only worker-side
caller of `runtime.invoke`). Tasks 11, 13, 14 and 15 depend on this.

**Files**

- Modify: `packages/module-registry/src/external/worker-runtime.ts` — the timeout in `run()` (:88-92),
  the per-module maps in `invoke()`/`run()`/`start()`/`failProcess()`, and the `module.invoke` params
  written to stdin (:100-102)
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — signal RPC start/finish to the
  runtime so the stall budget can be suspended; accept the invocation's host-side `AbortSignal` as a
  fourth handler argument and forward it into the pinned fetch call (:134) and the AI request
- Modify: `packages/module-sdk/src/worker.ts` — read `deadlineAt` off the invoke params; put
  `deadlineAt` (a number, and nothing else) on `ModuleWorkerContext`
- Modify: `apps/worker/src/external-module-job-handler.ts` — pass `lane: "queue"` and the queue's
  declared ceiling
- Modify: `apps/api/src/external-module-tools.ts` — pass `lane: "tool"`
- Modify: `apps/worker/src/external-module-invoke.ts` — takes `lane` as a required argument and
  forwards it; the job handler passes `"queue"`, the briefing adapter passes `"briefing"`
- Modify: `packages/module-registry/src/external/validate.ts` — accept, validate and clamp
  `queues[].timeoutMs`
- Modify: `packages/module-sdk/src/index.ts` — `timeoutMs?: number` on the queue declaration type;
  `ExternalModuleAiRequest` gains an optional host-side `signal`
- Test: `tests/unit/external-module-invocation-budget.test.ts`

**Contracts**

```ts
// worker-runtime.ts — replaces the single `invocationTimeoutMs` option.
export interface ExternalModuleWorkerRuntimeOptions {
  /** Max time the module may go WITHOUT progress. Suspended while a host RPC is in
   *  flight, so host latency is never charged to the module. Default 30_000. */
  readonly invocationStallMs?: number;
  /** Absolute ceiling on one invocation regardless of progress. Default 120_000. */
  readonly invocationHardTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly logger?: { warn(data: Record<string, unknown>, message?: string): void };
}

/** A lane is a SEPARATE CHILD PROCESS, not a separate promise chain over a shared one.
 *  Sharing a child across lanes is a cross-actor leak, not a queuing nicety — see Constraints.
 *
 *  THREE lanes, not two. `briefing` exists because Task 2's briefing invoker is a third caller
 *  of `invoke()` and it must not sit behind the queue lane: briefing composition is on a user's
 *  morning path, and a six-hourly crawl in the queue lane can legitimately hold that lane for
 *  minutes. Putting it in `tool` instead would be cheaper by one warm child, but it would let a
 *  slow briefing delay the assistant's own tool calls, which is the exact failure this task was
 *  opened to fix. */
export type WorkerLane = "queue" | "tool" | "briefing";

/** Ceiling on any queue's declared `timeoutMs`. A manifest is module-authored input, so the
 *  host's maximum wins over whatever it asks for. */
export const MAX_INVOCATION_MS = 600_000;

/** The module gets a deadline strictly inside the hard kill, so it can persist partial results
 *  and return cleanly instead of being SIGKILLed mid-write. */
export const DEADLINE_MARGIN_MS = 5_000;

/** `options` is REQUIRED, and `lane` is required within it. There is no default: a
 *  silently-defaulted lane is how a background job ends up in the foreground lane and the
 *  isolation this task buys is quietly given back. */
invoke(
  module: ExternalModuleDiscovery,
  handler: string,
  input: Record<string, unknown>,
  rpc: Rpc,
  options: { readonly lane: WorkerLane; readonly timeoutMs?: number }
): Promise<unknown>;

resolveHardTimeout(options: { readonly timeoutMs?: number }): number;
```

```ts
// module-sdk/src/worker.ts — ModuleWorkerContext gains the deadline, and only the deadline.
interface ModuleWorkerContext {
  // …existing ports: input, auth, fetch, kv, ai, db, attachments…
  /** Absolute epoch ms after which the host will hard-kill this invocation. This is the
   *  form every stage budget in Phase 4 is written against: compare it to a clock. */
  readonly deadlineAt: number;
  /** There is deliberately NO `ctx.signal`. No module port accepts a signal — `ctx.fetch`
   *  takes `{url, method?, headers?, bodyBase64?}` (`packages/module-sdk/src/index.ts:682`)
   *  and `ctx.ai.generateStructured` takes `{schema, prompt, maxOutputTokens?, tierHint?}`
   *  (`worker.ts:38`); an `AbortSignal` cannot be serialized across JSON-RPC; and a signal
   *  that can only cancel the module's own `await`s, while looking like it cancels the RPC
   *  it is passed beside, is a trap. A module that wants to stop its own loop compares
   *  `Date.now()` to `deadlineAt`. Cancelling work already in the host's hands is the HOST's
   *  job, through the per-invocation `AbortController` the host never exposes to the child. */
}
```

```ts
// worker-rpc-host.ts — the returned handler already takes (method, params, rememberSecret).
(method: string, params: unknown, rememberSecret: (v: string) => void, hostSignal?: AbortSignal);
```

```jsonc
// manifest: a queue may raise its own ceiling, bounded by the host.
{ "name": "job-search.crawl-run", "handler": "crawl.run", "timeoutMs": 600000 }
```

Wire format written to the child's stdin — `params` gains one field:

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "module.invoke",
  "params": { "handler": "…", "input": {}, "deadlineAt": 1234567890 }
}
```

**Constraints**

- **The stall budget measures silence, not duration** (B6, B7). It is cleared when the module asks the
  host for something and restarted when the host answers. The hard ceiling is the actual bound and is
  never suspended — without it, a module that pings the host every 29 s runs forever.
- **Suspension must be reference-counted, not a boolean.** A handler may have a `fetch` and an
  `ai.generateStructured` in flight at once; a boolean lets the first to finish restart the clock
  while the second is still blocked.
- **A lane is a separate child process.** Splitting only the serialization map while both lanes share
  one child is not a smaller version of this change, it is a security bug (B1):
  - Lane B's `state.current = invocation` (:95) overwrites lane A's while A still runs, so every RPC A
    issues afterwards executes under **B's** `rpc` closure — B's actor, B's data context, B's secret
    set — which also defeats the `containsSecret` redaction (:188, :212) because A's secrets are no
    longer the set being checked.
  - Whichever lane finishes first clears the slot (:107), so the other lane's next RPC hits
    `if (!invocation)` (:184) and **kills the process** as a protocol violation.
  - `capture` (:219) and `flushLogs` (:224) attribute stdout and stderr to whatever occupies the slot.
  - The invocation timeout (:88-92) `stop()`s the whole child, so a crawl lane timing out kills the
    user's in-flight chat tool call.
- **Every map and lifecycle hook keyed by `module.id` becomes keyed by
  `` `${moduleId}:${lane}` ``.** The call sites, so they are not re-derived — all in
  `worker-runtime.ts`:

  | Line (current) | Today                                                  | Must become                                        |
  | -------------- | ------------------------------------------------------ | -------------------------------------------------- |
  | :61-66         | `this.queues.get/set/delete(module.id)`                | `laneKey(module.id, lane)`                         |
  | :85            | `this.states.get(module.id) ?? this.start(module)`     | `this.states.get(key) ?? this.start(module, lane)` |
  | :90            | `this.states.delete(module.id)` (timeout)              | `this.states.delete(key)`                          |
  | :106           | `this.flushLogs(module.id, invocation)`                | log the lane alongside `moduleId`                  |
  | :108-113       | idle timer re-arm / `states.delete(module.id)`         | keyed by `key`                                     |
  | :143           | `this.states.set(module.id, state)`                    | `this.states.set(key, state)`                      |
  | :146-153       | `onStdout(module.id, …)` / `failProcess(module.id, …)` | pass `key`; keep `moduleId` separately for logging |
  | :240           | `if (this.states.get(moduleId) === state)`             | `if (this.states.get(key) === state)`              |

- **All three callers change in the same commit** or one silently lands in the wrong lane. The lane is
  passed explicitly — no inference from the handler name, no default.
- **The cost, stated so nobody is surprised:** up to three child processes per module while all lanes
  are warm, each released by the existing 60 s idle timer (:112). Keep per-lane serialization — one
  in-flight invocation per lane — so N concurrent jobs still cannot spawn N processes. The rejected
  alternative (tagging each RPC with an invocation id and multiplexing inside the child) needs a
  protocol version bump in `@jarv1s/module-sdk` plus concurrency inside `defineModuleWorker`, and
  still leaves one crashed lane taking down the other.
- **The deadline is absolute epoch milliseconds, not a duration.** Host and child are the same machine
  (the child is spawned at `worker-runtime.ts:124`), so epoch ms are directly comparable. A relative
  duration starts drifting the moment the child is slow to read stdin.
  `deadlineAt = Date.now() + Math.max(1_000, resolveHardTimeout(options) - DEADLINE_MARGIN_MS)`.
- **The SDK defaults `deadlineAt` to `Date.now() + 30_000` when the host omits it.** That version-skew
  default is the **only** reason the field is not mandatory in the protocol; say so in the code
  comment so it is not later "cleaned up" into a required field.
- **The host half is what makes cancellation real.** At the ceiling, `run()` aborts a per-invocation
  `AbortController` immediately before killing the child; the RPC callback takes that signal as a
  fourth host-side argument (never on the wire); `fetch.request` forwards it into the pinned fetch
  (`worker-rpc-host.ts:134`); and `ExternalModuleAiRequest.signal` forwards it into
  `generateStructured`, which already accepts `input.signal` and already returns
  `{ok: false, error: "aborted"}` (`packages/ai/src/structured/generate-structured.ts:130`, `:156`).
  This is what makes the `aborted` member of the worker-facing error union reachable at all (C4);
  today nothing in this tree can produce it for an external module. Neither construction site changes
  (`external-module-job-handler.ts:67`, `external-module-tools.ts:44`) — the signal comes from the
  runtime at `invoke`, not from the caller.
- **`validate.ts` already lets an unknown `timeoutMs` through** — it normalizes queues by spreading the
  whole queue object (M3) — so the work is rejection and clamping, not passthrough. Mirror the
  existing `retryLimit` clamp: reject a `timeoutMs` that is not a positive integer (`0`, negative,
  fractional, `NaN`, a string, `null`); clamp anything above `MAX_INVOCATION_MS` down to it. The
  validator returns `worker` reassembled from the normalized queue array, so the clamped value is what
  every caller receives (F1, B8).
- **Downstream consumers, named here so dependent tasks do not invent their own transport.** No
  module-facing port takes a signal; the deadline crosses the wire as a number and nothing else:
  - `Portal.crawl(input: { …, deadlineAt: number })` (Task 11), no `signal` parameter.
  - Every portal checks `Date.now() >= deadlineAt` **before each page fetch** and returns what it has.
  - Task 15's `runProfileStages` computes the crawl share from the time **remaining**, evaluated when
    that profile's crawl starts: `crawlDeadlineAt = now + (ctx.deadlineAt - now) * CRAWL_SHARE`. In a
    sweep the second profile's `now` is later, so it gets a share of what is actually left.
  - `runCrawl` (Task 14) narrows further per portal — an equal share of the crawl time still
    remaining, recomputed per portal, so an early finisher donates its slack.
  - Task 15's scoring stage checks `clock() < deadlineAt` before each `generateStructured` and halts
    with `"deadline"`. It passes no signal; the `aborted` branch is reachable because the **host**
    aborts the in-flight call at the ceiling.

**Tests**

`tests/unit/external-module-invocation-budget.test.ts`. The budget cases use fake timers; the lane
cases must assert on **whose context the RPCs ran under and how many children exist**, not on ordering
— a test that only asserts "the fast call returned first" passes against the broken shared-child
design too.

1. **Does not kill an invocation blocked on a slow host RPC.** Module makes one RPC, host takes 45 s,
   module returns. Under the old flat 30 s wall-clock timer this dies at 30 s having done nothing
   wrong. This is the regression the whole task exists for.
2. **Kills an invocation that goes quiet longer than the stall budget.** A module stuck in
   `while (true)` makes no RPCs, so nothing suspends the clock and it dies on schedule. Proves the
   budget still bites.
3. **Kills an invocation that exceeds the hard ceiling even while making progress.** A module RPCing
   every 20 s runs past 120 s and is killed. Without this, the stall budget alone is not a bound — it
   only measures silence.
4. **Honours a queue's declared ceiling but clamps it to the host maximum.**
   `resolveHardTimeout({timeoutMs: 600_000})` is 600 000; `{timeoutMs: 86_400_000}` is
   `MAX_INVOCATION_MS`. A manifest must not pin a worker process open for a day.
5. **Runs two lanes of one module in two separate child processes.** Actor A's queue-lane handler
   awaits a host-controlled latch while actor B's tool-lane handler completes. Assert (a) A's RPC was
   dispatched with `actorUserId === OWNER_A` — this is the cross-actor leak the shared `state.current`
   slot causes and the whole reason a lane is a process; (b) A resolves normally after the latch
   releases; (c) two distinct child pids.
6. **Does not queue a foreground tool call behind a running background job.** A never-resolving queue
   invocation does not delay a tool-lane call.
7. **Kills only the timing-out lane's child.** A queue invocation hitting a 5 s ceiling rejects while
   a latched tool invocation still resolves. Under one shared child, `stop(state)` kills both.
8. **Ships an absolute deadline in the invoke params, inside the hard ceiling.** Assert on the JSON
   written to the child's stdin — `method === "module.invoke"`, `params.deadlineAt` greater than now
   and at most `now + ceiling - DEADLINE_MARGIN_MS`. Asserted at the wire, not on a runtime getter,
   because the bug this prevents is the field never being sent.
9. **Still kills at the ceiling a handler that ignores its deadline.** The deadline is cooperative;
   the ceiling is the bound.
10. **Defaults `deadlineAt` when the host does not send one, and exposes no signal.** SDK-side: an
    older host omits the field, and the child must not compute `NaN` and abort everything
    immediately. Also assert `"signal" in ctx === false` — the sole cancellation surface is the number.
11. **Rejects a queue whose `timeoutMs` is not a positive integer** — `0`, `-1`, `1.5`, `NaN`,
    `"600000"`, `null`, each named in the failure message.
12. **Clamps a `timeoutMs` above the platform ceiling on the normalized output.** Assert on the
    returned manifest's `worker.queues[0].timeoutMs`, not the input.
13. **Passes the queue's normalized `timeoutMs` into `runtime.invoke`** — the job handler's fifth
    argument is `{lane: "queue", timeoutMs: 600_000}`. A validated, clamped ceiling the job handler
    never reads is the same as no ceiling.
14. **Invokes with the default ceiling when a queue declares no `timeoutMs`** — fifth argument is
    `{lane: "queue"}`.
15. **Invokes a briefing contribution on the briefing lane.** Drive the **real** briefing adapter
    (Task 2), not a hand-built options object — an assertion on a literal proves only that the literal
    was typed correctly. Assert the fifth argument is `{lane: "briefing"}` and is not the queue lane,
    where a running crawl would hold it (J4).
16. **At the hard ceiling an in-flight `fetch.request` aborts rather than resolving after the child is
    killed.** Assert against a real deferred HTTP handler, not a spy — the point is that host-held
    work actually stops.
17. **At the hard ceiling an in-flight AI RPC resolves `{ok: false, error: "aborted"}`.** Today
    nothing in this tree can produce that value for an external module.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-invocation-budget.test.ts   # exit 0
pnpm typecheck                                                          # exit 0
```

`pnpm typecheck` is not optional here — making `options` a required argument on `invoke()` is a
breaking signature change, and typecheck is the only thing that finds every caller, including
external modules (I7).

**User-facing summary:** Long-running module background jobs no longer fail part-way through for no
visible reason, a background job no longer blocks the assistant from answering questions about the
same module, and a job that runs out of time saves what it found instead of being cut off mid-write.

---

## Phase 1 — Module scaffold

### Task 3: Scaffold `external-modules/job-search`

The manifest every later task registers into, plus the owned-table list in a form TypeScript can
import.

**Depends on:** Task 2d (the nav `badge` field must validate) and Task 2 (the `briefing` block).
Everything in Phases 2–6 depends on this.

**Files**

- Create: `external-modules/job-search/package.json`, `tsconfig.json`, `jarvis.module.json`,
  `src/module-info.ts`, `src/db/tables.ts`
- Modify: root `package.json` — `check:external-modules` currently reads
  `tsc -p external-modules/finance --noEmit` and typechecks finance **only**
- Test: `tests/unit/job-search-manifest.test.ts`

**Contracts**

```ts
// external-modules/job-search/src/module-info.ts
/** The scaffold needs at least one file under src/: the shared tsconfig has
 * `"include": ["src"]`, and tsc exits non-zero with TS18003 ("No inputs were found")
 * on an empty include — so an empty scaffold would break `pnpm typecheck`. */
export const MODULE_ID = "job-search";
```

```ts
// external-modules/job-search/src/db/tables.ts
/** The owned-table list, in TypeScript, for everything that can import TypeScript: Task 4's
 * install test, Task 13's store, Task 21's RLS loop. A list retyped in a test is a list that
 * drifts, and an RLS test naming a table the migration never creates passes by finding nothing
 * wrong with nothing.
 *
 * It is NOT the source of truth for the manifest, and no comment here should claim it is.
 * `jarvis.module.json` is JSON — it cannot import a constant, and the shipped finance manifest
 * likewise carries a literal array (`external-modules/finance/jarvis.module.json:42`). The
 * literal in the manifest and this array are two independent copies; the equality assertion in
 * this task's manifest test is the ONLY thing that stops them drifting, which is why that test
 * lives here, with the manifest, rather than in the task that first consumes the constant. */
export const JOB_SEARCH_TABLES = [
  "job_search_profiles",
  "job_search_portals",
  "job_search_postings",
  "job_search_matches",
  "job_search_resumes"
] as const;
```

```json
// external-modules/job-search/package.json
{
  "name": "job-search",
  "private": true,
  "version": "0.1.0",
  "description": "Jarvis Job Search downloaded module. Prebuilt artifact package: jarvis.module.json + dist/worker.js + dist/web/index.js."
}
```

```json
// external-modules/job-search/jarvis.module.json
{
  "schemaVersion": 1,
  "id": "job-search",
  "name": "Job Search",
  "version": "0.1.0",
  "publisher": "Jarvis Project",
  "lifecycle": "optional",
  "compatibility": { "jarv1s": ">=0.1.0" },
  "description": "Finds job postings on public boards and reads each one against what you can do and what you actually want.",
  "auth": [],
  "storage": [
    { "namespace": "job-search.settings", "scopes": ["user"] },
    { "namespace": "job-search.meta", "scopes": ["user"] }
  ],
  "database": {
    "ownedTables": [
      "app.job_search_profiles",
      "app.job_search_portals",
      "app.job_search_postings",
      "app.job_search_matches",
      "app.job_search_resumes"
    ]
  },
  "runtime": { "workerEntrypoint": "dist/worker.js", "workerContractVersion": 1 },
  "fetchHosts": ["www.linkedin.com", "freehire.me"],
  "assistantTools": [],
  "worker": { "queues": [], "schedules": [], "reconcileJobs": [] },
  "briefing": {
    "handler": "briefing.contribute",
    "sections": ["morning", "evening"],
    "toolName": "job-search.briefing"
  },
  "web": { "entrypoint": "dist/web/index.js", "contractVersion": 1 },
  "navigation": [
    {
      "id": "job-search",
      "label": "Job Search",
      "path": "/",
      "icon": "compass",
      "badge": { "source": "notifications" }
    }
  ]
}
```

Root `package.json`:

```json
"check:external-modules": "tsc -p external-modules/finance --noEmit && tsc -p external-modules/job-search --noEmit"
```

**Constraints**

- **`external-modules/job-search/tsconfig.json` is `external-modules/finance/tsconfig.json` verbatim.**
  It already carries `jsx: "react"`, `jsxFactory: "h"`, and the `@jarv1s/module-sdk/worker` path
  alias. Do not diverge from it. Note the JSX factory consequence: every keyed component this module
  ships needs an explicit `key?: string` prop (I7).
- **`src/module-info.ts` exists so `tsc -p` has an input.** `"include": ["src"]` with no `src/` fails
  with TS18003 (K10).
- **`auth` is empty on purpose** — v1 uses no portal credentials, because it never signs in anywhere.
  Two declared fetch hosts only; Indeed is cut from v1 (L1) and user-nominated portals are deferred.
- **`assistantTools`, `queues` and `schedules` stay empty here** and fill in during Phases 4 and 5.
  The manifest test tolerates that because the badge and briefing assertions do not depend on them.
- **Queue `paramsSchema` is not JSON Schema.** When Task 13 adds queues, use the platform's own DSL —
  `{"type":"object","fields":{"profileId":{"type":"identifier"}}}` — the shape
  `isValidModuleParamsSchema` accepts (F8; see the `finance.categorize-apply` queue for a worked
  example). `assistantTools[].inputSchema` **is** JSON Schema. Two different languages in one file.
- **`icon: "compass"` is a Lucide icon name, not the retired product name.** Verify it in two steps —
  the grep is a locator, not a verification. `rg "landmark" apps/web/src --files-with-matches` only
  tells you which file holds the nav icon map. Open that file and check how icons resolve: an
  explicit map means `compass` must be **added to the map** or the nav renders nothing; a wholesale
  `lucide-react` re-export means confirm the export exists
  (`rg "^export .*\bCompass\b" node_modules/lucide-react/dist/lucide-react.d.ts`). Fall back to
  `briefcase` only if neither route works. A silently missing icon is the failure mode.
- **`pnpm typecheck` is the only gate that covers external modules** — nothing else compiles them,
  so extending `check:external-modules` is part of this task, not a follow-up.

**Tests**

`tests/unit/job-search-manifest.test.ts` — assert **through `validateExternalModuleManifest`**, never
against the raw JSON. The validator reconstructs from an explicit field allowlist and silently
discards what it does not know (F1), so a test reading the JSON file directly passes for a manifest
the loader would strip to pieces.

1. **The manifest validates against the real loader.**
2. **It declares only hosts that serve public postings** — `fetchHosts` equals
   `["www.linkedin.com", "freehire.me"]`. A third host appearing here is a scope change, not a typo.
3. **It owns exactly the tables `JOB_SEARCH_TABLES` names, in the same order** —
   `database.ownedTables` deep-equals `JOB_SEARCH_TABLES.map(t => "app." + t)`. THE seam: the JSON
   literal and the TS constant are two copies of one list and nothing in the toolchain relates them
   (F2). A table added to one and forgotten in the other produces a module that installs happily and
   then has an unprotected or a non-existent table. Deliberately exact deep equality including order,
   not a set comparison.
4. **It names five tables.** Pinned separately so that "fixing" case 3 by editing both lists at once
   still fails and forces the spec conversation.
5. **It survives reconstruction with its briefing block and nav badge intact** — `briefing` equals
   `{handler: "briefing.contribute", sections: ["morning","evening"], toolName: "job-search.briefing"}`
   and `navigation[0].badge` equals `{source: "notifications"}`. Both fields are new to the validator
   (Tasks 2 and 2d); this is the assertion that catches a validator that accepts but does not re-emit.
6. **The briefing handler stays out of the chat tool registry.** A briefing handler is a **worker**
   handler, which is what keeps it invisible to chat. The validator never enumerates handlers, so
   assert the negative directly: no `assistantTools` entry and no queue routes to
   `briefing.contribute`.
7. **No blended score is exposed through any tool schema** — the serialized validated manifest
   contains none of `overall`, `combinedScore`, `totalScore`, `matchScore` (L9). Cheap, and it fails
   the moment someone adds a convenience field in a later task.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-manifest.test.ts   # exit 0
pnpm check:external-modules                              # exit 0
```

---

### Task 4: Database schema

The five owned tables, their owner-bound foreign keys, and the two read indexes. DDL is carried
verbatim below because a module migration is hash-checked and can never be edited once it applies —
the SQL is a decision, not an implementation.

**Depends on:** Task 3 (the manifest declares `database.ownedTables`, and `JOB_SEARCH_TABLES` already
exists). Tasks 13, 15, 18 and 21 all read these tables.

**Files**

- Create: `external-modules/job-search/sql/0001_create_job_search_profiles.sql`
- Create: `external-modules/job-search/sql/0002_create_job_search_portals.sql`
- Create: `external-modules/job-search/sql/0003_create_job_search_postings.sql`
- Create: `external-modules/job-search/sql/0004_create_job_search_matches.sql`
- Create: `external-modules/job-search/sql/0005_create_job_search_resumes.sql`
- Create: `external-modules/job-search/sql/0006_index_job_search_matches_board.sql`
- Create: `external-modules/job-search/sql/0007_index_job_search_postings_profile.sql`
- Test: `tests/integration/job-search-tables-install.test.ts`

**Contracts**

`0001_create_job_search_profiles.sql`:

```sql
-- One search profile per role the user is pursuing. `criteria` is the extracted,
-- user-confirmable frame (Task 10) — never free model prose.
-- owner_user_id is the mandatory RLS scoping column; the platform generates the
-- FORCE RLS policy from manifest.database.ownedTables at install time.
CREATE TABLE app.job_search_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  state         text NOT NULL CHECK (state IN ('in_conversation', 'active', 'paused')),
  criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Broader-context summary distilled from the full-capability conversation (Task 8).
  -- Bounded and refreshed on confirmation; never raw transcript.
  context_summary text,
  schedule      text,
  -- How much this profile contributes to the daily briefing (Task 16's
  -- job-search.profile.set-briefing-detail tool; the settings screen in Task 20 writes it).
  -- On the profile row rather than in module KV for two reasons: it exports and deletes with the
  -- rest of the profile (NFR-7), and a stale KV entry can never disagree with a deleted profile.
  -- The three values are the union Task 16 already defines — do not add a fourth or rename one.
  briefing_detail text NOT NULL DEFAULT 'count'
                  CHECK (briefing_detail IN ('count', 'top', 'full')),
  -- Chat surface KEY for this profile's thread (Task 2c) — not the wire surface. The shell hashes
  -- (moduleId, key) into the legal surface string via moduleChatSurface(); a raw uuid here would
  -- never pass CHAT_SURFACE_PATTERN on its own. Stable for the profile's life.
  surface_key   text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Redundant against the primary key on purpose. Every child table below binds
  -- (owner_user_id, profile_id) to THIS key, so a child row can only ever reference a parent
  -- owned by the same user. Without it, a child's single-column FK to `id` would happily point
  -- at another user's profile, and the generated RLS policy would not notice: the emitted
  -- predicate is `owner_user_id = app.current_actor_user_id()` on the child's OWN column
  -- (`packages/db/src/module-rls-emitter.ts:46`). A foreign key is not an RLS boundary.
  UNIQUE (owner_user_id, id)
);
```

`0002_create_job_search_portals.sql`:

```sql
-- Per-profile portal health. `cause` is the structured failure record from Task 5 —
-- which portal, what kind, what was retrieved, when it last worked, what happens next.
-- A bare "failed" is a spec violation, so there is no boolean-only error column.
CREATE TABLE app.job_search_portals (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  last_ok_at    timestamptz,
  cause         jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, profile_id, source_id),
  -- Owner-bound parent reference, not a bare `profile_id REFERENCES …(id)`. See the note on
  -- app.job_search_profiles: the single-column form lets a row owned by A hang off a profile
  -- owned by B, and RLS only ever checks this table's own owner_user_id.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0003_create_job_search_postings.sql`:

```sql
-- Postings are deduped across portals, so identity is (source_id, external_id).
-- The embedding is triage-only: it decides which postings a model reads, and its
-- similarity value is never surfaced to the user.
CREATE TABLE app.job_search_postings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  company       text NOT NULL,
  location      text NOT NULL,
  url           text NOT NULL,
  body          text NOT NULL,
  posted_at     timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  embedding     vector(768),
  UNIQUE (owner_user_id, profile_id, source_id, external_id),
  -- The key app.job_search_matches binds its posting reference to (same reasoning as profiles).
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0004_create_job_search_matches.sql`:

```sql
-- Fit and Want are two independent axes and are stored as two independent columns.
-- There is deliberately NO blended/overall/total column: the schema is the last place
-- that rule can be enforced structurally, so it is enforced here.
-- outside_frame marks the reserved recall slice — postings deliberately surfaced from
-- outside the user's stated criteria (Task 8). It is a first-class flag, not a filter.
CREATE TABLE app.job_search_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  posting_id    uuid NOT NULL,
  fit           integer CHECK (fit IS NULL OR fit BETWEEN 0 AND 100),
  want          integer CHECK (want IS NULL OR want BETWEEN 0 AND 100),
  fit_reason    text,
  want_reason   text,
  outside_frame boolean NOT NULL DEFAULT false,
  state         text NOT NULL CHECK (state IN ('unscored', 'new', 'seen', 'dismissed')),
  scored_at     timestamptz,
  UNIQUE (owner_user_id, profile_id, posting_id),
  -- BOTH parents are owner-bound. A match is the row that joins two other rows, so it is the
  -- one place where a single-column FK could stitch one user's posting to another user's
  -- profile and leave a legally-owned row behind that leaks a foreign posting through a join.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, posting_id)
    REFERENCES app.job_search_postings (owner_user_id, id) ON DELETE CASCADE
);
```

`0005_create_job_search_resumes.sql`:

```sql
-- One résumé per profile, versioned. The résumé is first-class input to Fit,
-- not an attachment bolted on afterwards.
CREATE TABLE app.job_search_resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  version       integer NOT NULL,
  content       text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, profile_id, version),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0006_index_job_search_matches_board.sql` — the board's primary read:

```sql
-- Board read: this profile's matches by state, newest scored first.
CREATE INDEX job_search_matches_board_idx
  ON app.job_search_matches (owner_user_id, profile_id, state, scored_at DESC);
```

`0007_index_job_search_postings_profile.sql` — the triage read:

```sql
-- Triage read: this profile's postings not yet matched, newest first.
CREATE INDEX job_search_postings_profile_idx
  ON app.job_search_postings (owner_user_id, profile_id, first_seen_at DESC);
```

**Constraints**

- **The RLS scoping column is always `owner_user_id`** — `packages/db/src/module-rls-emitter.ts`
  hardcodes `owner_user_id = app.current_actor_user_id()` (E1). A table named `user_id` installs and
  then every generated policy references a column that does not exist.
- **The module authors no RLS, no policy and no grant.** `installModule()` Phase B generates all of
  it from `manifest.database.ownedTables` (E2). Hand-written policies collide with the generated
  objects; this is not belt and braces.
- **One statement per file.** `packages/db/src/migrations/module-sql-runner.ts:41` allows exactly one
  statement whose first command is `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ALTER TABLE`,
  `DROP INDEX` or `COMMENT ON` (E3). Inline constraints inside a `CREATE TABLE` are one statement and
  are fine; a trailing `ALTER TABLE` in the same file is not.
- **A foreign key is not an RLS boundary.** The generated predicate checks each table's own
  `owner_user_id`, and FK checks run as the table owner without RLS filtering — so a child row
  carrying the _actor's_ `owner_user_id` while pointing at _another user's_ parent passes every
  policy. Every parent reference here is a composite `(owner_user_id, parent_id)` FK against a
  redundant `UNIQUE (owner_user_id, id)` on the parent, never a bare `parent_id REFERENCES …(id)`.
- **`JOB_SEARCH_TABLES` does not generate DDL.** Each migration must create the table whose bare name
  appears in that array; a table created under a different name satisfies Task 3's manifest test and
  fails at install.
- **Module SQL is applied by `installModule()`** and recorded in `app.module_schema_migrations`. It is
  **not** run by `pnpm db:migrate` and never appears in the core migration catalog, so
  `tests/integration/foundation.test.ts` needs no change — do not touch it.
- **`vector(768)` is safe.** `infra/postgres/bootstrap/0001_extensions.sql` installs pgvector as
  superuser before any migration runs, so the type exists for every role.
- **No ANN index on `embedding`.** The triage candidate set is one profile's recent postings; a
  sequential scan over it is cheaper than maintaining an index, and adding one later is a
  one-statement migration.
- **The test cannot connect as the runtime role — do not try.**
  `packages/db/src/module-role-broker.ts:63` creates every module role
  `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, and only the _install_ role is briefly flipped to
  LOGIN and forced back to `NOLOGIN PASSWORD NULL` on every call (:73). Assume the role inside a
  transaction instead — `BEGIN` → `SET LOCAL ROLE jarvis_mod_job_search_runtime` →
  `SELECT set_config('app.actor_user_id', $1, true)` — the shape
  `packages/db/src/module-storage-rpc.ts:89` uses in production, with the GUC set the way
  `packages/db/src/data-context.ts:64,90` sets it. Both die with the transaction, so tests cannot leak
  privilege into each other.
- **`seedUser` runs as bootstrap, outside the runtime role** — `app.users` is not a module-owned table
  and the runtime role has no grant on it.
- **Teardown order is REVOKE-before-DROP-CASCADE**, copied from
  `tests/integration/finance-tables-install.test.ts`. Phase B re-grants onward from the install role's
  `WITH GRANT OPTION`, so revoking without `CASCADE` leaves a dependent grant and blocks `DROP ROLE`.

**Tests**

`tests/integration/job-search-tables-install.test.ts` — proves the **real** `sql/` directory installs
through the real `installModule` pipeline. Mirror `tests/integration/finance-tables-install.test.ts`,
including its `afterEach`. Write the `seedUser` / `seedProfile` / `asRuntime` / `insertMatch` helpers
inline; leave no case as a comment.

1. **Every migration installs, with platform-generated FORCE RLS, idempotently.** Seven installed
   migrations; every `job_search_%` relation has `relforcerowsecurity`; seven rows in
   `app.module_schema_migrations`; a second `install()` reports zero. Catches a missing file, a table
   the platform did not recognise as owned, and a runner that reapplies.
2. **A 768-dimension posting embedding stores and reads back.** `vector_dims(embedding)` is 768.
   Seed the parent profile first — `profile_id` is `NOT NULL` with an owner-bound FK, so a bare insert
   dies on the FK rather than proving anything about the vector type.
3. **Another owner's profile is invisible.** Owner A inserts a profile; owner B selects and gets zero
   rows. The assertion is that B cannot see A's row _at all_ — not merely that B has none of its own.
4. **An insert claiming another owner is refused** — B inserting with `owner_user_id = A` throws
   `row-level security`. The WITH CHECK half of the policy, which a read-only test never reaches.
5. **A child row pointing at another owner's parent is refused, on every child.** The case RLS cannot
   catch alone: B inserting a B-owned posting is legal as far as RLS is concerned, so the owner-bound
   composite FK has to notice the parent is A's. Cover postings, portals, résumés, and **both** of a
   match's two parents — B's posting under A's profile, _and_ B's profile with A's posting. A schema
   binding only `profile_id` passes the first and fails the second, which is exactly why both are
   asserted.
6. **A fit score outside 0..100 is refused** — `fit: 101` throws `check constraint`.
7. **Briefing detail defaults to `count` and rejects a value outside the union.** The quiet default
   matters: a profile the user never opened settings for still contributes a one-line count to the
   briefing rather than vanishing from it. Then `UPDATE … SET briefing_detail = 'verbose'` throws.
   Use a **separate transaction** for the rejection — a constraint violation aborts the transaction it
   happens in, so a following assertion in the same block fails with
   `current transaction is aborted` instead of checking what it meant to. The column, not Task 16's
   tool, is the enforcement point: a tool can be bypassed by a later direct write and a column cannot.

**Verify**

```bash
pnpm test:integration tests/integration/job-search-tables-install.test.ts   # exit 0, seven cases
```

Do **not** run `pnpm db:migrate` — module SQL is not in that catalog.

---

## Phase 2 — Domain layer (pure, no SDK, no network)

Everything in this phase is a pure function tested with plain Vitest. No `ctx`, no `fetch`, no DB.
This is where the product's actual judgement lives, so it gets the heaviest test coverage.

### Task 5: Records and failure causes

The shared vocabulary. Every later task in Phases 2–6 imports its types from this one file.

**Depends on:** nothing. First task that can start once the scaffold exists.

**Files**

- Create: `external-modules/job-search/src/domain/records.ts`
- Test: `tests/unit/job-search-failure-cause.test.ts`

**Contracts**

```ts
export type FailureKind =
  | "rate_limited"
  | "login_required"
  | "parse_failed"
  | "network"
  /** The run ran out of time, not out of luck. Everything retrieved so far is kept and the
   *  portal is NEVER disabled — a slow crawl is not a broken source. Task 11's adapters
   *  produce this when `clock() >= deadlineAt` before a page fetch. */
  | "deadline";

/** Never a bare "failed". Every field here answers a question the user will
 * otherwise have to ask: what broke, how much did we get, when did it last
 * work, and what happens next. */
export interface FailureCause {
  kind: FailureKind;
  sourceId: string;
  /** Human-readable, rendered verbatim. Built from these fields, not by a model. */
  summary: string;
  retrieved: number;
  expected: number | null;
  lastOkAt: string | null;
  nextAction: string;
  retryAt: string | null;
  /** login_required is terminal: we do not sign in to job boards, so the
   * portal disables itself rather than retrying forever. */
  disabled: boolean;
}

export interface SearchCriteria {
  titles: string[];
  seniority: string[];
  locations: string[];
  remote: "required" | "preferred" | "no-preference" | "onsite-ok";
  compFloorCents: number | null;
  excludeCompanies: string[];
  mustHave: string[];
  niceToHave: string[];
  dealbreakers: string[];
  /** Free text the model uses for Want, that no filter acts on. */
  wantNarrative: string;
}

export interface Posting {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  body: string;
  postedAt: string | null;
}

export interface Match {
  id: string;
  profileId: string;
  postingId: string;
  fit: number | null;
  want: number | null;
  fitReason: string;
  wantReason: string;
  outsideFrame: boolean;
  state: "unscored" | "new" | "seen" | "dismissed";
  scoredAt: string | null;
}

export interface PortalState {
  sourceId: string;
  enabled: boolean;
  lastOkAt: string | null;
  cause: FailureCause | null;
}

/** How much a profile contributes to the morning briefing. Named, not written inline as a
 *  union: Task 4's CHECK constraint, Task 10's `buildBriefingContribution`, Task 16's
 *  `set-briefing-detail` tool and Task 20's settings screen must agree on exactly these
 *  three, and four copies of a bare union drift one at a time. */
export type BriefingDetail = "count" | "top" | "full";

/** Lifecycle of one search profile. Mirrors the CHECK constraint on
 *  `app.job_search_profiles.state` (Task 4) character for character — `in_conversation`, not
 *  `draft`: the profile is not a draft of anything, it is mid-interview. */
export type ProfileState = "in_conversation" | "active" | "paused";

/** The user-confirmed distillation Task 10 bounds and Task 16 writes. Not a transcript. */
export type ProfileContext = string;

/** One search. The plural is the product: a user may run several at once (spec §3.5).
 *  Field-for-field the profile row Task 4 defines, minus `owner_user_id` — RLS supplies the
 *  owner and no module code may carry it (A1). `criteria` is `Partial` because the column
 *  defaults to `{}`: a profile mid-interview genuinely has some of them, which is exactly
 *  what `completedSteps` measures. */
export interface Profile {
  id: string;
  name: string;
  state: ProfileState;
  criteria: Partial<SearchCriteria>;
  contextSummary: ProfileContext | null;
  schedule: string | null;
  briefingDetail: BriefingDetail;
  /** Chat surface KEY, never the wire surface — the shell hashes it (Task 2c, H1). */
  surfaceKey: string;
  createdAt: string;
  updatedAt: string;
}

export function describeFailure(input: {
  kind: FailureKind;
  sourceId: string;
  sourceLabel: string;
  retrieved: number;
  expected: number | null;
  lastOkAt: string | null;
  retryAt: string | null;
}): FailureCause;
```

**Constraints**

- **The summary is assembled from the fields above, never generated by a model** (L9). This function
  is the reason the board can render a failure verbatim: the copy is deterministic, so a screenshot of
  it is reproducible and a test can assert it exactly.
- **`login_required` is terminal by policy, not by circumstance.** The spec forbids signing in to a
  job board, so a retry would fail identically forever. It sets `disabled: true` and the returned
  `retryAt` is forced to `null` regardless of what the caller passed.
- **`deadline` is not a failure of the portal.** `disabled` stays `false`, `retryAt` is preserved, and
  the copy must not describe the source as broken — nothing is wrong; the run hit its time budget.
- **Retry phrasing is one shared string**: `Retrying at ${clock(retryAt)}.` when `retryAt` is set,
  otherwise `Retrying on the next scheduled crawl.` `clock()` renders `iso.slice(11, 16)` —
  deliberately time-only, because "Retrying at 10:40" reads better than a timestamp and the board
  already shows the crawl date.
- **Per-kind copy, verbatim** (these strings are the contract the tests pin):
  - `rate_limited` — `` `${label} rate-limited us after ${retrieved} of about ${expected} postings. ${retry}` ``,
    degrading to `after ${retrieved} postings` when `expected` is null. `nextAction` is `retry`.
  - `login_required` — `` `${label} asked for an account before showing postings, so I stopped. I will not sign in to a job board on your behalf.` ``
    `nextAction`: `"Disabled. Turn it back on if you want to try again."`
  - `parse_failed` — the source answered but its layout changed; state that the `retrieved` already
    read were kept. `nextAction` is `"This needs a fix on our side. " + retry`.
  - `network` — could not be reached at all; the `retrieved` already read were kept.
    `nextAction` is `retry`.
  - `deadline` — ran out of time and stopped there; the `retrieved` already read were kept.
    `nextAction`: `"Picking up where I left off on the next crawl."`
- **`FailureCause` is what `app.job_search_portals.cause` stores** (Task 4). Adding a field here
  without a matching write in Task 13 leaves it silently absent on read.

**Tests**

`tests/unit/job-search-failure-cause.test.ts`:

1. **A rate-limit cause says what was retrieved, when it last worked, and what happens next.** Exact
   equality on `summary` (`"LinkedIn rate-limited us after 112 of about 190 postings. Retrying at
10:40."`), on `nextAction`, and `disabled === false`. Exact rather than substring: the copy is the
   deliverable, and a substring assertion passes against a summary that also leaked a model sentence.
2. **A login-walled portal disables itself and schedules no retry.** `disabled === true`,
   `retryAt === null`, and the summary states plainly that we will not sign in. Fails against an
   implementation that treats `login_required` as transient — the exact regression the no-paywall
   ruling exists to prevent.
3. **No kind produces an empty summary.** Loop over **all five** kinds, including `"deadline"`;
   assert `summary.length > 20` and `nextAction.length > 0` for each, with the kind as the assertion
   label so a failure names the culprit. Catches a `switch` that gained a union member and not a case
   — which is exactly what happened when `"deadline"` was added (round 6, finding 12).
4. **`deadline` keeps the portal alive.** `disabled === false`, `retryAt` equals the value passed in
   (not nulled), and the summary does **not** describe the portal as broken or unreachable. Fails
   against the obvious wrong implementation — routing `deadline` through the `network` branch — which
   would read as a source outage to the user and would eventually get a working portal disabled.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-failure-cause.test.ts   # exit 0
```

---

### Task 6: Hard-exclude filter (stage 1)

Stage 1 removes only what is objectively disqualifying. It must be conservative: anything it drops is
never read by a model and never reaches the user, so a wrong exclude is invisible.

**Depends on:** Task 5 (`Posting`, `SearchCriteria`).

**Files**

- Create: `external-modules/job-search/src/domain/excludes.ts`
- Test: `tests/unit/job-search-excludes.test.ts`

**Contracts**

```ts
export interface ExcludeResult {
  kept: Posting[];
  /** Why each drop happened, so the crawl log can answer "where did they go?" */
  dropped: Array<{ posting: Posting; reason: "excluded-company" | "duplicate-url" }>;
}
export function applyHardExcludes(
  postings: readonly Posting[],
  criteria: SearchCriteria
): ExcludeResult;
```

**Constraints**

- **Exactly two drop reasons exist, and no third may be added here.** A company the user named, or the
  same URL twice. Title, location and compensation look like obvious excludes and are the exact thing
  that would kill the product: the postings outside the stated frame are the ones the user cannot find
  on their own. Relevance is stage 2's job (Task 8), where the cut is soft and a slice is reserved for
  out-of-frame results.
- **Never exclude on a missing field.** Most postings omit compensation; excluding on absent comp
  deletes the market.
- **Company matching is normalised** — `trim().toLowerCase()` on both sides. A user typing
  `"Acme Corp"` must catch `"  acme corp "`.
- **URL dedupe is first-wins and normalised the same way.** Order of `kept` follows input order.
- **Every drop is recorded, never silently discarded** — `dropped` is what lets the crawl log answer
  "where did they go?", and an untracked drop is unauditable by construction.

**Tests**

`tests/unit/job-search-excludes.test.ts` — build `Posting` and `SearchCriteria` from small
`Partial<>`-override factories so each case states only the field it is about.

1. **A company on the exclude list is dropped, case- and whitespace-insensitively.** Company
   `"  acme corp "` against `excludeCompanies: ["Acme Corp"]` — zero kept, reason
   `"excluded-company"`. Fails against a naive `includes`/exact-match implementation.
2. **A posting far from the stated location is kept.** A Dublin posting against
   `locations: ["Seattle, WA"]` survives. This is the recall case the product exists to catch, and the
   assertion is what stops a later "obvious optimisation" from deleting it.
3. **A posting with no salary listed is kept**, even under a high `compFloorCents`. Guards the
   missing-field rule above.
4. **A posting whose title does not match the stated titles is kept** — `"Forward Deployed Engineer"`
   against `titles: ["Software Engineer"]`. The adjacent-title case; a title filter here would look
   correct in every demo and quietly remove the best results.
5. **Two postings sharing a URL collapse to one**, with reason `"duplicate-url"` on the second.

Cases 2–4 are the load-bearing ones: they assert what this function must **not** do, and they are the
only defence against a plausible, well-meaning implementation that filters on the criteria it is
handed.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-excludes.test.ts   # exit 0
```

---

### Task 7: Cross-portal dedupe

The same job appears on LinkedIn and on the company's own ATS board behind freehire. Showing it twice
destroys the board's density argument, and freehire aggregates ~50 ATS boards, so overlap with
LinkedIn is the normal case rather than the exception.

**Depends on:** Task 5 (`Posting`).

**Files**

- Create: `external-modules/job-search/src/domain/dedupe.ts`
- Test: `tests/unit/job-search-dedupe.test.ts`

**Contracts**

```ts
/** Stable identity for a posting across portals. */
export function postingIdentity(p: Posting): string;
export function dedupePostings(
  postings: readonly Posting[],
  sourcePriority: readonly string[]
): Posting[];
```

**Constraints**

- **Identity is `normalizedCompany::normalizedTitle`**, not the URL. Task 6 already collapses
  identical URLs; the same job on two portals has two different URLs and two different `externalId`s,
  which is the entire case this task exists for.
- **Company normalisation strips corporate suffixes** — `inc|llc|ltd|corp|corporation|co|gmbh|plc|
sa|nv|ab|oy` as whole words — then lowercases and collapses everything non-alphanumeric to single
  spaces. "Globex" and "Globex, Inc." are one company.
- **Title normalisation strips parentheticals** before the same lowercase/collapse pass. Titles
  routinely carry a location or req number that is not part of the role: "Staff Engineer (Seattle)"
  and "Staff Engineer" are one job.
- **Do not normalise seniority words away.** "Staff Engineer" and "Senior Engineer" are two jobs at
  one company, and collapsing them silently hides one.
- **An unranked source sorts last, not first** — `indexOf === -1` maps to `sourcePriority.length`. A
  source we did not rank is one we have no reason to trust over one we did.
- **Ties within one source break on longer `body`.** The fuller description is the more useful record
  and it is what the scoring model in Task 9 reads.
- **Dedupe runs after Task 6's hard excludes, before triage.** Running it first would let an excluded
  company's copy win the identity contest and survive as the kept record.

**Tests**

`tests/unit/job-search-dedupe.test.ts`, from a single `Partial<Posting>` factory:

1. **Identity ignores punctuation, case, and company suffixes** — `"Globex, Inc."` and `"globex inc"`
   produce the same key.
2. **Identity ignores a location qualifier in the title** — `"Staff Engineer (Seattle)"` equals
   `"Staff Engineer"`.
3. **Identity keeps two genuinely different roles at one company apart** — `"Staff Engineer"` and
   `"Senior Engineer"` differ. The guard against an over-aggressive normaliser, whose damage is
   invisible: the dropped posting simply never appears.
4. **The copy from the highest-priority source wins.** With `["freehire", "linkedin"]`, the freehire
   copy survives regardless of input order. Fails against a first-wins map.
5. **When sources tie, the longer body wins.**

**Verify**

```bash
pnpm vitest run tests/unit/job-search-dedupe.test.ts   # exit 0
```

---

### Task 8: Embedding triage with the reserved recall slice (stage 2)

The cost-control stage, and the one most likely to be implemented wrong. A naive "keep the top N by
similarity to the criteria" implementation silently deletes the product's entire reason for existing.

**Depends on:** Task 5 (`Posting`). Task 14 supplies the similarity maps.

**Files**

- Create: `external-modules/job-search/src/domain/triage.ts`
- Test: `tests/unit/job-search-triage.test.ts`

**Contracts**

```ts
export interface TriageInput {
  postings: readonly Posting[];
  /** Similarity of each posting to the stated criteria, keyed by posting id, 0..1. */
  criteriaSimilarity: ReadonlyMap<string, number>;
  /** Similarity to the user's broader profile — goals, notes, past conversation. */
  profileSimilarity: ReadonlyMap<string, number>;
  /** How many postings the scoring model will read this pass. */
  budget: number;
}
export interface TriageResult {
  /** Ordered: in-frame first, then the reserved recall slice. */
  selected: Array<{ posting: Posting; outsideFrame: boolean }>;
  /** How many postings were considered but not selected. Shown as a count only. */
  deferred: number;
}
export function triage(input: TriageInput): TriageResult;

/** Share of the budget reserved for postings the stated criteria would have missed. */
export const RECALL_SLICE = 0.2;

/** A posting is "outside the stated frame" when it is a poor match for what the
 * user asked for but a strong match for who they are. */
const OUTSIDE_FRAME_CRITERIA_MAX = 0.5;
const OUTSIDE_FRAME_PROFILE_MIN = 0.6;
```

**Constraints**

- **`RECALL_SLICE` is not a tuning knob.** It is the recall case — the whole reason the product beats
  a keyword search. Do not lower it to save tokens.
- **A posting is out-of-frame when `criteria ≤ 0.5` AND `profile ≥ 0.6`.** Both halves are required:
  low criteria similarity alone is just a bad match.
- **The reservation formula is the decision.** With `outside` and `inFrame` bucketed and ranked
  (outside by `profileSimilarity` desc, in-frame by `criteriaSimilarity` desc):
  - no out-of-frame candidates → `reserved = 0`;
  - no in-frame candidates → `reserved = budget` (spend the whole pass on recall);
  - otherwise `reserved = min(max(1, floor(budget * RECALL_SLICE)), budget - 1)`.

  The `max(1, …)` is the floor: at least one recall seat whenever a candidate exists, even at budgets
  where the percentage floors to zero — one seat is the difference between the feature existing and
  not existing. The `budget - 1` is the ceiling: the recall slice is a floor on recall, not a licence
  to spend the user's entire pass on a hunch. At budget 1 with both kinds present, the stated criteria
  win.

- **Whichever pool runs dry hands its unused seats to the other, in similarity order.** Without
  backfill, a reservation held against a pool with one candidate burns seats the scoring model had
  budget for — 1 in-frame + 5 outside at budget 5 would select 2 and defer 4 while the model sits
  idle.
- **Bucket in one pass.** The obvious `postings.filter(p => !outside.includes(p))` is O(n²) over a
  list that routinely holds several hundred postings after a sweep.
- **No similarity value may appear anywhere in the result** (L9). The triage score is a cost-control
  device; if it can be read off the result it will eventually be rendered, and rendering it is a spec
  violation.
- **A missing similarity entry reads as 0**, so a posting that failed to embed degrades to in-frame
  and low-ranked rather than throwing.
- **`budget <= 0` or no postings returns `{selected: [], deferred: postings.length}`** — deferral is
  always reported, never silent.

**Tests**

`tests/unit/job-search-triage.test.ts`. Every case builds explicit similarity maps, so each one names
the exact selection rule it defends.

1. **A slice of the budget is reserved for postings the criteria would have missed.** Eight in-frame
   (criteria 0.9 / profile 0.4) and two out-of-frame (0.2 / 0.95), budget 5 → 5 selected, of which
   exactly `["out0"]` is `outsideFrame` (`floor(5 * 0.2) = 1`). Also pins `RECALL_SLICE === 0.2`, so
   silently tuning it to zero fails a test rather than quietly changing the product.
2. **At least one recall slot exists when a candidate does.** Budget 2, where `floor(2 * 0.2) = 0` —
   one out-of-frame posting still gets a seat. Fails against a pure-percentage implementation, whose
   small-budget behaviour is to drop the feature entirely.
3. **The unused seats of a dry pool are backfilled.** One in-frame, five out-of-frame, budget 5 → 5
   selected, 4 outside, 1 deferred. Fails against the reservation-without-backfill implementation,
   which selects 2 and defers 4.
4. **The last seat goes to the stated criteria.** Budget 1 with both kinds → the in-frame posting,
   `outsideFrame === false`. The other half of case 2: it proves the floor is not also a priority.
5. **With nothing in frame, the whole budget goes to recall** — budget 1, two out-of-frame → one
   selected, `outsideFrame === true`.
6. **With nothing out of frame, the recall slots go to in-frame postings** — four in-frame, budget 3 →
   3 selected, none marked outside. Guards against reserving a seat that no candidate can fill.
7. **Deferrals are reported, not dropped silently** — ten postings, budget 4 → `deferred === 6`. The
   count is what the crawl summary shows; a zero here would tell the user everything was considered.
8. **No similarity value reaches the caller** — `JSON.stringify(result)` does not contain `"0.77"`
   when that was the input similarity. Cheap, and it fails the moment someone adds a debug field.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-triage.test.ts   # exit 0
```

---

### Task 9: Two-axis scoring — prompt and result validation (stage 3)

Fit and Want are two questions, and this is the task that keeps them two. The prompt copy is carried
verbatim below because it is the product's judgement, not an implementation detail.

**Depends on:** Task 5 (`Posting`, `SearchCriteria`). Task 15 calls it with `ctx.ai`.

**Files**

- Create: `external-modules/job-search/src/domain/score.ts`
- Test: `tests/unit/job-search-score.test.ts`

**Contracts**

```ts
export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fit", "want", "fitReason", "wantReason"],
  properties: {
    fit: { type: "integer", minimum: 0, maximum: 100 },
    want: { type: "integer", minimum: 0, maximum: 100 },
    fitReason: { type: "string", minLength: 1, maxLength: 600 },
    wantReason: { type: "string", minLength: 1, maxLength: 600 }
  }
} as const; // JSON Schema handed to ctx.ai.generateStructured

export function buildScorePrompt(input: {
  posting: Posting;
  criteria: SearchCriteria;
  resume: string;
  /** Free-text profile context (goals, notes). Never credentials. */
  context: string;
}): string;

export interface ScoreResult {
  fit: number;
  want: number;
  fitReason: string;
  wantReason: string;
}
/** Throws on anything the model got wrong. Never coerces, never defaults —
 * a bad score must fail loudly rather than land on the board as a number. */
export function parseScoreResult(raw: unknown): ScoreResult;
```

The prompt, verbatim — sections joined with newlines, empty lines dropped:

```
Read one job posting against one person and answer two separate questions.

FIT (0-100): could this person do this job, and would this employer plausibly want them?
Judge evidence in the résumé against what the posting asks for.

WANT (0-100): would this person still want this job a year in?
Judge the shape of the work — team size, autonomy, domain, process, trajectory —
against what they have said they are looking for.

These are independent. A job can be a perfect fit and a bad want, or the reverse.
Do not average, combine, or blend them. Do not let one influence the other.
Give each a short, concrete reason naming specific evidence, not a restatement of the score.

--- POSTING ---
{title} at {company} — {location}
{body}

--- RÉSUMÉ ---
{resume}

--- WHAT THEY SAID THEY WANT ---
{criteria.wantNarrative}
Dealbreakers: {criteria.dealbreakers joined with "; "}   ← omitted entirely when empty

--- OTHER CONTEXT ---
{context}
```

**Constraints**

- **`additionalProperties: false` plus an explicit unknown-key rejection in `parseScoreResult`.** Two
  layers on purpose: the schema constrains the model, the parser constrains what becomes a row. A
  model that helpfully returns `overall` must fail, because a blended score is the one number this
  product must never show (L9).
- **Never coerce, never clamp, never default.** A clamped 140 → 100 is indistinguishable on the board
  from a score the model actually reasoned about, and the user has no way to tell which they are
  looking at. Out-of-range throws.
- **An empty reason is a failure, not a blank cell.** An unexplained number is not usable, and the
  board renders reasons beside every score.
- **The two axes are described as answering different questions** — "could they do it" versus "would
  they still want it a year in". Drop that framing and the model collapses them into one number
  expressed twice, which passes every schema check and fails the product.
- **`context` and `resume` are user content, never credentials** (secrets-never-escape). This prompt
  is the module's largest outbound payload; nothing from `auth` or module KV secrets may reach it.
- **The prompt is built from records, never from prior model prose** (L9). `wantNarrative` and
  `dealbreakers` are user-confirmed fields from Task 10, not a transcript.

**Tests**

`tests/unit/job-search-score.test.ts`:

1. **The schema has exactly the two axes and their reasons** — `Object.keys(properties).sort()`
   deep-equals `["fit", "fitReason", "want", "wantReason"]`. A fifth property fails here first.
2. **The schema refuses unknown properties** — `additionalProperties === false`, so a model cannot
   invent an overall score.
3. **A well-formed result round-trips** unchanged.
4. **A score outside 0..100 throws rather than clamping** — `fit: 140` throws
   `/fit must be an integer between 0 and 100/`. The assertion is on the throw; a clamping
   implementation returns 100 and passes any test that only checks the range of the output.
5. **A non-integer score throws** — `fit: 82.5`.
6. **An empty reason throws** — `fitReason: ""`.
7. **An extra blended field throws** — `overall: 87` throws `/unexpected field: overall/`. The parser
   half of constraint 1; the schema does not run in this test.
8. **The prompt asks for the two axes independently and forbids averaging.** Contains the posting
   title, the résumé text and the want narrative verbatim; matches `/do not (average|combine|blend)/i`;
   and contains `"a year in"` — the phrase that makes Want a different question from Fit. Asserting
   on that phrase is deliberate: a prompt that keeps the ban but loses the distinction still produces
   two identical numbers.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-score.test.ts   # exit 0
```

---

### Task 10: Criteria extraction and surfacing shapes

Two files: the strict criteria parser plus onboarding-progress derivation, and the pure shaping of
what the board and the briefing display.

**Depends on:** Task 5 (`SearchCriteria`, `Match`, `Posting`, `FailureCause`). Task 15 reads
`context_summary`; Task 16 writes it; Task 19 renders the briefing contribution.

**Files**

- Create: `external-modules/job-search/src/domain/criteria.ts`
- Create: `external-modules/job-search/src/domain/surface.ts`
- Test: `tests/unit/job-search-criteria.test.ts`
- Test: `tests/unit/job-search-surface.test.ts`

**Contracts**

```ts
// criteria.ts
export const CRITERIA_SCHEMA: object;
export function parseCriteria(raw: unknown): SearchCriteria; // strict, throws

/** Which onboarding steps the stored criteria satisfy. Drives the progress
 * readout — derived from the record, never from what the model claimed. */
export const ONBOARDING_STEPS: readonly ["role", "want", "where", "comp", "sources"];
export function completedSteps(
  criteria: Partial<SearchCriteria>,
  enabledPortals: number
): Array<(typeof ONBOARDING_STEPS)[number]>;
export function isReadyToCrawl(criteria: Partial<SearchCriteria>, enabledPortals: number): boolean;

/** Hard bound on the profile's `context_summary`. */
export const CONTEXT_SUMMARY_MAX = 1200;
/** Validate a distilled context summary before it is stored. Strict, throws. */
export function parseContextSummary(raw: unknown): string;

// surface.ts
export function newMatchCount(matches: readonly Match[]): number;
export function buildBriefingContribution(input: {
  profiles: ReadonlyArray<{
    id: string;
    name: string;
    matches: readonly Match[];
    postings: ReadonlyMap<string, Posting>;
  }>;
  detail: BriefingDetail;
  degraded: readonly FailureCause[];
}): {
  headline: string;
  items: Array<{ id: string; title: string; detail: string; href?: string }>;
};
```

**Constraints — `criteria.ts`**

- **`parseCriteria` is strict in the same shape as `parseScoreResult`** (Task 9): reject unknown keys,
  reject bad enum values, and default **only** absent list fields to `[]` and absent scalars to
  `null`. It never invents content — an absent `compFloorCents` is `null`, not a guess.
- **Onboarding progress is derived from the stored record, never from the model's claim** that it
  "got" something. If the field is empty the step is not done, whatever the transcript says. Step
  rules: `role` ← `titles.length > 0`; `want` ← non-blank `wantNarrative`; `where` ←
  `locations.length > 0` **or** `remote === "required"`; `comp` ← `compFloorCents` is neither null nor
  undefined; `sources` ← `enabledPortals > 0`.
- **`sources` comes from enabled portals, not from criteria.** It is the one step whose evidence lives
  outside the criteria object.
- **Ready to crawl needs `role`, `want` and `sources` only.** Comp and location stay optional: plenty
  of people genuinely have no floor, and forcing one puts a number in the record the user did not
  mean.
- **`context_summary` has three rules, all enforced in `parseContextSummary` because it is the only
  place the value is admitted:**
  - **Provenance** — model-distilled but user-confirmed. The only writer is Task 16's
    `job-search.profile.set-context` tool, which the user sees and approves like any other tool call.
    Raw transcript is never stored. The record is exportable and deletable under NFR-7, so the user
    has to be able to recognise it as theirs.
  - **Bounds** — 1200 characters. This string rides in `buildScorePrompt` once per posting, so its
    length multiplies across the whole scored batch; it is a budget line, not just a field. Over the
    cap is a **rejection, never a truncation** — a half-sentence fed to the scorer on every posting is
    worse than a distiller that has to try again.
  - **Refresh** — replaced wholesale on every confirmation, never appended. An accreting summary
    drifts out of date, silently outgrows the cap, and ends up asserting things the user has since
    changed their mind about. Clearing it is `null`, which is why the empty string is rejected rather
    than treated as an erase.
- **Control characters are rejected outright**, newlines included. The summary is one flowing
  paragraph by construction, so no control character has a legitimate use, and forbidding the lot is
  easier to reason about than an allowlist. A NUL in particular must never reach Postgres — it aborts
  the statement rather than storing anything. Regex `/[\u0000-\u001f\u007f]/`, with an
  `eslint-disable-next-line no-control-regex` above it.
- **The summary carries exactly the authority of a user turn.** It enters a model prompt; it is not an
  instruction channel, and nothing downstream may treat it as one.
- **`buildScorePrompt` takes `context_summary` or `""`.** Task 15 reads the column, Task 16 writes it;
  until both land the column is dead weight, so do not skip either.

**Constraints — `surface.ts`**

- **Every string it emits is assembled from record fields** (L9). No model prose reaches the briefing
  or the board through this file.
- **`newMatchCount` counts `state === "new"` only** — not `seen`, not `dismissed`, and not `unscored`.
  An unscored match has no numbers yet and announcing it would send the user to an empty row.
- **`detail: "top"` takes the first three matches per profile ordered by `want` descending;
  `"full"` takes all.** Ordered by Want, not Fit and not a blend: Fit is what an employer thinks, Want
  is what the user thinks, and the briefing is for the user.
- **A degraded portal always contributes an item, at every detail level including `"count"`.** A
  silent partial crawl is the failure mode the spec forbids, and the level the user is most likely to
  have selected is the one that would hide it.
- **Out-of-frame matches are flagged, never presented as ordinary hits** — the detail line ends
  `· outside what you asked for`. The recall slice only works if the user can see which results it
  produced.

**Tests**

`tests/unit/job-search-criteria.test.ts`:

1. **An unknown `remote` value is rejected rather than defaulted** — `"maybe"` throws
   `/remote must be one of/`. A defaulting parser silently changes the search.
2. **Absent list fields become `[]` and absent scalars `null`, with nothing invented** — supplied
   `titles` survive, `dealbreakers` is `[]`, `compFloorCents` is `null`.
3. **A step counts as done only when its field actually holds something** —
   `{titles, wantNarrative}` with zero portals yields exactly `["role", "want"]`.
4. **`sources` is counted from enabled portals, not criteria** — `completedSteps({}, 2)` is
   `["sources"]`.
5. **Ready-to-crawl needs a role, a want and at least one source** — true with all three; false with
   zero portals; false with no want. Three assertions, one per required step, so a regression names
   which one.
6. **A short context summary is accepted and trimmed.**
7. **A summary over the cap is rejected, not truncated** — `CONTEXT_SUMMARY_MAX + 1` characters throws
   `/context summary must be 1200 characters or fewer/`.
8. **An empty or whitespace-only summary is rejected** — `"   "` throws. Storing it would read as "we
   have context" while carrying none.
9. **Control characters are rejected, newlines included** — both a literal NUL and a `\n` inside the text throw
   `/must not contain control characters/`. The NUL case is the one that would otherwise abort a
   Postgres statement at write time, far from here.
10. **A non-string is rejected** — `{text: "hi"}` throws.

`tests/unit/job-search-surface.test.ts`:

11. **`newMatchCount` counts only unseen scored matches** — a fixture of `new, new, seen, dismissed,
unscored` yields 2. Each of the three excluded states is a distinct wrong implementation.
12. **At detail `"count"`, there is a headline and no items** — `"2 new job matches in Software
Engineer."` and `items` is empty.
13. **At detail `"top"`, every item names both axes separately** — detail is exactly
    `"Fit 82 · Want 91"`, title is `"Staff Engineer at Globex"`. Exact equality is the assertion that
    catches a blended `"87% match"` (L9).
14. **An out-of-frame match is flagged** — `"Fit 74 · Want 88 · outside what you asked for"`.
15. **A degraded portal is reported in the briefing rather than passed over in silence** — with
    `detail: "count"` and one `rate_limited` cause, some item's detail contains the cause summary.
    Deliberately asserted at the quietest detail level.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-criteria.test.ts tests/unit/job-search-surface.test.ts   # exit 0
```

---

## Phase 3 — Source adapters

### Task 11: Portal interface and the freehire adapter

`freehire.me` first: it is the widest source (~50 ATS boards behind one declared host), so it proves
the interface before LinkedIn.

**Depends on:** Task 5 (`Posting`, `FailureCause`, `describeFailure`, `SearchCriteria`).

**Files**

- Create: `external-modules/job-search/src/adapters/types.ts`
- Create: `external-modules/job-search/src/adapters/freehire.ts`
- Create: `tests/fixtures/job-search/freehire-data.json` (captured, trimmed to three postings)
- Test: `tests/unit/job-search-adapter-freehire.test.ts`

**Probe results (live `curl`, 2026-07-27) — these are decisions, not background**

- `GET /api/jobs` → **404**. It does not exist.
- `GET /api/v1/jobs` → 200, `{data, meta:{limit,offset,total}}`, no key, `limit` capped at 100, good
  field mapping — but **it accepts no filters at all**. Every parameter tried (`search, q, query,
keyword(s), title, text, country, countries, work_mode, regions, is_tech, collections, per_page`)
  returned the byte-identical unfiltered first page of `total: 3,278,266`. Useless as a targeted
  source.
- `GET /__data.json` → the SvelteKit SSR route, and **the only thing that filters**. `work_mode` and
  `regions` narrow 3.28M → ~600; free-text `q` works but is fuzzy (`q=nurse` → 478,
  `q=zzzznotarealterm` → 3 against a 624 baseline, `q=kubernetes` → 608).

So the adapter targets `__data.json` and treats it as **a fragile internal route, not a public API**.
Two consequences: it must not trust the server's relevance (over-fetch; Task 6 and Task 8 do the
narrowing), and an unrecognised envelope is a `parse_failed` that **disables the portal**, never an
empty result set that reads as "no jobs matched your search".

**Contracts**

```ts
/** The adapter-facing fetch. This is NOT the host port and NOT WHATWG fetch — the real
 * `ctx.fetch` takes one `ModuleFetchRequest` object and resolves
 * `{status, headers, bodyBase64}` with no `ok` and no `text()`. Task 13's `toFetchLike`
 * bridges the two so base64 decoding lives in one place instead of in every adapter.
 * Adapters must be written against this type and tested with a plain `vi.fn()`. */
export interface FetchLike {
  (
    url: string,
    init?: { headers?: Record<string, string> }
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface CrawlResult {
  postings: Posting[];
  /** Present when the crawl stopped early. Partial results above are still kept. */
  failure: FailureCause | null;
}

export interface Portal {
  readonly id: string;
  readonly label: string;
  readonly host: string;
  crawl(args: {
    fetch: FetchLike;
    criteria: SearchCriteria;
    lastOkAt: string | null;
    now: string;
    /** Absolute epoch ms. Check `Date.now() >= deadlineAt` BEFORE each page fetch and return
     * what you already have with `failure: "deadline"`. Task 2e ships this to the worker as
     * `ctx.deadlineAt` and Task 14 narrows it per portal.
     *
     * There is deliberately no `signal` here. A worker-side `AbortSignal` cannot cancel an
     * in-flight `ctx.fetch` — the request crosses JSON-RPC and `ModuleFetchRequest` carries no
     * signal field (`packages/module-sdk/src/index.ts:682`). Cancelling a request already in
     * the host's hands is the host's job (Task 2e); a portal's whole share of it is this
     * cooperative check between fetches. Do not add a `signal` parameter to make the two look
     * symmetrical — it would be a parameter nothing could honour. */
    deadlineAt: number;
    /** Test seam only. Defaults to `Date.now`. Production callers (Task 14's `runCrawl`) pass
     * nothing. It exists so deadline cases are deterministic without `vi.useFakeTimers()`. */
    clock?: () => number;
  }): Promise<CrawlResult>;
}

/** One mapping for every adapter. 401/403 is the login wall: by policy we stop and disable
 * rather than trying to get around it. */
export function statusToKind(status: number): FailureKind;

export const PAGE_CAP = 10;
```

**Constraints**

- **Capture the fixture before writing the parser.** `__data.json` is SvelteKit's own serialization
  format: `{"type":"data","nodes":[…]}` where a node's `data` is a **flat array** and every object
  value inside it is an _integer index into that same array_. A hand-written expectation will be
  wrong. Capture with the module's own User-Agent, trim to three postings, strip cookies / session
  ids / tracking parameters; the fixture is committed, so treat it as public.
- Record in the adapter's header comment which node index holds the job list and which keys carry
  title / company / location / url / description / posted date. Those are the parser's only
  dependencies, and naming them makes the next `parse_failed` a five-minute fix.
- Index resolution is defensive: a value that is not a valid index into the flat array is a payload
  we do not understand, and the caller turns that into a disabling `parse_failed`, never a posting
  with a blank company name.
- `id: ""` on emitted postings is intentional — the store assigns the uuid; the adapter must not
  invent one.
- User-Agent is plain and descriptive (`Jarvis-JobSearch/0.1 (personal use)`). Do not impersonate a
  browser version string and do not rotate identities.
- **Must not fall back to `/api/v1/jobs`** when `__data.json` fails: that endpoint ignores filters,
  so the "fallback" is 3.28M mostly-irrelevant rows presented as search results.
- **Must not narrow on server relevance.** Over-fetch and let Task 6 and Task 8 filter.

**Tests** (`tests/unit/job-search-adapter-freehire.test.ts`)

Every case that is not about the deadline passes a `FAR_FUTURE` deadline, so a slow CI box cannot
turn an unrelated assertion into a flake.

1. **Maps the captured `__data.json` payload onto `Posting` records.** Three postings from the
   fixture; `id === ""`, `sourceId === "freehire"`, and `externalId` / `title` / `company` all
   non-empty, `url` https, `body` longer than 20 chars. Fails against an implementation that reads a
   job object's fields directly — those are integers, and the "no empty strings" assertions are what
   catches an index read as a value.
2. **Sends `q`, `work_mode` and `regions` — the only three parameters that filter.** Asserts the
   request path is `/__data.json` and specifically **not** `/api/`. Fails against a "fixed" URL that
   points at the documented API, which would silently return 3.28M unfiltered rows.
3. **429 → structured `rate_limited`, partial results kept.** First page succeeds, second 429s;
   asserts three postings survive, `kind === "rate_limited"`, `retrieved === 3`, `disabled === false`.
   Fails against an implementation that throws away partials on failure.
4. **401/403 → `login_required` and disables itself.** Fails against a generic error path that
   retries a login wall forever.
5. **Unrecognised envelope disables rather than reporting zero jobs.** A well-formed but
   non-matching payload must yield `postings: []`, `kind === "parse_failed"`, `disabled === true`,
   and a summary naming freehire. This is the misleading-silence case: "0 postings" reads to the
   user as "nothing matched your search".
6. **Non-JSON body → `parse_failed`, no postings.** Fails against a `JSON.parse` that is allowed to
   throw out of `crawl`.
7. **Deadline expires between pages → returns what it has.** Clock crosses `deadlineAt` after the
   first page; asserts exactly one fetch, page one's postings kept, `kind === "deadline"`, and
   `disabled === false` — a slow run must never disable a portal. Fails against a check placed after
   the fetch instead of before it.
8. **Deadline already passed → fetches nothing at all.** Asserts zero fetch calls and a `deadline`
   failure. Fails against a do-while shape that always fetches once.
9. **Stops paging at `PAGE_CAP`.** Fails against an unbounded pager on an endpoint that never
   reports a total.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-adapter-freehire.test.ts   # exit 0
```

### Task 12: LinkedIn guest adapter

**Indeed is cut from v1 — do not write an adapter, a fixture, or a manifest host for it.** Probed
live on 2026-07-27: `GET https://www.indeed.com/jobs?q=…&l=…` returns **HTTP 403** with a 27 KB
`<title>Security Check - Indeed.com</title>` body carrying Cloudflare markers. It is not a
User-Agent or header problem — it wants a real browser, and v1 has none. Anyone revisiting this must
re-probe rather than trusting a stale note that says Indeed works. (JobSpy's
`apis.indeed.com/graphql` static-key path was never probed here; it is a research task, not a v1
task.)

That leaves LinkedIn guest as the second source, and it is the clean one: no auth, no key, no cookie.

**Depends on:** Task 11 (`Portal`, `FetchLike`, `statusToKind`, `PAGE_CAP`).

**Files**

- Create: `external-modules/job-search/src/adapters/linkedin.ts`
- Create: `tests/fixtures/job-search/linkedin-guest.html` (captured, trimmed to three cards)
- Test: `tests/unit/job-search-adapter-linkedin.test.ts`

**Contracts**

```ts
export const linkedinPortal: Portal;
```

**Probed shape**

`GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&start=0`
→ 200, ~28 KB of HTML fragment, 30 `base-card` entries per page. Pagination is the `start` offset.
Capture with the module's own User-Agent; trim to three cards; strip cookies, session ids and `trk=`
or other tracking parameters from extracted URLs. The fixture is committed — treat it as public.

**Constraints**

- Parse the fragment with a small tolerant extractor over `base-card` elements. The module bundle
  has no DOM dependency and must not gain one for this.
- The guest fragment does **not** carry the job description, so `body` is the card's snippet text.
  Task 8's triage therefore has less signal from this source than from freehire. Say so in a
  comment: it is a real asymmetry, not an oversight.
- Guest endpoint only. Honour `PAGE_CAP`, return partial results alongside a `FailureCause`, and use
  the same plain `Jarvis-JobSearch/0.1 (personal use)` User-Agent — no browser impersonation, no
  identity rotation.

**Tests** (`tests/unit/job-search-adapter-linkedin.test.ts`)

Mirror every freehire case against this fixture — map to `Posting`, `rate_limited` on 429 keeping
partials, `login_required` + disabled on 403, `parse_failed` on an unrecognised body, `PAGE_CAP`
respected, and **both deadline cases**. Declare the same `FAR_FUTURE` constant and pass it on every
non-deadline case; `deadlineAt` is required, so a call that omits it does not compile.

Plus the two that are the reason this adapter is not a copy:

1. **An auth-wall interstitial is `login_required` even though it returns 200.** LinkedIn answers
   200 with a sign-in page rather than 401. Asserts `kind === "login_required"` and
   `disabled === true`. Fails against a status-only mapping, which would classify the wall as
   `parse_failed` and retry it forever.
2. **Stops paging when a page comes back with no cards.** The guest endpoint reports no total and no
   next cursor — an empty fragment **is** the end-of-results signal. Asserts exactly two fetches, a
   null failure, and three postings. Fails against an implementation that walks `start` to
   `PAGE_CAP` every time and spends nine requests learning nothing.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-adapter-linkedin.test.ts   # exit 0
```

Then hit the live endpoint once by hand and confirm the parser survives the real shape. Fixtures
rot; that check is the whole reason `parse_failed` is a first-class cause.

## Phase 4 — Worker

### Task 13: Worker skeleton, ports, and input validation

**Depends on:** Task 4 (tables), Task 5 (records), Task 11 (`FetchLike`).

**Files**

- Read first: `external-modules/finance/src/worker/ports.ts`, `index.ts`, and its validator
- Create: `external-modules/job-search/src/worker/{index.ts,ports.ts,validate.ts,store-sql.ts}`
- Create: `external-modules/job-search/src/domain/store-port.ts`
- Test: `tests/unit/job-search-validate.test.ts`
- Test: `tests/unit/job-search-fetch-bridge.test.ts`
- Test: `tests/integration/job-search-store.test.ts` — the store against a real database, **before**
  any handler depends on it

**Contracts**

```ts
// worker/validate.ts
/** The host spreads actorUserId onto every external tool input as an anti-spoof measure
 * (FIN-04). It is deliberate and it is not going away, so every strict validator in this
 * module strips it before checking for unknown keys. */
export function stripEnvelope(raw: unknown): Record<string, unknown>;
export function validateProfileInput(raw: unknown): { profileId: string };
```

```ts
// worker/ports.ts
export function toFetchLike(ctx: ModuleWorkerContext): FetchLike;
```

```ts
// domain/store-port.ts — structural, no SDK import, so handlers unit-test with a fake.

/** `Posting` (Task 5) deliberately has no embedding field — the domain filters and the dedupe
 * never look at vectors. The scoring stage does, and reading the postings and then re-reading
 * their vectors one at a time is a query per posting. Hence one widened row type rather than an
 * optional field on `Posting`. */
export interface PostingWithEmbedding extends Posting {
  readonly embedding: readonly number[];
}

export interface JobSearchStore {
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | null>;
  createProfile(name: string): Promise<Profile>;
  updateCriteria(id: string, criteria: SearchCriteria): Promise<void>;
  setProfileState(profileId: string, state: ProfileState): Promise<void>;
  setProfileContext(profileId: string, context: ProfileContext): Promise<void>;
  setBriefingDetail(profileId: string, detail: BriefingDetail): Promise<void>;
  listPortals(profileId: string): Promise<PortalState[]>;
  setPortalState(profileId: string, state: PortalState): Promise<void>;
  upsertPostings(profileId: string, postings: readonly Posting[]): Promise<Posting[]>;
  setEmbedding(postingId: string, vector: readonly number[]): Promise<void>;
  listUnscored(profileId: string, limit: number): Promise<Posting[]>;
  /** What the scoring stage actually reads. */
  listUnscoredPostingsWithEmbeddings(
    profileId: string,
    limit: number
  ): Promise<PostingWithEmbedding[]>;
  /** `limit` is required, not optional: the SQL binds it as `$2` and the board is a paged
   *  surface. An interface that omits it and a query that binds it is how `$2` ends up
   *  `undefined` at runtime — the driver rejects the statement and every board read 500s. */
  listMatches(profileId: string, limit: number): Promise<Match[]>;
  upsertMatch(profileId: string, match: Omit<Match, "id">): Promise<void>;
  setMatchState(matchId: string, state: Match["state"]): Promise<void>;
  /** The résumé is versioned and first-class (Task 4). `getLatestResume` is what the scoring
   * prompt uses; `getResumeVersion` is what a match pinned to an older version needs, so the
   * board can say which résumé produced a score. */
  getLatestResume(profileId: string): Promise<Resume | undefined>;
  getResumeVersion(profileId: string, version: number): Promise<Resume | undefined>;
  setResume(profileId: string, content: string): Promise<Resume>;
  /** Module KV, not a profile column: the sweep's rotation cursor belongs to the sweep, and it
   * has to survive the profile it happens to be pointing at being deleted. */
  getSweepCursor(): Promise<number>;
  setSweepCursor(index: number): Promise<void>;
}
```

**This interface is closed.** No task after this one may call a store method that is not listed. If a
later task needs one, it is added here first, with its own test, in the same change — a handler
written against a method that exists only in its own fake compiles, passes its unit test, and fails
on the first real invocation.

There is deliberately **no `setPortalEnabled`**. `PortalState` already carries `enabled`, so
`setPortalState` is a read-modify-write away; a second method that writes one field of the same row
is two ways to write the same state, and one of them will drift.

**Constraints on the fetch bridge** (`ctx.fetch` is not WHATWG fetch, and the adapters must never
learn that it isn't)

- `ctx.fetch` takes **one** object (`ModuleFetchRequest`) and resolves `{status, headers,
bodyBase64}` — `packages/module-sdk/src/index.ts:682-694`. No `ok`, no `text()`; the body is base64
  because the host reads it as an ArrayBuffer (`worker-rpc-host.ts:149`).
- Only four response headers survive — `content-type`, `content-length`, `last-modified`, `etag`
  (`worker-rpc-host.ts:143`). **`set-cookie` is dropped**, so no adapter can hold a session. That is
  consistent with the rule that a portal demanding login stops rather than signing in; it also means
  no adapter may be written to depend on one.
- A missing or non-matching `fetchHosts` entry is an `invalid_rpc` **throw**, not a status code.
  Callers must treat a rejection as a `network` cause, never as "zero postings found".
- Redirects are followed inside the host's fetch; the adapter sees only the final status.
- Decode the body eagerly. It is already fully in memory as base64, so a lazy `text()` buys nothing
  and only moves a decode failure somewhere harder to attribute.

**Constraints the SDK imposes on every store method** — not stylistic

1. **`ctx.db.query` allows exactly SELECT / INSERT / UPDATE / DELETE** (`packages/module-sdk/src/worker.ts:57-69`).
   There is no `BEGIN`, so **there are no multi-statement transactions**. Anything that must be
   atomic has to be one statement — a CTE, an `INSERT … SELECT`, or an `ON CONFLICT`.
2. **Never pass an actor id.** Every write sets `owner_user_id = app.current_actor_user_id()`, and
   no read filters on owner at all — the generated RLS policy already does
   (`packages/db/src/module-rls-emitter.ts:46`; the function is EXECUTE-granted to the runtime role
   at `:40`). A store method that accepts an `ownerUserId` argument is a store method that can be
   called with the wrong one.
3. **Positional `$1` params only.** Results are capped at 5000 rows / 5 MiB with a 5 s statement
   timeout, so every list method takes an explicit `limit`.
4. **`vector` has no JS binding.** Pass the embedding as pgvector's text form and cast — `$2::vector`
   with `JSON.stringify([...vector])`. A JS array is a runtime type error; a float array bound as
   `text` without the cast silently stores nothing usable. Reads come back as `embedding::text` and
   are parsed in JS — there is no array binding on the way out either.

**SQL contracts** (verbatim; the ones that are not a one-line `SELECT … WHERE id = $1`)

```sql
-- listProfiles — DETERMINISTIC ORDER IS PART OF THE CONTRACT. Task 15's sweep persists an INDEX
-- into this list, so an unstable order makes the cursor point at a different profile each sweep
-- and the rotation silently degenerates into random selection.
SELECT id, name, state, criteria, context_summary, schedule, briefing_detail, surface_key,
       created_at
  FROM app.job_search_profiles
 ORDER BY created_at ASC, id ASC   -- id breaks ties: created_at is not unique under a fast test
```

```sql
-- upsertPostings — one statement per batch, deduped on the natural key. Returns the stored rows so
-- the caller learns which were new without a second read. `first_seen_at` is NOT touched on
-- conflict: it is what "new since" means, and refreshing it on every crawl erases that.
INSERT INTO app.job_search_postings
  (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body, posted_at)
SELECT app.current_actor_user_id(), $1, x.source_id, x.external_id, x.title, x.company,
       x.location, x.url, x.body, x.posted_at
  FROM jsonb_to_recordset($2::jsonb) AS x(source_id text, external_id text, title text,
       company text, location text, url text, body text, posted_at timestamptz)
ON CONFLICT (owner_user_id, profile_id, source_id, external_id) DO UPDATE
  SET title = excluded.title, company = excluded.company, location = excluded.location,
      url = excluded.url, body = excluded.body, posted_at = excluded.posted_at
RETURNING id, source_id, external_id, title, company, location, url, body, posted_at, first_seen_at
```

```sql
-- setEmbedding — the cast is the whole point.
UPDATE app.job_search_postings SET embedding = $2::vector WHERE id = $1
```

```sql
-- listUnscoredPostingsWithEmbeddings — the scoring stage's ONE read. Unscored means "no match row
-- yet", which is a NOT EXISTS, not a state column on the posting.
SELECT p.id, p.source_id, p.external_id, p.title, p.company, p.location, p.url, p.body,
       p.posted_at, p.first_seen_at, p.embedding::text AS embedding
  FROM app.job_search_postings p
 WHERE p.profile_id = $1
   AND p.embedding IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM app.job_search_matches m WHERE m.posting_id = p.id)
 ORDER BY p.first_seen_at DESC
 LIMIT $2   -- hits job_search_postings_profile_idx
```

```sql
-- listMatches — the board read. One join, both axes as separate columns, and NO expression that
-- combines them; a `(fit + want)` anywhere in this file is the product invariant breaking at the
-- last place it can still be caught structurally.
SELECT m.id, m.posting_id, m.fit, m.want, m.fit_reason, m.want_reason, m.outside_frame, m.state,
       m.scored_at, p.title, p.company, p.location, p.url, p.source_id
  FROM app.job_search_matches m
  JOIN app.job_search_postings p ON p.id = m.posting_id
 WHERE m.profile_id = $1
 ORDER BY m.scored_at DESC NULLS LAST, m.id ASC
 LIMIT $2   -- hits job_search_matches_board_idx
```

```sql
-- upsertMatch — idempotent on (profile, posting) so re-scoring updates rather than duplicating.
-- Re-scoring returns the row to `new` deliberately: a changed score is news.
INSERT INTO app.job_search_matches
  (owner_user_id, profile_id, posting_id, fit, want, fit_reason, want_reason, outside_frame,
   state, scored_at)
VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5, $6, $7, 'new', now())
ON CONFLICT (owner_user_id, profile_id, posting_id) DO UPDATE
  SET fit = excluded.fit, want = excluded.want, fit_reason = excluded.fit_reason,
      want_reason = excluded.want_reason, outside_frame = excluded.outside_frame,
      state = 'new', scored_at = now()
```

```sql
-- setPortalState — the whole row, one statement. `last_ok_at` uses COALESCE so a failure NEVER
-- erases the last-known-good timestamp; that timestamp is the only thing that lets the degraded
-- strip say how long a board has been down (Task 20; Task 21 case 10 asserts it).
INSERT INTO app.job_search_portals
  (owner_user_id, profile_id, source_id, enabled, last_ok_at, cause, updated_at)
VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5::jsonb, now())
ON CONFLICT (owner_user_id, profile_id, source_id) DO UPDATE
  SET enabled = excluded.enabled,
      last_ok_at = COALESCE(excluded.last_ok_at, app.job_search_portals.last_ok_at),
      cause = excluded.cause, updated_at = now()
```

```sql
-- getLatestResume
SELECT id, version, content, updated_at FROM app.job_search_resumes
 WHERE profile_id = $1 ORDER BY version DESC LIMIT 1
```

**`setResume` — atomic version allocation. This one is a bounded retry loop, not a statement.**

```sql
WITH locked AS (
  SELECT id FROM app.job_search_profiles
   WHERE id = $1 AND owner_user_id = app.current_actor_user_id()
   FOR UPDATE
),
next AS (
  SELECT COALESCE(MAX(r.version), 0) + 1 AS version
    FROM app.job_search_resumes r, locked
   WHERE r.profile_id = locked.id
)
INSERT INTO app.job_search_resumes (owner_user_id, profile_id, version, content)
SELECT app.current_actor_user_id(), locked.id, next.version, $2
  FROM locked, next
ON CONFLICT (owner_user_id, profile_id, version) DO NOTHING
RETURNING id, version, content, updated_at
```

```ts
const SET_RESUME_MAX_ATTEMPTS = 5;
```

Why it is a loop, before anyone "simplifies" it back:

- `INSERT … SELECT COALESCE(MAX(version),0)+1` **races**. Under READ COMMITTED both concurrent
  statements read the same MAX before either inserts, both compute the same next version, and the
  UNIQUE constraint turns the second upload into a user-visible error.
- **`FOR UPDATE` on the parent does not fix it, and this is the trap.** Blocking on a row lock does
  not give the waiting statement a new snapshot. Postgres re-evaluates the _locked row_ after the
  lock is released (EvalPlanQual), but the aggregate over `app.job_search_resumes` is a different
  relation and keeps the snapshot taken when the statement began — before the wait. The lock changes
  the timing and hides the bug in casual testing; it does not remove it.
- The DB port allows no `BEGIN`, so we cannot hold a transaction across a read and a write. What we
  can do is make each **attempt** a fresh statement, and therefore a fresh snapshot, and let the
  unique constraint arbitrate. `ON CONFLICT DO NOTHING RETURNING` means a loser returns **zero rows**
  instead of throwing: that is the signal to try again, and the next attempt's MAX sees the winner's
  committed row.
- The retry is **bounded**. An unbounded loop under a pathological writer is a worker that burns its
  whole invocation deadline on one upload. Exhausting the five attempts is a real error, not a
  silent no-op — swallowing it would hand the caller a résumé that was never stored.
- **Zero rows has two causes and they must not be conflated.** Either `locked` was empty (the profile
  does not exist or is not ours — retrying will never help) or we lost the version race. Distinguish
  them with an ownership probe, or a missing profile spins five times and then reports a phantom
  concurrency failure. The missing-profile message says "no such profile", not anything about
  contention.
- The `locked` CTE stays. It is no longer load-bearing for correctness, but it scopes the write to a
  profile the actor owns in the same statement and collapses the common two-writer case into one
  retry instead of a thundering herd. It **must be referenced** by the insert (it is, in the `FROM`)
  — Postgres does not guarantee an unreferenced CTE runs at all.

**The sweep cursor is `ctx.kv`, not SQL.** Namespace `job-search.meta` (declared in Task 3's
manifest), key `sweep-cursor`. **The stored value is an object, `{ index: number }` — not a bare JSON
number**: `ctx.kv.get`/`set` are typed `Record<string, unknown>` in both directions
(`packages/module-sdk/src/worker.ts:20`), so a bare number is not storable and does not typecheck.
Validate on **read** as well as write — a hand-edited or half-written record must degrade to "start
at the beginning", never to a `NaN` that makes `rotate()` return an empty list and the sweep silently
do nothing forever. Absent key returns `0`; a fresh install starting at profile zero is correct, not
an error.

`index.ts` is `defineModuleWorker({handlers})` with an empty handler map. Tasks 15 and 16 fill it.

**Tests — validator** (`tests/unit/job-search-validate.test.ts`)

1. **Strips the host-injected `actorUserId` instead of rejecting the call.** The host spreads
   `actorUserId` onto every external tool input; a strict unknown-key validator that does not strip
   it kills every call with `unknown key: actorUserId`.
2. **Still rejects a genuinely unknown key** (`unknown key: sneaky`). Fails against a validator that
   "fixed" case 1 by dropping unknown-key checking altogether.
3. **Rejects a missing `profileId`.**

**Tests — fetch bridge** (`tests/unit/job-search-fetch-bridge.test.ts`)

1. **Decodes the host's base64 body and derives `ok` from the status.** Fails against a bridge that
   passes `bodyBase64` through as text.
2. **Reports a 429 as not-ok rather than throwing.** The adapters branch on `ok` to build a
   structured cause; a throwing bridge loses the partial results the adapter already collected.
3. **Passes request headers through in the host's own shape** — one object argument
   `{url, method, headers}`, not `(url, init)`. This is the whole reason the bridge exists, and a
   two-argument call would reach `ctx.fetch` as an ignored second parameter.

**Tests — store against a real database** (`tests/integration/job-search-store.test.ts`)

This runs **before** any handler depends on the store; everything above is invisible to a fake.
All of it through `createAppRuntimeRunner().withDataContext({actorUserId})` — the migration-owner
role is `NOBYPASSRLS`, so a raw query against these FORCE-RLS tables returns zero rows and every
assertion below passes for the wrong reason.

1. **`listProfiles` is stable across calls** with profiles created inside the same millisecond. This
   is what the `id ASC` tiebreak is for; without it the test is flaky rather than failing.
2. **`upsertPostings` twice with the same natural key** yields one row, updated fields, and an
   **unchanged `first_seen_at`**. Fails against an upsert that touches `first_seen_at`, which would
   silently erase what "new since" means.
3. **`setEmbedding` then `listUnscoredPostingsWithEmbeddings`** round-trips a 768-vector and
   `vector_dims` reports 768 — the cast working end to end.
4. **A posting with a match row is excluded** from `listUnscoredPostingsWithEmbeddings`, and one
   without it is included. Fails against a state-column check instead of `NOT EXISTS`.
5. **Concurrent `setResume`** — fire two on **two separate connections** without awaiting the first;
   assert versions 1 and 2 **and no error surfaced**. Two rules make this a real test: same-connection
   calls serialize for free and prove nothing, and sequential calls pass against the racy
   read-then-insert. A `FOR UPDATE`-only implementation fails this case. Then a third sub-case:
   `setResume` against a nonexistent profile id throws **immediately**, not after five attempts, and
   the message says "no such profile" rather than anything about contention.
6. **`setPortalState` with a failure cause preserves `last_ok_at`** from the previous success. Fails
   against an upsert without the `COALESCE`.
7. **`getSweepCursor` on a fresh install returns 0**, and survives a `setSweepCursor` followed by a
   profile delete. Then inspect the **stored KV payload directly** and assert it is `{ index: 3 }` —
   an object, not a bare `3`. Catches a store that typechecks against a `Promise<number>` façade
   while writing a shape the KV port cannot hold.
8. **A corrupt cursor reads as 0, not as NaN.** Write `{ index: "seven" }` into the KV key and assert
   `getSweepCursor()` returns `0`. Without read-side validation this returns `NaN`, `rotate()`
   produces an empty list, and the sweep does nothing forever without an error.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-validate.test.ts tests/unit/job-search-fetch-bridge.test.ts \
  && pnpm test:integration tests/integration/job-search-store.test.ts \
  && pnpm check:external-modules
```

Exit 0 for all three. The store test needs the module installed, so run it after Task 4's migrations
have been applied to the test database.

### Task 14: Crawl stage

**This produces a function, not a handler.** Nothing in this task appears in the manifest. A worker
handler cannot enqueue anything — `ModuleWorkerContext` has no jobs port — so crawl and score cannot
be two queued steps handing off to each other. They are two _stage functions_ composed inside one
invocation by Task 15, which is what lets each be unit-tested against a fake store with no SDK, no
network and no model. The directory name `stages/` is load-bearing: a file in `handlers/` is
something the manifest names, and this is not.

**Depends on:** Task 5 (`FailureCause`), Task 6 (`applyHardExcludes`), Task 7 (`dedupePostings`),
Task 11 (`Portal`, `FetchLike`), Task 13 (`JobSearchStore`).

**Files**

- Create: `external-modules/job-search/src/worker/stages/crawl.ts`
- Test: `tests/unit/job-search-crawl-stage.test.ts`

**Contracts**

```ts
/** The embedding dependency, structurally typed so the unit test passes a plain object.
 * These three names are Task 1's `ModuleEmbedPort` verbatim — `ctx.embed` satisfies this
 * without an adapter, and the document/query split must survive down to here because nomic
 * applies a different task prefix to each. */
export interface EmbedPort {
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  dimensions(): Promise<number>;
}

export async function runCrawl(deps: {
  store: JobSearchStore;
  portals: readonly Portal[];
  fetch: FetchLike;
  embed: EmbedPort;
  profileId: string;
  now: string;
  /** Epoch millis after which the stage stops STARTING new work and returns what it has.
   * Task 15 sets it so that scoring still gets a share of the invocation. */
  deadlineAt: number;
  /** Injected, not `Date.now()`, so the deadline test is deterministic. */
  clock: () => number;
}): Promise<{
  found: number;
  kept: number;
  degraded: FailureCause[];
  /** True when the deadline cut the stage short. Task 15 turns this into a visible
   * "checked 1 of 2 boards" state rather than letting it look like a clean pass. */
  truncated: boolean;
}>;
```

**Sequence**

Per profile: list enabled portals → walk them **one at a time**, checking the deadline before each →
`dedupePostings` with priority `["freehire", "linkedin"]` → `applyHardExcludes` → `upsertPostings` →
`embedDocuments` in batches of 128 → `setEmbedding`. Write every portal's `PortalState` back, healthy
or not.

**Constraints**

- **Sequential, not `Promise.allSettled`.** `allSettled` starts every portal in the same tick, which
  makes the deadline check unreachable — portal two is already in flight before the clock is ever
  consulted, so test 7 cannot pass. Isolation comes from the `try`/`catch` inside the loop, not from
  the combinator. Concurrency would also put both boards' full paging load on the wire at once
  against a shared deadline: the slow portal gets no more wall-clock than it does here, and the fast
  one gets less headroom to finish cleanly.
- **Each portal gets an equal share of what is left, recomputed every iteration**, not divided once
  up front: `Math.min(deadlineAt, clock() + Math.floor((deadlineAt - clock()) / remainingPortals))`
  where `remainingPortals = portals.length - index`. Dividing once lets portal one consume the whole
  window and hands portal two a slice that has already expired. A portal that finishes early donates
  its unused time to the ones after it.
- **Name every argument to `portal.crawl`. Do not spread.** An earlier revision wrote
  `portal.crawl({ ...input, deadlineAt })` against an `input` this function does not have — not
  implementable, and it would have hidden a missing field behind a structurally-satisfied type.
- **No `signal`.** `Portal.crawl` has no such parameter and could not honour one (Task 11). The
  pre-fetch clock check plus the per-portal number are the module's entire share of cancellation.
- **The per-portal deadline is cooperative, and that is the limit of the isolation claim.** A portal
  that ignores its `deadlineAt`, or that blocks inside a single host fetch, overruns its share and
  eats the next portal's time; nothing here can preempt it. Either the platform grows a generic
  host-clamped per-request `timeoutMs` on `ModuleFetchRequest` — a core change, out of this module's
  scope — or the plan does not claim hard isolation between portals. **It does not.** Say
  "cooperative per-portal budget", never "isolated", in comments and in any user-facing copy derived
  from this.
- **`truncated` is true if any portal was skipped for time _or_ any `CrawlResult.failure.kind ===
"deadline"`.** A portal that stopped at its own slice with partial postings is still a truncated
  stage; Task 15 has to be able to say "checked 1 of 2 boards".
- **Write portal state before returning, even on the truncated path.** A skipped portal keeps its
  previous state; a failed portal records its cause. Losing this write is how the board ends up
  claiming a source is healthy when it has been failing for a week.
- **A rejected `crawl` promise is a `network` cause, never zero postings.** `ctx.fetch` throws
  `invalid_rpc` when `fetchHosts` does not cover the URL; reporting that as "no jobs matched" is the
  misleading-silence failure.

**Tests** (`tests/unit/job-search-crawl-stage.test.ts`, against an in-memory fake `JobSearchStore`)

1. **A clean crawl stores deduped postings and records `lastOkAt` for each portal.**
2. **One portal failing does not lose the others' results** — a `rate_limited` LinkedIn alongside a
   healthy freehire stores freehire's postings and records LinkedIn's cause in `degraded`.
3. **A `login_required` portal is written back with `enabled: false`.**
4. **A disabled portal is not crawled on the next pass** — asserts its `crawl` was never called.
   Fails against a stage that filters on nothing and relies on the portal to refuse.
5. **Postings are embedded through `embedDocuments` in batches of ≤128** (Task 1's cap), and
   **`embedQuery` is never called here.** The criteria embedding belongs to the triage stage; calling
   the wrong one silently degrades retrieval, because nomic applies a different task prefix to each
   and nothing throws.
6. **The stage never writes a `fit` or `want` value.** Crawling and scoring are separate stages, and
   a crawled-but-unscored posting must be visibly `unscored` rather than silently absent.
7. **Stops starting portals past the deadline and reports that it did.** Two portals; a clock that
   jumps past `deadlineAt` during the first. Asserts the second portal's `crawl` was never called,
   the first portal's postings were still stored, and `truncated === true`. Fails against a check
   placed after the crawl instead of before it — which is the outcome that matters, because a slow
   first portal would otherwise leave the user with fresh postings, no scores, and a board where
   every row reads "unscored".
8. **A portal that throws does not prevent later portals from running**, and its `PortalState.cause`
   records the failure. This is case 2 one level lower: case 2 covers a portal that _reports_ a
   failure, this one a portal that _rejects_. Asserts the second portal's `crawl` was called, its
   postings were stored, and the thrower's state carries a cause rather than a healthy `lastOkAt`.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-crawl-stage.test.ts   # exit 0, eight cases
```

### Task 15: Score stage, the single-pass handler, and surfacing

Two things land here. The scoring stage, in the same shape as Task 14 — a pure function over a fake
store. Then the module's queue handlers: `crawl.run`, which runs crawl → triage → score for **one**
profile inside one invocation because it has no other choice; and `crawl.sweep`, which exists because
schedules fan out one job per _user_, not per profile, so something has to list the actor's own
profiles and walk them.

**Those are two declared queues, not one queue with two handlers.** A schedule can only ever reach
the handler of the queue it names — `job-reconciler.ts` resolves `queueByName.get(schedule.queue)`
and calls `boss.schedule(queue.name, …)`, and the job handler always invokes `queue.handler` with no
per-job override. A manifest that declares only `job-search.crawl-run` and points the schedule at it
makes `crawl.sweep` **unreachable code**, and the scheduled job arrives at `crawl.run` with
`params: {}` and no profile to crawl. That is the single most likely way this module ships looking
fine and never runs.

**Depends on:** Task 2b (`ctx.notify`), Task 2e (`ctx.deadlineAt`), Task 8 (`triage`), Task 9
(`buildScorePrompt`, `parseScoreResult`, `SCORE_SCHEMA`), Task 10 (`buildBriefingContribution`,
`newMatchCount`), Task 13 (`JobSearchStore`, `validateProfileInput`), Task 14 (`runCrawl`,
`EmbedPort`).

**Files**

- Create: `external-modules/job-search/src/worker/stages/score.ts`
- Create: `external-modules/job-search/src/worker/handlers/pass.ts` — `crawl.run` and `crawl.sweep`
- Create: `external-modules/job-search/src/worker/job-input.ts` — the queue-envelope parser
- Create: `external-modules/job-search/src/worker/handlers/briefing.ts`
- Create: `external-modules/job-search/src/worker/handlers/matches.ts` — `matches.list` and
  `match.set-state`, the board's only route to the database
- Modify: `external-modules/job-search/src/worker/index.ts` — register the handlers
- Modify: `external-modules/job-search/jarvis.module.json` — three queues, three tools, the schedule
- Test: `tests/unit/job-search-score-stage.test.ts`, `…-pass-handler.test.ts`,
  `…-job-input.test.ts`, `…-match-handler.test.ts`

**Contracts**

```ts
/** The AI dependency, typed as the REAL host contract. `ctx.ai.generateStructured` returns an
 * envelope, never a bare object, and never throws for a modelling failure — it reports one.
 * Typing this as `Promise<unknown>` is how a module ends up doing `result.fit` on
 * `{ok: false, error: "needs_config"}` and writing `undefined` into a score column. */
export interface AiPort {
  generateStructured(input: {
    schema: Record<string, unknown>;
    prompt: string;
    maxOutputTokens?: number;
    tierHint?: "reasoning" | "interactive" | "economy";
  }): Promise<
    | { ok: true; object: unknown }
    | {
        ok: false;
        error:
          | "needs_config"
          | "validation_failed"
          | "provider_error"
          | "usage_limited"
          | "aborted";
      }
  >;
}

/** Task 2b's `ctx.notify` verbatim. `key` is required here even though the port makes `href`
 * optional: Task 2b dedupes on `key`, so omitting it makes every pass post a fresh
 * "N new matches" row instead of updating one. Use `new-matches:${profileId}`. */
export interface NotifyPort {
  post(input: { key: string; title: string; body: string; href?: string }): Promise<void>;
}

/** The platform's hard cap, enforced PARENT-SIDE per invocation:
 * `worker-rpc-host.ts` exports `AI_CALLS_PER_INVOCATION_CAP = 8` and returns
 * `{ok:false, error:"usage_limited"}` on call nine. So this is the budget for the WHOLE
 * invocation — for a sweep, that is every profile put together, not eight each. */
export const AI_CALL_BUDGET = 8;

export async function runScore(deps: {
  store: JobSearchStore;
  embed: EmbedPort;
  ai: AiPort;
  notify: NotifyPort;
  profileId: string;
  /** Calls this stage may spend. Never larger than AI_CALL_BUDGET minus whatever the
   *  invocation already spent. Zero is legal and means "make no AI calls at all". */
  budget: number;
  now: string;
  deadlineAt: number;
  clock: () => number;
}): Promise<{
  scored: number;
  deferred: number;
  failed: number;
  /** AI calls actually made. The sweep subtracts this from its remaining budget, so a stage
   *  that under-reports silently blows the platform cap on the next profile. */
  aiCallsUsed: number;
  /** Set when the stage stopped for a reason the user should be told about, rather than
   * because it ran out of postings. Rendered by Task 20's degraded strip. */
  halted: null | {
    reason: "needs_config" | "usage_limited" | "deadline" | "aborted" | "provider_error";
    detail: string;
  };
}>;

export async function contributeToBriefing(deps: {
  store: JobSearchStore;
  detail: BriefingDetail;
}): Promise<BriefingContribution>;
```

```ts
// job-input.ts — the QUEUE envelope. Task 13's validateProfileInput handles the TOOL shape.
export interface JobEnvelope {
  readonly actorUserId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
}
export function parseJobEnvelope(raw: unknown): JobEnvelope;
```

**`ctx.input` has two shapes, and this is the single easiest thing in the module to get wrong**

| Invoked via                                                          | `ctx.input` is                                   |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| an assistant tool (`apps/api/src/external-module-tools.ts:82`)       | `{...toolInput, actorUserId}`                    |
| a queue job (`apps/worker/src/external-module-job-handler.ts:88-96`) | `{actorUserId, jobKind, idempotencyKey, params}` |

A handler written against the tool shape reads `input.profileId` on a queue job and finds nothing,
because the profile id is one level down in `params`. It does not crash — it silently does nothing.

**Constraints — the envelope parser**

- **Strict.** The host builds this object itself from exactly four literals
  (`external-module-job-handler.ts:88-96`), so any other shape means the contract changed under us,
  and running against a shape we do not understand is worse than failing. Allowed-key set of exactly
  `actorUserId`, `jobKind`, `idempotencyKey`, `params`.
- **`actorUserId` is first-class here and is never stripped.** The rule that a validator must
  _tolerate_ a host-spread `actorUserId` applies to **tool input schemas**, where the host adds it to
  a module-authored shape. This envelope is host-authored end to end. Do not harmonise the two.
- **`deadlineAt` is not in this envelope.** Task 2e ships it in the `module.invoke` params beside
  `input` and the SDK exposes it as `ctx.deadlineAt`. If a future change moves it into the input
  envelope, it must join the allowed-key set in the same edit or **every job fails on an unknown
  key**.
- `params: {}` is valid (the host writes `params: job.data.params ?? {}`); **absent** is not; and
  `params: []` must be rejected, because `typeof [] === "object"` slips through a naive check and
  every `params.profileId` read afterwards is silently `undefined`.

**Constraints — the score stage**

- Sequence: `embedQuery` the criteria text and the profile's `context_summary` → similarity maps
  against stored posting vectors → `triage` → take at most `min(budget, AI_CALL_BUDGET)` of the
  selected postings → `buildScorePrompt` → `ai.generateStructured({schema: SCORE_SCHEMA, prompt,
tierHint: "reasoning"})` → branch on the envelope → `parseScoreResult` → `upsertMatch`.
- **Five typed errors, four behaviours: `needs_config`, `usage_limited` and `aborted` end the stage;
  `validation_failed` is per-posting; `provider_error` gets exactly one retry across the whole
  stage** — not one per posting, or a provider that is down is hammered for every remaining posting.
  Write it as an explicit `switch` on `result.error`, not a truthiness check.
- **The retry needs a labelled inner loop.** "Retry the same posting" and "move to the next posting"
  are different instructions, and a bare `continue` inside the switch means the second one — it
  silently drops the posting it claims to retry while every call-counting assertion still passes. A
  `retriedProviderError` flag enforces the once rule; an `attempt <= 2` bound guarantees termination
  if someone later edits the flag wrong.
- **Check `callsUsed >= Math.min(budget, AI_CALL_BUDGET)` before every call, including the retry.**
  Taking `min(budget, AI_CALL_BUDGET)` postings up front bounds the _initial_ calls only; one retry
  on top of a full batch is one call over both the stage budget and the host cap. The host increments
  its counter **before** the check (`worker-rpc-host.ts:212-214`), so a rejected attempt still spends
  budget.
- **Cancellation is a number.** Check `clock() < deadlineAt` before each call and halt `"deadline"`
  when it passes. That check stops a call that has not started; a call already in flight is stopped
  by the host, which owns the invocation's `AbortController` (Task 2e). There is no `ctx.signal`, and
  `ctx.ai.generateStructured` accepts no signal parameter (`packages/module-sdk/src/worker.ts:38`).
  Do not go looking for one.
- **Never write a partial score.** A parse failure increments `failed` and leaves the posting
  `unscored` so the next pass retries it; a halt leaves the untouched postings `unscored`, not
  `failed`, because marking them failed hides them from that retry.
- **Notify only when this invocation actually produced matches** — post if and only if `scored > 0`,
  and the count in the body is the number of matches **created during this invocation**, not
  `newMatchCount` read fresh from the store. A store-wide count re-announces yesterday's unread
  matches every six hours, and a pass that scored nothing still posts. One `notify.post` per pass,
  keyed `new-matches:${profileId}`.
- `contributeToBriefing` reads the store and delegates entirely to `buildBriefingContribution` — no
  string assembly in the handler.

**Constraints — the pass handlers**

- **`CRAWL_SHARE = 0.4`.** The invocation's time is split rather than shared first-come-first-served:
  crawling is many cheap HTTP calls, scoring is a few expensive model calls, so an overrunning crawl
  is always the thing to cut — fresh postings with no scores is worse than slightly stale postings
  that are scored. **`CRAWL_SHARE` is a share of TIME; `AI_CALL_BUDGET` is a count of CALLS.** They
  are different resources and are never traded against each other; the crawl stage makes no AI calls.
- `crawl.run` parses the envelope, **requires `params.profileId` itself** (the queue `paramsSchema`
  DSL has no "required" concept, so `{type:"object",fields:{…}}` accepts `{}`), and runs both stages
  for that one profile with the full `AI_CALL_BUDGET`.
- `crawl.sweep` takes no params. It lists profiles via the store — never a parameter, since a
  schedule cannot carry one — filters to `state === "active"` **in the handler** (`listProfiles()` +
  filter, not a `listActiveProfiles` store method: the store contract is closed and "active" is a
  domain predicate), and spends the invocation's eight calls across them sequentially from a
  persisted rotation cursor.
- **`listProfiles` must return a deterministic order** (Task 13 pins `ORDER BY created_at, id`). The
  cursor is an **index** into that list; a non-deterministic order makes it point at a different
  profile every sweep and the rotation degenerates into random selection — which still passes any
  test that only counts calls.
- **Count the calls at the port, not at the return value.** Wrap `ctx.ai` once before the loop in a
  `countingAi(inner)` that increments **before** awaiting, so a call that throws or is aborted still
  counts as spent. The host's own counter is private to the parent RPC closure
  (`worker-rpc-host.ts:111`, incremented at `:212`) and the worker cannot read it. Budget arithmetic
  reads `ai.used()`; returned usage is for reporting only. Deriving remaining budget from returned
  usage double-spends after a throw and blows past the host cap, at which point the sweep looks
  broken for a reason nothing logged.
- **A profile that receives zero budget is legal** — skipped without an error, first in line next
  sweep. Without that, "rotation" means the first profile is scored every six hours and the last one
  never is.
- **One profile throwing must not stop the sweep.** Catch per profile, push the cause onto the
  returned summary, continue. Nothing is written to the store: the closed interface has no
  failure-note method and `ProfileState` has no error member, and inventing either here is a silent
  widening of a deliberately closed contract. The cursor still advances past it, so a permanently
  broken profile cannot starve the others.
- **The sweep honours the deadline, and the cursor points at the first profile not _started_.** Break
  out of the loop when `clock() >= ctx.deadlineAt` as well as when the budget is exhausted, and
  persist `stoppedAt` as the index of the first profile the loop never began — not the last one it
  finished, and not an index advanced past a profile that was cut short. Advancing past an unstarted
  profile is how one profile is skipped every sweep in a way no call-count assertion notices.
- `runProfileStages` takes the wrapped `ai` port as an argument rather than reaching for `ctx.ai`,
  and must never issue a call when its remaining budget is zero.

**Constraints — the match handlers, the board's only route to the database**

Until a declared handler calls Task 13's `listMatches` / `setMatchState` they are unreachable code:
the web bundle receives only `{hostActions, assistantSurface?}`
(`apps/web/src/external-modules/loader.ts:11-20`) and has no database access of any kind.

- **The read and the write take different transports, and this is forced, not chosen.** A
  `risk: "read"` tool executes inline on `POST /api/ai/assistant-tools/:name/invoke`. A `write` or
  `destructive` tool does **not**: the route creates a pending assistant action and returns **403
  with `blockedReason: "confirmation_required"`** before ever reaching `execute`
  (`packages/ai/src/routes.ts:645-668`). A board that calls
  `invokeTool("job-search.match.dismiss")` gets `{kind: "blocked"}` and the match is never dismissed
  — a button that does nothing, on a path where nothing errors. Writes from a module's own surface go
  through the manual-run queue endpoint, exactly as finance does
  (`external-modules/finance/src/web/api.ts:1-8`).
- `matches.list` — `risk: "read"`, called with `invokeTool`, returns board records.
- `match.set-state` — one handler, two ways in: the **board** enqueues
  `runQueue("job-search.match-state", "match.set-state", {matchId, state})`; the **assistant** reaches
  it through the `job-search.match.dismiss` write tool, where the confirmation prompt is the correct
  consent boundary rather than an obstacle.
- **`limit` is required, with no default.** Clamp 1..100 in the schema and **re-check in the
  handler**: the queue path's params DSL has no numeric bounds and never validated it. A handler that
  quietly substitutes a default lets an unbounded board read ship as an omission rather than fail.
- **Scope the read by `profileId`, not by `limit` alone.** RLS confines this to the actor's own rows,
  so the risk is one of the actor's _other_ profiles leaking into this profile's board — still wrong,
  and invisible in a single-profile test.
- **`SETTABLE_STATES = ["new", "saved", "dismissed"]`, enforced in the handler.** The queue's params
  DSL types `state` as `string` because the DSL has no enum, so an unvalidated handler accepts
  `state: "anything"` straight from a manual-run body into the database.
- Both handlers must be **registered** in `src/worker/index.ts` under the manifest's names. A handler
  that exists but is not registered fails at runtime with `unknown handler`, and nothing at install
  time catches it.
- The `crawl.run-now` tool and the `crawl.run` queue are **different handler names on purpose** — the
  tool receives the tool shape, the queue receives the envelope, and one handler serving both would
  have to sniff its own input. Register `crawl.run-now` as a thin wrapper that validates with Task
  13's `validateProfileInput` and calls the same internal function.

**Manifest additions** (verbatim)

```jsonc
"assistantTools": [
  {
    "name": "job-search.crawl.run-now",
    "permissionId": "job-search.crawl.run-now",
    "description": "Crawl this search profile's enabled job boards now.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "profileId": { "type": "string" } }, "required": ["profileId"]
    },
    "handler": "crawl.run-now"
  },
  {
    // The board's read. `risk: "read"` is not a preference — it is the whole reason this
    // works from the browser at all.
    "name": "job-search.matches.list",
    "permissionId": "job-search.matches.list",
    "description": "List scored matches for a search profile.",
    "risk": "read",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "profileId": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
      },
      "required": ["profileId", "limit"]
    },
    "handler": "matches.list"
  },
  {
    // The ASSISTANT path only ("dismiss that one" in chat, then confirm). The board does NOT
    // call this — a write tool 403s from the browser.
    "name": "job-search.match.dismiss",
    "permissionId": "job-search.match.dismiss",
    "description": "Dismiss a match so it leaves the board.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "matchId": { "type": "string" } }, "required": ["matchId"]
    },
    "handler": "match.set-state"
  }
],
"worker": {
  "queues": [
    {
      "name": "job-search.crawl-run", "handler": "crawl.run", "retryLimit": 2,
      // The board's "Search now" enqueues through POST /api/modules/:id/queues/:name/run,
      // which is gated on this flag and is the ONLY enqueue path that exists.
      "allowManualRun": true,
      // Task 2e. A pass is two portals of paged HTTP plus up to eight structured model calls;
      // the 30s default kills it mid-run with an empty log.
      "timeoutMs": 600000,
      // NOT JSON Schema — queue paramsSchema is the platform DSL (`isValidModuleParamsSchema`),
      // while assistantTools[].inputSchema above IS JSON Schema. Two languages, one manifest
      // file. The DSL has NO "required" concept, so this accepts `{}` too and `crawl.run` must
      // reject a missing profileId itself.
      "paramsSchema": { "type": "object", "fields": { "profileId": { "type": "identifier" } } }
    },
    {
      // The scheduled entry point. Its own queue because a schedule can only reach the handler
      // of the queue it names — there is no per-job handler override.
      "name": "job-search.crawl-sweep", "handler": "crawl.sweep", "retryLimit": 1,
      "allowManualRun": false,
      "timeoutMs": 600000,
      // Deliberately empty. The DSL rejects unknown keys, so `fields: {}` accepts `{}` and
      // nothing else.
      "paramsSchema": { "type": "object", "fields": {} }
    },
    {
      // The board's WRITE path.
      "name": "job-search.match-state", "handler": "match.set-state", "retryLimit": 2,
      "allowManualRun": true,
      "timeoutMs": 30000,
      // Two identifiers and an enum — metadata only, no posting content, per the global
      // constraint on job payloads.
      "paramsSchema": {
        "type": "object",
        "fields": { "matchId": { "type": "identifier" }, "state": { "type": "string" } }
      }
    }
  ],
  "schedules": [
    // Off the hour: every module scheduling at :00 stampedes the same minute. scope "user" fans
    // this out to one job per active user with these static params — there is no per-profile
    // scheduling, which is why the handler is a sweep.
    //
    // `queue` MUST be the sweep queue. Pointing it at job-search.crawl-run delivers a job with
    // no profileId to a handler that needs one, and leaves crawl.sweep unreachable.
    { "id": "job-search.crawl-sweep", "cron": "17 */6 * * *", "scope": "user",
      "jobKind": "job-search.crawl-sweep", "queue": "job-search.crawl-sweep" }
  ],
  "reconcileJobs": []
}
```

All four schedule fields are required by `validate.ts`: `id` and `jobKind` must match
`/^[a-z][a-z0-9_.-]{0,63}$/`, `cron` must be five fields, `scope` must be `"user"`. A schedule
missing any of them fails validation, which fails install.

**Tests — envelope** (`tests/unit/job-search-job-input.test.ts`)

1. **Reads exactly the four fields the queue path sends** and returns them unchanged.
2. **Accepts the sweep's empty `params: {}`** — empty is valid, absent is not.
3. **Rejects an unknown top-level key** (`/unknown key extra/`). The host sends four literals; a
   fifth means the contract moved.
4. **Rejects `params` that is an array, `null`, a scalar, or absent.** The array case is the one that
   matters: `typeof [] === "object"` passes a naive object check and every later `params.profileId`
   read is silently `undefined`.
5. **Rejects a tool-shaped input** `{profileId, actorUserId}` with `/unknown key profileId/`, rather
   than running against `params: undefined` and reporting success having done nothing.
6. **Rejects a missing `actorUserId`.** Everything stored is owner-scoped; there is no default.

**Tests — score stage** (`tests/unit/job-search-score-stage.test.ts`)

1. **Triage picks the batch** — only selected postings are sent to the model.
2. **`outsideFrame` from triage is persisted onto the match**, so the recall slice stays visibly
   flagged.
3. **An `{ok: true}` envelope whose `object` fails `parseScoreResult` leaves the posting `unscored`**
   and increments `failed`. It never lands as a number, and it is retried next pass.
4. **One bad result does not abort the batch** — the other postings still score.
5. **`needs_config` halts immediately** and scores nothing further; exactly one
   `generateStructured` call. Retrying is pointless — no model is configured, so every remaining call
   returns the same thing.
6. **`usage_limited` halts and leaves the rest `unscored`, not `failed`.** Asserts `failed === 0` and
   that the untouched postings still appear in `listUnscored`. Marking them failed would hide them
   from the next pass, which is fine because the cap resets per invocation.
7. **`aborted` ends the stage** — exactly one call, zero `failed`. Note what this case does _not_ do:
   it never constructs an `AbortSignal`. The module has none to give; the fake port returns the
   envelope exactly as the host's would.
8. **`provider_error` gets exactly one retry across the whole stage, on the same posting.** Asserts
   three things: that the two calls around the retry carried the **same posting id in their prompt**,
   that no posting was skipped, and that a second `provider_error` anywhere halts. A retry written as
   a bare `continue` passes a call-count assertion while silently dropping the posting it claimed to
   retry — the prompt assertion is what catches it.
9. **`validation_failed` is per-posting** — increment `failed`, leave the posting `unscored`, keep
   going. It is the one error the _model_, not the platform, caused.
10. **Never more than `budget` calls, never more than `AI_CALL_BUDGET`.** 40 candidates with
    `budget: 8` → exactly 8 calls and the remainder `deferred`. The 9th returns `usage_limited`
    anyway, so spending it to discover that is pure waste.
11. **`budget: 0` makes no calls at all** and returns `aiCallsUsed: 0` without an error. The sweep
    hands out zero when the invocation's budget is spent; that is a normal outcome.
12. **`aiCallsUsed` equals the number of `generateStructured` calls, including failures.** A retry
    counts. This is the number the sweep does its arithmetic on.
13. **A retry cannot exceed `budget`.** `budget: 1`, one candidate, first call `provider_error` →
    exactly **one** call and a `"usage_limited"` halt, not a second call it was never given.
14. **A retry cannot exceed `AI_CALL_BUDGET` either.** Eight candidates, `budget: 8`, first returns
    `provider_error` → exactly eight calls total; the retry consumes the eighth posting's call and
    the eighth posting is deferred. Without the counter this is nine, and the ninth is refused by the
    host after already being spent.
15. **A notification fires once per pass with the new-match count**, not once per match.
16. **The notification body never contains a blended number** — asserted against
    `/\b(overall|combined|score of)\b/i`.
17. **A pass that scores nothing posts no notification at all**, and a pass that scores 2 while the
    store already holds 30 unread matches says **2**. Fails against a body built from a store-wide
    `newMatchCount`, which re-announces yesterday's matches every six hours.

**Tests — pass handlers** (`tests/unit/job-search-pass-handler.test.ts`)

1. **`crawl.run` runs both stages in one invocation** — `runCrawl` then `runScore`, same `profileId`,
   from a single handler call. This is the assertion that encodes why the two stages are not two
   queue entries.
2. **The crawl deadline leaves room for scoring** — the deadline handed to `runCrawl` is meaningfully
   earlier than the one handed to `runScore`. A crawl allowed to consume the whole invocation
   produces a board full of `unscored` rows, which looks broken.
3. **`crawl.run` reads `params.profileId`, not `input.profileId`** — fed a real queue envelope.
4. **`crawl.run` rejects a missing or non-string `profileId` itself** with a typed failure — not a
   crash, not a silent no-op. The params DSL will happily deliver `{}`.
5. **`crawl.sweep` takes no params, lists the actor's own active profiles, and runs each.**
6. **`crawl.sweep` skips profiles that are not `active`** — a profile still `in_conversation` has no
   criteria, and crawling on empty criteria fetches the entire board.
7. **One profile failing does not stop the sweep** — the second profile still ran and the handler
   resolved rather than threw. A thrown handler is a pg-boss retry of the _whole_ sweep.
8. **Nine active profiles, one sweep: at most 8 AI calls in total, and the ninth is untouched.**
9. **The next sweep starts at that ninth profile** — cursor seeded from the first sweep's write.
10. **Twenty profiles across three sweeps: every profile is served at least once, and none is served
    twice before all the others have been served once.**
11. **Zero active profiles: no AI calls, no cursor write, no error.**
12. **A profile that receives zero budget is skipped without an error** and is first in line next
    sweep.
13. **The budget is counted at the port.** Profile 1 spends three calls and then throws; profile 2 is
    offered a budget of exactly **5**, not 8. Fails against every return-value-based accounting
    scheme — which is the point.
14. **The sweep stops at the deadline and the cursor points at the first profile not started.** Three
    profiles; the clock crosses `ctx.deadlineAt` during profile 2. Asserts profile 3's stages were
    never invoked and the persisted cursor is profile **2**'s index, not 3's — advancing past a
    profile that was cut short is how one profile is skipped every sweep with no assertion noticing.

**Tests — match handlers** (`tests/unit/job-search-match-handler.test.ts`, against a fake store)

1. **`matches.list` with no `limit` throws; it does not default.** Same for `0`, `101`, and `1.5`.
2. **`profileId` and `limit` reach the store unchanged** — asserted on the fake's recorded arguments,
   because a handler that reads the whole board and slices in memory passes any assertion made on the
   returned length.
3. **`match.set-state` with `state: "archived"`** (or any string outside the set) throws and calls the
   store **zero** times.
4. **Each of the three legal states calls the store exactly once with that state.**
5. **`matches.list` returns board records, never a raw store row** — id, title, company, both axis
   scores as separate fields, the reasons. Assert the returned keys explicitly: the render-from-
   records rule is only real if the record shape is pinned.

**Tests — manifest** (`tests/unit/job-search-manifest.test.ts`)

Assert through `validateExternalModuleManifest()`, **never against the raw JSON** — the validator
reconstructs the manifest from an explicit field list and silently drops what it does not recognise,
so `ok: true` proves nothing.

1. `worker.queues` has **three** entries, including handlers `crawl.run` and `crawl.sweep`.
2. **`queues[0].timeoutMs === 600000`.** If it is `undefined`, Task 2e's `validate.ts` change was not
   made and the pass dies at 30 seconds in production while passing every test here.
3. `worker.schedules[0].queue === "job-search.crawl-sweep"`.
4. `job-search.match-state` survives with `allowManualRun: true` — the board's dismiss has no other
   way in, and `allowManualRun` defaulting to false is a silent 403 at the one moment it matters.
5. **`job-search.matches.list` survives with `risk: "read"`** and `job-search.match.dismiss` with
   `risk: "write"`. The read one is load-bearing: flip it to `write` and every board read returns
   `confirmation_required` instead of matches, while every unit test above still passes.
6. **Every `schedules[].queue` names a declared queue.** Defence in depth, and be honest about which
   layer carries it: `validateWorker` already rejects an undeclared queue
   (`packages/module-registry/src/external/validate.ts:176`), so a validated install cannot reach the
   reconciler's silent `queueByName.get()` miss (`job-reconciler.ts:127`) with this defect. This
   assertion verifies the **normalized, install-time** wiring — that the name survives the field
   allowlist and still matches — not a typo the validator would already have caught.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-job-input.test.ts \
  tests/unit/job-search-score-stage.test.ts \
  tests/unit/job-search-pass-handler.test.ts \
  tests/unit/job-search-match-handler.test.ts \
  tests/unit/job-search-manifest.test.ts        # exit 0
```

### Task 16: Conversation, profile, résumé, and settings tools

The eight tools the conversation and the settings screen write through. Every one returns
**records, never prose**.

**Depends on:** Task 10 (`parseCriteria`, `parseContextSummary`, `CONTEXT_SUMMARY_MAX`,
`completedSteps`, `isReadyToCrawl`), Task 13 (`validateProfileInput`, `JobSearchStore`).

**Files**

- Create: `external-modules/job-search/src/worker/handlers/{profile.ts,resume.ts}`
- Modify: `external-modules/job-search/jarvis.module.json` — eight tools
- Test: `tests/unit/job-search-profile-handler.test.ts`

**Contracts**

| Tool                                     | Handler                       | Risk  |
| ---------------------------------------- | ----------------------------- | ----- |
| `job-search.profile.create`              | `profile.create`              | write |
| `job-search.profile.list`                | `profile.list`                | read  |
| `job-search.criteria.set`                | `criteria.set`                | write |
| `job-search.profile.set-context`         | `profile.set-context`         | write |
| `job-search.profile.set-briefing-detail` | `profile.set-briefing-detail` | write |
| `job-search.resume.set`                  | `resume.set`                  | write |
| `job-search.resume.get`                  | `resume.get`                  | read  |
| `job-search.portal.set-enabled`          | `portal.set-enabled`          | write |

`set-enabled`, **not `toggle`**: the tool names the state it writes rather than the transition, so a
retry or a double-click is idempotent instead of flipping the portal back off. Task 20's settings UI,
the seed prompt, and the Task 21/22 tests all call this exact name.

**Constraints**

- Each handler is the same four steps: validate the input, call the store, shape a record, return it.
  No handler builds a sentence and no handler decides policy — `isReadyToCrawl` and `completedSteps`
  live in Task 10's domain layer and are **called, not reimplemented**.
- **`profile.set-context` runs `parseContextSummary` and is the only writer of `context_summary`.**
  That is what makes the stored value something the user approved: the tool call is visible and
  confirmable like any other. **Raw transcript is never stored.**
- **`resume.get` is `risk: "read"` and returns résumé text to the _assistant_** — that is intended;
  the point is letting the user talk about their own résumé. What it must never do is reach an
  adapter. Keep it out of `ports.ts`'s crawl dependency set entirely, so the wiring makes the mistake
  impossible rather than merely discouraged.
- Every `inputSchema` here is **JSON Schema** with `additionalProperties: false` — unlike the queue
  `paramsSchema` in Task 15, which is the platform DSL. Two languages, one manifest file.

**Tests** (`tests/unit/job-search-profile-handler.test.ts`)

1. **`criteria.set` on a now-complete `in_conversation` profile flips `state` to `active` and
   enqueues nothing**, returning `readyToCrawl: true`. The absence is asserted explicitly: a handler
   cannot enqueue, and the first crawl is started by the browser calling
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` after this tool returns. A handler
   that tried to enqueue would have nothing to call.
2. **An incomplete profile stays `in_conversation`** and returns `readyToCrawl: false` with its
   `completedSteps`, so the UI's progress readout comes from the record.
3. **`profile.list` returns `completedSteps`** — a screen must never compute progress from prose.
4. **`resume.set` bumps `version` and keeps the prior row.**
5. **The crawl path never reads the résumé.** It is scoring input only; a résumé must never leave the
   instance inside an outbound HTTP request.
6. **Every handler strips `actorUserId` via `validateProfileInput`, and none accepts a genuinely
   unknown key.**
7. **`profile.set-context` rejects an over-length summary rather than truncating it** — a
   `CONTEXT_SUMMARY_MAX + 1` string throws and the stored value is unchanged. Truncation feeds a
   half-sentence to the scorer on every posting in the batch.
8. **`profile.set-context` replaces wholesale and never appends** — set twice, the second value is
   the whole stored value.
9. **`profile.set-briefing-detail` accepts exactly `count | top | full`** and rejects a fourth value,
   matching the column's check constraint from Task 4.
10. **No handler returns a blended score.** Walk every handler's result object and assert no key
    matches `/^(score|overall|match|rank)$/i` — a cheap structural guard against the one thing the
    design forbids.
11. **The manifest's declared tool handlers and the registration keys are the same set**, compared
    both ways so a name declared with no handler and a handler with no declaration both fail. Nothing
    else in the stack cross-checks these: a tool declared as `job-search.portal.toggle` and
    registered as `portal.set-enabled` installs cleanly, appears in the assistant's tool list, and
    fails only when a user asks for it.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-profile-handler.test.ts \
  tests/unit/job-search-manifest.test.ts && pnpm check:external-modules   # exit 0
```

### Task 17: Seed prompt for the job-search thread

The thread is a full-capability session — full tool set, no restrictions. It differs from the main
thread only by seed prompt and scope.

**Depends on:** Task 2c (`setSurfaceKey` / `seedContext` on `AssistantSurfaceHandleV1`), Task 16
(the tool names it cites).

**Files**

- Create: `external-modules/job-search/src/domain/seed-prompt.ts`
- Modify: `external-modules/job-search/src/web/use-profiles.ts` — the caller
- Test: `tests/unit/job-search-seed-prompt.test.ts`
- Test: `tests/unit/job-search-web-root.test.tsx` (additions)

**Contracts**

```ts
export function buildSeedPrompt(profile: Profile): string;

/** Bind the module's chat surface to the active profile and frame it once.
 *
 * Order matters: `setSurfaceKey` FIRST, because `seedContext` is curried with whatever surface
 * the handle currently holds — seeding first would frame the *drawer*, which is exactly the leak
 * Ben ruled out ("if the user is in the job search and they open the drawer, I don't want that
 * job search to show up in the drawer").
 *
 * The idempotency key is versioned (`:v1`). The manager dedupes on it
 * (`chat-session-manager.ts:384`), so a remount is a no-op — but editing the prompt text without
 * bumping the version would leave existing sessions framed by the old copy forever. */
export function useProfileThread(
  assistantSurface: AssistantSurfaceHandleV1 | undefined,
  profile: Profile | null
): void;
```

**Constraints**

- **A seed prompt with no caller is dead code.** `useProfileThread` is part of this task, not a later
  one, and the web-root test below is what proves it is wired.
- `setSurfaceKey(profile.surfaceKey)` before `seedContext(...)`; `setSurfaceKey(null)` on unmount.
  Returning the drawer is the shell's job (Task 2c), but the module says it too — a module that
  navigates away must not leave the drawer pointed at its own transcript.
- **The key is `profile.surfaceKey`, not `profile.id`.** Task 4 gives the profile row its own
  `surface_key` column precisely so the thread's identity is separable from the record's: rotating
  it starts a fresh conversation without deleting the search, and it is the only way a user ever
  gets to start over. Binding the id instead would compile, pass every unit test, and quietly
  remove that. The id still keys the **seed** below, because seeding is per profile-and-prompt-
  version, not per thread.
- Seed key is `job-search:${profile.id}:v1`. Bump the version whenever the prompt text changes.
- **Nothing in the stack validates a tool name written in prose.** A wrong name in the seed text
  fails silently at runtime, and has broken a module before. The prompt must cite the exact
  registered names.
- The prompt must not tell the model to withhold any capability — this is a full session.

**Tests** (`tests/unit/job-search-seed-prompt.test.ts`)

1. **Names the tools that write criteria** — `job-search.criteria.set` and `job-search.resume.set`
   appear verbatim, so the model records rather than narrates.
2. **Every tool name appearing in the prompt exists in `manifest.assistantTools`.** This is the
   generalisation of case 1 and the one that survives a later rename.
3. **Tells the model the interview has a defined end** — the five steps `role`, `want`, `where`,
   `comp`, `sources` all appear.
4. **Does not tell the model to withhold any capability** — asserts the text does not match
   `/only use|do not use|you cannot|not available here/i`.

**Tests** (`tests/unit/job-search-web-root.test.tsx`, additions)

1. **Binds the surface before framing it, and frames it once.** Renders and re-renders with the same
   surface; asserts `setSurfaceKey`'s `invocationCallOrder` is lower than `seedContext`'s, that it
   was called with the profile's `surfaceKey` (not its id), that `seedContext` was called exactly once, and that it received a string
   containing `job-search.criteria.set` with key `job-search:p1:v1`. Ordering, not just presence:
   seeding before binding frames the drawer, and a presence-only assertion passes either way.
2. **Works when the host gives it no assistant surface.** `assistantSurface` is optional in the host
   contract (`apps/web/src/external-modules/loader.ts:10-19`); the board must still render.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-seed-prompt.test.ts \
  tests/unit/job-search-web-root.test.tsx   # exit 0
```

## Phase 5 — Web surface

Built from `apps/web/src/job-search-prototype/variant-flow.tsx`. Read that file and `flow.css`
before starting: they hold the decided shape and the reasoning in their header comments. The
prototype's fake data does **not** come across — every value comes from a tool result.

### Task 18: Web entrypoint, the empty-install bootstrap, and the onboarding/board branch

The module's surface, the branch between onboarding and board, and the only path a freshly
installed module has out of having zero profiles.

**Depends on:** Task 15 (`job-search.profile.list` read tool, the `job-search.crawl-run` manual
queue), Task 16 (the tool names it calls).

**Files**

- Read first: `external-modules/finance/src/web/index.ts` — the entrypoint contract
- Read first: `apps/web/src/external-modules/host-actions.ts` — what `openAssistant` actually does
- Create: `external-modules/job-search/src/web/{index.ts,root.tsx,use-profiles.ts,api.ts,styles.css}`
- Test: `tests/unit/job-search-web-root.test.tsx`
- Test: `tests/unit/job-search-use-profiles.test.tsx`

**Contracts**

```ts
type ProfilesState =
  | { status: "loading" }
  | { status: "empty" } // zero profiles → bootstrap panel
  | { status: "ready"; profiles: Profile[]; selectedId: string };

export interface UseProfilesOptions {
  /** The bootstrap latch. `Root` owns it, not the hook: the thing that arms polling is a
   *  button press in `Root`'s bootstrap panel, and the thing that clears it is either a
   *  profile arriving or expiry. `false` means the hook schedules no interval at all. */
  pollArmed: boolean;
  /** Fired once when the window or the attempt cap is reached. `Root` responds by setting
   *  `pollArmed` back to false and rendering the retry action. The hook does not own the
   *  latch, so it cannot clear it itself — it reports. */
  onPollExpired(): void;
}

export function useProfiles(options: UseProfilesOptions): ProfilesState & {
  refetch(): void;
  select(id: string): void;
};
```

```ts
// src/web/api.ts — the module's transport, and the ONLY place it talks to the host.
export async function invokeTool(name: string, input?: Record<string, unknown>): Promise<unknown>;

/** Enqueue a manual run on a declared queue. Mirrors finance's `runQueue`
 *  (`external-modules/finance/src/web/api.ts:96`) exactly — same route, same body shape,
 *  same outcome union — because this is a host route with a fixed contract, not a place to
 *  be creative. `POST /api/modules/job-search/queues/:queueName/run`, body
 *  `{jobKind, params?}`, 202 → queued (a null jobId means the actor's manual singleton is
 *  already queued), 404 → the queue is not manual-runnable, anything else → error. */
export type RunOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };
export function runQueue(
  queueName: string,
  jobKind: string,
  params?: Record<string, unknown>
): Promise<RunOutcome>;
```

Module constants, named so the tests can shorten them and no call site hardcodes a number:
`POLL_INTERVAL_MS = 3_000`, `POLL_WINDOW_MS = 120_000`, `POLL_MAX_ATTEMPTS = 40`.

**The poll split.** The hook owns the **timing** — the interval, the attempt counter, the
`visibilitychange` subscription, and the hidden-time accounting. `Root` owns the **latch and the
UI** — `pollArmed`, the bootstrap button that sets it, and the retry action `onPollExpired` causes
it to render. Neither half can be tested without the other being nameable, which is why the
contract is written before the tests.

**Constraints**

- **The hook is plural.** Multiple profiles is a settled product decision, and a singular
  `useProfile` bakes "there is exactly one" into the first file every later screen imports.
- **`runQueue` is the only thing in the entire product that starts a crawl.** A worker handler
  cannot enqueue — there is no jobs port on `ModuleWorkerContext` — and the schedule only ever
  reaches `crawl.sweep`. If `runQueue` is not written and wired, a user can finish the
  conversation, watch `criteria.set` return `readyToCrawl: true`, and wait forever for a first
  crawl that nothing asked for. Two call sites, both required: the `readyToCrawl` transition here,
  and the board's "Search now" button (Task 20).
- **The enqueue latch persists under `actorScopeKey` + profile id, in module-local storage** —
  not in component state. An in-memory latch is cleared by a page reload, so the "once per
  transition" guarantee lasts exactly as long as the tab does: reload twice and the queue takes
  three jobs for one transition. `actorScopeKey` is in the latch key because module-local storage
  is per-browser, not per-actor, and a second signed-in user must not inherit the first's latch.
  **Task 20's "Search now" bypasses the latch entirely** — it is an explicit user action, and a
  deliberate re-run must not be swallowed by a record of an automatic one.
- **The empty install is a real state with a real path out of it.** A freshly installed module has
  zero profiles and cannot create one itself: `hostActions.openAssistant({starterPrompt})` inserts
  an **editable, unsent draft** into the assistant composer and never runs a tool
  (`apps/web/src/external-modules/host-actions.ts`); the browser REST invoke route serves
  `risk: "read"` tools only and 403s writes, and `profile.create` is a write tool; `Root` receives
  only `{hostActions, assistantSurface?}` (`apps/web/src/external-modules/loader.ts:10-19`) and is
  never handed a profile. So the bootstrap is a five-step handoff: empty state renders a
  module-owned panel with one primary action → the action opens the composer with a starter prompt
  → **the user presses send**, which is the consent boundary → the surface picks the new profile up
  by polling `profile.list` → `ready` renders the board or the switcher.
- **The poll is bounded on four axes.** Pressing the button is only a latch; the user may close the
  drawer, edit without sending, or send a turn that creates nothing. A latch with no exit is an
  infinite background poll on an abandoned tab.
  1. **Armed, not free-running** — no poll at all until the action is pressed. An untouched empty
     install issues zero tool calls.
  2. **Expiring** — `POLL_WINDOW_MS` **or** `POLL_MAX_ATTEMPTS`, whichever comes first, measured
     from the press.
  3. **Suspended while hidden** — while `document.hidden` the interval does not fire **and elapsed
     time does not accrue**, so a backgrounded tab does not burn the window down and expire the
     moment the user returns. Subscribe to `visibilitychange`; on becoming visible fetch once
     immediately before resuming the interval. The existing window-`focus` refetch stays.
  4. **Reset on expiry, with a way back** — the poll stops, the latch clears, and the panel
     re-renders with a retry action ("Still setting up? Try again") that re-arms the cycle. Expiry
     is **not** an error state and must not render one; the common cause is a user who decided not
     to finish, and they land back on the same panel they left.

  Do not assume an assistant-completion event exists on `assistantSurface`. If the implementer
  confirms one, they may replace the poll with it and should note that here — the four bounds still
  apply to whatever replaces it.

- **`selectedId` persists in module-local storage** and falls back to the first profile when the
  stored id no longer exists.
- **No chat button in the module surface.** The core header already has one; the prototype violates
  this deliberately (`variant-flow.tsx:145`). Do not port that button.
- **Every component uses the module's `h` factory** (`jsxFactory: "h"`), and **every keyed component
  needs an explicit `key?: string` prop** in its props type — external modules compile with their
  own factory, so `key` is not compiler-stripped and its absence is a TS2322.
  `pnpm check:external-modules` is the only gate that catches this.

**Test-file split — this is a correctness constraint, not organisation.** `job-search-web-root.test.tsx`
mocks `use-profiles.ts` with a hoisted `vi.mock`, because that is the only way to drive `Root`'s
branches. `vi.mock` is hoisted above the imports and applies to **the whole file**, so a case in that
file which claims to exercise the real hook — the poll timing, the attempt cap, the visibility
accounting — is asserting against the mock and would pass against a hook that was never written.
Every real-hook case therefore lives in `job-search-use-profiles.test.tsx`, which mocks only `api.ts`.

Two further mocking rules for the `Root` file: use **one** `vi.mock` per specifier — both transports
live in `api.ts`, and a second `vi.mock` of the same path replaces the first silently, so the earlier
factory's spies stop being installed and the failures land a long way from the cause. And stub
`hostActions` against the **real** `ExternalModuleHostActionsV1`, which requires both `actorScopeKey`
and `openAssistant` (`apps/web/src/external-modules/host-actions.ts:14-24`); typing it `any` to make
it compile hides the next field the contract grows. Omit `assistantSurface` — it is optional, and
`Root` must not require it.

**Tests** (`tests/unit/job-search-web-root.test.tsx` — branches, with `use-profiles` mocked)

1. **Zero profiles renders the bootstrap panel and no board** — asserts the set-up action is present
   and `queryByRole("table")` is null.
2. **Bootstrap goes through the assistant composer and never through a tool invoke.** Asserts
   `openAssistant` was called with a starter prompt matching `/job search profile/i` **and that the
   module's `invokeTool` was not called at all**. Assert the absence at the transport, not through a
   prop: `Root` takes only `{hostActions, assistantSurface?}`, so an `invokeTool` prop passed by a
   test would be ignored by the real component and the assertion would pass no matter what the
   bootstrap did. A direct invoke would 403 in production and pass in any test that stubs a prop.
3. **A profile with no criteria renders onboarding and no table** — a profile with nothing in it has
   nothing to put in a table.
4. **A profile with criteria renders the board and no onboarding.**
5. **No chat button is rendered** — `queryByRole("button", {name: /chat/i})` is null. Guards the
   prototype's deliberate violation from being ported.
6. **A profile that arrives already `active` enqueues the first crawl exactly once** — asserts
   `runQueue("job-search.crawl-run", "crawl.run", {profileId: "p1"})`, then refetches the same list
   and asserts the call count is still one. Clear the spy in `beforeEach` so the count measures this
   test's renders, not the file's.
7. **The enqueue latch survives a remount** — same profile, fresh mount with the same
   `actorScopeKey`, still one call. Fails against a latch held in component state, which is the
   implementation a passing case 6 alone would accept.
8. **A different `actorScopeKey` does not inherit the latch** — remount as a second actor and assert
   the crawl is enqueued for them. Guards the shared-browser case.
9. **A profile that arrives `in_conversation` enqueues nothing** — the crawl starts when criteria
   are complete, not when a profile exists.
10. **`runQueue` resolving `{kind: "already-queued"}` renders the calm queued state, not an error**,
    and `{kind: "disabled"}` says plainly that manual runs are off rather than failing silently.
11. **Binds and frames the assistant surface** — see Task 17, whose two cases live in this file.

**Tests** (`tests/unit/job-search-use-profiles.test.tsx` — the real hook, `api.ts` mocked)

Use `vi.useFakeTimers()`; drive visibility by stubbing `document.visibilityState` and dispatching
`visibilitychange` — jsdom does not change it for you.

1. **Armed and empty polls `profile.list` every `POLL_INTERVAL_MS`; the first non-empty response
   switches to `ready` and stops the interval** — advance a further 30 s and assert no more calls.
2. **Empty and not armed polls not at all** — zero calls. This is the case that keeps an untouched
   install silent.
3. **`POLL_WINDOW_MS` elapsing with every response empty fires `onPollExpired` once and stops** —
   advance a further 60 s and assert no additional calls.
4. **`POLL_MAX_ATTEMPTS` responses before the window elapses expire it the same way.** This is the
   axis a time-only bound misses the moment the interval is shortened.
5. **Re-arming after expiry resumes polling** and a non-empty response still resolves to `ready`.
6. **While `document.hidden` the interval does not fire and the window does not accrue** — hide,
   advance past `POLL_WINDOW_MS`, show again, and assert the poll is still live rather than expired.
   Fails against an implementation that merely skips the fetch while hidden.
7. **Becoming visible fetches once immediately, before the next interval tick.**
8. **One profile yields no switcher; three yield one, and `select` persists across a remount.**
9. **A stored `selectedId` that no longer exists falls back to the first profile** rather than
   rendering an empty board.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-root.test.tsx \
  tests/unit/job-search-use-profiles.test.tsx && pnpm check:external-modules   # exit 0
```

---

### Task 19: Onboarding screen

The screen a profile shows before it has criteria: the conversation itself at full width, how far
along it is, and nothing that pretends to be results.

**Depends on:** Task 10 (`ONBOARDING_STEPS`, `completedSteps`), Task 18 (`Root`'s branch), Task 2c
and Task 17 (`AssistantSurfaceHandleV1`, already bound to the profile's surface).

**Files**

- Read first: `apps/web/src/chat/assistant-surface/contracts.ts` — `AssistantSurfaceViewProps`
- Create: `external-modules/job-search/src/web/screens/onboarding.tsx`
- Test: `tests/unit/job-search-web-onboarding.test.tsx`

**The screen is the conversation.** Spec §7 makes onboarding "a full chat interface, full width" and
the prototype draws it as `.jp-onb__thread` + `.jp-onb__composer`; Task 22 phase 3 asserts a new
profile shows chat and no table, and phase 6 asserts that chat is gone once the board arrives. So
this screen renders the host's own thread view — `assistantSurface.Surface` off the handle Task 17
already bound with `setSurfaceKey(profile.id)` — with the progress chips above it. It does **not**
build a chat: `Surface` is a `ComponentType<AssistantSurfaceViewProps>` supplied by the host
(`apps/web/src/chat/assistant-surface/contracts.ts:26`), carrying the same stream the core header
drawer shows for this surface. That is spec §8's "same stream, two renderings" — one transcript, one
composer implementation, two places it appears.

**Constraints**

- **Render the host `Surface`; never a second chat implementation.** A module-owned transcript would
  have its own history, its own composer semantics and its own bugs, and would not be the thread the
  drawer shows. The whole scoping ruling rests on there being exactly one stream per surface.
- **`assistantSurface` is optional** (`loader.ts:10-19`, I1). Absent, the screen still renders its
  copy and chips with a plain line saying the conversation is unavailable — it does not blank, and it
  does not throw. Task 18's equivalent case is the precedent.
- **Progress comes from the record, never from the transcript.** The chips render from the
  `completedSteps` array on the `profile.list` result — the domain layer decides what is done
  (Task 10), and the screen displays it. A screen that inferred progress from what the model said
  would be UI made of model output.
- Port the markup from the prototype's `.jp-onb` block and the styles from `flow.css`, renaming the
  `jp-` prefix to the module's own.
- **Tokens only** — `pnpm check:design-tokens` fails on a literal colour.

**Tests** (`tests/unit/job-search-web-onboarding.test.tsx`)

1. **One chip per `ONBOARDING_STEPS` entry, with the done ones marked from `completedSteps`.**
   Fails against a screen that hardcodes its own step list, which would drift the moment Task 10's
   steps change.
2. **An empty profile renders the "nothing gets crawled until we both know what we're looking for"
   copy, not a spinner.** An empty profile is a finished state waiting on the user, not a load in
   progress, and a spinner tells the user to wait for something that will never arrive.
3. **No table, no rail, and no source strip during onboarding** — asserts each is absent. There are
   no results yet, and chrome that implies otherwise is the thing this screen exists to avoid.
4. **The conversation is the host's `Surface`, rendered full width** — pass a handle whose `Surface`
   is a spy component and assert it was rendered. A screen that only shows chips and copy leaves the
   user nothing to answer with, and Task 22 phase 3 would fail on a real instance long after this
   test passed.
5. **With no `assistantSurface`, the screen still renders its chips and copy** and says the
   conversation is unavailable rather than throwing. The host contract makes the handle optional, so
   this is a state that can actually occur.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx && pnpm check:design-tokens   # exit 0
```

---

### Task 20: Board, inspector, settings, and degraded states

The screen a profile shows once it has criteria: the two-axis match table, the per-match inspector,
and the per-profile settings. These are the states that decide whether the thing is usable.

**Depends on:** Task 15 (`job-search.matches.list` read tool, the `job-search.match-state` manual
queue, `job-search.crawl-run`), Task 16 (`job-search.portal.set-enabled`,
`job-search.profile.set-briefing-detail`), Task 18 (`invokeTool`, `runQueue`, `RunOutcome`).

**Files**

- Create: `external-modules/job-search/src/web/screens/{board.tsx,inspector.tsx,settings.tsx}`
- Create: `external-modules/job-search/src/web/screens/discuss.tsx` — the thread panel and its card
- Test: `tests/unit/job-search-web-board.test.tsx`
- Test: `tests/unit/job-search-web-discuss.test.tsx`
- Test: `tests/unit/job-search-web-settings.test.tsx`

**Transport — reads and writes take different routes, and this is forced.** The board's data comes
from `invokeTool("job-search.matches.list", {profileId, limit})`, which works from the browser only
because that tool is `risk: "read"`. Every write on this screen is a write tool and would 403 at
`packages/ai/src/routes.ts:645-668` with `blockedReason: "confirmation_required"`, so dismissing a
match goes through the manual-run route instead:
`runQueue("job-search.match-state", "match.set-state", {matchId, state})`. `limit` is required by
the tool and has no default, so the board passes one explicitly.

That split has a consequence the screen has to absorb: **`runQueue` returns "queued", not "done".**
A dismiss is therefore optimistic — hide the row immediately, then reconcile against the next
`matches.list` result, and restore the row with a plain message if it comes back still `new`. A
board that waited for the write to land would appear frozen; a board that hid the row and never
reconciled would silently lie after a failed job.

**Board states.** `loading` (an authored skeleton, not an empty table), `error` (the message plus a
retry that re-invokes `matches.list`), `empty` (a real state, distinct from both), and `ready`.
Refetch happens on window focus and after any `runQueue` resolves.

**Three actions, three different mechanisms.** Spec §7 puts **Discuss / Open posting / Dismiss** on
every match, and no two of them travel the same way:

```ts
// discuss.tsx
/** The card that stands in for the posting in the thread. Built from the match record —
 *  never from model prose, and never from a pasted paragraph of the posting body. */
export function MatchRecordCard(props: { match: Match; posting: Posting }): JSX.Element;

/** Open the profile's thread with this posting already in it. */
export function useDiscuss(assistantSurface: AssistantSurfaceHandleV1 | undefined): {
  discussing: string | null;
  discuss(match: Match, posting: Posting): void;
  close(): void;
};
```

- **Dismiss** is a write, so it cannot be invoked from the browser at all (I4) and goes through
  `runQueue("job-search.match-state", "match.set-state", {matchId, state})` — see the transport note
  above.
- **Open posting** is an ordinary external link to `posting.url`, `target="_blank"` with
  `rel="noopener noreferrer"`. It is not a tool call, it does not enqueue anything, and it does not
  mark the match seen — the user going to look is not the user deciding.
- **Discuss** opens the profile's thread with the posting already present. Two halves that must not
  be confused: the **user** gets `MatchRecordCard` rendered as a `LocalRow` on
  `assistantSurface.Surface` (`localRows` already exists on `AssistantSurfaceViewProps` and takes
  arbitrary content), and the **model** gets the same record as structured data through
  `submitTurn({text, controlContext})`, which core renders into the prompt as a bounded, defanged
  `<module_control>` block (`packages/chat/src/live/prompt-safety.ts:46-69`). Neither half is pasted
  prose, which is the whole of spec §8's ruling.

**Constraints — Discuss**

- **`controlContext` accepts exactly three keys — `step`, `action`, `values`** (`prompt-safety.ts:39`,
  `MODULE_CONTROL_KEYS`). Anything else is dropped silently, so the posting fields go inside
  `values`: `{action: "discuss", values: {title, company, location, url, fit, want, fitReason,
wantReason, outsideFrame}}`. A field parked at the top level does not reach the model and nothing
  reports that it did not.
- **8 KiB is the hard cap and it is bytes, not characters** (`MODULE_CONTROL_CONTEXT_MAX_BYTES`).
  Over it, the turn is rejected. So the card carries the record's own short fields and **not**
  `posting.body` — the body is what the scoring model already read, and re-sending it here would
  break the cap on any real posting.
- **The card renders from the record; the surface is not asked to render prose.** Fit and Want appear
  as two numbers with their two reasons, exactly as the inspector shows them (L9). No blended value,
  here least of all: this is the row the model is about to talk about.
- **Bind before you send.** Task 17 already holds the surface at `profile.id`; `discuss` must not
  change it. Submitting a turn while the handle still points at the drawer is the leak Ben ruled out,
  and it is invisible until someone opens the main drawer and finds a job in it.
- **The local card is local.** `localRows` is client state and never enters the transcript, so it
  disappears on reload while the turn it framed remains — which is correct, and is why the turn text
  itself must name the posting ("About _Staff Engineer_ at Globex") rather than relying on the card
  to carry the reference.
- **The core header drawer shows the same thread without the card** (spec §8, "same stream, two
  renderings"). That is not a defect to paper over: the card is a module-side convenience, the
  transcript is the shared truth.

**Constraints**

- **Fit and Want are separate sortable columns and are never combined.** No element renders a
  blended number, and settings offers no weighting control — a slider would smuggle in exactly the
  number the design forbids.
- **Unscored rows are visible, not absent.** A crawled-but-unscored posting renders `—` in both
  columns with a "Not read yet" flag, and sorts last under any active sort. The inspector explains
  that the queue is backed up and the posting has not been dropped.
- **Degraded portals render `cause.summary` and `cause.nextAction` verbatim.** The component must
  not compose its own failure sentence — the causes are authored in Task 5 precisely so the copy is
  written once, in one voice, by someone who knows what actually broke.
- **A disabled portal renders as disabled with its cause, not as an error.** A portal the module
  turned off itself (`login_required`) must say why it went off; otherwise the user re-enables it
  forever and it keeps failing.
- **"Search now" bypasses Task 18's enqueue latch.** It is an explicit user action; a deliberate
  re-run must not be swallowed by a stored record of an automatic one.
- **Briefing detail is exactly `BriefingDetail`** — the union Task 5 names, Task 16 writes and
  `buildBriefingContribution` switches on. Do not invent a fourth level or rename these. It is
  stored on the profile row as `briefing_detail` with the check constraint from Task 4's schema,
  **not** in module KV, so it exports and deletes with the rest of the profile and a stale KV value
  can never disagree with a deleted profile.
- Tokens only; `pnpm check:design-tokens` fails on a literal, and `pnpm check:file-size` caps every
  source file at 1000 lines — split by screen before it bites.

**Tests** (`tests/unit/job-search-web-board.test.tsx`)

1. **The board reads through `invokeTool("job-search.matches.list", …)` with a `profileId` and an
   explicit `limit`.** Asserted on the transport. A board fed from a prop would pass every render
   test and show nothing in production.
2. **Fit and Want are separately sortable** — sorting by one does not reorder the other's values.
3. **Unscored rows render `—` in both columns with the "Not read yet" flag**, and their inspector
   says the posting is queued rather than dropped.
4. **Unscored rows sort last regardless of the active sort**, ascending and descending both.
5. **A row outside the stated frame renders its flag** — the reserved recall slice is visible as
   such, not silently mixed into the ranking.
6. **No element anywhere renders a combined score** — assert the rendered text against
   `/\boverall\b|\bcombined\b/i`. Cheap structural guard on the one thing the design forbids.
7. **A degraded portal renders `cause.summary` and `cause.nextAction` verbatim** — assert the exact
   authored strings, so a component that paraphrases fails.
8. **A disabled portal renders as disabled with its cause, not as an error state.**
9. **"Search now" enqueues a real crawl** — asserts
   `runQueue("job-search.crawl-run", "crawl.run", {profileId})`, not local state. There is no other
   way to start a crawl on demand: handlers have no enqueue port and the schedule only reaches
   `crawl.sweep`.
10. **"Search now" fires even when the profile's enqueue latch is already set** — mount with the
    latch present in module-local storage and assert the call still happens.
11. **Each `RunOutcome` renders its own state** — `queued` → searching; `already-queued` → "Already
    searching", calm and not an error; `disabled` → a plain explanation that manual runs are off;
    `error` → the message with the button still usable. A button that fires and then looks identical
    is the failure this case exists to catch.
12. **Dismiss enqueues `runQueue("job-search.match-state", "match.set-state", {matchId, state:
"dismissed"})` and hides the row immediately** — asserted on the call and on the row's absence.
13. **A dismissed match that comes back `new` on the next `matches.list` is restored with a plain
    message.** This is the case that keeps the optimistic hide honest; without it the board lies
    whenever the job fails.
14. **`matches.list` rejecting renders the error state with a retry that re-invokes it** — assert
    the second call. A board that renders an empty table on a failed fetch tells the user they have
    no matches when the truth is that nothing was asked.
15. **Zero matches renders the authored empty state, distinct from both loading and error.**
16. **Every match offers all three actions** — Discuss, Open posting and Dismiss are each present.
    Spec §7 names three; the plan shipped one for a while, so this is asserted as a set.
17. **"Open posting" is a real link to `posting.url` with `rel="noopener noreferrer"`** — asserted on
    the `href` and the `rel`. A button with an `onClick` looks identical and cannot be
    middle-clicked, copied, or opened in a background tab.

**Tests** (`tests/unit/job-search-web-discuss.test.tsx`)

1. **Discuss renders the posting as a card in the thread, not as pasted prose** — the card shows the
   title, company and both axes; the rendered surface contains no substring of `posting.body`.
2. **The model receives the record as structured data** — `submitTurn` was called with
   `controlContext.action === "discuss"` and `controlContext.values.title` equal to the posting
   title. Asserted on the call, because a screen that only rendered the card would look right and
   leave the model with no idea what was clicked.
3. **`controlContext` uses only the three keys core accepts** — `Object.keys(controlContext)` is a
   subset of `["step", "action", "values"]`. The dropped-key failure is silent at runtime.
4. **The payload stays under the byte cap with a realistic posting** — a match whose `posting.body`
   is 20 KB still produces a `controlContext` under 8192 bytes when JSON-encoded. This is the case
   that fails only in production, on the first genuinely long job description.
5. **The turn text names the posting** — matches the title, so the transcript still makes sense after
   a reload has taken the local card away.
6. **Discuss does not re-bind the surface** — `setSurfaceKey` is not called, and `submitTurn` is.
   Task 17 owns the binding; a second binder is how the drawer ends up pointed at the wrong thread.
7. **Discuss on a match does not change its state** — no `runQueue` call. Talking about a job is not
   dismissing it or marking it read.
8. **With no `assistantSurface`, Discuss is not offered** — the other two actions still are. An action
   that silently does nothing is worse than an action that is not there.

**Tests** (`tests/unit/job-search-web-settings.test.tsx`)

1. **Lists every portal with its state and turns one off through
   `job-search.portal.set-enabled`** — asserted on the tool call. A toggle that only flips a
   `useState` is the failure this test exists to catch.
2. **A self-disabled portal shows its cause rather than presenting it as a user choice**, verbatim
   from `cause.summary`.
3. **Offers exactly the three briefing detail levels and persists the choice** through
   `job-search.profile.set-briefing-detail` — asserted on the call, and asserted that no fourth
   option is offered.
4. **Renders no combined score and no scoring controls** — Fit and Want are not user-weightable.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-board.test.tsx \
  tests/unit/job-search-web-discuss.test.tsx \
  tests/unit/job-search-web-settings.test.tsx \
  && pnpm check:design-tokens && pnpm check:file-size && pnpm check:external-modules   # exit 0
```

---

## Phase 6 — Verification

### Task 21: Integration tests

Everything up to here was a unit test against a fake store, which proved the module's _logic_ and
nothing about its _isolation_. This task runs against a real Postgres with RLS on and is where the
security invariants are actually exercised.

**Depends on:** Task 3 (manifest, `JOB_SEARCH_TABLES`), Task 4 (DDL), Task 13 (`JobSearchStore`),
Tasks 15 and 16 (the handlers), Task 2 (`collectBriefingContributions`).

**Files**

- **Extend, do NOT create:** `tests/integration/job-search.test.ts` — Task 2 (#1282) already
  created this file at commit `b043f1d6` with four passing briefing-trust-gate cases. Append
  your describe blocks; writing it fresh silently destroys verified coverage of the briefing
  manifest re-emit path.
- Read first, and copy their setup rather than inventing one:
  `tests/integration/external-module-gateway.test.ts`, `tests/integration/module-install.test.ts`,
  `tests/integration/module-worker-queue-ai.test.ts`, `tests/integration/module-worker-rpc.test.ts`,
  `tests/integration/external-module-finance.test.ts`

**Harness**

One install, two `describe` blocks. **Tier A** is DB-level RLS with no worker process; **tier B**
drives the real gateway and a live worker child process. One file is defensible only because the
install is the expensive part and both tiers need the same one — but **tier A must never depend on
the worker being up**, so a broken worker fails tier B alone and the security assertions still run.

Setup order, every step load-bearing:

1. Build the module package — the same build the release path runs, not a hand-assembled directory.
2. Place it in the discovery directory the installer scans.
3. Install it.
4. Enable it. An installed-but-disabled module is silently skipped.
5. **Assert `manifest_hash` and `package_hash` match what was installed.** This is the step that
   gets left out. `apps/worker/src/external-module-job-handler.ts:52` gates on the enabled flag and
   these hashes and **returns silently** on a mismatch — no throw, no log line worth reading. A
   harness that skips this assertion produces a green suite that invoked nothing at all, which is
   strictly worse than a red one.
6. Start the worker runtime with injected AI and fetch providers.
7. Tear down the child processes and every row this file created.

Two owners and one admin, created once for the file.

**Constraints**

- **Every read goes through `createAppRuntimeRunner().withDataContext({actorUserId})`.** The
  migration-owner role is `NOBYPASSRLS`, so a raw query against a FORCE-RLS table silently returns
  zero rows and every assertion passes for the wrong reason.
- **`JOB_SEARCH_TABLES` is imported, never retyped.** A hand-copied list drifts from the migration
  the first time a table is added, and the drift is invisible.
- **Clean up in `finally`, including on a failing assertion.** `test:uat-seed` runs sequentially
  against one shared, non-reset database, so durable rows leak into whichever file runs next.
- `pnpm test:integration <file>` **does not narrow the run** — the script passes a directory — so
  expect the whole integration suite. Read to the end rather than trusting the last screen, and
  **never pipe to `tail`**: it masks the exit code.

**Tests — tier A** (no worker process)

1. **The database's tables are exactly the canonical list.** Query `information_schema.tables` for
   `app.job_search_%` and assert the set equals `JOB_SEARCH_TABLES`. Without this, a table added in
   a later migration and forgotten here is never checked for RLS by anything.
2. **Cross-owner isolation, both directions, on every table.** Loop `JOB_SEARCH_TABLES`; insert as
   owner A, assert owner B reads zero rows, then the reverse. Asserting one direction only is how a
   policy that is accidentally `USING (true)` on `SELECT` but correct on `INSERT` survives.
3. **An admin actor sees nothing** — same loop, admin context. Admin power is configuration power;
   there is no private-data bypass anywhere, and this is the assertion that says so.
4. **Every owned table actually has a policy** — assert a `pg_policies` row per table.
   `installModule()` Phase B generates RLS from `manifest.database.ownedTables`, so a table missing
   from that array gets a table with **no policy at all**, which fails open. Test 2 still passes if
   the row simply is not there, so this is not redundant with it.
5. **The stored embedding has the dimension the port reports** — `vector_dims(embedding)` equals
   `await ctx.embed.dimensions()`. A 768-column holding a 384-vector does not error on insert in
   every path, and the downstream symptom is "triage returns nonsense", which is very expensive to
   trace back to here.

**Tests — tier B** (real gateway, live worker)

6. **The queue payload carries metadata only.** Enqueue through the real path, read the row back out
   of pg-boss, and assert the serialized JSON against a **whitelist** rather than spot-checking
   absences: `Object.keys(job.data).sort()` equals
   `["actorUserId", "jobKind", "manifestHash", "moduleId", "params"]`, and
   `Object.keys(job.data.params)` equals `["profileId"]`. `manifestHash` is **required** by the
   payload contract (`packages/jobs/src/module-jobs.ts:7`, validated at `:75` as `sha256:` + 64
   hex, populated at `job-reconciler.ts:137`) — it is a content anchor for the trust gate, not
   forbidden content, and a whitelist that omits it fails against a correct implementation. Assert
   it is **this install's** hash, not merely a well-formed digest: the handler compares it and
   returns silently on a mismatch, so a stale hash is a module that never runs. Then a belt: the
   whitelist catches a new key, and asserting the serialized string contains neither a résumé marker
   nor a posting-body marker, and is under 512 bytes, catches an existing key whose value grew a
   body.
7. **The manual-run route is the enqueue path, and it works** —
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` via `app.inject`, asserting a job
   appears. This is the only production enqueue path that exists; if `allowManualRun` is missing
   from the manifest, nothing in the module can ever start a crawl and no unit test would notice.
8. **The schedule resolves to the sweep queue.** Read the reconciled schedule rows and assert the
   `job-search.crawl-sweep` schedule is bound to the `job-search.crawl-sweep` **queue**. This is not
   a typo net — `validateWorker` (`packages/module-registry/src/external/validate.ts:176`) already
   rejects an install whose schedule names an undeclared queue. What it verifies is that the binding
   survives **normalization and install**: the reconciler's `queueByName.get(schedule.queue)` miss is
   silent (`job-reconciler.ts:127`), so if normalization ever renames or reshapes a queue the module
   simply never runs on its own and nothing says so.
9. **A tool call survives the host's `actorUserId` envelope** — invoke each of the eight Task 16
   tools **through the real gateway**, not by calling the handler directly. The host spreads
   `actorUserId` onto every external tool input, last, and a strict `additionalProperties: false`
   validator that does not strip it rejects every call the module will ever receive. A unit test that
   calls the handler directly never sees this.
10. **A partial crawl persists both halves** — one portal succeeds, one returns `rate_limited`;
    assert the postings landed _and_ that `job_search_portals` holds the structured cause with its
    `lastOkAt` intact. A failure that erases the last-known-good timestamp destroys the only signal
    that tells the user how long a board has been down.
11. **The briefing contribution round-trips** — feed `contributeToBriefing` output through
    `collectBriefingContributions` (Task 2) and assert it is accepted and rendered. Also assert the
    `count` / `top` / `full` levels produce three different lengths; if they do not, Task 4's
    `briefing_detail` column is being read but not used.
12. **No response, at any level, contains a blended score** — walk every object returned in this file
    and assert no key matches `/^(score|overall|match|rank)$/i` and no string matches
    `/\b\d{1,3}%\s*(match|overall|fit and want)\b/i`. Two axes, never one number, enforced at the
    boundary as well as in the schema.

**Verify**

```bash
pnpm test:integration tests/integration/job-search.test.ts; echo "EXIT=$?"   # EXIT=0
```

---

### Task 22: UAT test on the real prod-shaped stack

**Required, not optional.** Every UI/UX feature ships with a Playwright test against a real running
instance. The unit tests prove the parts and Task 21 proves the isolation; neither can tell you that
the board renders, that the chat is scoped to the right thread, or that a degraded portal says
anything useful on screen.

**Depends on:** Tasks 18–20 (the surface), Task 11 (the saved fixtures), Task 2d (the badge).

**Files**

- Create: `tests/uat/specs/job-search-board.uat.spec.ts`
- Create: `tests/uat/seed/chunks/job-search.ts` (+ register the chunk in `tests/uat/seed/types.ts`
  and in `run-uat.ts`'s `CHUNKS` set, `tests/uat/run-uat.ts:9`)
- Create: the fixture portal server (a small static HTTP origin serving Task 11's captures)
- Modify: `tests/uat/provisioner.ts` — start the fixture origin and publish its base URL into the
  stack's env **before** `docker compose up` (the delta below)
- Modify: `apps/worker/src/external-module-job-handler.ts` — the **host-side** test-only `createFetch`
  injection (generic: it applies to every module, not to this one)
- Create: `tests/unit/external-module-test-fetch-seam.test.ts` — proves the seam is inert unless
  explicitly turned on

Note what is **not** in that list: nothing under `external-modules/job-search/src`. The module's
shipped bytes are identical in the UAT run and in production, which is the entire point of the fetch
ruling below.

**The harness exists — use it, do not invent one**

- **`pnpm test:uat` → `tsx tests/uat/run-uat.ts`** (`package.json:43`) boots a prod-shaped Docker
  Compose stack from `infra/docker-compose.prod.yml` under its own project name, its own `/24`
  subnet (`provisioner.ts:32`), a bind-probed high port, a real migrate pass and a real seed, then
  runs Playwright through `tests/uat/playwright.uat.config.ts`. Specs live in `tests/uat/specs/`.
- **`tests/e2e/` is the mocked tier by design.** All of its specs intercept routes and
  `playwright.config.ts` starts only Vite. A real-stack Job Search test does not belong there, and
  `pnpm test:e2e` is not this task's command.
- **Finance is the precedent.** `tests/uat/specs/finance-{budget,feed,reports,shared}.uat.spec.ts`
  already prove an _external_ module end to end on this harness. Read `finance-feed` and
  `finance-budget` before writing a line: they carry the activation recipe — `docker cp` the built
  package in, restart so the fail-closed reconcile discovers it, enable it through the **real admin
  UI** (which is what records the trusted hashes), restart again so the module worker registers its
  pg-boss queues.
- **Every spec must `export const uatLevel = { level, without: [] } as const`** — `run-uat.ts:36-45`
  parses it out of the source with a regex before the stack boots, and an absent or malformed export
  is a hard error. Use `"admin+data"`.
- **`run-uat.ts`'s `finally` always tears down with `down -v`**, so container logs are unrecoverable
  after the run. Copy finance-budget's `test.afterEach` log dump: on a non-passing status, pull the
  worker logs into the run log **before** teardown. A silently failing queue job otherwise leaves no
  evidence at all.
- There is **no `pnpm dev:instance` script**, and nothing in this task needs one.

**The genuine gap: a provisioner delta, not a missing harness**

The stack the provisioner boots has no route to a test fixture, and two things must change for one to
exist:

- **The fixture origin must be reachable from inside the container**, not from the test runner's
  loopback. The crawl runs in the `jarv1s` service; `127.0.0.1` there is that container, not the
  host. Either run the fixture as an extra service on the UAT compose network, or bind it on the host
  and reach it through the gateway address of the run's own subnet (`UAT_DOCKER_SUBNET`,
  `provisioner.ts:32`) — whichever, the base URL that goes into the stack must be the one the
  **container** can resolve, and the run must fail loudly if it cannot.
- **`JARVIS_E2E_MODULE_FETCH_BASE` must be in the container's environment before the worker boots.**
  It is read at handler construction, so anything applied afterwards has no effect. That means
  writing it in `writeUatEnvFile` (`provisioner.ts:88-140`), which produces the `env.production.local`
  that `docker-compose.prod.yml` consumes through `env_file:` — and the fixture server therefore has
  to be listening, with its port known, before that file is written. Note the standing trap
  documented at `provisioner.ts:80-83,142-160`: `env_file:` feeds container env only and never
  compose-file `${…}` interpolation, so anything the compose YAML itself must see has to be exported
  as a real `process.env` var too.

**Deterministic sources — the fetch ruling**

The test must not touch LinkedIn or freehire. A live portal makes this fail on someone else's
Cloudflare rule at 3am, which trains everyone to ignore it. Three obvious routes are all closed:

- **A fixture origin cannot be reached through `ctx.fetch` as the policy stands** (E1/E2), and no
  amount of allowlisting changes it. `packages/host-fetch/src/index.ts:268,275` requires `https:` and
  a declared host, and `:79-97,148` rejects loopback and RFC-1918 ranges with `blocked_address` — and
  a Compose network is 10.x by construction. The allowlist is checked _before_ the pinning policy,
  not instead of it, so adding the fixture to `fetchHosts` does nothing.
- **Playwright route interception cannot see it.** The crawl requests originate in a worker child
  process, so `page.route` never observes them.
- **A module-side seam is dead code.** A worker child receives an environment of exactly three keys —
  `LANG`, `LC_ALL`, `TZ` (`worker-runtime.ts:120`, B4). Any `process.env.JOB_SEARCH_*` read inside
  module code is `undefined` everywhere, test included. And a module-side bypass means the code path
  under test is not the code path that ships.

**Ruling: inject `createFetch` at the host, in the worker app.** The seam already exists —
`createExternalModuleRpcHandler` takes an optional `createFetch` (`worker-rpc-host.ts:99`) and uses it
at the one place the pinned fetch is constructed (`:134`). The worker app supplies it under a
test-only env var **in its own process**, at the existing call site
(`apps/worker/src/external-module-job-handler.ts:67`), keyed on nothing about job-search so any
module's UAT can use it.

```ts
// Gated POSITIVELY, on two conditions that must both hold.
const E2E_MODE = process.env.JARVIS_RUNTIME_MODE === "e2e";
const fixtureBase = process.env.JARVIS_E2E_MODULE_FETCH_BASE;

if (fixtureBase && !E2E_MODE) {
  throw new Error(
    'JARVIS_E2E_MODULE_FETCH_BASE is set but JARVIS_RUNTIME_MODE is not "e2e". ' +
      "This variable enables a host-fetch bypass and must never be set outside the UAT harness."
  );
}

const testFetchBase = E2E_MODE ? fixtureBase : undefined;

const rpc = createExternalModuleRpcHandler({
  /* …unchanged… */
  ...(testFetchBase ? { createFetch: createE2eFixtureFetch(testFetchBase) } : {})
});
```

**Constraints on the seam**

- **The guard is positive, and `NODE_ENV` plays no part.** `process.env.NODE_ENV !== "production"` is
  fail-**open**: `NODE_ENV` is unset in a plain `node dist/index.js`, in a container that forgot it,
  and in most systemd units, and `undefined !== "production"` is true. A bypass whose guard defaults
  to "on" is not a guard. `JARVIS_RUNTIME_MODE` is net-new — nothing in the tree reads it today — and
  unset never opens the seam.
- **Fail loud, not quiet.** The fixture variable present without the mode refuses to boot: in one
  direction it would hide a fixture that stopped being exercised, in the other a leaked variable in
  production.
- **`createE2eFixtureFetch(base)` keeps the allowlist meaningful.** It receives the module's declared
  `fetchHosts` exactly as `createHostPinnedFetch` does, **rejects any host not in that list**, and
  only then rewrites the origin. Otherwise the var would silently disable the one check `fetchHosts`
  exists to make.
- **Both variables are set by the UAT provisioner and nowhere else** — not in a checked-in compose
  file, not in `.env.example`, not in any dev script. A variable in a checked-in example file is a
  variable someone will copy.
- **No `http://…:PORT` literal appears in the spec or its assertions.** The base reaches the worker
  through the env var; the assertions name the portal's real hostname, which is what the module
  thinks it is talking to.

The rejected alternative — driving the run against recorded stage inputs and skipping the crawl —
stays rejected: it would leave the degraded-portal strip, the posting counts, and "Search now" all
rendering from hand-seeded rows, which is precisely the wiring this test exists to prove.

**Tests** (`tests/unit/external-module-test-fetch-seam.test.ts`)

"Test-only" is a claim until something checks it, and the check must cover the **default**
environment, not just the production one. Restore `process.env` in `afterEach`.

1. **With `JARVIS_E2E_MODULE_FETCH_BASE` unset, the handler is constructed with no `createFetch` key
   at all** — assert on the argument object, not on behaviour, so it fails if someone passes
   `createFetch: undefined` and leans on a `??` further down.
2. **Fixture var set and `JARVIS_RUNTIME_MODE` unset throws, and the message names the variable** —
   run this over `NODE_ENV` ∈ {unset, `development`, `test`, `production`} and assert all four
   outcomes are identical. `NODE_ENV` must have no influence on this decision at all.
3. **Both vars set passes `createFetch`** — otherwise the guard is untestably strict and the UAT run
   fails with no explanation.
4. **`createE2eFixtureFetch(base)(["www.linkedin.com"])` rejects a host outside the allowlist and
   rewrites one inside it.** A fixture fetch that answers everything would let the module reach
   anywhere.

**The spec is ONE test.** The phases below each depend on state the previous one created — an
installed module, a profile, criteria, crawl results, a notification, a scoped conversation.
Playwright tests are isolated and may run in parallel, and nothing here declares serial mode, so
splitting them into a dozen `test` blocks produces a dozen tests that pass or fail on execution order
and on leftovers in a shared backend. That is not flakiness; it proves nothing either way. One long
test is the honest shape for one long journey — the cost is a worse failure message, mitigated by
`test.step`, which names the failing phase. The only other shape that works is giving **every** test
an independent fixture that installs the module and seeds its own prerequisites; take that wholesale
or not at all.

**Journey phases** (one `test.step` each)

1. **Install and activate** — the finance recipe: `docker cp` the built package into the modules
   volume, `restartUatStack`, enable through the real admin UI, restart again so the module's queues
   register. Then open it from the nav.
2. **An empty install offers exactly one way forward.** The bootstrap panel renders, its primary
   action puts an **unsent, editable draft** in the composer, and no profile exists until the user
   sends it. The consent boundary from Task 18, and the one step a user cannot route around.
3. **A new profile shows chat and no table** — `getByRole("table")` is absent. Onboarding is
   chat-only, and a table appearing early is the specific regression.
4. **Criteria fill the progress chips from the record** — drive the conversation, assert each chip's
   state, then assert the chip state **survives a full page reload**. That reload is what
   distinguishes a stored record from model prose held in component state.
5. **The first crawl is actually enqueued, and it finishes.** Nothing on the worker side can enqueue
   (F6), so if the browser never calls `runQueue` the board sits empty forever and phases 6–10 fail
   for a reason none of them names. Observe
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` with body
   `{jobKind: "crawl.run", params: {profileId}}` at the **network layer** with `page.waitForRequest`,
   so it passes only if the real route is called with the real body; then poll the board for a
   non-empty match list with a timeout that fails saying "crawl never produced matches", not a bare
   locator timeout. Also press **"Search now"** and assert a second run is accepted or reported as
   already queued — both are correct and neither is an error.
6. **The board replaces the chat once the profile is active** — table present, onboarding chat gone.
7. **Both axes are separate columns** — a `Fit` column and a `Want` column exist, and no cell matches
   `/^\d{1,3}%\s*match$/`. The one product invariant that has to hold on screen, not just in the
   schema.
8. **A degraded portal states the whole cause** — five assertions: which portal, what kind of failure,
   what was retrieved before it stopped, when it last worked, what happens next. "Job search failed"
   tells the user nothing.
9. **An unscored row explains itself** — `—` in both axes plus a reason, never a zero. A zero is a
   judgement; this is the absence of one.
10. **A recall posting is visibly flagged** — an `outside_frame` row carries its flag, so the user can
    tell a deliberate stretch from a bad match.
11. **Discuss puts the posting in the thread and keeps it out of the main drawer.** Click Discuss on a
    scored row; assert the card names that posting, that the thread receives a turn naming it, and
    that the row's state is unchanged. Then navigate out of the module and open the drawer: the turn
    is **absent**. Spec §12 names this path, and it is the one place the card, the turn, the surface
    binding and the scoping rule are all exercised together against a real stream.
12. **The core header chat carries the profile's thread — and only there.** Open the drawer inside the
    profile and assert the job-search turns are present; navigate out, open it again, assert they are
    **absent**. This proves the drawer-scoping ruling. It is the most likely thing to regress and the
    least likely to be caught by anything else in this plan, because both transcripts are correct in
    isolation — only the boundary between them is wrong.
13. **The nav badge shows the new-match count, and reading the notification clears it.** Task 2d
    defines the badge as the module's **unread notification count**, so that is what the phase drives:
    badge appears after a pass produces matches, mark the notification read through the existing
    notifications UI, assert `unreadByModule` drops to zero and the badge disappears. Do **not**
    assert that dismissing or acknowledging matches clears it — nothing marks those notifications
    read, so that would be testing undefined behaviour. If the product later wants the board to clear
    it, that is a core change with its own step in Task 2d.

**Harness notes** that cost an afternoon each if rediscovered: a seeded owner lands on onboarding
(Skip setup → Skip anyway); `getByLabel` substring-matches, so pass `{ exact: true }`; on failure the
DOM snapshot in `error-context.md` is far more useful than the stack trace; the seeded admin
credentials come from `tests/uat/seed/admin.ts`, never hardcoded.

**Verify**

```bash
pnpm test:uat job-search; echo "EXIT=$?"                            # EXIT=0 (boots the full stack)
pnpm vitest run tests/unit/external-module-test-fetch-seam.test.ts  # exit 0
```

If the module's tools 400 on every call, check the instance has a model configured for the module —
an unconfigured instance returns `needs_config` from `ai.generateStructured`, which surfaces as a
stuck onboarding rather than an error.

---

### Task 23: Full gate, prototype capture, and release notes

**Gate**

```bash
pnpm verify:foundation; echo "EXIT=$?"   # EXIT=0
```

**Never pipe it to `tail`** — a background command ending in `tail` reports exit 0 for a failing
gate. **Drop and recreate the gate DB first**: the gate's own `uat-seed` leaves durable rows that
fail the next run.

**Prototype capture.** The prototype is a primary source — it settled the UI, and its header
comments carry the reasoning. Push it to its own branch before deleting it:

```bash
git checkout -b prototype/job-search-ui
git add apps/web/src/job-search-prototype
git commit -m "chore: capture throwaway job search UI prototype"
git push -u origin prototype/job-search-ui
git checkout -
```

Then delete `apps/web/src/job-search-prototype/` and the DEV-guarded interception block in
`apps/web/src/main.tsx` from the working branch, and leave a pointer to the branch on the
implementation issue along with the verdict it settled.

**Registry and docs.** Add `job-search` to `scripts/publish-module-registry.ts`'s inputs so the
module is publishable. Note in the PR body which of the three spec §10 core changes shipped and
which deferred.

**User-facing summary.** Every commit and PR needs one, in release-note language:

> **Job Search.** Jarvis can now run job searches for you. Describe what you are looking for in a
> conversation, and it crawls public job boards on a schedule and reads every posting against two
> questions: could you do this job, and would you still want it a year in. Those two answers stay
> separate — there is no single "match score" — and each comes with the reasoning behind it. New
> matches show up as a notification, a badge, and a line in your briefing. When a board rate-limits
> us or asks for a login, it says exactly what happened and what it will do next.

---

## Self-Review

**Spec coverage.** Every numbered spec section maps to a task: §2 two axes → Tasks 9, 20;
§3.1 crawler → 11, 12, 14; §3.2 no paywalls → 11 (`statusToKind`), 12 (LinkedIn interstitial);
§3.3 résumé → 4, 16; §3.4 open conversation → 17; §3.5 profiles → 4, 16; §3.6 render from records →
10, 19, 20; §3.7 structured failures → 5, 11, 20; §3.8 recall → 8; §3.9 module owns everything →
Phase 0 confined to additive core files. §5 architecture → 3, 4, 13. §6 surfacing → 15. §7 UI →
18–20 (onboarding conversation → 19; all three match actions → 20). §8 thread scoping → 17 (binding
and seeding), 19 (the in-module rendering), 20 (Discuss and the record card), and Task 22 phase 11.
§9 résumé → 16. §10 core changes → 1, 2, and the flagged deferral. §11 security → 13, 21.
§12 testing → 21, 22.

**What the conformance pass changed.** Reading the assembled plan against the spec turned up one
real hole, in three places: the module never rendered a conversation. §7's "full chat interface" was
missing from Task 19, §7's Discuss and Open posting actions were missing from Task 20, and §8's
record-card ruling had no owner — while Task 22 phases 3 and 6 already asserted a chat that no task
built. Fixed inside the existing task numbers (L4): Task 19 renders `assistantSurface.Surface`,
Task 20 gains `discuss.tsx` with `MatchRecordCard` plus the `controlContext` payload to the model and
a real `posting.url` link, and Task 22 gains a Discuss journey phase. No new host seam was needed —
`localRows` and `submitTurn({controlContext})` both already exist; what was missing was a plan that
used them.

**Known gaps, stated rather than hidden:**

- **§10.1 dynamic fetch hosts is deferred**, so "add your own job portal" does not ship in v1.
  Flagged at the top for Ben's decision; if he wants it, this plan gains a Phase 0 task.
- **Chat thread plumbing is a Phase 0 dependency, not an assumption.** Tasks 17 and 22 depend on
  Task 2c's module-scoped chat surface. The implementer must confirm Task 2c has landed and that the
  drawer's thread resolution honours the surface key **before starting Phase 5**, and stop and
  report if the seam is not there — the alternative is a Phase 5 that builds against a surface
  nothing binds.
- **The real-stack harness already exists** — `pnpm test:uat`, with external-module precedent in
  `tests/uat/specs/finance-*.uat.spec.ts` (K8). Task 22 ships a spec into it plus one provisioner
  delta (a container-reachable fixture origin and `JARVIS_E2E_MODULE_FETCH_BASE` written before
  boot), not a harness.
- Sports and news are not migrated onto the Task 2 briefing seam. Separate cleanup, separate issue.

**Type consistency.** `FailureCause`, `SearchCriteria`, `Posting`, `Match`, `PortalState`,
`JobSearchStore`, `Portal`, `CrawlResult`, `ScoreResult`, `TriageInput`/`TriageResult`, and
`BriefingContribution` are each defined once — in Task 5, 11, 13, 9, 8, or 2 respectively — and
referenced by name thereafter. `completedSteps`, `isReadyToCrawl`, `parseScoreResult`,
`applyHardExcludes`, `dedupePostings`, `postingIdentity`, `triage`, `describeFailure`,
`stripEnvelope`, `runCrawl`, `runScore`, and `contributeToBriefing` keep the same names in every
task that mentions them.
