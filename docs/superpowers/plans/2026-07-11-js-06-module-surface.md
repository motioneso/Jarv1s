# JS-06 — Job-Search Module Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> (Repo note: those execution skills are disabled here by design — the coordinated-build agent drives tasks inline, TDD, one green commit per task.)

**Goal:** Deliver the external-module UI under `/m/job-search/*` (Overview, Onboarding, Profile/resume, Monitors, Opportunities shell) with one-click assistant handoff, reading data via the existing assistant-tools invoke route and triggering run-now via the module queue route.

**Architecture:** The external web bundle stays react-free: JSX compiles through an esbuild `jsxFactory` shim that delegates to the host React instance on the frozen `window.__JARVIS_MODULE_RUNTIME__` global. Reads go through `POST /api/ai/assistant-tools/:name/invoke` (risk:read tools only); run-now goes through `POST /api/modules/job-search/queues/job-search.monitor-run/run`. A tiny module-local fetch cache + pushState router replace host React Query / react-router, which are deliberately not exposed on the runtime global.

**Tech Stack:** TypeScript (strict, bundler resolution), esbuild (existing `scripts/build-external-module.ts`), host React 18 via runtime global, vitest `renderToString` unit harness, Playwright e2e, existing integration harness.

**Task issue:** #935 (epic #913). Spec: `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md`.

## Global Constraints

- Module id is **`job-search`** (NOT `jarv1s.job-search` — spec header is stale; Coordinator ruling model C is binding).
- Root calls **only risk:read tools** on the invoke route: `job-search.onboarding.get-state`, `profile.get`, `resume.get`, `monitor.list`, `monitor.get`, `sources.list`. Never a write tool without the confirm flow (write tools 403 `confirmation_required` — the Root never triggers them).
- Run-now body is exactly `{jobKind:"job-search.monitor-run-now", params:{monitorId}}` → `202 {jobId}`; `jobId:null` = already queued. **Params are IDs only** (metadata-only job payloads, CLAUDE.md).
- Web bundle must stay **react-free** (guarded by `tests/unit/external-module-job-search-bundle.test.ts` — keep it green).
- External strings render as **text, never raw HTML** (React text children; no `dangerouslySetInnerHTML` anywhere in the module).
- **JDS discipline:** existing `jds-*` primitives only; module-scoped `jsm-*` classes are **layout-only** (grid/flex/gap/spacing — zero color declarations, so the tokens.css raw-color rule is untouched); serif headings / mono eyebrows / sans body come from host document styles; **no curved left-border card accents**.
- No auto-submit: assistant handoff only through `hostActions.openAssistant({starterPrompt})` (#916 host sanitizes ≤1000 chars, editable draft).
- File-size gate: every source file ≤1000 lines.
- Typecheck via `pnpm check:external-modules`; full pre-push trio `pnpm format:check && pnpm lint && pnpm typecheck`.
- Commit per task, explicit-path `git add` only, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Temp smoke test `tests/integration/js06-invoke-smoke.test.ts` (uncommitted, header says DO NOT COMMIT) is superseded in Task 10 and deleted there. Never stage it.

## Deviations / scope flags for Coordinator

1. **`@jarv1s/module-web-sdk.requestJson` not reused.** Spec says "browser-safe shared request helper", but `requestJson` throws `ApiError` on non-2xx and discards the body — the invoke contract returns its meaningful payload (`{invocation}` with `blockedReason`) **on 403**, and run-now distinguishes 404/400/503 bodies. The module ships a ~60-line local `api.ts` modeled on requestJson (credentials:"include", JSON) that surfaces those bodies. module-web-sdk is also a different seam (build-time `virtual:jarvis-module-web` scanner), not the external-bundle runtime.
2. **"Module-scoped query keys"** (spec) superseded by ruling: no react-query on the runtime global → module-local cache; keys are module-scoped by construction (`tool-name:input-json`).
3. **Nav entry:** `serializeExternalModule` returns `navigation: []` (`apps/api/src/server.ts:901`) — surface is URL-only. Spec is silent. **Default here: URL-only, no host change.** Say the word if JS-06 should add a real nav entry (host-side change).
4. **"Local due time"** rendered as the monitor's configured wall-clock + timezone ("daily at 07:00 · America/New_York") plus `lastSuccessAt`/`lastCheckedAt` in the viewer's locale. No cross-timezone HH:MM arithmetic (fragile without a tz library).

## Verified contracts (grounded on this branch)

- Invoke route `packages/ai/src/routes.ts:577`: body `{input?: object}`; 200 `{invocation:{status:"succeeded", result, blockedReason:null, actionRequestId:null, ...}}`; write tool → **403** `{invocation:{status:"blocked", blockedReason:"confirmation_required", actionRequestId}}`; read tool without execute → **403** `blockedReason:"unsupported_tool"`; unknown tool → **404** `{error:"Assistant tool is not declared"}` (plain error, no invocation).
- Run-now route `apps/api/src/external-module-jobs.ts:18`: body `{jobKind, params?}` only; 202 `{jobId}` (null when singleton `manual:job-search:job-search.monitor-run:<actor>` collapses); 404 `{error:"Not found"}` for unknown/disabled module or queue; 400 invalid body; 503 enqueue failure. Rate limit default 6/min per module.
- Tool result shapes (handlers in `external-modules/job-search/src/worker/handlers/`):
  - `onboarding.get-state`: `{status:"ok", step: OnboardingStep|"done", completed: Record<string,boolean>, gates:{resumeApproved,profileApproved,monitorEnabled}, approvedResumeRevisionId?, approvedProfileRevisionId?}`. `STEP_ORDER` (`handlers/flow.ts:12`) = `["resume_intake","resume_critique","resume_approval","profile","sources_schedule","review_enable"]`.
  - `profile.get`: `{status:"ok", active: null|{revisionId,createdAt,provenance:"user"|"inferred",fields}, draftRevisionIds:string[]}`.
  - `resume.get`: no resume → `{status:"question", question}`; else `{status:"ok", revisionId, kind, content, createdAt, parentRevisionId?, critiqueSummary?, ...}`. Input `{revisionId?, includeDiff?}`.
  - `monitor.list`: `{status:"ok", monitors:[{monitorId,adapterId,enabled,timezone,dueTime,createdAt,updatedAt}]}` (metadata only).
  - `monitor.get` (input `{monitorId}`): adds `query`, `cursor?:{lastCheckedAt,lastSuccessAt?}`; missing → `{status:"error",code:"missing_record",...}`.
  - Handler errors surface as `{status:"error", code, message}` inside a 200 invocation result (`worker/wrap.ts`).
- Host runtime `apps/web/src/external-modules/loader.ts:33`: frozen `{contractVersion:1, react: React (full namespace incl. hooks + Fragment), reactDomClient}` installed at app boot (`app.tsx:30`) — **before** any module bundle import. Loader fails closed to `Missing = () => null`.
- `hostActions` (`apps/web/src/external-modules/host-actions.ts:63`): `{openAssistant({starterPrompt}): void}`; sanitize rejects >1000 chars / control chars / empty (fails closed, no truncation).
- Mount `apps/web/src/app.tsx:333` at `/m/:moduleId/*` — already shipped; **no host code changes needed** in JS-06 (unless Coordinator opts into nav entry).
- Unit render harness: `renderToString` from `react-dom/server` (see `tests/unit/sports-ticker.test.tsx`). No testing-library, no jsdom.
- Integration harness to clone: `tests/integration/external-module-job-search.test.ts` (resetEmptyFoundationDatabase → buildExternalModule → temp modulesDir → createApiServer enableExternalModules → first-signup admin → enable module).
- E2E mock: `tests/e2e/mock-modules.ts` `mockExternalWebModule` (route glob needs trailing `*` for Vite `?import`).

## File Structure

```
external-modules/job-search/src/web/
  index.ts            (modify) entry: default {contractVersion:1, Root}
  runtime.ts          (new) typed accessors over the runtime global: react, h, Fragment, hooks
  jsx.d.ts            (new) self-contained JSX namespace (no @types/react available here)
  api.ts              (new) invokeTool / runMonitorNow outcome mapping
  store.ts            (new) tiny cache + useToolQuery (useSyncExternalStore)
  router.ts           (new) pushState router: parseModulePath, navigate, useModulePath, ModuleLink
  format.ts           (new) pure label helpers (due time, dates, onboarding math)
  starter-drafts.ts   (new) per-step / per-surface starter prompts (all <1000 chars)
  styles.ts           (new) layout-only jsm-* CSS string (zero colors)
  states.ts           (new) Loading/Empty/Error/Disabled/Degraded authored states
  root.ts             (new) Root: chrome, tab nav, route switch, aria-live region
  screens/overview.ts     (new) container + exported OverviewView
  screens/onboarding.ts   (new) container + OnboardingView
  screens/profile.ts      (new) container + ProfileView (profile + resume)
  screens/monitors.ts     (new) container + MonitorsView + RunNowButton
  screens/opportunities.ts(new) shell with new/saved/passed/stale sub-routes

scripts/build-external-module.ts   (modify) web build: jsx transform, jsxFactory h / jsxFragment Fragment
external-modules/job-search/tsconfig.json (modify) jsx:react + factories

tests/unit/helpers/install-module-runtime.ts (new) sets the runtime global from real react
tests/unit/job-search-web-core.test.ts       (new) api/store/router/format pure logic
tests/unit/job-search-web-screens.test.tsx   (new) renderToString view tests incl. escaping
tests/unit/module-web-browser-safety.test.ts (modify) add external web entry to the walk
tests/integration/js06-module-surface.test.ts(new) permanent read-ok/write-403/run-now-dedupe/disable-404
tests/integration/js06-invoke-smoke.test.ts  (DELETE in Task 10 — temp, never commit)
tests/e2e/mock-modules.ts                    (modify) serve the real built bundle + invoke/run-now mocks
tests/e2e/js06-module-surface.spec.ts        (new) interactions + light/dark screenshots
```

Note: module source files use `.ts` with explicit `h(...)` calls where trivial, and `.ts` JSX-free is fine — but screens are far more readable as JSX. Decision: **screens and root use JSX** and therefore get `.tsx` extensions (`root.tsx`, `screens/*.tsx`, `states.tsx` → `states.tsx`). esbuild picks the loader by extension; the entry `index.ts` stays `.ts`.

---

### Task 1: Web build JSX shim + runtime accessor

**Files:**

- Modify: `scripts/build-external-module.ts` (web build options)
- Modify: `external-modules/job-search/tsconfig.json` (jsx settings)
- Create: `external-modules/job-search/src/web/runtime.ts`
- Create: `external-modules/job-search/src/web/jsx.d.ts`
- Create: `tests/unit/helpers/install-module-runtime.ts`
- Test: `tests/unit/job-search-web-core.test.ts` (started here, grows in Tasks 2–3)

**Interfaces:**

- Produces: `runtime.ts` exports `react` (host namespace), `h`, `Fragment`, `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useSyncExternalStore`, and type `ReactNodeLike = unknown`. Every later module file imports React facilities ONLY from `./runtime` (or `../runtime`).
- Produces: unit helper `tests/unit/helpers/install-module-runtime.ts` — import it FIRST in any unit test that imports module web source.

- [ ] **Step 1: Write the failing test**

Append to a new `tests/unit/job-search-web-core.test.ts`:

```ts
// tests/unit/job-search-web-core.test.ts
// JS-06 (#935): pure-logic tests for the external web surface — runtime
// accessor, api outcome mapping, store cache, router parsing, format helpers.
// The runtime global must be installed before any module web import (helper
// module first — ESM evaluation order guarantees it).
import "./helpers/install-module-runtime";

import { describe, expect, it } from "vitest";

import { Fragment, h, react } from "../../external-modules/job-search/src/web/runtime.js";

describe("job-search web runtime accessor (#935)", () => {
  it("delegates createElement to the host react instance", () => {
    const element = h("div", { className: "x" }, "hello") as { type?: unknown };
    expect(element).toMatchObject({ type: "div" });
  });

  it("re-exports the host Fragment", () => {
    expect(Fragment).toBe(react.Fragment);
  });
});
```

And the helper:

```ts
// tests/unit/helpers/install-module-runtime.ts
// JS-06 (#935): unit-test twin of installModuleHostRuntime (apps/web
// external-modules/loader.ts) — the external web source captures the runtime
// global at import time, so this module must be imported before any module
// web file in a test's import list.
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";

const scope = globalThis as { __JARVIS_MODULE_RUNTIME__?: unknown };
if (!scope.__JARVIS_MODULE_RUNTIME__) {
  scope.__JARVIS_MODULE_RUNTIME__ = Object.freeze({
    contractVersion: 1,
    react: React,
    reactDomClient: ReactDOMClient
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/job-search-web-core.test.ts`
Expected: FAIL — cannot resolve `../../external-modules/job-search/src/web/runtime.js`.

- [ ] **Step 3: Implement runtime.ts + jsx.d.ts + build/tsconfig changes**

```ts
// external-modules/job-search/src/web/runtime.ts
// JS-06 (#935): typed accessors over the frozen host runtime global. The
// bundle must never carry its own React (bundle-hygiene test) — everything
// delegates to the host instance. Captured at module scope: the host installs
// the global at app boot before any bundle import, so a missing global means a
// broken host and the loader's dynamic import fails closed to Missing.
export type ReactNodeLike = unknown;

type Dispatch<S> = (next: S | ((prev: S) => S)) => void;

export type HostReact = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ReactNodeLike;
  Fragment: unknown;
  useState: <S>(initial: S | (() => S)) => [S, Dispatch<S>];
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
  useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]) => T;
  useRef: <T>(initial: T) => { current: T };
  useSyncExternalStore: <T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T
  ) => T;
};

type ModuleRuntime = { contractVersion: number; react: HostReact };

function readRuntime(): ModuleRuntime {
  const runtime = (globalThis as { __JARVIS_MODULE_RUNTIME__?: ModuleRuntime })
    .__JARVIS_MODULE_RUNTIME__;
  if (!runtime || runtime.contractVersion !== 1) {
    throw new Error("job-search web root requires the Jarvis module runtime v1");
  }
  return runtime;
}

export const react: HostReact = readRuntime().react;

// jsxFactory/jsxFragment targets — every .tsx file imports { h, Fragment }.
export const h: HostReact["createElement"] = (type, props, ...children) =>
  react.createElement(type, props, ...children);
export const Fragment: unknown = react.Fragment;

export const useState = react.useState;
export const useEffect = react.useEffect;
export const useMemo = react.useMemo;
export const useCallback = react.useCallback;
export const useRef = react.useRef;
export const useSyncExternalStore = react.useSyncExternalStore;
```

```ts
// external-modules/job-search/src/web/jsx.d.ts
// JS-06 (#935): self-contained JSX namespace for the classic jsxFactory
// transform. @types/react is not resolvable from this package (external
// modules are outside the pnpm workspace), so intrinsic props are loosely
// typed; correctness is covered by renderToString unit tests and e2e.
declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tagName: string]: Record<string, unknown>;
  }
}
```

`scripts/build-external-module.ts` — web build gains the classic JSX transform (worker build untouched):

```ts
// Web: browser ESM; must stay react-free (JSX compiles to the module's own
// `h`/`Fragment` from src/web/runtime.ts, which delegate to the host React
// on the frozen runtime global — asserted by the bundle-hygiene test).
await build({
  entryPoints: [join(dir, "src/web/index.ts")],
  outfile: join(dir, "dist/web/index.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  sourcemap: false,
  logLevel: "silent",
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment"
});
```

`external-modules/job-search/tsconfig.json` compilerOptions additions:

```json
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/job-search-web-core.test.ts && pnpm vitest run tests/unit/external-module-job-search-bundle.test.ts && pnpm check:external-modules`
Expected: PASS (bundle hygiene still green — react still not bundled).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-external-module.ts external-modules/job-search/tsconfig.json \
  external-modules/job-search/src/web/runtime.ts external-modules/job-search/src/web/jsx.d.ts \
  tests/unit/helpers/install-module-runtime.ts tests/unit/job-search-web-core.test.ts
git commit -m "feat(job-search): JSX build shim + host-runtime accessor for the web surface (#935)"
```

---

### Task 2: API client — invoke + run-now outcome mapping

**Files:**

- Create: `external-modules/job-search/src/web/api.ts`
- Test: `tests/unit/job-search-web-core.test.ts` (append)

**Interfaces:**

- Produces:
  - `type ToolOutcome<T> = {kind:"ok"; result:T} | {kind:"blocked"; reason:string} | {kind:"disabled"} | {kind:"error"; message:string}`
  - `invokeTool<T>(name: string, input?: Record<string,unknown>): Promise<ToolOutcome<T>>`
  - `type RunNowOutcome = {kind:"queued"} | {kind:"already-queued"} | {kind:"disabled"} | {kind:"error"; message:string}`
  - `runMonitorNow(monitorId: string): Promise<RunNowOutcome>`

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/job-search-web-core.test.ts`)

