# Spec — #1251/#1252 tool failure visibility (operator log + audit truth)

Date: 2026-07-25. Status: DRAFT — awaiting Ben's approval.
Grounded on `fd524022` (worktree `.claude/worktrees/spec-host-findings`, branch
`spec/host-findings-1250-1255`). Line numbers below are this commit's. Both issues quote an
older revision (~17 lines higher through `gateway.ts`); the code they describe is unchanged.

Line numbers are `fd524022`'s. `build/js-03-perms` (`ee7ca045`) merges first and reorganizes
`module-sdk/src/index.ts`, `worker-runtime.ts`, and `gateway.ts` — re-resolve every line
reference in those three files against main at implementation time. Specifically:
`packages/module-sdk/src/index.ts` changes 285 lines and is heavily net-negative, so Fix 3's
insertion point and the `workerContractVersion` citation at `:619` are both restructured, not
merely shifted; `packages/module-registry/src/external/worker-runtime.ts` gains 59 lines in the
same JSON-RPC invoke/reject path Fix 3 extends; and `packages/ai/src/gateway/gateway.ts` gains
33 lines, deleting three hardcoded `found.dto.name === "job-search.resume.critique"` checks
(`:167`, `:188`, `:543`) in favor of a helper at `:75`, which moves the `runHandler` catch at
`:456` and all three audit call sites (`:175`, `:196`, `:550`).

Both issues are the same defect seen from two sides: **a tool can fail and leave no honest
record anywhere.** #1251 is the operator log saying nothing; #1252 is the audit log saying
"success". They share one call path (`AssistantToolGateway.runHandler` → external worker
boundary) and one fix surface, so they are specced together.

## Problem

### 1. A handler throw is discarded, not just sanitized (#1251)

`packages/ai/src/gateway/gateway.ts:456-459`

```ts
} catch {
  // never leak internals/secrets from a handler throw
  return { ok: false, error: `Tool ${found.dto.name} failed` };
}
```

The sanitized return is correct and stays — that boundary is what stops a throw from carrying
secrets or internals into a model prompt. But the caught value is bound to nothing, so it is
also gone for the operator. `Tool <name> failed` is the only artifact the entire system
produces for a failed tool call.

Cost, from #1234 (JS-03) UAT: a `job-search.resume.critique` failure appeared as an audit row
of `failed / handler_error` with **nothing in `api.log`**. Diagnosis proceeded by correlating
audit `occurred_at` against `ai.structured usage` lines. The real cause — an invocation
timeout that counted host AI latency (`worker-runtime.ts:88-92`, a flat
`invocationTimeoutMs ?? 30_000` wall-clock cap on `origin/main`) — stayed invisible for three
UAT rounds. The thrown value in that case was `ExternalModuleWorkerError`
(`worker-runtime.ts:35-40`) whose entire payload is a closed-enum `code: "timeout"`. One
logged field would have ended it.

Sibling catches with the same shape:

| Site                                                                | What is silently swallowed                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `gateway.ts:370-372` (`runReadToolForActor`)                        | every cross-tool pre-submit read failure                                    |
| `gateway.ts:501-503` (preview hook)                                 | why an approval card degraded to summary-only                               |
| `gateway.ts:584-586` (`firstRunNotice`)                             | a prefs read/write DB error                                                 |
| `gateway.ts:665-675` (`recordAuditRaw`)                             | logs an envelope but drops the error — an audit-write failure with no cause |
| `gateway.ts:232-238` (yolo lookup in `requestNativeToolPermission`) | a thrown yolo lookup silently becomes "not yolo"                            |

### 2. `result.ok` is not a claim about success (#1252)

Audit outcome is derived from the gateway envelope alone:

- `gateway.ts:175` (yolo), `gateway.ts:195-196` (auto-run), `gateway.ts:549-550` (confirmed):
  `outcome: result.ok ? "success" : "failed"`, `errorClass: result.ok ? null : "handler_error"`.
- Same derivation drives the live drawer card: `gateway.ts:165`, `:187`, `:542`
  → `outcome: result.ok ? "executed" : "error"`.

`runHandler` sets `ok: true` for anything that _returned_ (`gateway.ts:439-455`). External
modules have no error channel short of throwing, so self-handled failures return normally:

