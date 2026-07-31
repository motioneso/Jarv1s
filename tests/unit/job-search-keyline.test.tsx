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
  FIT_BAND_EYEBROW,
  FIT_BAND_LABEL,
  FIT_BAND_RAIL,
  FieldPair,
  KeyRow,
  SectionHead,
  fitBand,
  type FitBand
} from "../../external-modules/job-search/src/web/keyline";
import { FIT_BAND_MINIMUMS } from "../../external-modules/job-search/src/domain/score";

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
  // Mockup rewrite (2026-07-29, task #98): FitRail — the old score-bar rendering of Fit — is
  // retired (K-D1 superseded); see keyline.tsx's own header. Fit now reads as a rail colour plus a
  // band word (fitBand + FIT_BAND_RAIL/FIT_BAND_EYEBROW/FIT_BAND_LABEL) — never a bar, never a raw
  // number, on the row or in the opportunity-detail screen. The "null must never render like a
  // real zero" invariant these two tests protected now lives in the callers that hold the
  // nullable value (match-row.tsx, inspector.tsx render an em dash / "Not read yet" and never call
  // fitBand at all when fit is null) — fitBand itself only ever takes a real number, so there is
  // nothing left here to assert about null. What IS still keyline.tsx's own contract: the
  // thresholds are quartered correctly, every band has a rail/eyebrow/label, and the label is a
  // word, never a digit.
  it("fitBand quarters 0-100 into four bands, each with a rail, an eyebrow tone, and a non-numeric label", () => {
    expect(fitBand(100)).toBe("strong");
    expect(fitBand(85)).toBe("strong");
    expect(fitBand(84)).toBe("good");
    expect(fitBand(65)).toBe("good");
    expect(fitBand(64)).toBe("fair");
    expect(fitBand(40)).toBe("fair");
    expect(fitBand(39)).toBe("weak");
    expect(fitBand(0)).toBe("weak");

    const bands: FitBand[] = ["strong", "good", "fair", "weak"];
    for (const band of bands) {
      expect(FIT_BAND_RAIL[band]).toBeTruthy();
      expect(FIT_BAND_EYEBROW[band]).toBeTruthy();
      expect(FIT_BAND_LABEL[band]).toBeTruthy();
      // Fit reads as a word, not a score, anywhere it's shown — never a raw digit in the label.
      expect(FIT_BAND_LABEL[band]).not.toMatch(/\d/);
    }
  });

  it("uses the domain's shared Fit-band minimums", () => {
    expect(fitBand(FIT_BAND_MINIMUMS.strong)).toBe("strong");
    expect(fitBand(FIT_BAND_MINIMUMS.strong - 1)).toBe("good");
    expect(fitBand(FIT_BAND_MINIMUMS.good)).toBe("good");
    expect(fitBand(FIT_BAND_MINIMUMS.fair)).toBe("fair");
    expect(fitBand(FIT_BAND_MINIMUMS.fair - 1)).toBe("weak");
  });

  it("KeyRow with divided renders exactly one jds-divider; without it, none", async () => {
    const undivided = await render(createElement(KeyRow, { divided: false }, "row content"));
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
    const renderer = await render(createElement(FieldPair, { label: "On your board" }, "12"));
    expect(text(renderer)).toBe("On your board 12");
    expect(findByClass(renderer, "jds-fact")).toHaveLength(1);
  });

  // Constraint 1 of the keyline-restructure plan: module CSS is layout-only. No colour, font,
  // border colour or shadow declaration may appear in any module stylesheet — every visual rule
  // comes from the host jds-* primitives the markup composes. This is the one CSS-contract check
  // in the job-search suite, so every later task's own CSS additions are covered by the same
  // assertion without each writing its own copy. The module now ships three stylesheets (#102
  // split styles.css's board/detail classes into styles-board.css, and the Overview/Profile/
  // Monitors screens into styles-screens.css, both loaded and concatenated the same way — see
  // either file's own header), so all three are checked here, not just the original one.
  it("every module stylesheet declares zero CSS custom-property references (layout-only contract)", () => {
    const stylesheets = ["styles.css", "styles-board.css", "styles-screens.css"];
    for (const name of stylesheets) {
      const cssPath = new URL(`../../external-modules/job-search/src/web/${name}`, import.meta.url);
      const css = readFileSync(cssPath, "utf8");
      // Built at runtime, not written literally, so this very assertion doesn't trip its own check.
      const token = ["var", "(", "--"].join("");
      const matches = css.match(new RegExp(token.replace(/[()]/g, "\\$&"), "g")) ?? [];
      expect(matches, `${name} should declare zero design-token references`).toHaveLength(0);
    }
  });
});