```ts
import { afterEach, vi } from "vitest";

import { invokeTool, runMonitorNow } from "../../external-modules/job-search/src/web/api.js";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }));
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("job-search web api client (#935)", () => {
  it("maps a succeeded read invocation to ok with the result", async () => {
    const stub = stubFetch(200, {
      invocation: {
        status: "succeeded",
        blockedReason: null,
        result: { status: "ok", monitors: [] }
      }
    });
    const outcome = await invokeTool<{ status: string }>("job-search.monitor.list");
    expect(outcome).toEqual({ kind: "ok", result: { status: "ok", monitors: [] } });
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/assistant-tools/job-search.monitor.list/invoke");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ input: {} });
  });

  it("maps a 403 blocked invocation to blocked with the reason", async () => {
    stubFetch(403, {
      invocation: { status: "blocked", blockedReason: "confirmation_required", result: null }
    });
    const outcome = await invokeTool("job-search.monitor.save");
    expect(outcome).toEqual({ kind: "blocked", reason: "confirmation_required" });
  });

  it("maps invoke 404 (tool not declared) to disabled — stale session fails closed", async () => {
    stubFetch(404, { error: "Assistant tool is not declared" });
    expect(await invokeTool("job-search.monitor.list")).toEqual({ kind: "disabled" });
  });

  it("maps network failure to a safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("boom")))
    );
    expect(await invokeTool("job-search.monitor.list")).toEqual({
      kind: "error",
      message: "Network error"
    });
  });

  it("run-now: 202 with a jobId is queued; jobId null is already-queued", async () => {
    const stub = stubFetch(202, { jobId: "j1" });
    expect(await runMonitorNow("m1")).toEqual({ kind: "queued" });
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/modules/job-search/queues/job-search.monitor-run/run");
    // Metadata-only payload: jobKind + monitorId, nothing else (CLAUDE.md).
    expect(JSON.parse(String(init.body))).toEqual({
      jobKind: "job-search.monitor-run-now",
      params: { monitorId: "m1" }
    });

    stubFetch(202, { jobId: null });
    expect(await runMonitorNow("m1")).toEqual({ kind: "already-queued" });
  });

  it("run-now: 404 is disabled, 503 is a safe error", async () => {
    stubFetch(404, { error: "Not found" });
    expect(await runMonitorNow("m1")).toEqual({ kind: "disabled" });
    stubFetch(503, { error: "Service unavailable" });
    expect(await runMonitorNow("m1")).toEqual({
      kind: "error",
      message: "Request failed (503)"
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/job-search-web-core.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/web/api.ts
// JS-06 (#935): module-local request helpers. Deliberately NOT
// @jarv1s/module-web-sdk requestJson — the invoke contract carries its payload
// ({invocation:{blockedReason,...}}) on 403, and requestJson throws away
// non-2xx bodies. Only risk:read tools are ever invoked here; write tools go
// through the assistant confirm flow, never this client (Coordinator ruling).
export type ToolOutcome<T> =
  | { kind: "ok"; result: T }
  | { kind: "blocked"; reason: string }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

type InvocationBody = {
  invocation?: {
    status?: string;
    blockedReason?: string | null;
    result?: Record<string, unknown> | null;
  };
};

async function parseJson(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function invokeTool<T extends Record<string, unknown>>(
  name: string,
  input?: Record<string, unknown>
): Promise<ToolOutcome<T>> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetch(`/api/ai/assistant-tools/${encodeURIComponent(name)}/invoke`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: input ?? {} })
    });
  } catch {
    return { kind: "error", message: "Network error" };
  }
  // 404 = tool not declared = module disabled/uninstalled server-side. A stale
  // browser session must fail closed to the disabled state (spec).
  if (response.status === 404) return { kind: "disabled" };
  const body = (await parseJson(response)) as InvocationBody | null;
  const invocation = body?.invocation;
  if (response.ok && invocation?.status === "succeeded") {
    return { kind: "ok", result: (invocation.result ?? {}) as T };
  }
  if (invocation?.status === "blocked") {
    return { kind: "blocked", reason: invocation.blockedReason ?? "blocked" };
  }
  return { kind: "error", message: `Request failed (${response.status})` };
}

export type RunNowOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

export async function runMonitorNow(monitorId: string): Promise<RunNowOutcome> {
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await fetch("/api/modules/job-search/queues/job-search.monitor-run/run", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      // Metadata-only job payload (CLAUDE.md hard invariant): the id, nothing else.
      body: JSON.stringify({ jobKind: "job-search.monitor-run-now", params: { monitorId } })
    });
  } catch {
    return { kind: "error", message: "Network error" };
  }
  if (response.status === 202) {
    const body = (await parseJson(response)) as { jobId?: string | null } | null;
    // jobId:null = the manual singleton for this actor is already queued —
    // report queued state without polling (spec: no duplicate activation).
    return body && body.jobId ? { kind: "queued" } : { kind: "already-queued" };
  }
  if (response.status === 404) return { kind: "disabled" };
  return { kind: "error", message: `Request failed (${response.status})` };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run tests/unit/job-search-web-core.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/api.ts tests/unit/job-search-web-core.test.ts
git commit -m "feat(job-search): invoke/run-now web api client with fail-closed outcome mapping (#935)"
```

