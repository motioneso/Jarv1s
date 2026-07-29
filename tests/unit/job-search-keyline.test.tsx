// K1 (2026-07-28 keyline-restructure plan): keyline.tsx's presentational primitives in isolation,
// plain node environment (no jsdom needed — a pure render, same reasoning as
// job-search-web-onboarding.test.tsx's header). No transport to mock: these components take
// every value as a prop and never call invokeTool/runQueue themselves.
import "./helpers/install-module-runtime";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import {
  FieldPair,
  FitRail,
  KeyRow,
  SectionHead
} from "../../external-modules/job-search/src/web/keyline";

async function render(element: unknown): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element as Parameters<typeof create>[0]);
  });
  return renderer;
}

function flatten(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flatten).join(" ");
  if (typeof node === "object" && "children" in (node as { children?: unknown })) {
    return flatten((node as { children?: unknown }).children);
  }
  return "";
}

function text(renderer: ReactTestRenderer): string {
  return flatten(renderer.toJSON()).replace(/\s+/g, " ").trim();
}

function findByClass(renderer: ReactTestRenderer, className: string) {
  return renderer.root.findAll((item) =>
    String((item.props as { className?: string }).className ?? "")
      .split(" ")
      .includes(className)
  );
}

describe("job-search keyline primitives", () => {
  // FitRail null must never render a 0 — a missing basis to score (e.g. Fit with no résumé on
  // file) is not the same claim as "scored zero", and the two must not be visually confusable.
  it("FitRail with value=null renders no digit anywhere in its subtree", async () => {
    const renderer = await render(
      createElement(FitRail, { label: "Fit", value: null })
    );
    expect(text(renderer)).toBe("Fit —");
    expect(text(renderer)).not.toMatch(/\d/);
    expect(findByClass(renderer, "jds-score")).toHaveLength(0);
  });

  // A real zero is a score like any other and must draw through the same Score component as every
  // other value — including a real, zero-width fill, not an omitted bar.
  it("FitRail with value=0 renders a 0 and a zero-width fill", async () => {
    const renderer = await render(createElement(FitRail, { label: "Want", value: 0 }));
    expect(text(renderer)).toContain("0");
    expect(findByClass(renderer, "jsm-fit-rail__empty")).toHaveLength(0);

    const fill = renderer.root.find(
      (item) => (item.props as { className?: string }).className === "jds-score__fill"
    );
    expect((fill.props as { style?: Record<string, unknown> }).style?.["--jds-score"]).toBe("0");
  });

  it("KeyRow with divided renders exactly one jds-divider; without it, none", async () => {
    const undivided = await render(
      createElement(KeyRow, { divided: false }, "row content")
    );
    expect(findByClass(undivided, "jds-divider")).toHaveLength(0);

    const divided = await render(createElement(KeyRow, { divided: true }, "row content"));
    expect(findByClass(divided, "jds-divider")).toHaveLength(1);
  });

  // Omitted (not just falsy) matters here too: a row with nothing for the aside must not leave an
  // empty `.jsm-krow__aside` wrapper sitting in the tree.
  it("KeyRow renders no aside wrapper when aside is omitted, and one when it is provided", async () => {
    const withoutAside = await render(createElement(KeyRow, { divided: false }, "content"));
    expect(findByClass(withoutAside, "jsm-krow__aside")).toHaveLength(0);

    const withAside = await render(
      createElement(KeyRow, { divided: false, aside: "Dismiss" }, "content")
    );
    expect(findByClass(withAside, "jsm-krow__aside")).toHaveLength(1);
    expect(text(withAside)).toContain("Dismiss");
  });

  it("SectionHead renders its trailing slot children", async () => {
    const renderer = await render(
      createElement(SectionHead, { label: "Where it's looking" }, "3 sources")
    );
    expect(text(renderer)).toContain("Where it's looking");
    expect(text(renderer)).toContain("3 sources");
    expect(findByClass(renderer, "jsm-sechead__aside")).toHaveLength(1);
  });

  it("SectionHead renders no trailing slot wrapper when children are omitted", async () => {
    const renderer = await render(createElement(SectionHead, { label: "Résumé" }));
    expect(findByClass(renderer, "jsm-sechead__aside")).toHaveLength(0);
  });

  it("FieldPair renders the label and value on the host's jds-fact hairline unit", async () => {
    const renderer = await render(
      createElement(FieldPair, { label: "On your board" }, "12")
    );
    expect(text(renderer)).toBe("On your board 12");
    expect(findByClass(renderer, "jds-fact")).toHaveLength(1);
  });

  // Constraint 1 of the keyline-restructure plan: module CSS is layout-only. No colour, font,
  // border colour or shadow declaration may appear in styles.css — every visual rule comes from
  // the host jds-* primitives the markup composes. This is the one CSS-contract check in the
  // job-search suite (there was no existing one to extend), so every later task's own CSS
  // additions are covered by the same assertion without each writing its own copy.
  it("styles.css declares zero CSS custom-property references (layout-only contract)", () => {
    const cssPath = new URL(
      "../../external-modules/job-search/src/web/styles.css",
      import.meta.url
    );
    const css = readFileSync(cssPath, "utf8");
    const matches = css.match(/var\(--/g) ?? [];
    expect(matches).toHaveLength(0);
  });
});