- `external-modules/job-search/src/worker/wrap.ts:11-16` — `InputError` and `JobSearchKvError`
  are caught and returned as `{ status: "error", code, message }`.
- `external-modules/job-search/src/worker/handlers/resume.ts:137-142` — `resume.critique`
  returns `{ status: "error", code: "critique_unavailable" }` when `ai.generateStructured`
  fails. `resume.critique` is `risk: "write"` (`external-modules/job-search/jarvis.module.json:51`),
  so it _does_ write an audit row — recording **`outcome = success`** for a review that never
  happened. This is the tool at the centre of #1234 UAT.
- `handlers/resume.ts:86-92` (`attachment_unavailable`), `external-modules/finance/src/worker/wrap.ts:24-33`,
  `finance/src/worker/handlers/sync.ts:288,293` — same pattern, two modules.

The path that flattens it: worker returns a plain result → `worker-runtime.ts:214`
`pending.resolve(message.result)` → `external-module-tools.ts:134-143` `externalToolResult()`
wraps any object as `{ data: … }` → `tool-manifests.ts:43` `execute` resolves →
`gateway.ts:439` `ok: true`.

`app.jarvis_action_audit_log` is the evidence source for "did this actually work". It must
not be able to answer yes when the work failed.

## Design

Five changes. Fixes 1-2 are #1251 (host-local, no protocol change). Fixes 3-5 are #1252 (an
additive worker-protocol change plus its reference adopters).

### Fix 1 — log the failure the model is not allowed to see

`packages/ai/src/gateway/types.ts`: add a structural logger port, matching the shape
`ExternalModuleWorkerRuntime` already accepts (`worker-runtime.ts:51`) so no package gains a
Fastify dependency:

```ts
export interface GatewayLogger {
  error(data: Record<string, unknown>, message?: string): void;
  warn(data: Record<string, unknown>, message?: string): void;
}
```

`gateway.ts:26-57`: add `readonly logger?: GatewayLogger` to `AssistantToolGatewayDependencies`.
Wired in `packages/chat/src/routes.ts:741` (`buildChatGatewayDependencies`) from the Fastify
instance in scope at `routes.ts:244`, via `createModuleLogger(server.log, "assistant-gateway")`
(`packages/module-sdk/src/logger.ts:15`). When no logger is injected (unit tests, non-Fastify
callers), fall back to the `console.error(JSON.stringify({...}))` envelope already used at
`gateway.ts:666` — uniform behavior, and no failure is ever silent.

In `runHandler`'s catch (`gateway.ts:456`), bind the error and log **one** line built from an
explicit allowlist, then return the existing sanitized value byte-for-byte unchanged:

```
event: "assistant_tool_handler_failed"
toolName, toolModuleId, risk, requestId, chatSessionId, actorUserId
errorName    // error.name, else constructor name, charset-filtered, ≤64 chars
errorCode    // only if typeof error.code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/
durationMs   // measured around the execute call
stackFrames  // see below
```

`describeError` must be total over `unknown`: a handler can `throw "boom"`, `throw null`, or
throw a plain object. A non-`Error` value yields `errorName: typeof value` (e.g. `"string"`)
and no `errorCode`/`stackFrames` — never `String(value)`, which is the thrown value's content
and therefore subject to the same rule as `message` below.

Why an allowlist and not the error object: `apps/api/src/error-handling.ts:18-23` already
establishes this as the repo's structural (not denylist-based) secrets rule — construct log
objects from named fields, never spread the raw error, never log request bodies or headers.
This spec applies the same rule one layer down.

**What may be logged, and why it is safe**

- `errorName` — a class name from our own code or Node. No data.
- `errorCode` — logged only when it is a short identifier-shaped string. This is what carries
  the diagnosis in practice: `ExternalModuleWorkerError.code` is the closed enum
  `"protocol" | "timeout" | "crash" | "handler_failed"` (`worker-runtime.ts:36`), and Node/pg
  codes are fixed constants. The #1234 line would have read
  `errorName=ExternalModuleWorkerError errorCode=timeout durationMs=30012` — the whole bug.
- `stackFrames` — `error.stack` with **line 1 removed** and only ` at …` frames kept, first 10
  frames, capped at 2000 chars (the cap that `MAX_CLIENT_STACK_CHARS`,
  `apps/api/src/error-handling.ts:29-32`, already uses). V8 puts `Name: message` on line 1 of
  `stack`; dropping it is what keeps the message out. Frames are file paths and line numbers
  from our own source — code locations, not user data.

