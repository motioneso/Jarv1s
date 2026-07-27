## Constraints proven against the tree

Facts about this repository and decisions taken, each verified against the source at the cited
`file:line`. **These are requirements, not background.** Tasks cite them by ID. Line numbers drift —
treat them as locators and re-read the file before acting on any single one; the surrounding claim is
what must hold, not the number.

Verified 2026-07-26 against `751c7f14`.

## A. Module schema, migrations, RLS

**A1 — The ownership column is `owner_user_id`, always.** External-module RLS is *generated*, not
hand-written: `generateModuleTableRlsSql()` emits `owner_user_id = app.current_actor_user_id()`
(`packages/db/src/module-rls-emitter.ts:24,46`). A table using `user_id` installs and then fails
when the generated policy references a column that does not exist. Finance's migrations declare
`owner_user_id` and contain **no** hand-written RLS, policies, or grants
(`external-modules/finance/sql/0001_create_finance_items.sql:1`) — copying that machinery into a
module migration duplicates platform-owned security. *(r1 #1)*

**A2 — One DDL statement per external-module migration file.** `validateModuleMigrationSql`
enforces exactly-one-statement plus a first-command allowlist
(`packages/db/src/migrations/module-sql-runner.ts:25-46`). This applies **only to external module
migrations**. Core package `sql/` directories legitimately hold multi-statement files — the live
`packages/notifications/sql/0071_notifications_worker_insert_grant.sql` is a grant plus two
policies in one file. Do not "fix" a core migration to satisfy a rule that does not govern it.
*(r1 #1; confirmed r6 #3)*

**A3 — A foreign key is not an RLS boundary.** Generated RLS checks only the *child row's*
`owner_user_id` (`module-rls-emitter.ts:46`). A child table with an independent `owner_user_id` and
a single-column FK to the parent UUID lets actor A insert a row owned by A that references B's
parent, if the UUID is known. Owner-bound composite FKs
(`FOREIGN KEY (owner_user_id, parent_id) REFERENCES … (owner_user_id, id)`, requiring
`UNIQUE (owner_user_id, id)` on the parent) are the fix, and each `ALTER`/`CREATE` is its own file
under A2. *(r5 #1)*

**A4 — `pnpm db:migrate` does not install module SQL.** It runs core and built-in package SQL only
(`scripts/migrate.ts:30,43`). Module SQL installs through `installModule()` and is recorded in a
separate ledger, `app.module_schema_migrations` (`scripts/module-install.ts:38`). External-module
migrations must **never** be added to the core migration catalog — that list lives in
`tests/integration/foundation-schema-catalog.test.ts:230`, not in `foundation.test.ts`. The install
test to model is `tests/integration/finance-tables-install.test.ts`. *(r1 #2)*

**A5 — Module runtime roles are `NOLOGIN`.** `packages/db/src/module-role-broker.ts:63` creates
every module role `NOLOGIN NOSUPERUSER`; only the *install* role is briefly flipped to LOGIN
(`:103,:114`). A test cannot connect as `jarvis_mod_<id>_runtime`. The real pattern is: connect as a
parent role, then `BEGIN; SET LOCAL ROLE jarvis_mod_<id>_runtime; select
set_config('app.actor_user_id', $1, true)` — the shape used by
`packages/db/src/module-storage-rpc.ts:89` and `packages/db/src/data-context.ts:64,90`. *(r2 B4b)*

**A6 — A constraint violation aborts its transaction.** A negative DDL case (e.g. asserting a check
constraint rejects a value) must run in **its own** transaction; a following assertion in the same
block dies with `current transaction is aborted` instead of testing anything. *(r2, Task 4 rework)*

**A7 — Never edit an applied migration.** The runner hash-checks applied files (`CLAUDE.md`). This
is why DDL is a *decision*, not an implementation detail, and why migration SQL stays verbatim in
any thinned plan.

## B. Worker runtime, lanes, and invocation

**B1 — One child process and one mutable `state.current` per module.** `worker-runtime.ts:31,43,95`
holds a single process state per module id, and every child RPC is dispatched through whichever
invocation currently occupies that slot (`:182`). Splitting only the *serialization map* into lanes
lets two invocations run concurrently in the same child: the second overwrites `state.current`, so
the first invocation's later RPCs execute under the second actor's RPC closure, data context, risk
level, and secret set — and the first `finally` can clear the slot while the other is still live.
**Per-module serialization is a security boundary.** Any lane split must key the `states` map (not
just the queue) by `${module.id}:${lane}`, or track invocations by id and bind every RPC to one.
*(r3 #1; also memory `module-runtime-one-state-current-per-module`)*

**B2 — The runtime verifies nothing.** `ExternalModuleWorkerRuntime.invoke` simply starts the
supplied discovery (`packages/module-registry/src/external/worker-runtime.ts:55`). Enabled status,
`manifest_hash` and `package_hash` are checked by **`createExternalModuleJobHandler`**
(`apps/worker/src/external-module-job-handler.ts:50,54,59`), which then constructs the actor-scoped
RPC handler (`:66-84`). Therefore: *any new caller of `runtime.invoke` — a briefing invoker, a tool
path, anything — inherits no trust checking whatsoever.* A disabled, stale, or tampered module can
contribute content through an unverified path. Every invoker must go through one shared verifying
helper; two copies of a trust gate is one copy that rots. *(r6 #2)*

**B3 — Child processes get a three-key environment.** `worker-runtime.ts:120` passes only `LANG`,
`LC_ALL`, `TZ`. No test/fixture/feature env var can reach module code inside the child. A test seam
must therefore be a **host composition** seam, not a module-side branch. *(r4 F2)*

**B4 — The host-side fetch injection already exists.** `createExternalModuleRpcHandler` takes an
optional `createFetch` (`worker-rpc-host.ts:99`, used at `:134`). An e2e fetch fixture is a
composition-root wiring job, not net-new platform work. The module keeps calling `ctx.fetch`
unchanged, so the real worker/RPC path is still exercised. *(r4 F2, verified)*

**B5 — A test-mode bypass must be gated positively.** Gating on `NODE_ENV !== "production"` plus a
fixture variable fails **open**: a deployment with a missing or misspelled `NODE_ENV` enables the
bypass. Gate on an explicit affirmative mode (e.g. `JARVIS_RUNTIME_MODE === "e2e"`) **plus** the
fixture var, and fail startup if the fixture var appears without the mode. Cover `NODE_ENV` unset,
`development`, `test`, and `production`. *(r5 #11)*

**B6 — The worker gets a deadline, never a signal.** An `AbortSignal` cannot cross JSON-RPC. The
host owns one `AbortController` per invocation and passes its signal only into host-side fetch and
AI implementations; the worker receives a **deadline timestamp** it can compare against a clock and
can only stop its own loops. `ModuleFetchRequest` is `{url, method?, headers?, bodyBase64?}` —
no signal (`packages/module-sdk/src/index.ts:682`), and `generateStructured` accepts none
(`packages/module-sdk/src/worker.ts:38`). Do not reintroduce a worker-side signal. *(r4 F1, r5 #4 —
settled and frozen from round 5 onward)*

**B7 — A deadline checked only between requests is not isolation.** With no per-request timeout,
one in-flight fetch can consume the entire remaining invocation and starve every later portal. Either
`ModuleFetchRequest` gains a generic, serializable, **host-clamped** `timeoutMs`, or the plan must
stop claiming per-portal isolation. *(r6 #11)*

**B8 — Manifest `timeoutMs` reaches the runtime only if the validator rebuilds `worker`.** Queue
normalization *spreads* the queue object and preserves unknown fields
(`packages/module-registry/src/external/validate.ts:133`); only the top-level manifest
reconstruction is allowlisted. So "unknown queue fields are silently dropped" is **false**, and a
test asserting field preservation passes against today's implementation. The behaviour worth
testing is rejection of non-integer / negative / excessive `timeoutMs`, the clamp on normalized
output, and that the job handler actually passes it into `runtime.invoke`. *(r3 #10)*

## C. AI budget and the RPC host

**C1 — Eight AI calls per invocation, counted before the call.** The cap is shared across the whole
invocation and enforced at eight (`worker-rpc-host.ts:77,212`); the counter increments **then**
checks, so attempt nine is rejected. Consequences: (a) a batch of eight plus one retry is nine
calls and fails; retries must consume the same budget, checked before every initial call *and*
every retry; (b) for a sweep, eight is across **all** profiles together, not eight each — a profile
receiving zero budget in a sweep is legal and leads the next sweep; (c) flooring every profile at
one budget token means nine active profiles need nine calls, which cannot happen. *(r1 #5, r3 #6,
r5 #5)*

**C2 — The authoritative call counter is private to the parent RPC closure.**
`worker-rpc-host.ts:111` — the worker cannot read it, and a stage that throws returns no usage. Any
"calls spent by a profile that threw still count" rule must be implemented by a handler-level
`AiPort` wrapper shared across profiles, deriving remaining budget from the wrapper even on a throw.
*(r4 F9)*

**C3 — `generateStructured` returns an envelope, not a value.** `{ok:true, object}` or
`{ok:false, error}` (`packages/module-sdk/src/worker.ts:34,45`) with five typed errors:
`needs_config | validation_failed | provider_error | usage_limited | aborted`. `provider_error` is a
**returned member, not a thrown exception**, so nothing retries implicitly. Passing the envelope
straight to a parser rejects every result. *(r1 #5, r4 F10)*

**C4 — `aborted` must halt the stage.** The core emits `aborted` when the operation's abort signal
fires or the adapter throws `AbortError`
(`packages/ai/src/structured/generate-structured.ts:130,154`). Continuing to issue AI calls after
cancellation is wrong; it is not a malformed result isolated to one posting. `validation_failed`
stays per-posting. *(r3 #15)*

**C5 — Structured prompts are byte-bounded.** The host limit is 65,536 bytes
(`packages/ai/src/structured/schema-bounds.ts:5`). A prompt that concatenates unbounded posting
bodies, résumé content, and context fails at runtime on ordinary real data. Every prompt section
must be deterministically bounded, and parsers must enforce the schema's own character limits rather
than trusting the model. *(r1 #19)*

**C6 — In a per-item loop, `continue` advances the item.** "Retry the same item" needs a nested
attempt loop or a labelled retry; a bare `continue` silently skips. *(r4 F10)*

## D. The module worker context and DB port

**D1 — `ModuleWorkerContext` is `{input, auth, fetch, kv, ai, db, attachments}`.**
(`packages/module-sdk/src/worker.ts:13`.) There is **no enqueue port**, no memory/context-retrieval
port, no notify port and no embed port in the base contract. Anything a module needs beyond that
list is a core addition that must be justified as a generic seam every module gets. *(r1 #3, #6, #8)*

**D2 — A worker handler cannot enqueue.** Following from D1: any "stage A enqueues stage B" design
is unimplementable. Crawl → triage → score must compose inside one queue handler, or the module
needs a real generic `ctx.jobs.enqueue()` capability designed and serviced end to end. *(r1 #3)*

**D3 — `ctx.db.query(text, params?)` is raw bounded SQL with positional `$1`, SELECT/INSERT/UPDATE/
DELETE only, and no transaction control** (`packages/module-sdk/src/worker.ts:57,64`). No `BEGIN`.
Atomicity must be achieved in a single statement or a bounded retry. The port forwards parameters
exactly; it cannot invent a `$2` an interface did not declare. *(r3 #5, r5 #13)*

**D4 — A single statement is not automatically concurrency-safe.**
`INSERT … SELECT COALESCE(MAX(version),0)+1` lets two callers read the same maximum before either
inserts. *(r5 #6)*

**D5 — `FOR UPDATE` does not refresh the statement's snapshot for other relations.** Under READ
COMMITTED, Postgres re-evaluates the **locked row** after the lock is released (EvalPlanQual), but
an aggregate over a *different* relation in the same statement keeps the snapshot taken when the
statement began — before the wait. So locking a parent profile row does not make
`MAX(child.version)+1` safe. The safe shape is a bounded retry:
`INSERT … ON CONFLICT DO NOTHING RETURNING`, retrying with a **fresh statement** when no row
returns, and distinguishing "no such parent" from "contended out". *(r6 #4; also memory
`jarv1s` bug entry)*

**D6 — The KV port stores `Record<string, unknown>` only** (`packages/module-sdk/src/worker.ts:20`).
A bare JSON number is not a legal value. A cursor is `{index}`, validated on read (finite,
non-negative integer) with invalid or absent defaulting to zero. *(r5 #7)*

**D7 — A persisted index cursor requires a deterministic list order.** Without a stable
`ORDER BY` on the listing it indexes into, the cursor is meaningless. *(r3 #9 / r4 F9)*

**D8 — A cursor must not advance past unserved work.** If the invocation deadline expires, later
items return "deadline" without being served; advancing the cursor over them skips them, possibly
wrapping. Check the clock before each item, stop at the deadline, report deadline exhaustion
explicitly, and persist the cursor at the first item **not started**. *(r6 #10)*

**D9 — Sequential, not `Promise.allSettled`, when order or budget matters.**
`Promise.allSettled` starts every promise before any finishes, so it cannot honour "portal two must
not start after portal one crosses the deadline", and rotating an order does not decide who gets a
scarce shared budget. Use `for…of` with per-item `try/catch`. *(r3 #6, #7)*

## E. Host fetch

**E1 — The fetch host policy forbids IP literals, ports, and `http:`.**
`packages/host-fetch/src/policy.ts` — `validateUrl` requires `https:`, requires the port to be empty
or `443`, and `isPinnableHost` rejects hostnames containing `:` and rejects IPv4 literals. Resolved
addresses then go through `isBlocked`, which rejects loopback and private space
(`packages/host-fetch/src/index.ts:146,273`). `http://127.0.0.1:4599` is unreachable three times
over. A local fixture server cannot be reached through `ctx.fetch`, and Playwright cannot intercept
requests made by the **worker** process. *(r3 #4)*

**E2 — `ctx.fetch` is not the shape adapters want.** `ModuleFetchResponse` is
`{status, headers, bodyBase64}` (`packages/module-sdk/src/index.ts:689-693`) — no `ok`, no `text()`.
A bridge is required, and it inherits three host behaviours worth stating: only four response
headers survive (**no `set-cookie`, so no adapter can hold a session**), a host missing from
`fetchHosts` throws `invalid_rpc` rather than returning a status, and redirects are followed inside
the host. *(r2 M10)*

**E3 — 401/403 is not proof of a login wall.** A 403 can be public-page anti-bot denial. Classifying
every 401/403 as `login_required` permanently disables public sources for the wrong reason.
*(r1 #20)*

## F. Manifest, validation, queues, and the job envelope

**F1 — The manifest validator defensively reconstructs and drops unknown top-level fields**
(`validate.ts:656`). A test that imports the raw JSON and asserts fields passes while the field is
absent from the loaded manifest. Manifest tests must go through
`validateExternalModuleManifest()` and assert the **validated** output. *(r1 #13)*

**F2 — A JSON manifest cannot import a TypeScript constant.** Finance's `jarvis.module.json:42`
carries a literal owned-table array. A `TABLES` constant is not a source of truth by assertion; the
only enforceable seam is a test asserting
`validated.database.ownedTables` deep-equals `TABLES.map(t => "app." + t)`. *(r4 F11)*

**F3 — `assistantTools` entries require `name`, `permissionId`, `description`, `risk`,
`inputSchema`, `handler`, and a `runtime` block on the manifest** (`validate.ts:425,436-450`). A
fixture missing any of them returns `ok:false` before the behaviour under test is reached. *(r2 M8)*

**F4 — A schedule naming an undeclared queue is rejected by validation**, not silently dropped
(`validate.ts:176`). The reconciler's `continue` is silent (`job-reconciler.ts:127`) but a validated
install cannot reach it. Keep manifest assertions as defence in depth; state the correct rationale.
*(r4 F12)*

**F5 — Job execution always invokes `queue.handler`.** Scheduling selects a queue and sends its
payload (`job-reconciler.ts:126`); the handler that runs is the queue's declared handler
(`external-module-job-handler.ts:88`). Registering a handler name that no manifest queue points at
does nothing. Two behaviours ⇒ two declared queues. **Ruled and frozen: two queues, not one queue
with two handlers.** *(r3 #2)*

**F6 — The queue envelope is `{actorUserId, jobKind, idempotencyKey, params}` and the payload
requires `manifestHash`.** `packages/jobs/src/module-jobs.ts:7` types it and `:75` validates it
(`sha256:` + 64 hex); `job-reconciler.ts:137` populates it. A test asserting an exact key set must
include `manifestHash` — it is metadata, not forbidden content. Params never arrive as top-level
fields. *(r1 #4, #23; r4 F3)*

**F7 — `actorUserId` is first-class in the queue envelope and is never stripped there.** It is
stripped only at the **tool** boundary. The host also spreads `actorUserId` onto every external tool
input, so a strict unknown-key validator at the worker boundary must strip it or every call dies.
*(settled r4; memory `external-module-actoruserid-envelope`)*

**F8 — The params DSL has no `required` and no enum.** `packages/module-sdk/src/module-params.ts`
rejects unknown keys but has no required concept, so `{type:"object",fields:{}}` accepts `{}` and
nothing else, and any `paramsSchema` accepts `{}`. `assertModuleJobPayload` skips validation when
`params` is absent. **A handler must therefore validate its own required params and return a typed
failure** — the platform will not do it. Note also that this DSL is a *different language* from
`assistantTools[].inputSchema`, which is JSON Schema. *(r3, entanglement section)*

**F9 — An envelope parser that claims strictness must be strict.** Accepting unknown top-level keys,
accepting arrays as `params`, or coercing a missing/scalar `params` to `{}` contradicts the claim.
Require an exact plain-object shape and a non-array plain-object `params`, with rejection tests for
extras, arrays, null, scalars, and absence. *(r3 #9)*

**F10 — `manifest_hash` is not a content anchor; `package_hash` is.** The trust gate must compare
`package_hash` — the normalized-manifest digest goes stale on a core change alone and silently kills
module queues. *(pre-existing ruling, memory `manifest-hash-kills-module-queues`; reflected in B2)*

## G. Notifications core

**G1 — Read state is a separate table.** `app.notification_reads`
(`packages/notifications/src/repository.ts:249,251`). Updating a notification row leaves the read row
intact, so a keyed re-post does **not** return the item to unread and the badge stays cleared.
"Return to unread" requires deleting the actor's read row in the same statement/CTE as the upsert.
*(r3 #8 / r4 F8)*

**G2 — `CreateNotificationInput` is `{moduleId, title, body?, metadata?, urgency?}`** — no event key
and no href (`repository.ts:29`), and creation always inserts a new random row (`:203`). Any
key-based dedupe/update and any href are core additions, and the module-facing port's `key` must be
mapped to the repository's `eventKey` **at the host boundary** — the two names are deliberately
different. *(r3 #11, r5 #8)*

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
grant. *(r6 #3)*

**G4 — `markRead` reads the parent without locking it** (`repository.ts:249`). A concurrent
mark-read can insert after a refresh's snapshot/delete and leave the refreshed event read, violating
"re-fire returns unread". Both operations must be serialized on the notification row. *(r5 #9)*

**G5 — A keyed refresh that always posts will resurrect the badge.** Because a keyed re-post
deliberately returns the item to unread, posting on every pass — including passes with zero new
results — un-reads a notification the user has already dismissed. Post only when the current
invocation produced something, and count only what that invocation created. *(r6 #9)*

**G6 — `NotificationDto.moduleId` already exists** (`packages/shared/src/notifications-api.ts:20`),
and `countUnread` (`repository.ts:355`) is the template for a per-module count. A module badge can
therefore be defined as *that module's unread notification count* — a small generic core seam
(`unreadByModule: Record<string, number>` on the list result) rather than a new tool-result channel.
The shell already runs the query it needs (`app-shell.tsx:227`) and already has `formatUnreadCount`
(`:386`). **Decision taken (r2 B2): the badge counts notifications.** *(r2 B2)*

**G7 — Fastify response schemas silently drop undeclared fields.** Any new field on a REST response
must be added to the shared schema in `packages/shared/*-api.ts` or `fast-json-stringify` strips it.
Recurring trap. *(memory `fast-json-stringify-schema-strip`; flagged in r2 B2's fix)*

## H. Chat surfaces and the assistant surface

**H1 — `CHAT_SURFACE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/`** (`packages/shared/src/chat-api.ts:14`).
No colons, ≤32 chars, must start with a lowercase letter. `module:job-search:profile-1` and a
`gen_random_uuid()::text` default both fail; every route runs `normalizeChatSurface`
(`chat-api.ts:16-21`) and throws `Invalid chat surface`, so the thread 400s on every turn. The host
must **hash** `(moduleId, key)` — FNV-1a, not sha256, because `crypto.subtle` is async and this is a
synchronous render path. *(r2 B1; memory `chat-surface-pattern-trap`)*

**H2 — A per-module surface is already bound today.**
`createAssistantSurfaceHandle(subscribeRecords, surface?, seedComposer?)`
(`apps/web/src/chat/assistant-surface/handle.ts`) already wraps `Surface`, passes `scopedSurface` to
`sendChatTurn`, and curries `subscribeRecords`; `apps/web/src/app.tsx:352-357` calls it with
`props.moduleId`. So the module id **is** the surface today. A per-profile surface is an extension
(`setSurfaceKey(key)` → hash, falling back to the bare module id), not new machinery. The real
contract file is `apps/web/src/chat/assistant-surface/contracts.ts`;
`AssistantSurfaceViewProps.surface?` already exists. *(r2, verified facts section)*

**H3 — Thread seeding already has a working precedent.** `packages/chat/src/live-routes.ts:67-70`
defines `EveningInterviewSeed {context, openingPrompt}`; `:383-403` resolves a seed then calls
`manager.seedContext(actorUserId, userName, seed.context, undefined, surface)` followed by
`manager.submitTurn(…, seed.openingPrompt, undefined, surface)` — **both take a surface**.
`resolveEveningInterviewSeed?` is an optional runtime dep (`packages/chat/src/routes.ts:172-175,397`).
A per-surface seed resolver rides this shape. `seedComposer` is **not** the right seam: it plants a
visible draft the user reads as their own text. *(r2 M11)*

**H4 — Ordering is the consent boundary.** `setSurfaceKey` must run **before** any seed, or the
main drawer gets framed with the module's seed — the exact leak Ben ruled out. Assert call order,
not just call presence. *(r2 M11 fix)*

**H5 — `hostActions.openAssistant` only inserts an unsent editable draft**
(`apps/web/src/external-modules/host-actions.ts:14,18`). It submits nothing and returns no
completion signal. **Ruled: that is the consent boundary, not a UX gap to be smoothed over.**
Consequence: any "opened once" latch plus a poll waiting for a result runs forever if the user
closes the drawer, edits without sending, or the assistant fails. Polls must be bounded by elapsed
time or attempts, suspended while `document.hidden`, offer a retry on expiry, and reset when the
assistant closes without producing anything. *(r3 #5, r4 F7)*

**H6 — A bootstrap latch must be actor- and resource-scoped and must persist.** An in-memory set
survives only one mounted lifetime; a remount, navigation, StrictMode double-render, or reload
re-fires it. Persist under `actorScopeKey + profileId` in module-local storage, and let an explicit
manual action bypass the bootstrap latch entirely. *(r6 #8)*

## I. The external-module web contract

**I1 — `Root` receives `{hostActions, assistantSurface?}` and nothing else**
(`apps/web/src/external-modules/loader.ts:11-20`; confirmed by
`external-modules/finance/src/web/root.tsx:34`). No records, no profile, no `invokeTool` prop. A test
that renders `<Root profile={…}>` or passes an invented transport prop can produce a component the
real loader cannot mount. *(r1 #21, r2 M7, r4 F6)*

**I2 — `ExternalModuleHostActionsV1` requires `actorScopeKey`**
(`apps/web/src/external-modules/host-actions.ts:14`). A stub supplying only `openAssistant` does not
typecheck. `actorScopeKey` is also the correct cache-key and storage-key prefix. *(r4 F6)*

**I3 — Browser reads go through the module's own transport, mirroring
`external-modules/finance/src/web/api.ts:33` (`invokeTool`) and `:96` (`runQueue`,
`POST /api/modules/:id/queues/:name/run`, which requires `allowManualRun: true` and a
`paramsSchema`).** These are the only two paths from a module screen to its worker. *(r5 #2)*

**I4 — A `write` or `destructive` tool cannot be invoked from the browser at all.** The REST invoke
route executes `read` tools inline; for anything else it creates a **pending assistant action** and
returns **403 with `blockedReason: "confirmation_required"` before `execute`**
(`packages/ai/src/routes.ts:645-668`). A button wired to `invokeTool` on a write tool silently does
nothing and never errors. Writes from a module screen must go through `runQueue`; the write tool
survives as the **assistant-only** path. *(found while applying r6 #5 — round 6 understated this;
finance's own comment says the route "403s non-read tools", which is right about the status code and
wrong about the mechanism)*

**I5 — A queue-backed write is asynchronous.** The UI must specify optimistic application plus
reconciliation on the next poll; there is no synchronous result to render. *(r6 #5b)*

**I6 — A module surface only receives a tool result if the tool opts in.** `surfacesResultToUi` in
the manifest, plus an `outputSchema` for the result to be projected through. **Note: the commit that
added this (`915672f2`) was on an abandoned build and did not survive the 2026-07-26 repo reset —
verify against HEAD before relying on it.** *(r2 B2, corrected; memory
`module-ui-needs-tool-result-allowlist`)*

**I7 — External-module JSX needs an explicit `key?: string`.** Modules compile with their own `h`
factory so `key` is not compiler-stripped; every keyed component prop type needs it or TS2322. Only
`pnpm typecheck` covers external modules. *(memory `external-module-jsx-key-prop`)*

**I8 — A hoisted `vi.mock` of a hook applies to the whole file.** Mocking `use-profiles.ts` at the
top and then claiming to test "the real hook" later in the same file tests the mock. Real-hook cases
belong in a separate file where only the transport (`api.ts`) is mocked. *(r6 #7;
same class as r4 F6, where `vi.mock` after a static import could not vary per test —
use `vi.hoisted` for a mutable mock)*

## J. Briefings

**J1 — `ComposeDeps.moduleManifests` is `readonly JarvisModuleManifest[]`, supplied only by
`getBuiltInModuleManifests()`** (`packages/module-registry/src/index.ts:1311,1318`). External JSON
manifests never enter it, so a `m.briefing` filter over it matches zero modules **forever** — in
production, silently, while every unit test that hand-injects manifests passes. External briefing
manifests need their own dependency field. *(r2 B3)*

**J2 — `registerBriefingsJobWorkers` is called from exactly one place**, inside the briefings
module's own `registerWorkers` in `packages/module-registry/src/index.ts` (~`:1306`), and an
injection point already exists: `RegisterBriefingsJobWorkersOptions.composeDeps`
(`packages/briefings/src/jobs.ts:136`), with a large literal passed at ~`:1318-1345`. But
`packages/module-registry` has **no external-module discovery and no external worker runtime** —
those live in `apps/worker/src/worker.ts`. So the invoker and the external manifests must arrive as
*dependencies of* `registerWorkers`, not be constructed there. Importing worker internals into
briefings would break module isolation. `packages/modules/` and any
`@jarv1s/modules/briefing-seam` do **not exist**. *(r1 #9, r2 B3)*

**J3 — `collectExternalBriefingContributions` swallows rejections.** A trust-gate test must
therefore assert on the **composed briefing output**, not on a thrown error — a test that expects a
rejection passes whether the gate works or not. *(r6 #2 fix)*

**J4 — A briefing invocation must not share the queue lane.** A six-hourly crawl can hold the queue
lane for minutes; putting briefings behind it delays the briefing, and putting them in the tool lane
delays the assistant. Hence a third lane. *(r6 #1)*

## K. Test-harness realities

**K1 — `pnpm test:integration <file>` does not narrow.** The script bakes in the directory
(`package.json:49`) and forwards your argument alongside it (`scripts/test-integration.ts:74,97`), so
you get the whole suite. Use the passthrough escape hatch (and note it skips per-run DB isolation),
or `pnpm exec tsx scripts/test-integration.ts <file>`. *(r1 #27, r2 M14)*

**K2 — `createExternalModuleRpcHandler` takes seven inputs and returns a three-argument handler.**
`(module, toolRisk, actorUserId, requestId, workerDataContext, cipher, isActorAdmin)` →
`(method, params, rememberSecret)` (`worker-rpc-host.ts:89`). The harness to copy is
`tests/unit/external-module-attachment-port.test.ts:56-67,76`, including its
`null as unknown as DataContextRunner` casts. *(r2 M5)*

**K3 — `ExternalModuleRpcError` has a closed code union and `super(code)` makes message === code**
(`worker-rpc-host.ts:26`). Two different regexes cannot both match one message. Assert with
`.rejects.toMatchObject({code, detail})`, and if a new code or a `detail` param is needed, say so
explicitly as a change to that class. *(r2 M5)*

**K4 — RPC branches that need no DB must be served before `withDataContext`.** Like
`attachments.readText`: after `const params = record(rawParams)` (~`:129`) and before
`withDataContext` (~`:152`). A harness passing a null `workerDataContext` depends on this. *(r2 M5)*

**K5 — A new host port must be threaded at every RPC construction site.** There are exactly two
today: `apps/api/src/external-module-tools.ts:44` (assistant tools) and
`apps/worker/src/external-module-job-handler.ts:67` (queue jobs) — and B2 adds the briefing path as
a third caller. Make the dependency **required**, so missing a site is a typecheck failure rather
than an `invalid_rpc` at runtime on the scheduled path. *(r2 M6; generalised to every Phase 0 port)*

**K6 — Per-invocation counters belong in the per-invocation factory closure**, beside
`let aiCalls = 0` (`worker-rpc-host.ts:111`). Inside the returned function the cap never trips; at
module scope it leaks across invocations. A single test catches only one of the two wrong
placements — build a second handler from the same factory. *(r2 M12)*

**K7 — Playwright tests are isolated and may run in parallel.** A sequence of cases each depending
on state the previous one created needs either one end-to-end test with `test.step` phases, or a
per-test API fixture seeding exactly its prerequisites. Never rely on execution order or backend
leftovers. **Ruled and frozen: one journey test with `test.step`, not eleven tests.** *(r4 F4)*

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
gap for a *crawling* module is a delta on that provisioner: a fixture HTTP origin reachable from
**inside** the container (`127.0.0.1` there is the container, not the runner) and
`JARVIS_E2E_MODULE_FETCH_BASE` written by `writeUatEnvFile` (`provisioner.ts:88-140`) before
`docker compose up`, since a worker-facing variable applied after boot reaches nothing. Note the
adjacent trap documented at `provisioner.ts:80-83,142-160`: `env_file:` feeds container env only,
never compose-file `${…}` interpolation. *(r6 #6, restated 2026-07-27 against the tree; the earlier
"there is no harness" form of this finding was wrong.)*

**K9 — `defineModuleWorker()` returns `void` and starts the stdio protocol**
(`packages/module-sdk/src/worker.ts:82`). There is no `__invokeForTest`; the existing harness spawns
a real worker process (`tests/unit/module-sdk-worker.test.ts:45`). *(r1 #26)*

**K10 — A tsconfig with `"include": ["src"]` and no `src/` fails with `TS18003`**
(`external-modules/finance/tsconfig.json:1`). A task that adds a module to `check:external-modules`
before creating any source cannot finish green. *(r1 #14)*

**K11 — Production execution refuses missing discovery or mismatched enabled/hash state**
(`external-module-job-handler.ts:52`). Any "real gateway" integration harness must therefore build
`dist/worker.js`, discover the package, hash it, insert and enable its registry row, start its queue
worker, and configure embed/AI/notification dependencies — installing SQL alone does none of that.
Split DB/RLS tests from process/gateway tests if one harness cannot honestly do both. *(r3 #13)*

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