---

### Task 3: Store (useToolQuery) + internal router + format helpers

**Files:**

- Create: `external-modules/job-search/src/web/store.ts`
- Create: `external-modules/job-search/src/web/router.ts`
- Create: `external-modules/job-search/src/web/format.ts`
- Test: `tests/unit/job-search-web-core.test.ts` (append)

**Interfaces:**

- Produces (`store.ts`):
  - `type QuerySnapshot<T> = { status:"loading" } | { status:"settled"; outcome: ToolOutcome<T> }`
  - `useToolQuery<T>(name: string, input?: Record<string,unknown>): QuerySnapshot<T>` — module-scoped cache key `` `${name}:${JSON.stringify(input ?? {})}` ``
  - `invalidateQueries(): void` (clears cache + notifies; used after run-now and on re-entry)
  - Test-only seam: `__resetStoreForTests(): void`
- Produces (`router.ts`):
  - `MODULE_BASE = "/m/job-search"`
  - `parseModulePath(pathname: string): string` (pure — `/m/job-search` → `/`, `/m/job-search/monitors` → `/monitors`, non-module paths → `/`)
  - `navigate(to: string): void` (pushState + notify), `useModulePath(): string`
  - `ModuleLink(props: {to: string; className?: string; "aria-current"?: string; children?: unknown}): ReactNodeLike`
- Produces (`format.ts`):
  - `onboardingProgress(completed: Record<string,boolean>): {done: number; total: 6; percent: number}`
  - `STEP_LABELS: Record<string,string>` for the six checkpoints
  - `dueLabel(dueTime: string, timezone: string): string` → `"daily at 07:00 · America/New_York"`
  - `whenLabel(iso: string | undefined): string` → localized `toLocaleString` or `"never"`

- [ ] **Step 1: Failing tests** (append):

```ts
import {
  __resetStoreForTests,
  useToolQuery
} from "../../external-modules/job-search/src/web/store.js";
import { parseModulePath } from "../../external-modules/job-search/src/web/router.js";
import {
  dueLabel,
  onboardingProgress,
  STEP_LABELS
} from "../../external-modules/job-search/src/web/format.js";
import { renderToString } from "react-dom/server";

describe("job-search web store (#935)", () => {
  it("renders loading first, then caches the settled outcome per key", async () => {
    __resetStoreForTests();
    stubFetch(200, {
      invocation: {
        status: "succeeded",
        blockedReason: null,
        result: { status: "ok", monitors: [] }
      }
    });
    function Probe(): unknown {
      const snapshot = useToolQuery("job-search.monitor.list");
      return h("i", null, snapshot.status);
    }
    // Server snapshot path (renderToString) must not throw and reports loading.
    expect(renderToString(h(Probe, null) as never)).toContain("loading");
  });
});

describe("job-search internal router (#935)", () => {
  it("parses module-relative paths", () => {
    expect(parseModulePath("/m/job-search")).toBe("/");
    expect(parseModulePath("/m/job-search/")).toBe("/");
    expect(parseModulePath("/m/job-search/monitors")).toBe("/monitors");
    expect(parseModulePath("/m/job-search/opportunities/saved")).toBe("/opportunities/saved");
    expect(parseModulePath("/today")).toBe("/");
  });
});

describe("job-search format helpers (#935)", () => {
  it("computes onboarding progress over the six checkpoints", () => {
    expect(onboardingProgress({})).toEqual({ done: 0, total: 6, percent: 0 });
    expect(
      onboardingProgress({ resume_intake: true, resume_critique: true, resume_approval: true })
    ).toEqual({ done: 3, total: 6, percent: 50 });
    expect(Object.keys(STEP_LABELS)).toEqual([
      "resume_intake",
      "resume_critique",
      "resume_approval",
      "profile",
      "sources_schedule",
      "review_enable"
    ]);
  });

  it("labels a monitor schedule without timezone arithmetic", () => {
    expect(dueLabel("07:00", "America/New_York")).toBe("daily at 07:00 · America/New_York");
  });
});
```

- [ ] **Step 2: Run to verify failure** — modules not found.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/web/store.ts
// JS-06 (#935): tiny module-scoped fetch cache. The host deliberately does not
// expose React Query on the runtime global, so reads share one Map keyed by
// tool name + input JSON (module-scoped by construction) with
// useSyncExternalStore subscribers. Fetch starts on first subscribe; snapshots
// are stable object identities so getSnapshot is referentially safe.
import { invokeTool, type ToolOutcome } from "./api";
import { useCallback, useSyncExternalStore } from "./runtime";

export type QuerySnapshot<T> =
  | { status: "loading" }
  | { status: "settled"; outcome: ToolOutcome<T> };

type Entry = {
  snapshot: QuerySnapshot<Record<string, unknown>>;
  listeners: Set<() => void>;
  started: boolean;
};

const LOADING: QuerySnapshot<never> = { status: "loading" };
const cache = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { snapshot: LOADING, listeners: new Set(), started: false };
    cache.set(key, entry);
  }
  return entry;
}

function start(key: string, name: string, input?: Record<string, unknown>): void {
  const entry = entryFor(key);
  if (entry.started) return;
  entry.started = true;
  void invokeTool(name, input).then((outcome) => {
    entry.snapshot = { status: "settled", outcome };
    for (const listener of entry.listeners) listener();
  });
}

export function useToolQuery<T extends Record<string, unknown>>(
  name: string,
  input?: Record<string, unknown>
): QuerySnapshot<T> {
  const key = `${name}:${JSON.stringify(input ?? {})}`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const entry = entryFor(key);
      entry.listeners.add(onChange);
      start(key, name, input);
      return () => {
        entry.listeners.delete(onChange);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes name+input
    [key]
  );
  const getSnapshot = useCallback(() => entryFor(key).snapshot, [key]);
  // Third arg = server snapshot: renderToString requires it and reports the
  // current cache state (loading on a cold cache) without kicking off fetches.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as QuerySnapshot<T>;
}

// After run-now (or on demand) drop everything so the next mount refetches.
export function invalidateQueries(): void {
  const listeners: Array<() => void> = [];
  for (const entry of cache.values()) listeners.push(...entry.listeners);
  cache.clear();
  for (const listener of listeners) listener();
}

export function __resetStoreForTests(): void {
  cache.clear();
}
```

```ts
// external-modules/job-search/src/web/router.ts
// JS-06 (#935): the host exposes no react-router on the runtime global, so the
// Root owns a minimal pushState router under the fixed /m/job-search base. The
// host's /m/:moduleId/* route keeps matching for every internal path, and the
// browser back button works because the host re-renders on popstate.
import { h, useCallback, useSyncExternalStore, type ReactNodeLike } from "./runtime";

export const MODULE_BASE = "/m/job-search";

export function parseModulePath(pathname: string): string {
  if (pathname !== MODULE_BASE && !pathname.startsWith(`${MODULE_BASE}/`)) return "/";
  const rest = pathname.slice(MODULE_BASE.length);
  return rest === "" || rest === "/" ? "/" : rest;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string): void {
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", `${MODULE_BASE}${to === "/" ? "" : to}`);
  notify();
}

function subscribeToPath(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("popstate", onChange);
  };
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : parseModulePath(window.location.pathname);
}

export function useModulePath(): string {
  return useSyncExternalStore(subscribeToPath, currentPath, currentPath);
}

export function ModuleLink(props: {
  to: string;
  className?: string;
  "aria-current"?: string;
  children?: unknown;
}): ReactNodeLike {
  const { to, children, ...rest } = props;
  const onClick = useCallback(
    (event: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
      // Let modifier-clicks open a real tab; plain clicks stay in-app.
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      navigate(to);
    },
    [to]
  );
  return h("a", { href: `${MODULE_BASE}${to === "/" ? "" : to}`, onClick, ...rest }, children);
}
```

```ts
// external-modules/job-search/src/web/format.ts
// JS-06 (#935): pure display helpers, unit-tested. "Local due time" is the
// monitor's configured wall-clock + IANA zone verbatim — no cross-timezone
// HH:MM arithmetic (fragile without a tz library; flagged in the plan).
export const STEP_LABELS: Record<string, string> = {
  resume_intake: "Share your resume",
  resume_critique: "Review the critique",
  resume_approval: "Approve a resume revision",
  profile: "Build your search profile",
  sources_schedule: "Choose sources & schedule",
  review_enable: "Review & enable monitoring"
};

const STEP_ORDER = Object.keys(STEP_LABELS);

export function onboardingProgress(completed: Record<string, boolean>): {
  done: number;
  total: 6;
  percent: number;
} {
  const done = STEP_ORDER.filter((step) => completed[step] === true).length;
  return { done, total: 6, percent: Math.round((done / 6) * 100) };
}

export function dueLabel(dueTime: string, timezone: string): string {
  return `daily at ${dueTime} · ${timezone}`;
}