**What must never be logged**

- `error.message`. Not capped, not truncated, not "just for external modules". Postgres
  messages embed row values (`Key (email)=(…) already exists`); undici/fetch errors embed the
  request URL, which can carry a query-string credential; a module's thrown `Error` is
  module-authored prose over user content (a résumé, a transaction). Nothing at this boundary
  can classify it. This is the CLAUDE.md "secrets never escape" invariant applied literally:
  logs are one of the five named sinks.
- `error.cause` (recursively — a wrapped cause is just another message), and provider-shaped
  fields `response`, `body`, `config`, `request`, `data`, `detail`, `query`, `params`.
- The tool input, the tool result, and anything reachable from `services`.

Deliberately left silent: `nativeYoloCanAutoAllow` (`gateway.ts:747-749`) and
`realpathWriteTarget` (`gateway.ts:760,768`). A throw there _is_ the answer (fail closed to the
confirm path), and the inputs are private filesystem paths — logging them would put user paths
in the log to describe a correct, non-exceptional outcome.

### Fix 2 — the sibling catches

Same helper, same allowlist, one line each:

- `gateway.ts:370-372` → `error` level, `event: "assistant_read_tool_failed"`. Highest value
  after `runHandler`: this path has no audit row at all, so today it is 100% invisible.
- `gateway.ts:501-503` → `warn`, `event: "action_preview_failed"` (+ `toolName`). The card
  still degrades to summary-only; the reason stops being a mystery.
- `gateway.ts:584-586` → `warn`, `event: "agency_pref_read_failed"`.
- `gateway.ts:665-675` → keep the existing envelope, add `errorName`/`errorCode`/`stackFrames`.
  A dropped audit write is a compliance-grade event that currently reports no cause.
- `gateway.ts:232-238` → `warn`, `event: "yolo_mode_lookup_failed"`. Behavior (deny) unchanged.

Extract the allowlist projection once — `packages/ai/src/gateway/error-fields.ts`, exporting
`describeError(error: unknown): Record<string, unknown>` — so there is exactly one place where
the "may be logged" decision lives and exactly one place to test it.

### Fix 3 — a real failure channel for external modules (protocol, contract v1, additive)

Today a module can only signal failure by throwing, and a throw is flattened to a bare
`handler_failed` with no class (`packages/module-sdk/src/worker.ts:176-182` →
`worker-runtime.ts:211`). Give modules a typed, non-throwing way to report failure and carry a
class through to the audit row.

**Carrier type — `@jarv1s/module-sdk`** (owned there because both `@jarv1s/ai` and
`@jarv1s/module-registry` already import the SDK — `gateway.ts:5-13`, `worker-runtime.ts:4` —
so neither has to import the other, and module isolation holds):

```ts
// packages/module-sdk/src/tool-failure.ts
export interface ToolFailure {
  readonly errorClass: string; // /^[a-z][a-z0-9_]{0,39}$/
  readonly userMessage?: string; // ≤200 chars, no control characters
}

/** Thrown inside a module handler; normalized by defineModuleWorker. */
export class ModuleToolFailure extends Error {
  readonly toolFailure: ToolFailure;
  constructor(errorClass: string, userMessage?: string) {
    super(`module tool failure: ${errorClass}`);
    this.name = "ModuleToolFailure";
    // Built conditionally, not `{ errorClass, userMessage }` — exactOptionalPropertyTypes
    // rejects an explicit `undefined` for an optional property.
    this.toolFailure = userMessage === undefined ? { errorClass } : { errorClass, userMessage };
  }
}

/** Non-throwing form: `return toolFailure("critique_unavailable", "…")` from a handler. */
export function toolFailure(errorClass: string, userMessage?: string): Record<string, unknown> {
  return {
    __jarvisToolFailure: userMessage === undefined ? { errorClass } : { errorClass, userMessage }
  };
}

/** Host-side guard: does this rejection carry a module-declared failure? */
export function isToolFailure(value: unknown): value is { readonly toolFailure: ToolFailure } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = (value as { toolFailure?: unknown }).toolFailure;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { errorClass?: unknown }).errorClass === "string"
  );
}
```

