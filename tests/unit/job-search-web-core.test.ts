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