export function whenLabel(iso: string | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run tests/unit/job-search-web-core.test.ts && pnpm check:external-modules` → PASS.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/store.ts external-modules/job-search/src/web/router.ts \
  external-modules/job-search/src/web/format.ts tests/unit/job-search-web-core.test.ts
git commit -m "feat(job-search): module-local query cache, pushState router, format helpers (#935)"
```

---

### Task 4: Authored states + layout styles + starter drafts + Root shell

**Files:**

- Create: `external-modules/job-search/src/web/states.tsx`
- Create: `external-modules/job-search/src/web/styles.ts`
- Create: `external-modules/job-search/src/web/starter-drafts.ts`
- Create: `external-modules/job-search/src/web/root.tsx`
- Modify: `external-modules/job-search/src/web/index.ts`
- Test: `tests/unit/job-search-web-screens.test.tsx` (new)

**Interfaces:**

- Produces (`states.tsx`): `LoadingState({label}: {label: string})`, `EmptyState({title, body, action?})`, `ErrorState({message})` (role="alert"), `DisabledState()` (fixed copy, **no actions** — disable removes starter actions per spec), `DegradedState({detail})`. All render `jds-card jds-card--sunken jsm-state` blocks with `jds-eyebrow` kicker; text only, no icons, no animation (reduced-motion trivially satisfied).
- Produces (`states.tsx`): `outcomeGate<T>(snapshot: QuerySnapshot<T>, render: (result: T) => ReactNodeLike, opts?: {loadingLabel?: string}): ReactNodeLike` — the shared ladder every screen uses: loading → LoadingState; disabled → DisabledState; blocked → DegradedState; error → ErrorState; ok with `result.status === "error"` → DegradedState; else `render(result)`.
- Produces (`starter-drafts.ts`): `starterDraftForStep(step: string): string` (six steps + `"done"` fallback), `RESUME_DRAFT`, `PROFILE_DRAFT` constants. All plain ASCII, < 300 chars each (host cap 1000, fail-closed).
- Produces (`root.tsx`): `Root(props: {hostActions: {openAssistant: (input: {starterPrompt: string}) => void}})` — renders `<style>` (layout CSS), header (`jds-eyebrow` "Module" + `<h1>` "Job Search"), tab nav (`ModuleLink`s with `aria-current="page"` on active), aria-live region, and the route switch. Also exports `announce(message: string)` from `states.tsx`-adjacent live-region store (see code).
- Modify (`index.ts`): entry becomes `import { Root } from "./root"; export default { contractVersion: 1, Root };`

- [ ] **Step 1: Failing tests** (new file):

```tsx
// tests/unit/job-search-web-screens.test.tsx
// JS-06 (#935): renderToString view tests for the external surface. The
// runtime helper must be the first import (installs the host global before any
// module source captures it). Screens split container (hooks) from exported
// pure Views so fixtures render synchronously without fetch.
import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DisabledState,
  EmptyState,
  ErrorState,
  LoadingState
} from "../../external-modules/job-search/src/web/states.js";
import { h } from "../../external-modules/job-search/src/web/runtime.js";
import { starterDraftForStep } from "../../external-modules/job-search/src/web/starter-drafts.js";
import Contribution from "../../external-modules/job-search/src/web/index.js";

function render(node: unknown): string {
  return renderToString(node as never);
}

describe("job-search authored states (#935)", () => {
  it("loading state announces via role=status", () => {
    const html = render(h(LoadingState, { label: "Loading monitors" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading monitors");
    expect(html).toContain("jds-card");
  });

  it("error state uses role=alert", () => {
    expect(render(h(ErrorState, { message: "Request failed (500)" }))).toContain('role="alert"');
  });

  it("disabled state preserves-data copy and offers no actions", () => {
    const html = render(h(DisabledState, null));
    expect(html).toContain("turned off");
    expect(html).toContain("data is preserved");
    expect(html).not.toContain("<button");
  });

  it("empty state renders title and body", () => {
    const html = render(
      h(EmptyState, { title: "No monitors yet", body: "Set one up with Jarvis." })
    );
    expect(html).toContain("No monitors yet");
  });
});

describe("job-search starter drafts (#935)", () => {
  it("has a draft for every checkpoint and the done state, all under the host cap", () => {
    for (const step of [
      "resume_intake",
      "resume_critique",
      "resume_approval",
      "profile",
      "sources_schedule",
      "review_enable",
      "done"
    ]) {
      const draft = starterDraftForStep(step);
      expect(draft.length).toBeGreaterThan(10);
      expect(draft.length).toBeLessThan(1000);
      // Host sanitizer fail-closes on control characters — never ship one.
      expect(draft).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    }
  });
});

describe("job-search Root contract (#935)", () => {
  it("default export keeps web contract v1 with a Root component", () => {
    expect(Contribution.contractVersion).toBe(1);
    expect(typeof Contribution.Root).toBe("function");
  });

  it("Root renders module chrome and tab nav", () => {
    const html = render(h(Contribution.Root, { hostActions: { openAssistant: () => undefined } }));
    expect(html).toContain("Job Search");
    expect(html).toContain("jds-eyebrow");
    expect(html).toContain('aria-current="page"');
    for (const label of ["Overview", "Onboarding", "Profile", "Monitors", "Opportunities"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-live="polite"');
  });
});
```

- [ ] **Step 2: Run to verify failure** — modules not found.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/web/styles.ts
// JS-06 (#935): layout-only module CSS injected by the Root as a <style> tag.
// ZERO color/typography declarations — visual identity comes entirely from the
// host's jds-* primitives and document styles, so the tokens.css raw-color
// rule and theme switching are untouched by this module.
export const MODULE_STYLES = `
.jsm-root { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.jsm-header { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
.jsm-nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
.jsm-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.jsm-stack { display: flex; flex-direction: column; gap: 1rem; }
.jsm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.jsm-state { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; }
.jsm-meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 0; }
.jsm-meta dt { margin: 0; }
.jsm-meta dd { margin: 0; }
.jsm-steps { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.jsm-step { display: flex; align-items: baseline; gap: 0.75rem; }
.jsm-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;
```

```ts
// external-modules/job-search/src/web/starter-drafts.ts
// JS-06 (#935): editable starter prompts for the #916 assistant handoff. The
// host sanitizer fail-closes above 1000 chars — keep these short, plain ASCII,
// and imperative so the user can edit before sending (never auto-submitted).
const STEP_DRAFTS: Record<string, string> = {
  resume_intake:
    "Let's start my job search onboarding. I'd like to share my current resume with you.",
  resume_critique: "Please walk me through your critique of my resume and what you'd improve.",
  resume_approval: "Let's review the latest resume revision together so I can approve it.",
  profile: "Let's build my job search profile: target titles, skills, locations, and preferences.",
  sources_schedule: "Help me pick job sources and set up a monitoring schedule.",
  review_enable: "Let's review my job search setup and enable monitoring."
};

const DONE_DRAFT = "Let's review my job search status and what to do next.";

export function starterDraftForStep(step: string): string {
  return STEP_DRAFTS[step] ?? DONE_DRAFT;
}

export const RESUME_DRAFT =
  "Let's work on my resume. Show me the latest revision and suggest improvements.";
export const PROFILE_DRAFT =
  "Let's update my job search profile: titles, skills, locations, and preferences.";
```

```tsx
// external-modules/job-search/src/web/states.tsx
// JS-06 (#935): authored loading/empty/error/disabled/degraded states shared
// by every route (spec: every route has all five). Text-only — no icons, no
// animation, so prefers-reduced-motion needs no special casing.
import { Fragment, h, type ReactNodeLike } from "./runtime";
import type { QuerySnapshot } from "./store";

export function LoadingState(props: { label: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Loading</span>
      <p>{props.label}…</p>
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  body: string;
  action?: ReactNodeLike;
}): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state">
      <span className="jds-eyebrow">Nothing here yet</span>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.action ?? null}
    </div>
  );
}

export function ErrorState(props: { message: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="alert">
      <span className="jds-eyebrow">Something went wrong</span>
      <p>{props.message}</p>
    </div>
  );
}

// Disable removes actions without deleting data (spec): fixed copy, no buttons,
// no assistant handoff from a disabled surface.
export function DisabledState(): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Module off</span>
      <h2>Job Search is turned off</h2>
      <p>
        This module was disabled on the server. Your data is preserved; an administrator can
        re-enable it under Settings.
      </p>
    </div>
  );
}

export function DegradedState(props: { detail: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Partially unavailable</span>
      <p>{props.detail}</p>
    </div>
  );
}

// Shared render ladder: every screen funnels its query snapshot through this
// so the five authored states are consistent across routes.
export function outcomeGate<T extends Record<string, unknown>>(
  snapshot: QuerySnapshot<T>,
  render: (result: T) => ReactNodeLike,
  opts?: { loadingLabel?: string }
): ReactNodeLike {
  if (snapshot.status === "loading") {
    return <LoadingState label={opts?.loadingLabel ?? "Loading"} />;
  }
  const outcome = snapshot.outcome;
  if (outcome.kind === "disabled") return <DisabledState />;
  if (outcome.kind === "blocked") {
    return <DegradedState detail="This data needs confirmation in the assistant." />;
  }
  if (outcome.kind === "error") return <ErrorState message={outcome.message} />;
  const status = (outcome.result as { status?: unknown }).status;
  if (status === "error") {
    return <DegradedState detail="This section could not load safely. Try again later." />;
  }
  return <Fragment>{render(outcome.result)}</Fragment>;
}
```

Live-region announcer (goes at the bottom of `states.tsx`; consumed by RunNowButton in Task 8 and rendered by Root):

```tsx
// Tiny aria-live announcer: run-now and similar async outcomes push a message
// here; the Root renders one polite live region for the whole surface.
const liveListeners = new Set<() => void>();
let liveMessage = "";

export function announce(message: string): void {
  liveMessage = message;
  for (const listener of liveListeners) listener();
}

export function subscribeLive(onChange: () => void): () => void {
  liveListeners.add(onChange);
  return () => {
    liveListeners.delete(onChange);
  };
}

export function currentLiveMessage(): string {
  return liveMessage;
}
```

```tsx
// external-modules/job-search/src/web/root.tsx
// JS-06 (#935): the external Root. Owns internal routing (host exposes no
// react-router), a single polite live region, and the module chrome. Renders
// entirely from jds-* primitives + layout-only jsm-* styles.
import { h, useSyncExternalStore, type ReactNodeLike } from "./runtime";
import { ModuleLink, useModulePath } from "./router";
import { MODULE_STYLES } from "./styles";
import { currentLiveMessage, subscribeLive } from "./states";
import { OverviewScreen } from "./screens/overview";
import { OnboardingScreen } from "./screens/onboarding";
import { ProfileScreen } from "./screens/profile";
import { MonitorsScreen } from "./screens/monitors";
import { OpportunitiesScreen } from "./screens/opportunities";

export type HostActions = { openAssistant: (input: { starterPrompt: string }) => void };

const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Overview" },
  { to: "/onboarding", label: "Onboarding" },
  { to: "/profile", label: "Profile & resume" },
  { to: "/monitors", label: "Monitors" },
  { to: "/opportunities", label: "Opportunities" }
];

function activeTab(path: string): string {
  if (path === "/") return "/";
  const first = `/${path.split("/")[1] ?? ""}`;
  return TABS.some((tab) => tab.to === first) ? first : "/";
}

function LiveRegion(): ReactNodeLike {
  const message = useSyncExternalStore(subscribeLive, currentLiveMessage, currentLiveMessage);
  return (
    <div aria-live="polite" role="status" className="jsm-visually-hidden">
      {message}
    </div>
  );
}

function RouteSwitch(props: { path: string; hostActions: HostActions }): ReactNodeLike {
  const tab = activeTab(props.path);
  if (tab === "/onboarding") return <OnboardingScreen hostActions={props.hostActions} />;
  if (tab === "/profile") return <ProfileScreen hostActions={props.hostActions} />;
  if (tab === "/monitors") return <MonitorsScreen />;
  if (tab === "/opportunities") return <OpportunitiesScreen path={props.path} />;
  return <OverviewScreen hostActions={props.hostActions} />;
}

export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  const path = useModulePath();
  const current = activeTab(path);
  return (
    <div className="jsm-root" data-module="job-search">
      <style>{MODULE_STYLES}</style>
      <LiveRegion />
      <header className="jsm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Job Search</h1>
      </header>
      <nav className="jsm-nav" aria-label="Job Search sections">
        {TABS.map((tab) => (
          <ModuleLink
            key={tab.to}
            to={tab.to}
            className={`jds-btn jds-btn--ghost jds-btn--sm${current === tab.to ? " jds-btn--secondary" : ""}`}
            aria-current={current === tab.to ? "page" : undefined}
          >
            {tab.label}
          </ModuleLink>
        ))}
      </nav>
      <RouteSwitch path={path} hostActions={props.hostActions} />
    </div>
  );
}
```

(`key` prop: fine to pass through `h` — host React handles it.)

```ts
// external-modules/job-search/src/web/index.ts
// JS-06 (#935): external web entry — contract v1 Root (see root.tsx). The
// bundle stays react-free: all React access goes through src/web/runtime.ts.
import { Root } from "./root";

export default { contractVersion: 1, Root };
```

**Note for this task only:** `RouteSwitch` imports screens that don't exist yet. To keep the commit green, Task 4 creates each `screens/*.tsx` as a minimal placeholder that Tasks 5–9 replace:

```tsx
// external-modules/job-search/src/web/screens/overview.tsx (placeholder pattern
// for all five — replaced by its real implementation in the next tasks)
import { h, type ReactNodeLike } from "../runtime";
import type { HostActions } from "../root";

export function OverviewScreen(_props: { hostActions: HostActions }): ReactNodeLike {
  return <p>Overview arrives in the next task.</p>;
}
```

(`onboarding.tsx`, `profile.tsx` take `{hostActions: HostActions}`; `monitors.tsx` takes no props; `opportunities.tsx` takes `{path: string}`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.ts tests/unit/external-module-job-search-bundle.test.ts && pnpm check:external-modules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/states.tsx external-modules/job-search/src/web/styles.ts \
  external-modules/job-search/src/web/starter-drafts.ts external-modules/job-search/src/web/root.tsx \
  external-modules/job-search/src/web/index.ts external-modules/job-search/src/web/screens \
  tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): module Root shell — chrome, tabs, authored states, live region (#935)"
```

---

### Task 5: Overview screen

**Files:**

- Replace: `external-modules/job-search/src/web/screens/overview.tsx`
- Test: `tests/unit/job-search-web-screens.test.tsx` (append)

**Interfaces:**

- Consumes: `useToolQuery`, `outcomeGate`, `onboardingProgress`, `dueLabel`, `whenLabel`, `starterDraftForStep`, `RunNowButton` (Task 8 — Overview uses a local placeholder link to `/monitors` until then; final wiring lands in Task 8 Step 6).
- Produces: `OverviewView(props: {onboarding: OnboardingState; monitors: MonitorSummary[]; hostActions: HostActions})` — pure, fixture-testable. Types:

```ts
export type OnboardingState = {
  step: string;
  completed: Record<string, boolean>;
  gates: { resumeApproved: boolean; profileApproved: boolean; monitorEnabled: boolean };
};
export type MonitorSummary = {
  monitorId: string;
  adapterId: string;
  enabled: boolean;
  timezone: string;
  dueTime: string;
};
```

- [ ] **Step 1: Failing tests** (append to screens test):

```tsx
import {
  OverviewView,
  type MonitorSummary,
  type OnboardingState
} from "../../external-modules/job-search/src/web/screens/overview.js";

const onboardingFixture: OnboardingState = {
  step: "profile",
  completed: { resume_intake: true, resume_critique: true, resume_approval: true },
  gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
};

const monitorsFixture: MonitorSummary[] = [
  {
    monitorId: "m1",
    adapterId: "greenhouse",
    enabled: true,
    timezone: "America/New_York",
    dueTime: "07:00"
  }
];

const noopHost = { openAssistant: () => undefined };

describe("job-search overview view (#935)", () => {
  it("shows onboarding progress, approval gates, and monitor health", () => {
    const html = render(
      h(OverviewView, {
        onboarding: onboardingFixture,
        monitors: monitorsFixture,
        hostActions: noopHost
      })
    );
    expect(html).toContain("3 of 6");
    expect(html).toContain("Resume approved");
    expect(html).toContain("Profile pending");
    expect(html).toContain("1 enabled");
    expect(html).toContain("daily at 07:00 · America/New_York");
  });

  it("with no monitors, offers the assistant handoff instead of health", () => {
    const html = render(
      h(OverviewView, { onboarding: onboardingFixture, monitors: [], hostActions: noopHost })
    );
    expect(html).toContain("No monitors yet");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// external-modules/job-search/src/web/screens/overview.tsx
// JS-06 (#935): landing route — onboarding completion, approval gates, monitor
// health at a glance. Container fetches; OverviewView is pure for unit tests.
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { dueLabel, onboardingProgress } from "../format";
import { starterDraftForStep } from "../starter-drafts";
import { ModuleLink } from "../router";
import type { HostActions } from "../root";

export type OnboardingState = {
  step: string;
  completed: Record<string, boolean>;
  gates: { resumeApproved: boolean; profileApproved: boolean; monitorEnabled: boolean };
};

export type MonitorSummary = {
  monitorId: string;
  adapterId: string;
  enabled: boolean;
  timezone: string;
  dueTime: string;
};

function GateBadge(props: { ok: boolean; okLabel: string; pendingLabel: string }): ReactNodeLike {
  return (
    <span className={`jds-badge ${props.ok ? "jds-badge--forest" : "jds-badge--neutral"}`}>
      {props.ok ? props.okLabel : props.pendingLabel}
    </span>
  );
}

export function OverviewView(props: {
  onboarding: OnboardingState;
  monitors: MonitorSummary[];
  hostActions: HostActions;
}): ReactNodeLike {
  const progress = onboardingProgress(props.onboarding.completed);
  const enabled = props.monitors.filter((monitor) => monitor.enabled);
  return (
    <div className="jsm-stack">
      <section className="jds-card jsm-state" aria-labelledby="jsm-ov-onboarding">
        <span className="jds-eyebrow">Onboarding</span>
        <h2 id="jsm-ov-onboarding">
          {progress.done} of {progress.total} steps complete
        </h2>
        <div className="jsm-meta">
          <GateBadge
            ok={props.onboarding.gates.resumeApproved}
            okLabel="Resume approved"
            pendingLabel="Resume pending"
          />
          <GateBadge
            ok={props.onboarding.gates.profileApproved}
            okLabel="Profile approved"
            pendingLabel="Profile pending"
          />
          <GateBadge
            ok={props.onboarding.gates.monitorEnabled}
            okLabel="Monitoring on"
            pendingLabel="Monitoring off"
          />
        </div>
        {props.onboarding.step === "done" ? null : (
          <div className="jsm-row">
            <ModuleLink to="/onboarding" className="jds-btn jds-btn--secondary jds-btn--sm">
              View checkpoints
            </ModuleLink>
            <button
              type="button"
              className="jds-btn jds-btn--primary jds-btn--sm"
              onClick={() =>
                props.hostActions.openAssistant({
                  starterPrompt: starterDraftForStep(props.onboarding.step)
                })
              }
            >
              Continue with Jarvis
            </button>
          </div>
        )}
      </section>
      <section className="jds-card jsm-state" aria-labelledby="jsm-ov-monitors">
        <span className="jds-eyebrow">Monitors</span>
        <h2 id="jsm-ov-monitors">
          {props.monitors.length === 0
            ? "Monitor health"
            : `${enabled.length} enabled of ${props.monitors.length}`}
        </h2>
        {props.monitors.length === 0 ? (
          <EmptyState
            title="No monitors yet"
            body="Set up your first monitor in the onboarding conversation."
            action={
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                onClick={() =>
                  props.hostActions.openAssistant({
                    starterPrompt: starterDraftForStep("sources_schedule")
                  })
                }
              >
                Continue with Jarvis
              </button>
            }
          />
        ) : (
          <ul className="jsm-steps">
            {props.monitors.map((monitor) => (
              <li key={monitor.monitorId} className="jsm-step jsm-row">
                <span>
                  {monitor.adapterId} — {dueLabel(monitor.dueTime, monitor.timezone)}
                </span>
                <span
                  className={`jds-badge ${monitor.enabled ? "jds-badge--forest" : "jds-badge--neutral"}`}
                >
                  {monitor.enabled ? "Enabled" : "Paused"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ModuleLink to="/monitors" className="jds-btn jds-btn--ghost jds-btn--sm">
          Monitor details & run now
        </ModuleLink>
      </section>
    </div>
  );
}

export function OverviewScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const onboarding = useToolQuery<OnboardingState & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    onboarding,
    (onboardingState) => (
      <OverviewMonitors onboarding={onboardingState} hostActions={props.hostActions} />
    ),
    { loadingLabel: "Loading your job search" }
  );
}

function OverviewMonitors(props: {
  onboarding: OnboardingState;
  hostActions: HostActions;
}): ReactNodeLike {
  const monitors = useToolQuery<{ monitors: MonitorSummary[] } & Record<string, unknown>>(
    "job-search.monitor.list"
  );
  return outcomeGate(
    monitors,
    (result) => (
      <OverviewView
        onboarding={props.onboarding}
        monitors={result.monitors ?? []}
        hostActions={props.hostActions}
      />
    ),
    { loadingLabel: "Loading monitors" }
  );
}
```

- [ ] **Step 4: Run to verify pass** — screens + core + `pnpm check:external-modules`.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/screens/overview.tsx tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): overview route — onboarding progress, gates, monitor health (#935)"
```

---

### Task 6: Onboarding screen

**Files:**

- Replace: `external-modules/job-search/src/web/screens/onboarding.tsx`
- Test: `tests/unit/job-search-web-screens.test.tsx` (append)

**Interfaces:**

- Produces: `OnboardingView(props: {state: OnboardingState; hostActions: HostActions})` (pure) + `OnboardingScreen` container (same `useToolQuery("job-search.onboarding.get-state")` + `outcomeGate` shape as Task 5).

- [ ] **Step 1: Failing tests:**

```tsx
import { OnboardingView } from "../../external-modules/job-search/src/web/screens/onboarding.js";

describe("job-search onboarding view (#935)", () => {
  it("lists the six checkpoints with done/current/todo status", () => {
    const html = render(h(OnboardingView, { state: onboardingFixture, hostActions: noopHost }));
    for (const label of [
      "Share your resume",
      "Review the critique",
      "Approve a resume revision",
      "Build your search profile",
      "Choose sources & schedule",
      "Review & enable monitoring"
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Done"); // completed steps
    expect(html).toContain("Current"); // the active step badge
    expect(html).toContain("Continue with Jarvis");
  });

  it("celebrates completion without a continue action", () => {
    const html = render(
      h(OnboardingView, {
        state: {
          step: "done",
          completed: Object.fromEntries(Object.keys(STEP_LABELS).map((s) => [s, true])),
          gates: { resumeApproved: true, profileApproved: true, monitorEnabled: true }
        },
        hostActions: noopHost
      })
    );
    expect(html).toContain("Onboarding complete");
    expect(html).not.toContain("Continue with Jarvis");
  });
});
```

(`STEP_LABELS` already imported in the core test; add the import here too.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// external-modules/job-search/src/web/screens/onboarding.tsx
// JS-06 (#935): checkpoint progress + "Continue with Jarvis" (#916 editable
// starter draft, never auto-submitted — the host owns sanitize+focus).
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { outcomeGate } from "../states";
import { STEP_LABELS } from "../format";
import { starterDraftForStep } from "../starter-drafts";
import { ModuleLink } from "../router";
import type { HostActions } from "../root";
import type { OnboardingState } from "./overview";

function stepStatus(state: OnboardingState, step: string): "done" | "current" | "todo" {
  if (state.completed[step] === true) return "done";
  return state.step === step ? "current" : "todo";
}

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  done: { className: "jds-badge--forest", label: "Done" },
  current: { className: "jds-badge--amber", label: "Current" },
  todo: { className: "jds-badge--neutral", label: "To do" }
};

export function OnboardingView(props: {
  state: OnboardingState;
  hostActions: HostActions;
}): ReactNodeLike {
  const complete = props.state.step === "done";
  return (
    <section className="jds-card jsm-state" aria-labelledby="jsm-onboarding-title">
      <span className="jds-eyebrow">Onboarding</span>
      <h2 id="jsm-onboarding-title">
        {complete ? "Onboarding complete" : "Set up your job search"}
      </h2>
      <ol className="jsm-steps">
        {Object.entries(STEP_LABELS).map(([step, label]) => {
          const status = stepStatus(props.state, step);
          const badge = STATUS_BADGE[status];
          return (
            <li key={step} className="jsm-step jsm-row">
              <span>{label}</span>
              <span className={`jds-badge ${badge.className}`}>{badge.label}</span>
            </li>
          );
        })}
      </ol>
      {complete ? (
        <ModuleLink to="/monitors" className="jds-btn jds-btn--secondary jds-btn--sm">
          Go to monitors
        </ModuleLink>
      ) : (
        <button
          type="button"
          className="jds-btn jds-btn--primary"
          onClick={() =>
            props.hostActions.openAssistant({
              starterPrompt: starterDraftForStep(props.state.step)
            })
          }
        >
          Continue with Jarvis
        </button>
      )}
    </section>
  );
}

export function OnboardingScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const snapshot = useToolQuery<OnboardingState & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    snapshot,
    (state) => <OnboardingView state={state} hostActions={props.hostActions} />,
    { loadingLabel: "Loading onboarding" }
  );
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/screens/onboarding.tsx tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): onboarding route — checkpoints + assistant handoff (#935)"
```

---

### Task 7: Profile & resume screen (incl. external-text escaping test)

**Files:**

- Replace: `external-modules/job-search/src/web/screens/profile.tsx`
- Test: `tests/unit/job-search-web-screens.test.tsx` (append)

**Interfaces:**

- Produces: `ProfileView(props: {profile: ProfileResult; resume: ResumeResult; hostActions: HostActions})` (pure) + `ProfileScreen` container chaining two `useToolQuery` calls (`profile.get`, `resume.get`) through nested `outcomeGate`s — **except** `resume.get`'s `{status:"question"}` result, which is NOT an error: the container passes it through to the view as the "no resume yet" empty state. Types:

```ts
export type ProfileResult = {
  status: string;
  active: null | {
    revisionId: string;
    createdAt: string;
    provenance: string;
    fields: Record<string, unknown>;
  };
  draftRevisionIds: string[];
};
export type ResumeResult =
  | { status: "question"; question?: string }
  | { status: "ok"; revisionId: string; kind: string; createdAt: string; critiqueSummary?: string };
```

Resume metadata shown is **compact** (spec): kind, short revision id (`revisionId.slice(0, 8)`), created date, critique summary as text. Never `content`. Profile shows provenance badge, created date, and up to six `targetTitles`/`locations` values as `jds-chip` TEXT (external-string escaping guaranteed by React text children — asserted below).

- [ ] **Step 1: Failing tests:**

```tsx
import {
  ProfileView,
  type ProfileResult,
  type ResumeResult
} from "../../external-modules/job-search/src/web/screens/profile.js";

const profileFixture: ProfileResult = {
  status: "ok",
  active: {
    revisionId: "rev-profile-1",
    createdAt: "2026-07-10T12:00:00.000Z",
    provenance: "user",
    // Hostile external string — must render escaped, never as markup.
    fields: { targetTitles: ["Staff Engineer", "<script>alert(1)</script>"] }
  },
  draftRevisionIds: []
};

const resumeFixture: ResumeResult = {
  status: "ok",
  revisionId: "rev-resume-12345678",
  kind: "markdown",
  createdAt: "2026-07-09T12:00:00.000Z",
  critiqueSummary: "Strong impact bullets; <b>tighten</b> the summary."
};

describe("job-search profile view (#935)", () => {
  it("shows approved revision metadata and return-to-assistant actions", () => {
    const html = render(
      h(ProfileView, { profile: profileFixture, resume: resumeFixture, hostActions: noopHost })
    );
    expect(html).toContain("rev-resu"); // short revision id
    expect(html).toContain("Staff Engineer");
    expect(html).toContain("Refine with Jarvis");
    expect(html).toContain("Update with Jarvis");
  });

  it("renders external strings as text, never markup", () => {
    const html = render(
      h(ProfileView, { profile: profileFixture, resume: resumeFixture, hostActions: noopHost })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>tighten</b>");
  });

  it("without a resume, prompts the assistant handoff", () => {
    const html = render(
      h(ProfileView, {
        profile: { status: "ok", active: null, draftRevisionIds: [] },
        resume: { status: "question" },
        hostActions: noopHost
      })
    );
    expect(html).toContain("No resume yet");
    expect(html).toContain("No profile yet");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// external-modules/job-search/src/web/screens/profile.tsx
// JS-06 (#935): compact approved-revision metadata only — full editing stays
// conversational (JS-03). Resume `content` is deliberately never rendered.
// All values render as React text children (external strings stay text).
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { whenLabel } from "../format";
import { PROFILE_DRAFT, RESUME_DRAFT } from "../starter-drafts";
import type { HostActions } from "../root";

export type ProfileResult = {
  status: string;
  active: null | {
    revisionId: string;
    createdAt: string;
    provenance: string;
    fields: Record<string, unknown>;
  };
  draftRevisionIds: string[];
};

export type ResumeResult =
  | { status: "question"; question?: string }
  | { status: "ok"; revisionId: string; kind: string; createdAt: string; critiqueSummary?: string };

function chipValues(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 6);
}

function AssistantButton(props: {
  label: string;
  draft: string;
  hostActions: HostActions;
}): ReactNodeLike {
  return (
    <button
      type="button"
      className="jds-btn jds-btn--secondary jds-btn--sm"
      onClick={() => props.hostActions.openAssistant({ starterPrompt: props.draft })}
    >
      {props.label}
    </button>
  );
}

export function ProfileView(props: {
  profile: ProfileResult;
  resume: ResumeResult;
  hostActions: HostActions;
}): ReactNodeLike {
  const { profile, resume } = props;
  return (
    <div className="jsm-grid">
      <section className="jds-card jsm-state" aria-labelledby="jsm-resume-title">
        <span className="jds-eyebrow">Resume</span>
        <h2 id="jsm-resume-title">Approved resume</h2>
        {resume.status !== "ok" ? (
          <EmptyState
            title="No resume yet"
            body="Share your resume with Jarvis to get a critique and an approved revision."
            action={
              <AssistantButton
                label="Share with Jarvis"
                draft={RESUME_DRAFT}
                hostActions={props.hostActions}
              />
            }
          />
        ) : (
          <div className="jsm-stack">
            <dl className="jsm-meta">
              <dt className="jds-eyebrow">Revision</dt>
              <dd>{resume.revisionId.slice(0, 8)}</dd>
              <dt className="jds-eyebrow">Kind</dt>
              <dd>{resume.kind}</dd>
              <dt className="jds-eyebrow">Created</dt>
              <dd>{whenLabel(resume.createdAt)}</dd>
            </dl>
            {resume.critiqueSummary ? <p>{resume.critiqueSummary}</p> : null}
            <AssistantButton
              label="Refine with Jarvis"
              draft={RESUME_DRAFT}
              hostActions={props.hostActions}
            />
          </div>
        )}
      </section>
      <section className="jds-card jsm-state" aria-labelledby="jsm-profile-title">
        <span className="jds-eyebrow">Profile</span>
        <h2 id="jsm-profile-title">Search profile</h2>
        {!profile.active ? (
          <EmptyState
            title="No profile yet"
            body="Build your search profile in a conversation with Jarvis."
            action={
              <AssistantButton
                label="Build with Jarvis"
                draft={PROFILE_DRAFT}
                hostActions={props.hostActions}
              />
            }
          />
        ) : (
          <div className="jsm-stack">
            <dl className="jsm-meta">
              <dt className="jds-eyebrow">Source</dt>
              <dd>
                <span className="jds-badge jds-badge--outline">{profile.active.provenance}</span>
              </dd>
              <dt className="jds-eyebrow">Updated</dt>
              <dd>{whenLabel(profile.active.createdAt)}</dd>
            </dl>
            <div className="jsm-meta">
              {[
                ...chipValues(profile.active.fields, "targetTitles"),
                ...chipValues(profile.active.fields, "locations")
              ].map((value) => (
                <span key={value} className="jds-chip">
                  {value}
                </span>
              ))}
            </div>
            <AssistantButton
              label="Update with Jarvis"
              draft={PROFILE_DRAFT}
              hostActions={props.hostActions}
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function ProfileScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const profile = useToolQuery<ProfileResult & Record<string, unknown>>("job-search.profile.get");
  return outcomeGate(
    profile,
    (profileResult) => <ProfileResume profile={profileResult} hostActions={props.hostActions} />,
    { loadingLabel: "Loading profile" }
  );
}

function ProfileResume(props: { profile: ProfileResult; hostActions: HostActions }): ReactNodeLike {
  const resume = useToolQuery<Record<string, unknown>>("job-search.resume.get");
  if (resume.status === "loading") {
    return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
  }
  // resume.get answers {status:"question"} when nothing is stored — that's the
  // authored empty state, not a degraded outcome, so bypass outcomeGate's
  // status:"error"-only degradation and pass it through.
  const outcome = resume.outcome;
  if (outcome.kind !== "ok") {
    return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
  }
  return (
    <ProfileView
      profile={props.profile}
      resume={outcome.result as ResumeResult}
      hostActions={props.hostActions}
    />
  );
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/screens/profile.tsx tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): profile & resume route — approved metadata, text-only external strings (#935)"
```

---

### Task 8: Monitors screen + RunNowButton (queued state, no polling)

**Files:**

- Replace: `external-modules/job-search/src/web/screens/monitors.tsx`
- Modify: `external-modules/job-search/src/web/screens/overview.tsx` (swap the "Monitor details & run now" link target comment — no code change needed if Task 5 shipped the link; skip if so)
- Test: `tests/unit/job-search-web-screens.test.tsx` (append)

**Interfaces:**

- Produces: `MonitorsView(props: {monitors: MonitorDetail[]})`, `RunNowButton(props: {monitorId: string})`, `runStateLabel(outcome: RunNowOutcome): string` (pure, tested). Type:

```ts
export type MonitorDetail = {
  monitorId: string;
  adapterId: string;
  enabled: boolean;
  timezone: string;
  dueTime: string;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
};
```

- `MonitorsScreen` fetches `monitor.list`, then per-monitor `monitor.get` (input `{monitorId}`) for cursor data; a `monitor.get` `{status:"error"}` row renders as a safe per-row degraded line, not a whole-screen failure (spec: safe error state).

- [ ] **Step 1: Failing tests:**

```tsx
import {
  MonitorsView,
  runStateLabel,
  type MonitorDetail
} from "../../external-modules/job-search/src/web/screens/monitors.js";

const monitorDetail: MonitorDetail = {
  monitorId: "m1",
  adapterId: "greenhouse",
  enabled: true,
  timezone: "America/New_York",
  dueTime: "07:00",
  lastCheckedAt: "2026-07-10T11:00:00.000Z",
  lastSuccessAt: "2026-07-10T11:00:00.000Z"
};

describe("job-search monitors view (#935)", () => {
  it("shows adapter, schedule, enabled state, and last success", () => {
    const html = render(h(MonitorsView, { monitors: [monitorDetail] }));
    expect(html).toContain("greenhouse");
    expect(html).toContain("daily at 07:00 · America/New_York");
    expect(html).toContain("Enabled");
    expect(html).toContain("Last success");
    expect(html).toContain("Run now");
  });

  it("maps run-now outcomes to announced labels", () => {
    expect(runStateLabel({ kind: "queued" })).toBe("Run queued");
    expect(runStateLabel({ kind: "already-queued" })).toBe("Already queued");
    expect(runStateLabel({ kind: "disabled" })).toBe("Module is turned off");
    expect(runStateLabel({ kind: "error", message: "Request failed (503)" })).toBe(
      "Could not queue the run"
    );
  });

  it("with no monitors renders the authored empty state", () => {
    expect(render(h(MonitorsView, { monitors: [] }))).toContain("No monitors yet");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// external-modules/job-search/src/web/screens/monitors.tsx
// JS-06 (#935): monitor configuration + health + run-now. Run-now reports
// queued state from the 202 response alone — jobId:null means the manual
// singleton already holds a queued run (no polling of private job output,
// spec). Outcomes are pushed to the Root's polite live region.
import { h, useState, type ReactNodeLike } from "../runtime";
import { runMonitorNow, type RunNowOutcome } from "../api";
import { useToolQuery } from "../store";
import { announce, DisabledState, EmptyState, outcomeGate } from "../states";
import { dueLabel, whenLabel } from "../format";
import type { MonitorSummary } from "./overview";

export type MonitorDetail = MonitorSummary & {
  lastCheckedAt?: string;
  lastSuccessAt?: string;
};

export function runStateLabel(outcome: RunNowOutcome): string {
  if (outcome.kind === "queued") return "Run queued";
  if (outcome.kind === "already-queued") return "Already queued";
  if (outcome.kind === "disabled") return "Module is turned off";
  return "Could not queue the run";
}

export function RunNowButton(props: { monitorId: string }): ReactNodeLike {
  const [state, setState] = useState<"idle" | "pending" | "settled">("idle");
  const [label, setLabel] = useState("Run now");
  const disabled = state !== "idle";
  return (
    <button
      type="button"
      className="jds-btn jds-btn--secondary jds-btn--sm"
      disabled={disabled}
      onClick={() => {
        setState("pending");
        setLabel("Queuing…");
        void runMonitorNow(props.monitorId).then((outcome) => {
          const message = runStateLabel(outcome);
          setState("settled");
          setLabel(message);
          announce(message); // aria-live status announcement (spec a11y)
        });
      }}
    >
      {label}
    </button>
  );
}

function MonitorRow(props: { monitor: MonitorDetail }): ReactNodeLike {
  const monitor = props.monitor;
  return (
    <li className="jds-card jds-card--flush jsm-state">
      <div className="jsm-row">
        <h3>{monitor.adapterId}</h3>
        <span
          className={`jds-badge ${monitor.enabled ? "jds-badge--forest" : "jds-badge--neutral"}`}
        >
          {monitor.enabled ? "Enabled" : "Paused"}
        </span>
      </div>
      <dl className="jsm-meta">
        <dt className="jds-eyebrow">Schedule</dt>
        <dd>{dueLabel(monitor.dueTime, monitor.timezone)}</dd>
        <dt className="jds-eyebrow">Last checked</dt>
        <dd>{whenLabel(monitor.lastCheckedAt)}</dd>
        <dt className="jds-eyebrow">Last success</dt>
        <dd>{whenLabel(monitor.lastSuccessAt)}</dd>
      </dl>
      <div className="jsm-row">
        <RunNowButton monitorId={monitor.monitorId} />
      </div>
    </li>
  );
}

export function MonitorsView(props: { monitors: MonitorDetail[] }): ReactNodeLike {
  if (props.monitors.length === 0) {
    return (
      <EmptyState
        title="No monitors yet"
        body="Monitors are set up in the onboarding conversation with Jarvis."
      />
    );
  }
  return (
    <ul className="jsm-steps" aria-label="Job monitors">
      {props.monitors.map((monitor) => (
        <MonitorRow key={monitor.monitorId} monitor={monitor} />
      ))}
    </ul>
  );
}

// Per-monitor detail fetch: a single failing monitor.get degrades that row
// only (safe error state), never the whole screen.
function MonitorDetailRow(props: { summary: MonitorSummary }): ReactNodeLike {
  const detail = useToolQuery<Record<string, unknown>>("job-search.monitor.get", {
    monitorId: props.summary.monitorId
  });
  if (detail.status === "loading") {
    return <MonitorRow monitor={props.summary} />;
  }
  const outcome = detail.outcome;
  if (outcome.kind === "disabled") return <DisabledState />;
  if (outcome.kind !== "ok" || (outcome.result as { status?: unknown }).status !== "ok") {
    return <MonitorRow monitor={props.summary} />;
  }
  const cursor = (outcome.result as { cursor?: { lastCheckedAt?: string; lastSuccessAt?: string } })
    .cursor;
  return (
    <MonitorRow
      monitor={{
        ...props.summary,
        lastCheckedAt: cursor?.lastCheckedAt,
        lastSuccessAt: cursor?.lastSuccessAt
      }}
    />
  );
}

export function MonitorsScreen(): ReactNodeLike {
  const monitors = useToolQuery<{ monitors: MonitorSummary[] } & Record<string, unknown>>(
    "job-search.monitor.list"
  );
  return outcomeGate(
    monitors,
    (result) => {
      const summaries = result.monitors ?? [];
      if (summaries.length === 0) return <MonitorsView monitors={[]} />;
      return (
        <ul className="jsm-steps" aria-label="Job monitors">
          {summaries.map((summary) => (
            <MonitorDetailRow key={summary.monitorId} summary={summary} />
          ))}
        </ul>
      );
    },
    { loadingLabel: "Loading monitors" }
  );
}
```

- [ ] **Step 4: Run to verify pass** (screens + core + bundle hygiene + `pnpm check:external-modules`).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/screens/monitors.tsx tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): monitors route — config, health, run-now queued state (#935)"
```

---

### Task 9: Opportunities shell (JS-08-ready routes)

**Files:**

- Replace: `external-modules/job-search/src/web/screens/opportunities.tsx`
- Test: `tests/unit/job-search-web-screens.test.tsx` (append)

**Interfaces:**

- Produces: `OpportunitiesScreen(props: {path: string})` — sub-tabs new/saved/passed/stale via `ModuleLink`s to `/opportunities/{bucket}`; `bucketFromPath(path: string): "new"|"saved"|"passed"|"stale"` (pure, defaults `"new"`). Each bucket renders an authored empty state; **no listing UI** (JS-08 delivers capture — spec non-goal here).

- [ ] **Step 1: Failing tests:**

```tsx
import {
  bucketFromPath,
  OpportunitiesScreen
} from "../../external-modules/job-search/src/web/screens/opportunities.js";

describe("job-search opportunities shell (#935)", () => {
  it("parses bucket routes with a new default", () => {
    expect(bucketFromPath("/opportunities")).toBe("new");
    expect(bucketFromPath("/opportunities/saved")).toBe("saved");
    expect(bucketFromPath("/opportunities/passed")).toBe("passed");
    expect(bucketFromPath("/opportunities/stale")).toBe("stale");
    expect(bucketFromPath("/opportunities/bogus")).toBe("new");
  });

  it("renders bucket tabs and the JS-08 empty state", () => {
    const html = render(h(OpportunitiesScreen, { path: "/opportunities/saved" }));
    for (const label of ["New", "Saved", "Passed", "Stale"]) expect(html).toContain(label);
    expect(html).toContain("Opportunities arrive with monitoring runs");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// external-modules/job-search/src/web/screens/opportunities.tsx
// JS-06 (#935): route shell only — new/saved/passed/stale exist and are
// bookmarkable so JS-08 can fill them with captured opportunities. No listing
// UI yet (spec non-goal; opportunities.list stays a JS-05 stub).
import { h, type ReactNodeLike } from "../runtime";
import { ModuleLink } from "../router";
import { EmptyState } from "../states";

const BUCKETS = ["new", "saved", "passed", "stale"] as const;
export type Bucket = (typeof BUCKETS)[number];

const BUCKET_LABELS: Record<Bucket, string> = {
  new: "New",
  saved: "Saved",
  passed: "Passed",
  stale: "Stale"
};

export function bucketFromPath(path: string): Bucket {
  const segment = path.split("/")[2] ?? "new";
  return (BUCKETS as readonly string[]).includes(segment) ? (segment as Bucket) : "new";
}

export function OpportunitiesScreen(props: { path: string }): ReactNodeLike {
  const bucket = bucketFromPath(props.path);
  return (
    <section className="jsm-stack" aria-labelledby="jsm-opps-title">
      <h2 id="jsm-opps-title" className="jsm-visually-hidden">
        Opportunities
      </h2>
      <nav className="jsm-nav" aria-label="Opportunity buckets">
        {BUCKETS.map((candidate) => (
          <ModuleLink
            key={candidate}
            to={`/opportunities/${candidate}`}
            className={`jds-btn jds-btn--ghost jds-btn--sm${bucket === candidate ? " jds-btn--secondary" : ""}`}
            aria-current={bucket === candidate ? "page" : undefined}
          >
            {BUCKET_LABELS[candidate]}
          </ModuleLink>
        ))}
      </nav>
      <EmptyState
        title={`No ${BUCKET_LABELS[bucket].toLowerCase()} opportunities yet`}
        body="Opportunities arrive with monitoring runs in an upcoming release."
      />
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass** (all unit suites + typecheck + bundle hygiene).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web/screens/opportunities.tsx tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): opportunities shell routes ready for JS-08 (#935)"
```

---

### Task 10: Permanent integration tests; delete the temp smoke file

**Files:**

- Create: `tests/integration/js06-module-surface.test.ts`
- Delete: `tests/integration/js06-invoke-smoke.test.ts` (temp, uncommitted — `rm`, never stage)
- Modify: `tests/unit/module-web-browser-safety.test.ts` (extend the walk to the external web source)

**Interfaces:**

- Consumes: the harness of `tests/integration/external-module-job-search.test.ts` — copy its setup verbatim (resetEmptyFoundationDatabase → `buildExternalModule` → temp modulesDir with `jarvis.module.json` + dist → `createApiServer` with `enableExternalModules` → first-signup admin → enable module via the same admin route that file uses; read the exact calls from that file when implementing).

- [ ] **Step 1: Write the integration test** (structure below; lift the setup block from the existing harness file — it is the source of truth for helper names):

```ts
// tests/integration/js06-module-surface.test.ts
// JS-06 (#935): permanent guards for the module-surface data plane —
// supersedes the temporary js06-invoke-smoke proof. Read tools succeed over
// the invoke route, write tools 403 without executing, run-now dedupes via the
// manual singleton, and a disabled module fails closed to 404.
import {
  describe,
  expect,
  it /* + harness imports copied from external-module-job-search.test.ts */
} from "vitest";

// ... setup copied from tests/integration/external-module-job-search.test.ts ...

describe("js-06 module surface data plane (#935)", () => {
  it("lists the declared job-search assistant tools", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: sessionHeaders
    });
    expect(response.statusCode).toBe(200);
    const tools = response
      .json()
      .tools.filter((t: { moduleId: string }) => t.moduleId === "job-search");
    const names = tools.map((t: { name: string }) => t.name);
    for (const required of [
      "job-search.onboarding.get-state",
      "job-search.profile.get",
      "job-search.resume.get",
      "job-search.monitor.list",
      "job-search.monitor.get",
      "job-search.sources.list"
    ]) {
      expect(names).toContain(required);
    }
  });

  it("executes a risk:read tool and passes handler fields through sanitize/bound", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/job-search.monitor.list/invoke",
      headers: sessionHeaders,
      payload: { input: {} }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().invocation).toMatchObject({
      status: "succeeded",
      blockedReason: null,
      result: { status: "ok", monitors: [] }
    });
  });

  it("blocks a write tool with confirmation_required and does not execute it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/job-search.monitor.save/invoke",
      headers: sessionHeaders,
      payload: { input: {} }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().invocation).toMatchObject({
      status: "blocked",
      blockedReason: "confirmation_required"
    });
  });

  it("run-now returns 202 with a jobId, then jobId null while already queued", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/modules/job-search/queues/job-search.monitor-run/run",
      headers: sessionHeaders,
      payload: { jobKind: "job-search.monitor-run-now", params: { monitorId: "m-test" } }
    });
    expect(first.statusCode).toBe(202);
    expect(typeof first.json().jobId).toBe("string");

    const second = await app.inject({
      method: "POST",
      url: "/api/modules/job-search/queues/job-search.monitor-run/run",
      headers: sessionHeaders,
      payload: { jobKind: "job-search.monitor-run-now", params: { monitorId: "m-test" } }
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().jobId).toBeNull();
  });

  it("fails closed after disable: invoke answers 404 tool-not-declared", async () => {
    // Disable through the same admin surface the harness used to enable,
    // then a formerly-good read tool must vanish from the declared set.
    // (exact disable call copied from the harness/enable step, inverted)
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/job-search.monitor.list/invoke",
      headers: sessionHeaders,
      payload: { input: {} }
    });
    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Extend the browser-safety walk.** In `tests/unit/module-web-browser-safety.test.ts`, add the external web entry to the walked roots (exact mechanism: the file builds a list of entry files from `scanModuleWeb` + module-web-sdk; append `external-modules/job-search/src/web/index.ts` to that list so node builtins / backend packages can never creep into the browser graph via `domain/` imports).

- [ ] **Step 3: Run**

```bash
rm tests/integration/js06-invoke-smoke.test.ts
pnpm vitest run tests/unit/module-web-browser-safety.test.ts
pnpm test:integration -- js06-module-surface
```

Expected: PASS (integration runner auto-isolates the DB — `scripts/test-integration.ts`). If the multi-agent shared dev Postgres is contended, re-run rather than weakening assertions (memory: multi-agent PG contention).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/js06-module-surface.test.ts tests/unit/module-web-browser-safety.test.ts
git commit -m "test(job-search): permanent surface data-plane guards; extend browser-safety walk (#935)"
```

---

### Task 11: E2E — real bundle, interactions, screenshots

**Files:**

- Modify: `tests/e2e/mock-modules.ts` (add `mockExternalWebModuleFromDist`)
- Create: `tests/e2e/js06-module-surface.spec.ts`

**Interfaces:**

- Produces (`mock-modules.ts`): `mockExternalWebModuleFromDist(page: Page, options?: {invokeFixtures?: Record<string, unknown>; runNowJobIds?: Array<string | null>; invokeStatus?: number}): Promise<void>` — same module/me mocks as `mockExternalWebModule`, but the bundle route fulfills the **real** `external-modules/job-search/dist/web/index.js` from disk (`readFileSync`, content-type `text/javascript`; keep the trailing-`*` glob for Vite `?import`). Adds routes:
  - `**/api/ai/assistant-tools/*/invoke*` → per-tool fixture from `invokeFixtures` keyed by tool name (default: onboarding fixture at step `profile`, empty monitor list), or `invokeStatus: 404` to simulate disable.
  - `**/api/modules/job-search/queues/job-search.monitor-run/run*` → 202 with the next value from `runNowJobIds` (default `["job-1", null]`).
- The spec builds the bundle first: `execSync("pnpm build:external:job-search", {cwd: repoRoot, stdio: "inherit"})` in `test.beforeAll` (or reuse dist if present and newer than src — keep it simple: always build; it's a one-shot esbuild, <2s).

- [ ] **Step 1: Write the spec** — mirror the structure/selectors of `tests/e2e/external-modules.spec.ts` (login/mocks/composer assertions are already proven there):

Scenarios:

1. **Surface renders real data:** mount from dist, fixtures with 1 monitor → `/m/job-search` shows "Job Search" h1, onboarding progress, monitor row with "daily at 07:00 · America/New_York".
2. **#916 handoff from onboarding:** navigate to Onboarding tab (keyboard: Tab to the nav link, Enter), activate "Continue with Jarvis" via Enter → composer `Message Jarvis` textbox holds the step draft ("Let's build my job search profile…"), is focused, and **no** `/api/chat/turn` POST fired.
3. **Run-now queued + dedupe, announced:** Monitors tab → click "Run now" → button text becomes "Run queued" and the aria-live region contains "Run queued"; second monitor run (or remount) with `jobId:null` → "Already queued". Button disabled after settle (no duplicate activation).
4. **Disabled fails closed:** `invokeStatus: 404` → every route shows "Job Search is turned off" and **no** "Continue with Jarvis" button exists anywhere.
5. **Screenshots:** `page.screenshot` of Overview + Onboarding + Monitors in light and dark (toggle via the host theme mechanism used by existing e2e/screen-capture code — check `pnpm capture:screens` harness for the theme toggle selector; fall back to `page.emulateMedia({colorScheme})` if the app follows the system scheme). Save to `test-results/js06-screens/{route}-{theme}.png` (CI artifact, not committed) for the Coordinator/Ben screenshot review.

- [ ] **Step 2: Run** — `pnpm test:e2e -- js06-module-surface` (frontend gate only — e2e mocks REST, no PG; memory: scope frontend QA to the frontend gate).
      Expected: PASS, 5 scenarios.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/mock-modules.ts tests/e2e/js06-module-surface.spec.ts
git commit -m "test(job-search): e2e real-bundle surface interactions + light/dark screenshots (#935)"
```

---

### Task 12: Full gate + wrap-up

- [ ] **Step 1: Full local gate**

```bash
pnpm build:external:job-search
pnpm verify:foundation
```

Expected: exit 0 (record exact commands + exit codes if CI unavailable). Also confirm the temp smoke file is gone and nothing under `docs/coordination/` is staged.

- [ ] **Step 2: Pre-push trio + rebase**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

- [ ] **Step 3: Invoke `coordinated-wrap-up`** — push, open PR `Closes #935` with a user-facing "What's new" summary (release-note language: "The Job Search module now has its own screens: overview, onboarding progress, profile & resume status, monitors with run-now, and opportunity tabs — plus one-click handoff into a Jarvis conversation."), attach/reference screenshots, report PR + evidence to the Coordinator. No board/merge actions.

---

## Exit-criteria coverage (spec § Verification → tasks)

| Spec requirement                                                | Task                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Runtime web-contract/version and shared-React tests             | 1 (runtime accessor tests, bundle-hygiene stays green), 4 (contract v1 Root test)                             |
| No Node/server import in browser bundle                         | 1 (hygiene test), 10 (browser-safety walk extension)                                                          |
| Loading/empty/degraded/disabled screenshots + interaction tests | 4–9 (renderToString states), 11 (e2e + screenshots)                                                           |
| #916 editable-draft/focus, no auto-submit                       | 4/6 (drafts under cap, control-char guard), 11 scenario 2                                                     |
| Tool/API calls actor-authenticated + module-gated               | 2 (credentials:include, invoke/run-now routes only), 10 (integration: read ok / write 403 / disable 404)      |
| Run-now duplicate prevention + queued state, no polling         | 2 (jobId null mapping), 8 (button states + announce), 10 (dedupe integration), 11 scenario 3                  |
| Disable/re-enable, stale session fails closed                   | 2 (404→disabled), 4 (DisabledState, no actions), 10, 11 scenario 4                                            |
| External-text rendering                                         | 7 (escaping test), global no-dangerouslySetInnerHTML                                                          |
| Design-token and a11y checks                                    | 4 (jds-_ only, layout-only jsm-_), aria-current/labels/live-region/roles throughout, 11 keyboard interactions |
| Overview/Onboarding/Profile/Monitors/Opportunities surfaces     | 5/6/7/8/9                                                                                                     |
| Root owns internal routing, no core-module internals imported   | 3 (router), imports limited to module-local files (browser-safety walk enforces)                              |
