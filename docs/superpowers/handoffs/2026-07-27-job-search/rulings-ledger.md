# Rulings ledger — facts about the tree, and decisions taken

The durable output of six adversarial review rounds (2026-07-26) on the Job Search module plan.
The plan's ~6000 lines of pre-written implementation are being cut. **These constraints are not.**

Each entry is a constraint, not a fix. Where a round proposed a fix, only the underlying rule is
recorded here — the rewrite is free to satisfy it any way it likes.

**Grounding.** Rounds 1–6 were grounded on `751c7f14` (round 1 on `origin/main` `35980e1d`). Line
numbers were correct at that commit and **drift** — treat them as locators, and re-verify before
acting on any single one. Every citation below was independently re-read at the time it was applied
unless marked otherwise.

**Sources.** `$SP/codex-r1.txt` (r1, 27 findings) · `$SP/fable-r2-findings.md` (r2, 16) ·
`$SP/codex-r3-findings.md` + `$SP/fix-plan-r3.md` (r3, 16) · `$SP/codex-r4-verdict.txt` +
`$SP/codex-r4-findings.md` (r4, 12) · `$SP/codex-r5-verdict.txt` (r5, 13) ·
`$SP/codex-r6-verdict.txt` (r6, 12).

---

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
stop claiming per-portal isolation. _(r6 #11 — NOT APPLIED)_

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
explicitly, and persist the cursor at the first item **not started**. _(r6 #10 — NOT APPLIED)_

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
invocation produced something, and count only what that invocation created. _(r6 #9 — NOT APPLIED)_

**G6 — `NotificationDto.moduleId` already exists** (`packages/shared/src/notifications-api.ts:20`),
and `countUnread` (`repository.ts:355`) is the template for a per-module count. A module badge can
therefore be defined as _that module's unread notification count_ — a small generic core seam
(`unreadByModule: Record<string, number>` on the list result) rather than a new tool-result channel.
The shell already runs the query it needs (`app-shell.tsx:227`) and already has `formatUnreadCount`
(`:386`). **Decision taken (r2 B2): the badge counts notifications.** _(r2 B2)_

**G7 — Fastify response schemas silently drop undeclared fields.** Any new field on a REST response
must be added to the shared schema in `packages/shared/*-api.ts` or `fast-json-stringify` strips it.
Recurring trap. _(memory `fast-json-stringify-schema-strip`; flagged in r2 B2's fix)_

**G8 — A manifest field bound for the browser crosses FOUR strip points, and the plan's file lists
only cover two.** Found while building Task 2d (#1285): a manifest-declared `navigation[].badge`
validated in `validate.ts` and rendered by the shell would still never arrive, because between them
sit `ModuleNavigationEntryDto` (`packages/shared/src/platform-api.ts:34-40`, no `badge`),
`moduleNavigationEntrySchema` (`:143-154`, `additionalProperties: false`), and
`serializeExternalModule` (`apps/api/src/server.ts:896-902`, which enumerates navigation fields
explicitly). Each drops the field silently and independently.

So the full checklist for **any** module-manifest field the browser must see is: SDK type →
`validate.ts` validation **and re-emit** → shared DTO → shared Fastify schema (declared, and **not**
in `required`) → the serializer's field literal → the renderer. Follow the `#918` `web` precedent at
`platform-api.ts:193-198` — it is the same shape, already commented.

Two corollaries. First, **a type-level assertion cannot catch this**: adding the DTO field makes
typecheck pass while the schema still strips it, so the test must go through a real response
(`app.inject`), not a constructed DTO. Second, **"Task N asserts it end to end" is not the same as
"Task N builds the plumbing"** — Task 22 lists 2d under _Depends on_ and only asserts the badge, and
no task in the plan ever claimed `platform-api.ts` or `server.ts`. Left alone this surfaces as a
Task 22 failure with nothing in Task 2d's own tests having ever been wrong. _(raised by the build
agent as a scope question before writing code — the right call; ruled 2026-07-27 to extend 2d's
boundary to both files. Same family as memory `wired-not-just-defined`.)_

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
manual action bypass the bootstrap latch entirely. _(r6 #8 — NOT APPLIED)_

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
reconciliation on the next poll; there is no synchronous result to render. _(r6 #5b — NOT APPLIED)_

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
belong in a separate file where only the transport (`api.ts`) is mocked. _(r6 #7 — NOT APPLIED;
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

**K8 — There is no `pnpm dev:instance` script, and `playwright.config.ts:19` starts only the web
app.** Not the API, worker, database, fixture server, or module installer. An e2e plan must name a
real checked-in harness and pass any worker-facing env var into the worker **before it boots** —
setting it on the Playwright process reaches nothing. _(r6 #6 — NOT APPLIED. Also: the memory
`dev-instance-cli-1258` describing that CLI is stale post-2026-07-26 reset and has been annotated.)_

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

- **Indeed is cut from v1.** Live-probed 403 behind Cloudflare; the documented GraphQL endpoint is on
  `apis.indeed.com` (not the declared host) and its job APIs are partner/authenticated, contradicting
  `auth: []` and the no-login-walled-sources rule. Re-probe before trusting any note that says it
  works. _(r1 #10, settled r2)_
- **Phase 0 may touch core**, on the condition that each addition is a **generic seam every module
  gets**. Whether a given addition meets that bar is reviewable; the decision is not.
- **No per-item autonomous application submission in v1.** A requirement, not an omission.
- **Task numbering is frozen.** Tasks are cross-referenced by number throughout; "renumber" is never
  an accepted fix. Scope may move; numbers do not.
- **Two declared queues, not one queue with two handlers.** _(F5)_
- **The AI budget of 8 is per invocation**, shared across all profiles in a sweep. A zero-budget
  profile is legal and leads the next sweep. _(C1)_
- **The store interface is closed by design.** Adding a method is a change to the store task, not a
  local convenience. There is deliberately no `setPortalEnabled` — `PortalState` already carries
  `enabled`, so a read-modify-write covers it; this was round 3's one _partly valid_ sub-claim.
- **The badge is unread notifications**, and the e2e asserts the notification-read definition
  (`unreadByModule` → 0 after marking read), not board acknowledgement. Clearing or dismissing
  matches does not mark notification rows read. _(G6, r3 #16)_
- **Two axes are never blended into one score, and the UI is never made of model output.** A
  weighting slider in settings would smuggle the blended score back in and is explicitly forbidden.
- **Hard dealbreakers are distinct from soft preferences.** The spec names location, compensation
  floor, and an explicit no-list as hard excludes; a design that refuses to filter them silently
  changes an approved product ruling. _(r1 #16)_
- **The recall slice needs a legitimate source.** A module may not query goals, notes, memory, or
  chat tables (module isolation). Either a generic context/retrieval capability exists, or the
  broader-profile summary is persisted into the module's own record through a user-confirmed tool.
  Provenance / bounds / refresh must be stated at the definition: single named writer, raw transcript
  never stored, bounded and **rejected not truncated**, replaced wholesale never appended, cleared
  with `null` (which is why `""` is rejected). _(r1 #6, r2 Task 8/10)_
- **A recall reservation must not starve the primary pool.** `Math.max(1, floor(budget * 0.2))`
  makes recall 100% of budget 1 and 50% of budget 2. Cap the reservation at `budget - 1` when
  primary candidates exist, backfill unused seats from the other pool, and treat a missing
  similarity as "defer", not as a legitimate zero. _(r1 #18, r2 M9)_
- **Dedupe identity must not merge distinct roles.** Normalized company + title with all
  parentheticals stripped collapses "Staff Engineer (Security)" and "(ML)". Prefer canonical URLs or
  external IDs; strip only a parenthetical proven to be a location. In-memory dedupe within one pass
  does not persist — cross-portal identity needs a stored canonical key with a per-owner unique
  constraint. _(r1 #15, #17)_
- **A portal that returns an unrecognised envelope is disabled with `parse_failed`** — it must never
  report zero results as if the search succeeded. Likewise, do not trust a source's own relevance
  ranking; over-fetch and narrow locally. _(r2, Task 11 rework)_
- **Timestamps are stored structured and formatted in the user's timezone.** Slicing characters
  11–16 out of an ISO string displays UTC as if it were local. A "portal failed" summary must be
  conditional on whether anything was retrieved. _(r1 #25)_
- **A failure kind that means "we ran out of time" must not disable a portal.** `deadline` is not
  brokenness; the summary must not describe the portal as broken and must preserve `retryAt`.
  _(r6 #12 — NOT APPLIED)_
- **`href` must be a validated relative path** (`/…`, no scheme, no `//`); a module-supplied
  absolute or protocol-relative URL is rejected. _(r3 #11 fix)_
- **This overrides the looser prose in Task 2's plan section**, which reads "a same-origin path or an
  `http:`/`https:` absolute URL" while citing this very ruling. The ledger wins. A briefing item
  links to an **in-app deep link** (`/m/job-search/…`) — which is the better product shape anyway:
  the user lands on the match with its Fit and Want intact and clicks out from there, rather than
  jumping to a raw posting straight from the briefing. _(settled 2026-07-27 while building Task 2)_

### Ben's rulings, 2026-07-27 — the two questions the spec left open

- **The briefing says "here are new jobs that might be a good fit" — not everything.** It surfaces
  only the **top most-confident matches**, not the full new-since-yesterday list. The briefing is a
  nudge, not an inbox; the module page is where the complete list lives. The exact cut (a top-N, a
  percentile, or a Fit floor) is an implementation choice inside the job-search briefing handler and
  is **not** a user-facing setting — the "detail levels" idea the spec floated is dropped. This is
  content of the module's own handler, not of the generic Task 2 seam.
- **Custom job-board sources are IN v1, and the portal list is NOT fixed at package time.** Ben:
  the user talks to Jarvis — "go grab this and add it as a job board source" — and it becomes a
  source. This **un-defers dynamic fetch-host grants**, which the approved plan had cut. Numbering is
  frozen, so this lands as a **new task appended at the end**, never by renumbering.
- **Light-touch on the security work for that path, deliberately.** Ben's call, stated plainly. The
  honest read: fetching a user-named URL from the host is the one genuinely new risk surface in this
  module (an internal address or a cloud metadata endpoint reached through our own network). The way
  to honour "don't do a lot of security work" without leaving that open is to **reuse the machinery
  that already exists** — `assertValidFetchHosts` in `@jarv1s/host-fetch/policy`, already imported by
  the manifest validator, already enforced on every module fetch — rather than build anything new.
  Adding a host to a grant list is then a small write, not a security project. Anything beyond
  reusing that policy is out of scope unless Ben asks.

## M. Claims that were rejected or corrected — do not re-derive

- **"`setPortalEnabled` is missing from the store."** _Partly valid, rejected as a contract hole._
  `PortalState` already carries `enabled`; a `setPortalState` read-modify-write covers it. A named
  convenience method is optional, not required. _(r3 #8 sub-claim)_
- **"The queue path has no `ctx.ai`."** _False._ The queue path does get `ctx.ai`
  (`apps/worker/src/external-module-job-handler.ts:38-42,86`; `apps/worker/src/worker.ts:266`).
  Queue-driven scoring is fine. _(killed in r2)_
- **"Unknown queue fields are silently dropped."** _False._ Queue normalization spreads and preserves
  them (`validate.ts:133`); only the top-level manifest is allowlisted. A test built on this premise
  passes today and proves nothing. _(r3 #10)_
- **"A missing schedule queue fails silently."** _False._ `validateWorker` rejects it
  (`validate.ts:176`). The reconciler's silent `continue` is unreachable for a validated install.
  _(r4 F12)_
- **"`surfacesResultToUi` landed in `915672f2`."** _False against HEAD._ That commit was on the
  abandoned build and did not survive the repo reset; verify before relying on it. _(corrected during
  r2)_
- **"`pnpm dev:instance` exists."** _False._ It is gone from `main` since the 2026-07-26 reset. The
  memory describing it has been annotated rather than deleted. _(r6 #6)_
- **"The runtime verifies enabled status and package hash."** _False_ — see B2. This one was asserted
  by the plan itself and is the reason B2 exists.
- **"A locking CTE (`FOR UPDATE`) makes `MAX(version)+1` safe."** _False_ — see D5. This was round
  5's own accepted fix, and round 6 correctly overturned it. A finding from an earlier round is not
  immune.
- **"Round 6 #5: Task 20 must explicitly call these tools."** _Understated, not wrong._ A write tool
  cannot be called from the browser at all — see I4. The stronger constraint replaces it.
- **Renumbering.** Every round was told numbering is frozen; any finding whose fix is "renumber" or
  "reorder so the numbers read cleanly" is rejected on sight.

---

## Meta — what six rounds taught about the review loop

Round 5's own accepted fix (`FOR UPDATE`) became round 6's blocker; round 3's accepted lane split
would have broken invocation isolation. **Six rounds, 96 findings, every verdict `NOT LOCKED`** —
round 6 was the largest yet at 6 BLOCKER / 5 MAJOR / 1 MINOR. Finding volume never trended down.
The cause is structural: each wholesale rewrite of a task manufactured new
implementation code, and new code is new attack surface. Constraints converge; implementations do
not. That is why this ledger exists and the code does not.

Two operational rules earned the hard way:

- **Re-verify every citation before applying.** Every round contained at least one claim that did not
  survive a read of the cited file, and round 6 also _understated_ one.
- **A finding accepted in an earlier round is not settled.** It can be overturned by a later, better
  reading of the same file.

## N. Plan audit findings, 2026-07-27 (read-only sweep for the G8 gap class)

Run after G8 to find other instances. Tasks 1, 2b, 2c, 2e, 11, 12, 14, 22, 23 came back clean —
they carry no value travelling manifest/worker/DB → browser, so the gap class cannot apply.

**N1 — Task 21 must EXTEND `tests/integration/job-search.test.ts`, never create it.** Task 2 already
created it at `b043f1d6` with four briefing-trust-gate cases. The plan said "Create". Anyone
following it literally would have destroyed verified coverage of the briefing re-emit path — and the
suite would still be green, because the replacement file has its own passing tests. Both the part
file and the assembled plan are corrected. _(This is the finding the audit paid for.)_

**N2 — Task 2d's Files list never carried G8's fix.** The ruling recorded the diagnosis; the task row
that an implementer actually reads still named neither `platform-api.ts` nor `server.ts`. Corrected.
General lesson: **a ruling is not applied until the row an implementer reads carries it.** When a
ruling changes a task's scope, edit the task row in the same pass.

**N3 — `job-search.matches.list` can silently collapse to unstructured text.** Reported, NOT
independently verified — verify before building Task 15. The claim: the REST route at
`packages/ai/src/routes.ts:709-712` pipes tool results through the deprecated
`boundedAssistantToolResultData`, which renders via `JSON.stringify(data, null, 2)` (the result key
is `matches`, not `items`, so it never takes the table-row path) and, above
`MAX_RENDERED_TOOL_RESULT_CHARS` (16 000, `output-validation.ts:4`), **replaces the whole structured
result with `{ text: "<truncated>" }`**. `matches.list` allows `limit: 100` with two free-text reason
fields per row, so a full board plausibly crosses it. If true this is a direct hit on the invariant
that the board renders from records, never from model prose. Task 15's own tests call the handler
directly and would never catch it.

**N4 — Task 5 defines no `Profile` type, though `job_search_profiles` is the richest table.** Later
consumers each invent an ad-hoc subset (Task 10's `buildBriefingContribution` takes
`{id, name, matches, postings}`, dropping `state`/`schedule`/`briefingDetail`/`surfaceKey`/
`contextSummary`). Not a drop today; it is the precondition for two tasks drifting on what a profile
contains. Add the canonical type when Task 5 is built.

**N5 — N3 is CONFIRMED, and it is a live threat to the board. Verified in code, 2026-07-27.**
The chain, each link re-read at `6a74badf`:

1. External-module tools are not execute-less at the REST boundary. `createExternalToolManifests`
   (`packages/module-registry/src/external/tool-manifests.ts:43`) **synthesizes**
   `execute: (_db, input, ctx) => invoke(module, tool, input, ctx)`, dispatching to the worker. So
   the browser's `invokeTool("job-search.matches.list", …)` does reach the module, and Task 18/20's
   transport claim is correct — read tools work from the browser, writes 403 with
   `confirmation_required`. That part of the plan is sound.
2. That same route ends at `boundedAssistantToolResultData(sanitized)`
   (`packages/ai/src/routes.ts:712`), which is `@deprecated` and does this: render the result; if the
   rendered string exceeds `MAX_RENDERED_TOOL_RESULT_CHARS` (16 000,
   `packages/ai/src/gateway/output-validation.ts:4,89-95`), **discard the structured object entirely
   and return `{ text: "…\n...[truncated tool result]" }`**.
3. `matches.list` currently allows `limit: 1..100` with two free-text reason fields per row. A full
   board crosses 16 000 rendered characters comfortably.

The board would then be handed prose where it expected records — a direct hit on the invariant that
the UI is never made of model output. It fails **silently and only when a search is going well**:
few matches render fine, a good week breaks the screen. Nothing in Task 15's or Task 20's tests
catches it, because those call the handler directly and never cross the route.

**Required, in Task 15:** lower `limit`'s maximum from 100, cap each free-text reason field in the
handler's projection, and add a test that builds a worst-case maximum-size result, renders it the way
the route does, and asserts the structured `data` survives — i.e. the result has no `text` key. Pick
the two constants so that test passes with real headroom, and comment them with *why* they are what
they are, or the next person will raise the limit back. Task 20 must not paginate around this by
issuing several calls without the per-call bound; the bound is what makes each call safe.

**N6 — Nothing in the plan can read portal state, but two screens must render it.** Task 16 declares
eight tools including `job-search.portal.set-enabled` (write) and no portal **read**. `listPortals`
exists only as a worker-internal store method (Task 13). Task 20 then requires the settings screen to
list every portal with its state and render `cause.summary`/`cause.nextAction` verbatim, and asserts
it. As written the screen has no source for what it renders. **Add a ninth tool,
`job-search.portal.list` (`risk: "read"`, per-profile), to Task 16**, and note it in Task 20's
depends-on. Task 16's test 11 compares declared handlers against registration keys as a *set*, so it
keeps working — but the prose saying "eight tools" must move in the same pass, per N2.

**N7 — `surfacesResultToUi` does not exist in this tree; do not go looking for it.** Commit
`915672f2` ("let a module opt its tool results into its own UI") is **not an ancestor of HEAD** — it
was lost in the 2026-07-26 repo reset, like the module-worker-timeout fix. Any note claiming that
mechanism is present is stale. **This does not block the plan:** the board reads through `invokeTool`
(N5, link 1), not through the chat `action_result.result` channel, so nothing here depends on the
lost commit. Recorded only so nobody spends an afternoon hunting a mechanism that is gone and is not
needed.

**N8 — `file:line` citations in the part docs are locators, not addresses. Re-grep the symbol at
task start.** The parts were written against a snapshot; three agents are now editing the tree
concurrently, so line numbers drift the moment anything lands. Verified case: after Task 2d shifted
`packages/notifications/src/repository.ts` and Task 2e began shifting
`packages/module-registry/src/external/worker-rpc-host.ts`, several of Task 2b's citations
(`markRead`'s CTE, the unread left-join, `let aiCalls = 0`, the `withDataContext` call site) sat
between a handful and ~30 lines off HEAD — while every **claim** attached to them was still exactly
right.

Two failure modes this prevents, in both directions:

1. An implementer trusting the number and editing whatever now occupies that line.
2. An implementer or reviewer reporting "the plan is wrong" on a citation that is merely stale,
   burning a round on a phantom.

**Rule: locate by symbol name, not by line number.** A citation is confirmed when the named symbol
is found and its described behaviour matches; a drifted line number is not a finding and must not be
reported as one. Only a changed *claim* is a finding. This applies to every remaining task — do not
raise it again per-task.

**N9 — A nav icon with no `iconMap` entry falls back; it does not render nothing. Task 3's stated
failure mode is wrong.** `08-task03-scaffold.md` warns that `icon: "compass"` must be added to the
app-shell icon map "or the nav renders nothing." Verified against HEAD: `app-shell.tsx` resolves
`iconMap[props.entry.icon] ?? Layers3`, with a second `Layers3` for the no-icon case. A name the map
does not know renders a generic layers glyph — visibly wrong, never invisible. `Compass` *is* a real
`lucide-react` export, so nothing is blocked.

**Ruling: the scaffold correctly ships `compass` without touching `app-shell.tsx`.** That file is
outside Task 3's declared scope, and the shipped finance module sets the identical precedent —
`landmark` ships with no map entry. **Whichever task wires the real Job Search nav entry adds
`Compass` to the icon map**, and its own test asserts the mapping rather than leaving it to review.

Do not re-report the plan's "renders nothing" line as a defect — it is recorded here as known-wrong.
The general lesson is N8's: a plan's *claim* about behaviour is checkable, and this one failed the
check while the instruction built on it (ship `compass`) was still right. Verify the claim, keep the
instruction that survives it.

**N10 — `cause.summary` and `cause.nextAction` are user-facing copy, and two of the five kinds are
unreviewed.** Task 5 pins exact strings only for `rate_limited` and `login_required`; `parse_failed`
and `network` are pinned on `nextAction` and a minimum length only, so their summaries were written
to implementer judgment (`f6328857`). That is not a defect — nothing in the plan specifies them — but
these strings **render verbatim** to the user on the settings screen (Task 20) and must not be
mistaken for reviewed product copy.

**Rule: treat the `parse_failed` and `network` summaries as draft copy.** Task 20 reviews them
against the module's voice when it builds the screen that shows them, and may rewrite them freely —
no ruling is needed to change wording that no test pins. Do **not** rewrite the two pinned strings;
their tests assert exact equality deliberately.

The general point for the rest of the build: a domain string that reaches a screen is copy, not an
implementation detail. When a plan leaves one open, say so at hand-off rather than letting it ship as
though it were specified.

## N11 — The ledger outranks a task part file: dedupe strips only a *proven* location

**Raised by the Task 7 implementer, who declined to pick a side and escalated instead — correct.**

Two plan artifacts disagree about title normalisation in dedupe:

- The **ledger** (r1 #15, #17, restated in `parts/01-constraints.md`) rules that stripping *all*
  parentheticals collapses "Staff Engineer (Security)" and "Staff Engineer (ML)" into one identity,
  and requires stripping **only a parenthetical proven to be a location**.
- The **part file** (`parts/12-task07-dedupe.md`) contracts a blanket `\([^)]*\)` strip, and its
  test 2 exercises exactly that.

The implementer built to the part file, reasoning it was more specific and more recent, and flagged
the conflict. The reasoning is defensible but the conclusion is wrong, and this settles the general
case:

**Rule: the rulings ledger outranks a task part file wherever they conflict.** Part files are
derived from the ledger and were written earlier in one pass; the ledger is where a decision is
*revised*. A part file that contradicts a ruling is a drafting error in the part file, not a
newer decision. When they disagree, follow the ledger and record the divergence here — never
silently follow the more convenient one.

**Rule: strip a title parenthetical only when the record proves it is a location or a req number.**
The proof is available without a gazetteer, because `Posting` carries its own `location` field: a
parenthetical whose normalised text appears in the posting's own `location` **is** a location, by
that posting's own account. Beyond that, strip a parenthetical that is a remote/hybrid/onsite
keyword or is digit-dominant (a req number). **Otherwise keep it in the identity.**

The default direction is deliberate. Task 7's own header comment already states the asymmetry
correctly: *a wrong merge is worse than a missed one* — two distinct roles collapsed into one row is
a job the user never sees, with no error and nothing to notice. A missed merge only shows the user
the same job twice, which is visible and harmless. When we cannot prove a parenthetical is a
location, keeping it costs a duplicate; dropping it costs a job.

The part file's test 2 (`"Staff Engineer (Seattle)"` equals `"Staff Engineer"`) still passes,
provided the fixture's `location` names Seattle — which is what a real posting looks like. A fixture
with a location-bearing title and an empty `location` field is not a case we owe a merge.

## N12 — Control characters in source are written as escapes, never as literal bytes

**Found by verifying `cfeb4712`'s bytes rather than its tests.** Task 10's control-character guard
was written with the *actual* bytes 0x00, 0x1F and 0x7F inside the regex character class, and its
test fixture carried a real NUL byte in a string literal. Every test passed — the regex matches the
same set either way — but `git show --stat` reported both files as `Bin 0 -> N bytes` and `file`
called them "data".

That is the whole cost: **git produces no diff for a binary file**, so those two files had no
line-level review, no blame, and every future change to them would be invisible in a PR. Editors,
greps, formatters and codegen are all entitled to mangle a NUL in a source file.

**Rule: any control character in source is written as an escape sequence** — `/[\x00-\x1f\x7f]/`,
`"has a\x00nul in it"` — never as the byte itself. This bites specifically where the code is
*about* control characters, which is exactly where a sanitizer or an input guard lives, so expect it
again in any task that validates user- or model-supplied text. Comment the escaping at the site: the
behaviour is identical, so the next reader has no other clue why it matters.

**Rule: check `git show --stat` on a commit, not just the gate.** A file reporting `Bin` instead of
a line count is the tell, and no unit test, typecheck, or lint run in this repo will surface it.

Also confirmed on the same commit: `format:check` was red on both files. That failure
**short-circuits the whole gate**, so `test:unit` and `test:integration` never execute behind it —
a red run that reads as a style nit while actually meaning no tests ran at all. Formatting is a
correctness signal here, not a cosmetic one.

## N13 — `format:check` is part of every task's gate, not a cleanup step

Measured, not asserted: at the point Tasks 4–10 were all reported green, **six job-search files
from four different agents failed `prettier --check`**. Every one of those agents had run its unit
tests and `check:external-modules` and reported a real exit 0. None had run `format:check`.

That is not a tidiness problem. A `format:check` failure **short-circuits the gate**, so
`test:unit` and `test:integration` never execute behind it. The resulting red run reads as a style
nit while actually meaning *no tests ran at all* — the single most misleading state a gate in this
repo can be in, and the reason [[format-check-hides-unrun-tests]] exists.

**Rule: every task's gate list includes `pnpm format:check` with a real exit code**, alongside the
task's tests and `check:external-modules`. A task is not done until it exits 0.

Cleaned up wholesale in `881ed512` (formatting only; 30 unit and 7 integration tests re-verified
after). The recurrence is what the rule is for — one agent forgetting is an oversight, four
agents forgetting is a missing instruction.

## N14 — Task 24 has no plan part yet, and no code may be written against it

Task 24 (user-added job board sources, #1309) was appended **after** the plan was approved, on
Ben's ruling that custom sources are in v1. Every other task in this build has a part file carrying
its contracts, invariants, and test cases; Task 24 has an issue body and nothing else.

That is a hard process gate, not a formality. "Spec before build" is a project invariant, and this
task is the one that touches the fetch-host allowlist — the boundary that decides which hosts a
module may reach at all. A task authored straight from an issue body would be inventing that
contract inside the implementation, which is precisely where a security-relevant shape drifts.

**Rule: Task 24 gets a plan part (`parts/30-task24-sources.md`) reviewed and approved before any
Task 24 code is written.** The part carries contracts, not implementations, in the same form as
every other part: the grant record's shape and where it persists, which existing machinery is
reused (`assertValidFetchHosts` in `packages/host-fetch/src/policy.ts:6` already exists and is
already enforced on every module fetch — this is a small write against existing enforcement, not a
new security project), the disable/remove path, and the `parse_failed` handling a user-named source
gets like any other portal. The login-walled hard stop stays in force: the crawler never signs in
and never uses stored credentials against a job board.

## N15 — A `Bin` marker on one commit is not proof the new blob is still binary

Follow-up to N12. Git flags a diff binary if **either** side of the pair contains a control byte, so
the commit that *fixes* literal control bytes still renders as `Bin old -> new bytes` — the tainted
parent blob is what forces it. That is expected and is not a residual defect.

**Rule: check the blob, not the diff.** `git cat-file -p <sha>:<path>` piped through a byte scan (or
`file -`) is the authority on whether the stored content is clean. Confirmed this way on `9161c7b4`:
both blobs are UTF-8 text with zero control bytes, and every future diff that does not have the
tainted parent on one side renders as normal reviewable text.

**Do not rewrite history to make an old diff render as text.** The branch is shared by six agents
and by other sessions; a rebase to cosmetically fix one historical diff pair trades a real hazard
(everyone's checkout diverging mid-build) for a cosmetic gain on a commit nobody needs to review
again.

## N16 — `parse_failed` does NOT disable a portal (revises L14)

Raised by the Task 11 agent, which found `describeFailure`'s `parse_failed` case
(`records.ts:159-173`, already committed) setting `disabled: false` while L14 and part 16's test 5
both demanded `true`. It was right to stop rather than route around it, and right that Task 5's
tests never pinned the value. The implementation is the correct one; **L14's phrasing overreached
and is revised here.**

What `disabled` actually costs: a disabled portal is never crawled again (part 19, test 4) until
the user turns it back on. Nothing nudges them to. So disabling on a layout change means that after
we ship the parser fix, the user's search stays permanently narrower than they asked for, through no
action of theirs and with nothing to notice — the exact silent-loss class this whole design fights.
`login_required` earns `disabled: true` because a retry can *never* succeed regardless of what we
ship: it is terminal by policy. A parse failure is terminal only until our next release, and then it
self-heals on the next scheduled crawl.

The committed copy already encodes this and would have become a lie under L14: `parse_failed`'s
`nextAction` is `"This needs a fix on our side. " + retry` — it promises a retry. Every genuinely
disabled kind pairs with the `"Disabled. Turn it back on if you want to try again."` copy instead.

**Steelmanning L14:** its stated concern is real — an unrecognised envelope must never reach the
user as a successful zero-result search. But `disabled` was never what prevents that. What prevents
it is `kind === "parse_failed"` plus the structured `cause` the board renders verbatim (part 25,
test 8) and `portal.list` returns (part 21). A degraded portal is visible on every crawl; a disabled
one is a decision the user has to undo.

**Rule: `disabled: true` is reserved for kinds where retrying can never succeed no matter what we
ship** — today that is `login_required` alone. `parse_failed`, `rate_limited`, `network` and
`deadline` all leave the portal enabled and degraded, with the cause rendered.

Follow-ups: part 16 lines 31 and 132 corrected in the same commit (a part file contradicting a
ruling is a drafting error in the part file, N11). Task 5's `job-search-failure-cause.test.ts` never
asserted `parse_failed`'s `disabled` value at all, which is why the gap survived four gates — that
assertion gets added so the value is pinned rather than incidental.

## N17 — A runtime fetch-host grant is platform-owned and module-agnostic

Task 24's draft part had the platform's `fetch.request` branch call a "module-specific"
`grantedHostsFor(db)` to union the actor's granted hosts onto `manifest.fetchHosts`. In practice
that means the host reaching into `app.job_search_custom_sources` — a module's own table — which is
a module-isolation violation, and it would have to be repeated for every module that ever wants a
runtime host.

**Rule: the grant lives in a platform-owned, module-agnostic table** keyed by `(module_id,
owner_user_id, host)`, written by the module through a declared SDK port on the worker context, and
read by `fetch.request` for the invoking `(moduleId, actorUserId)` before it calls
`createHostPinnedFetch`. The module's own table keeps the *source definition* — label, url, which
profile named it — and never the capability.

This is not the "new security machinery" Ben's ruling excluded. The grant has to be stored
somewhere regardless; this is the version that doesn't cross a module boundary, and it is *less*
platform code than a per-module hook because every module inherits it. `assertValidFetchHosts` and
`createHostPinnedFetch` remain the only enforcement, unchanged, applied to the merged list.

Placement follows the platform-package convention (`packages/<pkg>/sql/NNNN_*.sql`, globally
numbered, with a row added to `foundation-schema-catalog.test.ts`, which asserts the full list) —
not `infra/postgres/migrations/`, and not the module's `sql/`.

**Ordering rule for the two writes.** Registering a source writes a module row and a platform grant,
and `ctx.db.query` permits no transaction across them. Order both paths so a crash leaves the
**narrower** capability, never the wider one: on add, the source row first and the grant second; on
remove, the grant first and the source row second. A source with no grant fails closed and visibly;
a grant with no source is a capability the user believes they revoked.

## N18 — The platform grant store already exists: `app.module_kv`. No new table, no new migration.

N17 was right that the grant must be platform-owned and module-agnostic, and wrong that it needs new
storage. `app.module_kv` (`packages/settings/sql/0154_module_kv.sql`) is already exactly that table:
platform-owned, RLS enabled **and** forced, `scope 'user'` with an `owner_user_id` FK to
`app.users`, unique on `(module_id, namespace, owner_user_id, key)` for user-scoped rows, and a
64 KiB cap on each `value`. `packages/settings/sql/0157_module_worker_runtime_access.sql` grants
`jarvis_worker_runtime` SELECT/INSERT/UPDATE/DELETE with policies scoped to `app.current_module_id()`
and `status = 'enabled'`, so the worker can already read and write it. The RPC is wired
(`kv.get`/`kv.set`/`kv.list`/`kv.delete`, `worker-rpc-host.ts:403-434`) over
`packages/settings/src/repository-module-kv.ts`.

**Rule: the fetch-host grant is a user-scoped `app.module_kv` row in a manifest-declared namespace.**
N17's placement paragraph is withdrawn — there is **no** new `packages/<pkg>/sql/NNNN_*.sql`, **no**
new table, and **no** new `foundation-schema-catalog.test.ts` row for Task 24. Everything else in
N17 stands: platform-owned, module-agnostic, keyed by the invoking `(moduleId, actorUserId)`, and
the module's own table keeps only the source definition, never the capability.

**`fetch.request` must open its own short DataContext and close it before the network call.** The
branch sits at `worker-rpc-host.ts:211`, *outside* the `withDataContext` block that starts at 258,
so it has no `scopedDb`. Do not move the branch inside that block to get one: that would hold a
database transaction open for the entire duration of an outbound HTTP request, against an
adversarial remote host, with the connection pool capped. Read the granted hosts in a
`input.workerDataContext.withDataContext(...)` that returns before `createHostPinnedFetch` is
called.

**On self-granting — state it plainly rather than implying a guarantee we do not have.** A module
that can add a host at runtime can, by construction, add a host at runtime; no arrangement of
storage changes that. What actually constrains it is three things, and the design must lean on
these and claim nothing more:

1. **The capability is manifest-declared.** `kv.set` rejects any namespace the module's reviewed,
   hash-pinned manifest does not declare (`undeclared_namespace`), so a module that never declares
   the grant namespace can never grant, and one that does declared it where the user consented — at
   install. This is Ben's ruling (consent = install), not a new prompt.
2. **Enforcement is unchanged and still applies.** `assertValidFetchHosts` and
   `createHostPinnedFetch` treat a granted host exactly as a manifest host: the BLOCKED
   loopback / link-local / RFC1918 / cloud-metadata subnets and the DNS pinning hold, so a grant can
   never be turned into a route to an internal address.
3. **Every granted host is visible and revocable** on the module's settings surface (Task 20). A
   capability the user cannot see is the one we would not be able to defend.

`toolRisk: "read"` already forbids `kv.set`/`kv.delete` entirely, so the grant write can only happen
from a manual-risk tool — never from a read tool the assistant may call on its own.

**Still owner-scoped, not profile-scoped.** `fetch.request` has only `input.actorUserId` and
`input.module` in scope; there is no `profileId`. A host added under one profile is therefore
fetchable by every profile of that same owner, and never across users. Task 20's settings copy must
say so rather than implying per-profile isolation.

N17's write-ordering rule is unchanged: on add, source row first then grant; on remove, grant first
then source row — a crash must always leave the narrower capability.

## N19 — freehire returns one page. Do not budget it as a pager.

Probed twice against the live host (Task 11 implementation, 2026-07-27): none of `offset`, `page`,
`cursor`, `start`, `skip`, `from` or `after` changes what `__data.json` returns. Every variant
echoes page one back byte-identically. The adapter still sends `offset` — it is harmless, and the
route may honour it under conditions the probe did not reach — but **the adapter cannot be assumed
to page, and in practice does not.**

Two consequences, both for Task 14:

- **Budget freehire as roughly one page, not `PAGE_CAP` pages.** A per-portal share of the deadline
  sized for ten sequential fetches spends the invocation's time on a source that yields its whole
  result set on the first one, starving portals that genuinely do page.
- **Do not add an "identical page seen twice, stop early" guard** to the adapter or the crawl loop.
  It reads as a free optimisation and is not one: two identical pages are also what a legitimately
  stable, genuinely-repeating result set looks like, and a guard cannot tell the two apart. The
  worst case without it is refetching page one up to `PAGE_CAP` — wasteful, bounded, and absorbed by
  dedupe. The worst case with it is silently truncating a real result set, which is the failure mode
  this whole module is built to avoid.

Recorded here rather than left in `freehire.ts`'s header comment because Task 14 sizes its budget
from part 19 and the `Portal` contract, and has no reason to open an adapter's source to find it.

### N18 addendum — the integration test to clone, and the two GUCs

Task 24's grant test is not novel work; `tests/integration/module-worker-rpc.test.ts` already does
exactly this shape and is the file to copy (see also `external-module-finance.test.ts`'s `seedKv`).

- Seed `app.external_modules` with a raw bootstrap-client INSERT at `status = 'enabled'` — the
  worker RLS policies added in 0157 require it. Note `installModule()` does **not** write that table;
  it journals to `app.module_installs`. The enabled row comes from `module-reconcile.ts` or the admin
  route, so a test seeds it directly.
- Open the connection as `jarvis_worker_runtime` and set **both** GUCs inside the transaction. They
  are not set by one helper: `DataContextRunner.withDataContext` sets `app.actor_user_id`, and the
  caller then issues `set_config('app.current_module_id', …, true)` itself — that is precisely what
  `worker-rpc-host.ts:258-263` does, and a test that mirrors it is testing the real path.
- **The actor GUC is `app.actor_user_id`, not `app.current_actor_user_id`.** The latter is the SQL
  *function* the RLS policies call; it reads the former. Setting the function's name as a GUC fails
  silently — the policy simply sees no actor and the row vanishes, which reads as an RLS bug rather
  than a typo.

### N20 — integration tests use `asRuntime()`, not `createAppRuntimeRunner()`

Task 13's part file names `createAppRuntimeRunner()` as the integration-test harness. It cannot work
against the `app.job_search_*` tables: those require the per-module runtime role via `SET LOCAL ROLE`,
which is what `asRuntime()` (in `tests/integration/job-search-tables-install.test.ts`) does. Use
`asRuntime()`. Per N11 the ledger outranks the part file, so this is settled — Task 21 and any later
integration work should not re-litigate it.

### N21 — the two DB-access patterns are different, and the second one is a production rule

A job-search integration test needs **two** distinct access patterns, and using one where the other
belongs fails as a missing row rather than an error:

- **`app.job_search_*` (module-owned):** connect as `jarvis_worker_runtime`, `SET LOCAL ROLE` to the
  per-module runtime role, set `app.actor_user_id`.
- **`app.module_kv` (CORE platform table — the sweep cursor lives here):** connect as
  `jarvis_worker_runtime` with **no role switch**, and set **both** `app.actor_user_id` and
  `app.current_module_id`. Migration 0157's worker-scoped policies require both, plus an
  `app.external_modules` row with `status = 'enabled'` (seeded directly — `installModule()` only
  journals `app.module_installs`).

**This is not only a test concern.** The same requirement holds in production: the worker-rpc-host's
RPC-parent DataContext must set both GUCs before any `ctx.kv` *or* `ctx.db` call, not just the actor
one. A future change that sets only the actor GUC will not raise — the RLS policy will simply match
nothing, and a module's stored cursor will silently read as absent. Treat "the row vanished" as the
signature of a missing `app.current_module_id`, not as data loss.

### N22 — LinkedIn's 200-status auth-wall heuristic is unverified, and that is accepted

The LinkedIn adapter detects an auth wall served with a 200 status by matching markers (`authwall`,
`sign in to linkedin`, `join now to view`). This has **not** been verified against a real
interstitial, deliberately: forcing one would mean abusive request volume against a third party, and
the module's whole premise is that we do not do that. The heuristic is accepted as-is because it
fails to the safe side — a misclassification yields `parse_failed` (enabled, retried, cause shown to
the user), never a silent success or a spurious permanent disable. Worth one manual spot-check if
someone ever has a real wall in hand; not worth manufacturing one.

### N23 — enumerate tools from the manifest, never from a literal

Task 21's test 9 said "invoke each of the eight Task 16 tools"; the manifest declares nine. The stale
count is the smaller problem. **Derive the list from the manifest's declared `assistantTools` and
assert every declared tool is invoked** — never hardcode a count or a name list.

A hardcoded enumeration passes while a tool goes untested: someone adds a tenth tool, the assertion
still checks nine, and the gap is green and invisible. Manifest-derived enumeration fails loudly the
moment a tool is added without coverage, which is the failure worth having. Same class as prose tool
names being unvalidated — a renamed tool fails at runtime with nothing red beforehand.

### N24 — a module's runtime fetch-host grant namespace is a declared manifest field, not a convention

Task 24 asked whether `fetchHostGrantsNamespace` — a manifest field naming which `storage` namespace
holds a module's runtime-granted fetch hosts — should exist, or whether the platform should just know
the namespace by convention. **It is a declared field. Approved.**

A convention means any module that happens to declare a conventionally-named namespace silently
acquires the ability to extend its own network reach, with nothing at review or install time saying
so. A declared field makes runtime host-granting opt-in and legible in the reviewed, hash-pinned
manifest — which is what Ben's "consent = install" ruling requires. This is the only new schema Task
24 adds anywhere, and it is the right one.

### N25 — bounds on extracting a `Posting` from an arbitrary third-party page

Task 24's custom-source adapter fetches a user-registered URL and hands the page to
`ctx.ai.generateStructured`. There is no precedent for that in this codebase, so these bounds are
decisions rather than transcriptions:

- **Strip `<script>`/`<style>` contents and HTML comments (tolerant regex, no DOM dependency), then
  cap at `CUSTOM_SOURCE_PAGE_BYTE_CAP = 60_000` bytes.** The bound is about latency, not cost: the
  module worker's 30s invocation cap **includes host AI time** and blows with an empty
  `handler_error` carrying no cause. A 300 KB prompt (~75k input tokens) on a source that is fragile
  by construction is the shape that trips it. `ctx.deadlineAt` is the lever after the call; this is
  the lever before it. **Do not** justify the number by scaling `MAX_RENDERED_TOOL_RESULT_CHARS`
  (16,000, `packages/ai/src/gateway/output-validation.ts:4`) — that is a rendered-tool-output
  precedent, not a page-fetch one, and citing it as a derivation is misleading.
- **The strict parser rejects any extracted `url` that is not `https:`,** failing the whole
  extraction per the fail-the-whole-extraction rule. `url` is the one model-derived field that
  becomes a link the user follows off the board, and the page it was derived from is attacker-
  controlled. **Not** same-host: job boards legitimately link out to ATS domains — that is freehire's
  entire model — and a same-host rule breaks the common case to close a hazard `https:`-only already
  closes.
- **Nothing the model returns may ever influence what gets fetched.** The adapter fetches exactly the
  one registered `url`; no extracted field feeds a later request. State this as a constraint, not
  only as a test. A future task adding "follow the posting links for full descriptions" would break
  it without touching a line Task 24 wrote.

One correction to a citation, not to a rule: the four-layer LLM-field exfiltration defense in this
codebase guards LLM-derived fields persisted **next to private cached content**, where the hazard is
smuggling the private body into the derived fields. A public job board page has no private content to
smuggle, so that posture does not transfer. The whole-extraction-fails-on-one-bad-field rule stands
on its own reasoning: a fabricated or blank field is worse than no posting.

---

## N26 — Gate DB isolation is mandatory; never pipe a gate command

Recorded 2026-07-27, from a coordinate-skills update landing mid-build.

**Never run `pnpm verify:foundation`, or anything else that touches Postgres, without an
exported and freshly created gate database.** An unscoped run on 2026-07-25 hit the live dev
database `jarv1s` and took chat down for 90 minutes.

```
GATEDB=jarvis_gate_<agent-slug>
docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS $GATEDB;"
docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE $GATEDB;"
export JARVIS_PGDATABASE=$GATEDB
( pnpm verify:foundation > /tmp/vf-<slug>.log 2>&1; echo "### FINAL rc=$?" >> /tmp/vf-<slug>.log ) &
grep '### FINAL' /tmp/vf-<slug>.log
```

Three independent ways this fails silently:

1. **`export`, not inline.** `JARVIS_PGDATABASE=x pnpm ...` does **not** survive backgrounding —
   the variable is dropped and the run lands back on the live database with no signal.
2. **DROP and CREATE fresh every run.** A reused gate DB carries prior migration state and greens
   for the wrong reason.
3. **Never pipe a gate command.** `| tail`, `| grep` — a pipeline returns the *filter's* exit
   code, so a red gate reads as green. A blocking hook now rejects piped gate commands. Read the
   log file. Never trust `echo $?` after a backgrounded command either.

**Stagger** gate runs; concurrent ones crash the shared dev Postgres. DROP the gate DB when done.

This bit the coordinator the same day: an `npx eslint ... | tail -5; echo "EXIT=$?"` probe
reported "EXIT=0", which was `tail`'s status, not eslint's — and the probe had also dropped
`pnpm lint`'s `--max-warnings=0`. The bad number reached another agent before it was caught.
`pnpm test:unit` touches no database and stays the correct inner loop.

## N27 — Live-path proof is part of the finish line, not just merge

For work touching a user-facing feature, module, or UI surface, CI-green plus review is **not**
done. It needs a live end-to-end proof posted as a `gh pr comment`: the feature exercised through
the real UI on a live dev instance, with the UAT run and screenshots.

Resolve which specs with `.claude/skills/coordinate/resolve-uat-triggers.sh`. **The trigger map is
deliberately incomplete — empty output never means no proof is needed.**

Absent that proof the honest status is **"code-complete, unverified"**, never "done". This mostly
lands on Task 22 (#1306), but it changes what Task 21 Tier B is *for*: Tier B is no longer the
last line of defence, so it should stay on what only an integration test can prove — the
metadata-only payload whitelist, the manifest-hash trust gate, the schedule-to-queue binding, and
the `actorUserId` envelope — rather than growing to cover what the live UAT covers better.

## N28 — Commit with explicit paths; the index is shared

**`git commit <explicit paths> -m "..."`.** That form commits only the named paths regardless of
what else is staged. `git add <paths>` followed by a bare `git commit` is **not** safe — the bare
commit takes the whole index, including anything another agent staged.

The standing "never `git add -A` / `git add .`" rule is necessary but **not sufficient**, and this
fired for real on 2026-07-27: commit `f3d68780` intended three lint-ignore files and carried
fourteen, including another agent's entire in-flight Task 18 plus `package.json` and
`pnpm-lock.yaml`, under a message about lint ignores. Caught and reset inside two minutes, never
pushed, zero damage — but only because someone was watching the commit monitor.

After committing, run `git show --name-only HEAD` and read the list. For a coordinator,
`git status --porcelain` showing staged entries for files belonging to another agent means the
landmine is armed right now; warn whoever is closest to committing.

**Rewrite boundary:** resetting your own commit, seconds old and unpushed, to undo an accidental
sweep is correct and expected. Rewriting anything another agent may have built on is not — surface
it to the coordinator instead. This does not loosen N15.

## N29 — The AI port reaches the custom adapter by closure, never by widening `Portal`

`customPortal(source, ai)` takes the AI port as a constructor parameter and closes over it. Do
**not** add an `ai` field to `Portal.crawl`'s args or to `runCrawl`'s deps.

The custom adapter is the only portal that does model-driven extraction. Widening the shared
contract would hand an AI port to freehire and linkedin, which must never have one — that is a
capability boundary, not a tidiness preference. Declaring the port's type locally (an `AiPort`
interface mirroring `ModuleWorkerContext["ai"]`) rather than importing it from the SDK follows the
`EmbedPort` precedent already documented at `worker/stages/crawl.ts:38`, and keeps the adapter
SDK-free and unit-testable against a plain object.

**The wiring obligation this creates belongs to Task 15 (#1299) and is load-bearing.**
`runCrawl` receives `portals` already assembled (`crawl.ts:84-96`), so whoever builds that array
per profile must read `store.listCustomSources(profileId)` and push a `customPortal(source, ctx.ai)`
for each row. If that step is skipped, custom sources are stored, configured, validated and tested
green while never being crawled — a silent no-op with no failing test anywhere. Same category as
the `database.ownedTables` manifest gap flagged earlier on this task.

## N30 — Custom extraction returns an array; one bad posting fails the whole page

The extraction schema is `{ postings: [...] }`, each item shaped like `Posting` minus `id` and
`sourceId`. Part 30's "shaped like Posting minus id/sourceId" describes the **item** shape, not the
cardinality — a job board page lists many postings, and singular would make custom sources
structurally incapable of what freehire and linkedin already do.

**If any item fails validation, the whole extraction fails** — the plain extension of "one field
failing validation fails the whole extraction". Partial acceptance is the worse failure: the model
drops three postings from a page of fifty, we store forty-seven, and report success. That is the
recall case failing silently, and the recall case is protected. A whole-page failure is loud,
lands as a structured `parse_failed` cause, and per N16 does **not** disable the portal — so it
retries on the next sweep and recovers by itself the moment the page or the model output is
well-formed. The availability cost (a 98%-fine source yielding nothing) is real and accepted,
because it is visible and fixable while silent under-recall is neither.

**An empty array is a legitimate zero-result page, not a failure** — mirrors freehire's
empty-items rule (N19).

The structured cause must record **where** extraction failed: the item index and the offending
field name, bounded to that. Not "parse_failed" alone, which makes a fifty-posting page
undebuggable — and not the raw item either, which drags posting bodies into a failure record.

## N31 — Where the live proof lands, and when this branch gets pushed

N27 says user-facing work is not done without a live end-to-end proof posted as a PR comment.
There is no PR: `origin/feat/job-search` does not exist and `gh pr list --head feat/job-search` is
empty. This resolves the gap rather than leaving each agent to improvise.

**Do not push this branch or open a PR yet.** The tree is knowingly red — typecheck, lint and
format all fail on other agents' in-flight work at any given moment, by design, because six agents
share it. Pushing now fires CI on a red tree and produces a failure signal that means nothing,
which is how a team learns to ignore CI.

**Proof accrues to Task 22 (#1306), not per task.** Individual task agents do not each stage a live
run; that would mean standing up the module six times against half-built surfaces. Task 22's
consolidated run on the prod-shaped stack is the proof for the surface work collectively —
Tasks 18, 19 and 20 included.

**The PR opens at Task 23 (#1307)**, once the full gate is green on a quiet tree, and every proof
posts there.

**Until then the honest per-task status is "code-complete, unverified".** Say exactly that. Do not
post a live proof onto a closed task issue to discharge the obligation — a closed issue is not
where anyone looks, and the obligation is not discharged by filing it somewhere.

## N32 — Naming paths on a commit does not protect a file two agents are editing

N28 fixed a dirty **index**: `git commit <explicit paths>` instead of a bare `git commit`. It does
not fix a dirty **file**. `git commit <path>` takes the whole current content of that path, so if
two agents have in-flight edits in the same file, whoever commits first carries the other's
unfinished work under a message that does not mention it.

Observed 2026-07-27: `external-modules/job-search/src/web/root.tsx` and
`tests/unit/job-search-web-root.test.tsx` each held Task 17 (chat-surface) and Task 19 (criteria)
work at the same time — the `useProfileThread` wiring and the `OnboardingScreen` branch. A
correct-looking N28-compliant commit from either agent would have swept the other.

**The rule.** Before committing, run `git diff <path>` on every shared-looking file and read the
added lines. If they include work that is not yours:

1. Commit the files that are **exclusively yours** now. That is always safe.
2. Leave the co-edited files to the agent still working in them; their commit carries both, and
   **its message must name both tasks**.
3. Never `git checkout`, revert or hand-restore a co-edited file to strip what looks like someone
   else's edits — that destroys verified work and is a history problem, not a staging one.
4. The task whose wiring rode along **stays open** until the coordinator confirms it is in
   committed state. "My files are committed" is not "my task is committed".

Files most exposed on this branch are the shared entrypoints: `web/root.tsx`,
`tests/unit/job-search-web-root.test.tsx`, `worker/index.ts`, and `jarvis.module.json`. Treat a
commit touching any of them as requiring the `git diff` read above.

## N33 — job-search gets no UAT seed chunk, and the absence is documented

**Overrides** part file `parts/27-task22-uat.md`'s literal "register the chunk" instruction. A part
file's step list is a plan, not a contract; where following it to the letter would defeat its
purpose, the coordinator rules and the ledger records why.

**The ruling.** Do not add a `"job-search"` member to the `UatSeedChunk` union, to
`UAT_SEED_CHUNKS`, or to `run-uat.ts`'s `CHUNKS` set — **not even a documented no-op**.

**Why.** `#1087` finding 3 is sharper than the paraphrase it usually gets ("no module-installing
chunk on the always-on ladder"). Its actual content: at the `admin+data` level job-search must be
**not installed by default, to prove the absent-module UI path** — and `#1026`'s absent-module
Playwright path was unreachable precisely because job-search seeding was reachable
(`tests/uat/seed/levels.ts:94` now carries the fix and its comment).

That makes a registered-but-empty chunk *actively harmful* rather than merely useless:

1. It creates the vocabulary that invites a future agent to add job-search to `ADMIN_DATA_CHUNKS`
   and silently re-break the absent-module path. Nothing goes red when that happens.
2. A chunk that does nothing reads to whoever finds it next as "job-search seeding exists and is
   broken", which costs someone a debugging session.
3. It cannot earn its keep. Task 22 Phase 1 installs the module **live** via docker-cp and the admin
   UI (the finance precedent), so by the time a chunk would run there is no install left to do — and
   seeding a profile or criteria row would *skip* the onboarding flow the UAT exists to exercise.

**Instead:** document the deliberate absence — a note in the part file and a comment where a reader
would go looking — stating that job-search is installed live in Phase 1 and is intentionally absent
from the seed ladder so the absent-module path stays reachable, citing `#1087` finding 3. If a later
spec genuinely needs seeded job-search data, it adds a real chunk with real content, deliberately.

**The general form:** when an instruction can be satisfied in letter by dead scaffolding, that is a
signal the instruction is wrong for the situation — raise it rather than building the no-op. Per the
project's no-stale-concepts rule, dead vocabulary gets removed in the same pass, not introduced.

## N34 — supersedes N30's addendum: diagnostics never enter `FailureCause`

**N30's addendum was wrong** and is withdrawn. It asked the structured cause to record *where*
extraction failed (item index, offending field). Building it would have been a mistake, correctly
refused by the agent asked to do it.

**Why it was wrong.** `FailureCause` is user-facing board copy: `describeFailure` is the single
place that builds `summary`/`nextAction`, `FailureKind` is deliberately closed with an exhaustive
check, and Task 20 renders `summary`/`nextAction` **verbatim** on the failure card. An item index and
a field name are debug detail, not board copy — putting them in `summary` shows a user internals
they cannot act on, and adding a free-text `detail` field invites exactly that leak later, plus a
cross-adapter shape change that freehire and linkedin never asked for.

**The rule.** Diagnostic detail does not enter `FailureCause`, in any field, ever.

1. If a failure distinction **matters to the user**, it earns a new closed `FailureKind` with its own
   authored copy in `describeFailure` — reviewed as copy, written once, in one voice. Not a string.
2. If it **only matters to us**, it is telemetry at the adapter, and it must never carry the raw
   item: a custom source is a user's private board content, and adapter logs are not a place for it.
3. `parse_failed` staying undifferentiated is acceptable. For a user-added board the actionable
   truth is "this board's postings could not be read, you can remove it" — which `nextAction`
   already carries. Field-level precision helps nobody the user can reach.

**The general form:** when a build agent refuses a coordinator ruling on the grounds that it would
corrupt a documented structural invariant, the default is that the agent is right. A ruling made
without reading the type it constrains loses to the type.

**Related, not a security gap.** `source.ts` locally duplicates `isPinnableHost` rather than
importing `@jarv1s/host-fetch/policy`, because the module's tsconfig `paths` deliberately expose only
`@jarv1s/module-sdk/worker`. That duplication is **correct**: the module is sandboxed and cannot
import host packages at runtime, and the module's copy is a UX pre-check only — the authoritative
enforcement is the host's pinned fetch, which independently resolves and blocks. Document it as
defence-in-depth with the host authoritative; do not widen module `paths` to "fix" it.

## N35 — the file-size gate is repaired by splitting, never by exemption

`scripts/check-file-size.ts` carries an `exemptFiles` allowlist. It is **not** available to this
epic. Three files were pushed over the 1000-line cap by our own commits — `apps/api/src/server.ts`
(997 on main → 1002), `packages/module-sdk/src/index.ts` (998 → 1064) and
`tests/integration/notifications.test.ts` (996 → 1179). All three get split. None gets exempted.

The allowlist is legitimate for files that genuinely cannot be made smaller — `packages/db/src/
types.ts` is on it because hand-maintained Kysely table types grow with the schema. Reaching for
the same hatch to absorb damage we caused converts a design rule into a formality, and the next
agent inherits an allowlist that reads as permission.

Two consequences that outlive the fix:

**`check:file-size` is step 3 of `verify:foundation`**, ahead of `typecheck`, `test:unit`,
`db:migrate`, `test:uat-seed` and `test:integration`. While it is red, none of those steps run at
all. Any "full gate green" claimed on this branch after `444c64d2` is unverified by construction —
re-run it, do not trust it.

**"Untouched by me" is not "pre-existing."** Both statements were made about these files and only
the first was true. Before calling any gate failure pre-existing, diff the file against `main` —
`git show main:<path> | wc -l`. A failure this branch caused, described as background noise, is how
a gate stays red across a whole epic.

## N36 — a split is verified by counting test cases, not lines

N35 says split rather than exempt. **Split means the cases keep running from a new path, not that
they stop existing.** Deleting test cases to get a file under the cap is strictly worse than the
exemption we refused: `check:file-size` goes green, `test:integration` is the *last* link in
`verify:foundation` so the loss surfaces nowhere, and nothing in the toolchain counts cases across
a split.

Caught live: `tests/integration/notifications.test.ts` went 33 cases → 12 in the working tree, with
the extracted `notifications-harness.ts` holding four helper exports and **zero** cases — ~574 lines
and 21 cases with no destination.

So for every test file split under this or any later gate repair, prove conservation in the commit
message:

```
git show HEAD:<path> | grep -cE '^\s*(it|test)\('     # before
grep -chE '^\s*(it|test)\(' <each resulting file>     # after, summed
```

The two numbers must match. A falling **line** count is the goal; a falling **case** count is a
defect. The same applies to a helpers-only extraction, where the expected delta is exactly zero.

Generalisation worth carrying past this epic: when a gate measures a proxy (line count) for a
property we actually care about (readability), the cheapest way to satisfy the gate is usually to
damage the property. Every mechanical gate repair needs a second, independent measure of the thing
the gate was standing in for.

## N37 — Tier B integration scope: 6, 8, 9, hash gate, 11. Not 10, not 12.

Task 21 Tier B (#1305) writes exactly five things into
`tests/integration/job-search.test.ts`: the metadata-only payload whitelist (6), the
schedule-to-queue binding (8), the `actorUserId` envelope (9), the manifest/package hash trust
gate, and the briefing round-trip (11). Tests 10 and 12 from the original spec are out.

**Test 12 (no blended score) is dropped as genuinely redundant.** Verified, not asserted: five
existing unit sites cover it, including the tool-schema boundary an integration test would be
re-checking — `job-search-manifest.test.ts:102`, `job-search-profile-handler.test.ts:380`,
`job-search-match-handler.test.ts:203`, `job-search-score.test.ts:55` and `:114`,
`job-search-surface.test.ts:100`.

**Test 10 (partial-crawl persistence) is deferred to the UAT in #1306, not deleted.** Faking one
portal succeeding while another rate-limits, through a *live* worker, requires the
`JARVIS_RUNTIME_MODE=e2e` + `JARVIS_E2E_MODULE_FETCH_BASE` fixture-server machinery that Task 22
is building concurrently. The substitution point is host-side `createFetch` on the **queue-job
path only** — `createExternalModuleTools` has no equivalent, so the tool-invoke path cannot fake
network at all. Deferring avoids two agents building one harness. **If #1306's UAT does not
exercise the crawl-then-degrade path, test 10 returns to Tier B** — this is a transfer of
coverage, not a write-off, and the transfer must be checked before #1305 closes.

**Test 11 changed shape.** `collectExternalBriefingContributions` takes no detail-level
parameter; the module handler resolves it most-generous-wins across active profiles
(`count=0, top=1, full=2`). Three separate scenarios, one active profile each — two profiles at
different levels in one scenario collapse to the higher and prove nothing. Route it through the
**real** `ExternalModuleWorkerRuntime`: the existing `#1282` briefing block stubs
`runtime.invoke` and never starts a child, so the live path is the only uncovered part.

**The hash gate moved and now checks both hashes.** Not `external-module-job-handler.ts:52` —
it is `createVerifiedExternalModuleInvoker` in `apps/worker/src/external-module-invoke.ts`
(~93–124), requiring `manifest_hash` **and** `package_hash` to match, returning a typed
`{ok:false, reason:"hash-mismatch"}`. Assert both hashes and the reason. `package_hash` is the
real content anchor; the `manifestHash` in a job payload is a different value.

**Generalisation.** Two of the three scope cuts here were argued from "it's already covered
elsewhere" — and that claim is only load-bearing if you *run the grep*. One was true at five
sites; the other was a transfer that needed an explicit tripwire so the coverage cannot vanish
between two agents each assuming the other holds it. Never accept "covered elsewhere" as
scope-reduction without naming the file and line that covers it.

## N38 — a render cap is paid for in row count, never in the explanation text

Caught while verifying `88daf351`, which lowered `REASON_MAX_CHARS` from 400 to 60 in
`worker/handlers/matches.ts` and described itself as *"Not user-visible — test and internal
render-safety coverage only."* It is user-visible, and the way it was found is the reusable part:
the claim was checked against the consumer rather than against the diff.

`screens/inspector.tsx:3` states plainly that it never calls `invokeTool`/`runQueue` — it renders
`match.fitReason`/`match.wantReason` off the board row at `:53`/`:58`. The manifest declares no
`job-search.match.get`; `matches.list` is the only tool returning match data. So the 60-char cap is
the **entire** Fit and Want explanation anywhere in the product. The AI writes a full reason to the
database and nothing displays it. A locked module rule — Fit and Want each carry their own reason —
is not satisfied by a 60-character fragment.

**The constraint that motivated it is real.** `boundedAssistantToolResultData`
(`packages/ai/src/gateway/output-validation.ts:89`, reached from `packages/ai/src/routes.ts:712`,
which is the browser `invokeTool` path the board uses) returns `result.data` untouched under 16 000
rendered characters and replaces it **wholesale** with `{text: "…truncated"}` above it. Over the cap
the board renders no rows at all, not a short list. A budget genuinely has to be spent.

**Ruling: spend it on the row count.** Reasons and the posting URL are the product; rows-per-screen
is a knob. Any future field added to a capped tool result follows the same order — shrink the list
before shrinking what each item says. Filed as #1330, scoped to land with #1329 (same two files).

Two mechanical traps recorded with it:

- `BoardMatch` carries **no `url`**, so "Open posting" — one of three plan-named match actions — has
  no data to work with. Found by grepping the consumers for `url|href`, not by reading the handler.
- `board.tsx:18`'s `MATCHES_LIMIT` and `MATCHES_LIST_MAX_LIMIT` are two copies of one number. They
  move together or the board starts throwing `InputError` on every read.

**Generalisation.** "Not user-visible" is a claim about the *consumer*, not about the diff. A change
to a constant inside a handler looks internal by construction; whether it is depends on who reads
the field and whether any other path can still reach the untruncated value. Trace to the surface
before accepting the label — and when a cap must be enforced, ask which axis the product can afford
to lose, rather than shrinking whichever field the arithmetic makes easiest.

### N39 — a field belongs in the list row only if the list renders it

**Ruling.** `fitReason` and `wantReason` come **out** of `BoardMatch` and live only on
`MatchDetail`, behind `job-search.match.get`. The board row keeps `id`, `title`, `company`, `fit`,
`want`, `outsideFrame`, `state`, `url`. `MATCHES_LIST_MAX_LIMIT` is then recomputed from the real
formatter against the freed budget — it must not be left at a number chosen while the reasons were
still in the row.

**Why.** Verified, not assumed: `grep -n "reason" board.tsx` returns **nothing**. The board table
renders Fit and Want as two sortable numeric columns and no prose. The only consumer of either
reason is `inspector.tsx:53,58`, which is open for exactly one match at a time. So the row was
paying `2 × REASON_MAX_CHARS` on every row for a field no row displays, and that cost was what
pushed `MATCHES_LIST_MAX_LIMIT` from 40 down to 15 once `url` (N38, #1330) had to be added.

This is strictly better on both axes at once, which is why it is a ruling and not a preference:
the board gets its row count back, *and* the inspector gets the **full untruncated** reasoning
instead of 150 characters — which is what spec §7 asks for ("an inspector showing the two axes and
the model's reasoning for each"). Truncating a field down to fit a budget it never needed to be in
is a loss with no corresponding gain.

**The structural contract still holds.** `inspector.tsx:3` states "this file never calls
invokeTool/runQueue"; `board.tsx` "owns every fetch/sort/dismiss decision". The detail read is
therefore issued by `board.tsx` on selection and handed down as a prop — the inspector stays pure
presentation. Do not move the fetch into the inspector to make this easier.

`url` stays on the row: plan tests 16 and 17 put all three actions on **every** match and assert
"Open posting" is a real link to `posting.url` per row, so unlike the reasons it genuinely is
per-row data. The model reaching `matches.list` still gets full reasoning — via `match.get`, the
same door the inspector uses.

**Generalisation.** Before spending render budget on a field, grep the renderer for it. A field
that only a detail view reads is a detail field, however natural it looks on the list type. When a
cap forces a trade, first check whether anything in the row is not actually rendered — reclaiming
dead weight beats choosing which live thing to shrink.
