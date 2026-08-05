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
  *dependencies of* `registerWorkers`, never constructed inside `packages/module-registry`, which has
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