One name for the concept end to end: the wire key is `__jarvisToolFailure`, the validated
payload is `ToolFailure`, and it travels host-side as a `toolFailure` property on the thrown
error. No parallel `moduleErrorClass`/`moduleUserMessage` spelling anywhere.

**Module side** — `defineModuleWorker` (`packages/module-sdk/src/worker.ts:157-183`) accepts
either form and normalizes both:

- `throw new ModuleToolFailure("critique_unavailable", "I couldn't review the résumé right now.")`
- `return toolFailure("critique_unavailable", "…")` → the reserved result shape
  `{ __jarvisToolFailure: { errorClass, userMessage } }` (namespaced so it cannot collide with
  a module's own data keys).

Both become one JSON-RPC error:
`{ error: { code: -32000, message: "handler_failed", data: { errorClass, userMessage } } }`.
Any other throw keeps today's exact behavior (`error.data` absent).

**Host side** — `worker-runtime.ts:208-214`. This is the trust boundary: worker JSON is
untrusted input. Validate `error.data` against the charset/length rules above and **drop any
field that fails** (never truncate-and-keep a class, never accept extra keys). Reject with
`ExternalModuleWorkerError("handler_failed")`, whose constructor (`worker-runtime.ts:36`) gains
an optional second parameter carrying the validated payload:

```ts
export class ExternalModuleWorkerError extends Error {
  constructor(
    readonly code: "protocol" | "timeout" | "crash" | "handler_failed",
    readonly toolFailure?: ToolFailure
  ) {
    super(`External module worker ${code}`);
    this.name = "ExternalModuleWorkerError";
  }
}
```

Optional and last, so all ten existing single-argument constructions
(`worker-runtime.ts:75,89,111,119,149,152,160,178,185,211,213`) keep compiling untouched.
Everything downstream — `external-module-tools.ts:78-86`, `tool-manifests.ts:43` — already
propagates rejections, so no change there.

Why the worker boundary and not `externalToolResult()`
(`external-module-tools.ts:134-143`): that function is composition-layer glue that has already
lost the distinction between "result" and "error"; the protocol decision belongs where the
protocol is parsed, next to the version check and the secret scan.

### Fix 4 — the gateway maps a declared failure to `ok: false`

`packages/ai/src/gateway/types.ts:62`: extend the error variant to
`{ ok: false; error: string; failureClass?: string }`.

`runHandler`'s catch (`gateway.ts:456`): if `isToolFailure(error)`, return `ok: false` with
`error` set to `error.toolFailure.userMessage` (falling back to today's `Tool <name> failed`)
and `failureClass` set to `error.toolFailure.errorClass`.
The `userMessage` is module-authored text intended for the user — the same trust class as the
module's normal tool output, which already reaches the model — so passing it through opens no
new leak path and preserves today's UX (the model can still say _why_). It is **not** logged
and **not** persisted; only `failureClass` is.

Audit call sites `gateway.ts:175`, `:196`, `:550` each replace their inline
`errorClass: result.ok ? null : "handler_error"` with one shared helper:

```ts
/**
 * Audit classification for a runHandler result. The nullish check is on the FIELD, not the
 * interpolation: a template literal is never null, so `\`module:${x}\` ?? "handler_error"`
 * would write the literal `module:undefined` for every ordinary (non-declared) throw and
 * destroy the handler_error classification #1234 was diagnosed with.
 *
 * Never receives the `denied` variant — a denial is audited at gateway.ts:525-529 with no
 * errorClass at all — but the `in` check keeps this total over the union.
 */
function auditErrorClass(result: GatewayToolResponse): string | null {
  if (result.ok) return null;
  const failureClass = "failureClass" in result ? result.failureClass : undefined;
  return failureClass ? `module:${failureClass}` : "handler_error";
}
```

The prefix does two things: an operator can tell a module-declared class from a
host-classified one, and a module can never impersonate a host class. Bound: `module:` + 40
chars = 47 ≤ the
`length(error_class) <= 64` CHECK at `packages/ai/sql/0127_jarvis_action_audit_log.sql:11`.

**No migration.** `outcome` stays the existing enum — `failed` is already the right value
(`0127_jarvis_action_audit_log.sql:10`, `packages/ai/src/repository.ts:206`), and `error_class`
is unconstrained free text within the length cap. Nothing is added to
`tests/integration/foundation.test.ts`'s migration list.

Note `error_class` is exported to the user in their data export
(`packages/settings/src/data-export-queries.ts:297`) — a second reason the charset rule exists
and a module message never becomes a class.

The live drawer fixes itself: `gateway.ts:165`, `:187`, `:542` already read
`result.ok ? "executed" : "error"`, so a declared failure stops rendering as a green execute.

### Fix 5 — adopt the channel in the two modules that already fake success

Without this, #1252 is closed in the host and still open in the code we ship.

- `external-modules/job-search/src/worker/wrap.ts:11-16` → `throw`/return `ModuleToolFailure`
  instead of `{ status: "error", … }`, preserving today's `code` as `errorClass` and today's
  message as `userMessage`.
- `external-modules/job-search/src/worker/handlers/resume.ts:86-92,137-142` → same.
- `external-modules/finance/src/worker/wrap.ts:24-33`,
  `finance/src/worker/handlers/sync.ts:288,293` → same. The comment at `finance/wrap.ts:18-19`
  ("error code only, never response bodies") already states the discipline this channel makes
  structural.

**Backward compatibility.** `MODULE_WORKER_CONTRACT_VERSION` stays `1`
(`packages/module-sdk/src/index.ts:619`) and manifests keep declaring `workerContractVersion: 1`.
Both checks are exact-equality — `worker-runtime.ts:177` (`version !== …` → protocol failure,
worker dead) and `packages/module-registry/src/external/validate.ts:416` (`!== 1` → manifest
rejected) — so a bump would disable every installed module the moment the host image rolls,
for no gain: the channel needs no negotiation. An old worker never emits `error.data`, the host
sees `undefined`, and the result is byte-identical to today (`handler_error`). New SDK output
runs unchanged on an old host too (the extra `data` key is ignored by
`worker-runtime.ts:211`), so module and host can be deployed in either order.

The closest precedent is on `build/js-03-perms` itself: `surfacesResultToUi` ships as an
additive optional field on the assistant-tool declaration — validated at
`external/validate.ts:374-375`, copied at `external/tool-manifests.ts:81`, declared at
`module-sdk/src/index.ts:364` and `:556` — with **no** `schemaVersion` or `CORE_VERSION` bump.
Same shape as this change: optional, ignored when absent, no negotiation needed.

A module that has not adopted the channel and still returns `{ status: "error" }` **continues
to audit as success**. That is accepted and must be stated in the module-authoring docs.

**Rejected alternative — host sniffs `status: "error"` in the result.** A module's `data`
object is module-owned namespace; a legitimate tool can return a row whose `status` field is
the string `"error"` (a sync report, a health check). Inferring host control flow from module
data breaks module isolation, would manufacture false failures, and is exactly the guessing
game the explicit channel exists to end. Steelmanned: it would retrofit every unadopted module
for free and needs no protocol change — which is real value, and why it is tempting. It is
still wrong, because a wrong `failed` corrupts the same log a wrong `success` does, and the
audit log's whole claim is that it does not guess.

**Queue-handler side effect.** `apps/worker/src/external-module-job-handler.ts:88` invokes the
same runtime, so a declared failure inside a queue handler now rejects and pg-boss marks the
job failed and retries per the queue's `retryLimit`. Today it resolves and the job is recorded
complete. This is the correct behavior, but it is a behavior change for adopters: module
authors must use the channel only for work that genuinely failed. Call it out in the SDK doc
comment.

## Testing

Unit:

- `tests/unit/mcp-gateway-units.test.ts` — new `describe("handler failure visibility (#1251)")`:
  a throwing tool emits exactly one `assistant_tool_handler_failed` line carrying
  `toolName`/`requestId`/`errorName`/`errorCode`; the returned envelope is still exactly
  `{ ok: false, error: "Tool <name> failed" }`; a non-`Error` throw (`throw "boom"`) still
  logs, with `errorName: "string"` and no stack.
- `tests/unit/mcp-gateway-units.test.ts`, same block — **classification regression guard**: a
  write tool that throws an ordinary `Error` (no declared failure) records
  `errorClass === "handler_error"` **exactly** on the stubbed `insertActionAuditLog` call —
  not `module:undefined`, not `null`. This is the classification the #1234 diagnosis ran on,
  and the one an inline `?? ` fallback would silently destroy. Sibling case: a declared
  failure records `module:<class>`.
- `tests/unit/gateway-failure-log-redaction.test.ts` (new) — the invariant test. Throw an
  `Error` whose message and `stack` line 1 contain `sk-live-SENTINEL` and whose `cause`,
  `response.body`, and `config.headers` also contain it; assert the serialized log object
  contains no occurrence of the sentinel, and that `stackFrames` still contains `at`. Same
  case for a `ToolFailure` whose `userMessage` holds the sentinel (must reach the model, must
  not reach the log).
- `tests/unit/gateway-read-tool.test.ts` — extend "sanitizes handler throws (never leaks
  internals)" (`:101`) to also assert the injected logger received the failure.
- `tests/unit/external-worker-runtime.test.ts` — worker declares a failure → `invoke` rejects
  with an `ExternalModuleWorkerError` whose `toolFailure` holds the class and message;
  malformed `data` (41-char class, `Bad-Class!`, object `userMessage`, extra keys) → those
  fields dropped (`toolFailure` undefined or message-less), still rejects with code
  `handler_failed`; worker with no `data` → `toolFailure === undefined` (the old-module case,
  behavior identical to today).
- `tests/unit/module-sdk-worker.test.ts` — `defineModuleWorker` normalizes both the thrown
  `ModuleToolFailure` and the returned `toolFailure(...)` shape to the same JSON-RPC error; an
  ordinary throw still produces bare `handler_failed`; a handler returning a legitimate
  `{ status: "error" }` payload is **not** treated as a failure (isolation guard).
- `tests/unit/external-module-job-search-worker.test.ts` — `wrap()` now surfaces `InputError` /
  `JobSearchKvError` as declared failures, class preserved.

Integration:

- `tests/integration/external-module-gateway.test.ts` — sibling to the existing case at `:33`:
  an external write tool that declares a failure produces an audit row with
  `outcome = 'failed'` and `error_class = 'module:<class>'`, and the notifier record's outcome
  is `"error"`.
- `tests/integration/external-module-job-search.test.ts` — `resume.critique` with a failing
  `ai` port audits `failed` (direct regression test for the #1234 miss).

Gate: `pnpm verify:foundation` (fresh gate DB), exit code recorded.

## Non-goals

- Changing what the **model** sees on a throw. The sanitized `Tool <name> failed` stays.
- Any new `outcome` value, migration, or audit-schema change.
- A log-shipping, retention, or alerting story for the new lines.
- Retrofitting unadopted modules by sniffing their result payloads (rejected above).
- Reworking the invocation timeout (`worker-runtime.ts:88-92`). The stall-budget fix lives on a
  build branch and is not on `origin/main` at `fd524022`; it is separate work. This spec only
  makes such a timeout visible when it fires.
- Persisting a failure reason anywhere new (no `error_message` column, no new error row). The
  audit log gets a class; the operator log gets the diagnosis.
- Reporting failures for `risk: "read"` tools in the audit log — reads write no audit row at
  all (`gateway.ts:182`), and changing that is an audit-volume decision of its own.

## Open questions for Ben

1. **Is a stripped stack enough, or do you want the message?** Recommendation: **stripped stack
   only**, as specced. `errorName` + `errorCode` + frames diagnosed the #1234 case completely,
   and `message` is the one field that provably carries user data and credentials. If a real
   case later needs it, the narrow follow-up is an allowlist of host-owned error classes whose
   messages are known constants — not a global cap-and-log.
2. **Prefix module-declared classes with `module:`?** Recommendation: **yes**. It costs 7
   characters of a 64-char column and makes "a module said this" un-spoofable in the log.
3. **Should the failure carrier include `retryable`, for queue handlers?** Recommendation:
   **defer**. `retryLimit` is already declared per queue
   (`ExternalModuleQueueDeclaration`, `packages/module-sdk/src/index.ts`), and adding a
   second, module-controlled retry lever before anyone has asked for it is protocol surface we
   would have to keep forever.
4. **Ship Fix 5 (job-search + finance adoption) in the same PR, or split?** Recommendation:
   **same PR**. Host-only leaves both shipped modules still auditing failures as success, so
   #1252 would not actually be closed by its own fix.
