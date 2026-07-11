// tests/unit/job-search-web-screens.test.tsx
// JS-06 (#935): renderToString view tests for the external surface. The
// runtime helper must be the first import (installs the host global before any
// module source captures it). Screens split container (hooks) from exported
// pure Views so fixtures render synchronously without fetch.
import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Contribution from "../../external-modules/job-search/src/web/index.js";
import { h } from "../../external-modules/job-search/src/web/runtime.js";
import { starterDraftForStep } from "../../external-modules/job-search/src/web/starter-drafts.js";
import {
  DisabledState,
  EmptyState,
  ErrorState,
  LoadingState
} from "../../external-modules/job-search/src/web/states.js";

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
      // eslint-disable-next-line no-control-regex
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
