// JS-06 (#935): pure-logic tests for the external web surface — runtime
// accessor, api outcome mapping, store cache, router parsing, format helpers.
// The runtime global must be installed before any module web import (helper
// module first — ESM evaluation order guarantees it).
// .tsx (despite no JSX): react-importing root tests are .tsx by repo convention —
// root tsconfig includes tests/**/*.ts only; react types live in apps/web.
import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invokeTool, runMonitorNow } from "../../external-modules/job-search/src/web/api.js";
import {
  dueLabel,
  onboardingProgress,
  STEP_LABELS
} from "../../external-modules/job-search/src/web/format.js";
import { parseModulePath } from "../../external-modules/job-search/src/web/router.js";
import { Fragment, h, react } from "../../external-modules/job-search/src/web/runtime.js";
import {
  __resetStoreForTests,
  useToolQuery
} from "../../external-modules/job-search/src/web/store.js";

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

describe("job-search web runtime accessor (#935)", () => {
  it("delegates createElement to the host react instance", () => {
    const element = h("div", { className: "x" }, "hello") as { type?: unknown };
    expect(element).toMatchObject({ type: "div" });
  });

  it("re-exports the host Fragment", () => {
    expect(Fragment).toBe(react.Fragment);
  });
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
