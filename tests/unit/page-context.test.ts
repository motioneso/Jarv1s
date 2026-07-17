import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPageContextSnapshot,
  isHiddenElementSignals,
  isSensitiveElementSignals,
  projectPageContextErrorAttributes,
  type ElementPrivacySignals
} from "../../apps/web/src/chat/page-context.js";

function signals(overrides: Partial<ElementPrivacySignals> = {}): ElementPrivacySignals {
  return {
    tag: "input",
    type: "text",
    autocomplete: null,
    hidden: false,
    ariaHidden: false,
    display: null,
    visibility: null,
    noCapture: false,
    ...overrides
  };
}

describe("isSensitiveElementSignals (#679 redaction)", () => {
  it("excludes password fields", () => {
    expect(isSensitiveElementSignals(signals({ type: "password" }))).toBe(true);
  });

  it("excludes hidden input fields", () => {
    expect(isSensitiveElementSignals(signals({ type: "hidden" }))).toBe(true);
  });

  it("excludes fields with autocomplete=current-password", () => {
    expect(
      isSensitiveElementSignals(signals({ type: "text", autocomplete: "current-password" }))
    ).toBe(true);
  });

  it("excludes fields with autocomplete=new-password", () => {
    expect(isSensitiveElementSignals(signals({ type: "text", autocomplete: "new-password" }))).toBe(
      true
    );
  });

  it("excludes fields with autocomplete=one-time-code", () => {
    expect(
      isSensitiveElementSignals(signals({ type: "text", autocomplete: "one-time-code" }))
    ).toBe(true);
  });

  it("excludes fields with a cc-* autocomplete token (payment card)", () => {
    expect(isSensitiveElementSignals(signals({ type: "text", autocomplete: "cc-number" }))).toBe(
      true
    );
  });

  it("excludes any element flagged with the data-jarvis-no-capture opt-out", () => {
    expect(isSensitiveElementSignals(signals({ tag: "div", type: null, noCapture: true }))).toBe(
      true
    );
  });

  it("does not exclude an ordinary text input", () => {
    expect(isSensitiveElementSignals(signals({ type: "text", autocomplete: "email" }))).toBe(false);
  });

  it("does not exclude an ordinary button", () => {
    expect(isSensitiveElementSignals(signals({ tag: "button", type: null }))).toBe(false);
  });
});

describe("isHiddenElementSignals", () => {
  it("excludes native hidden attribute", () => {
    expect(isHiddenElementSignals(signals({ hidden: true }))).toBe(true);
  });

  it("excludes aria-hidden", () => {
    expect(isHiddenElementSignals(signals({ ariaHidden: true }))).toBe(true);
  });

  it("excludes display:none", () => {
    expect(isHiddenElementSignals(signals({ display: "none" }))).toBe(true);
  });

  it("excludes visibility:hidden", () => {
    expect(isHiddenElementSignals(signals({ visibility: "hidden" }))).toBe(true);
  });

  it("does not exclude an ordinary visible element", () => {
    expect(isHiddenElementSignals(signals({ display: "block", visibility: "visible" }))).toBe(
      false
    );
  });
});

describe("buildPageContextSnapshot", () => {
  it("buckets candidates by kind", () => {
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [
        { kind: "heading", text: "Today" },
        { kind: "button", text: "Add task" },
        { kind: "label", text: "Due date" },
        { kind: "text", text: "3 tasks due today" }
      ],
      focused: null,
      selectedText: null
    });
    expect(snapshot.headings).toEqual(["Today"]);
    expect(snapshot.buttons).toEqual(["Add task"]);
    expect(snapshot.labels).toEqual(["Due date"]);
    expect(snapshot.visibleText).toEqual(["3 tasks due today"]);
  });

  it("drops candidates that are blank after trimming", () => {
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [
        { kind: "text", text: "   " },
        { kind: "text", text: "real text" }
      ],
      focused: null,
      selectedText: null
    });
    expect(snapshot.visibleText).toEqual(["real text"]);
  });

  it("caps each bucket at its max count", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      kind: "text" as const,
      text: `item ${i}`
    }));
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates,
      focused: null,
      selectedText: null
    });
    expect(snapshot.visibleText.length).toBe(20);
  });

  it("truncates over-long candidate text", () => {
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [{ kind: "text", text: "x".repeat(500) }],
      focused: null,
      selectedText: null
    });
    expect(snapshot.visibleText[0]?.length).toBeLessThanOrEqual(200);
  });

  it("passes through focused element info and truncates its label", () => {
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [],
      focused: { tag: "button", role: "button", label: "y".repeat(500) },
      selectedText: null
    });
    expect(snapshot.focused?.tag).toBe("button");
    expect(snapshot.focused?.label?.length).toBeLessThanOrEqual(200);
  });

  it("truncates selected text and returns null when blank", () => {
    const withSelection = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [],
      focused: null,
      selectedText: "z".repeat(1000)
    });
    expect(withSelection.selectedText?.length).toBeLessThanOrEqual(500);

    const blankSelection = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [],
      focused: null,
      selectedText: "   "
    });
    expect(blankSelection.selectedText).toBeNull();
  });

  it("stamps a capturedAt timestamp", () => {
    const snapshot = buildPageContextSnapshot({
      route: "/tasks",
      pageTitle: "Tasks",
      candidates: [],
      focused: null,
      selectedText: null
    });
    expect(() => new Date(snapshot.capturedAt).toISOString()).not.toThrow();
  });
});

describe("projectPageContextErrorAttributes (#1109 structured UI errors)", () => {
  it("projects declared data-jarvis attributes without visible prose inference", () => {
    expect(
      projectPageContextErrorAttributes({
        code: "news.add_source.no_json_model",
        errorClass: "prerequisite",
        remediationRef: "news.add_source.configure_json_model"
      })
    ).toEqual({
      code: "news.add_source.no_json_model",
      class: "prerequisite",
      remediationRef: "news.add_source.configure_json_model"
    });
    expect(
      projectPageContextErrorAttributes({
        code: "news.add_source.discovery_unavailable",
        errorClass: "transient",
        remediationRef: null
      })
    ).toEqual({
      code: "news.add_source.discovery_unavailable",
      class: "transient"
    });
  });

  it("drops malformed error classes and prerequisite errors without remediation", () => {
    expect(
      projectPageContextErrorAttributes({
        code: "bad.one",
        errorClass: "other",
        remediationRef: null
      })
    ).toBeNull();
    expect(
      projectPageContextErrorAttributes({
        code: "bad.two",
        errorClass: "prerequisite",
        remediationRef: null
      })
    ).toBeNull();
  });
});

describe("page-context.ts never reads raw form-control values (#679 structural guard)", () => {
  it("contains no `.value` access anywhere in the module", () => {
    const path = fileURLToPath(new URL("../../apps/web/src/chat/page-context.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    // Strip doc-comment prose (which legitimately mentions `.value` in backticks while
    // explaining the invariant) so this only scans real code for the access pattern.
    const withoutBacktickedRefs = source.replace(/`[^`]*`/g, "");
    // Guards the hard invariant documented at the top of the module: no code path may
    // ever read `.value` off a DOM node (that would capture raw input/textarea content).
    expect(withoutBacktickedRefs).not.toMatch(/\.value\b/);
  });
});

describe("page-context.ts stays Tier-1 only (#1109 privacy boundary)", () => {
  it("contains no field-value, raw-HTML, or src reads", () => {
    const path = fileURLToPath(new URL("../../apps/web/src/chat/page-context.ts", import.meta.url));
    const source = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(source).not.toMatch(/\.value\b/);
    expect(source).not.toMatch(/\.innerHTML\b/);
    expect(source).not.toMatch(/\.src\b/);
  });
});
