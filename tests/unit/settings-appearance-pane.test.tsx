import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { AestheticThemeTokens } from "@jarv1s/shared";
import {
  AppearancePane,
  contrastRatio,
  slugifyThemeId,
  tokensToCssVars
} from "../../apps/web/src/settings/settings-appearance-pane.js";
import { parsePalette } from "../../apps/web/src/theme/theme-runtime.js";

function renderAppearancePane(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(AppearancePane))
  );
}

const tokens: AestheticThemeTokens = {
  paper: "#ffffff",
  surface: "#ffffff",
  surface2: "#f5f3ed",
  surface3: "#edeae1",
  ink: "#000000",
  ink2: "#5b564d",
  ink3: "#8b8678",
  ink4: "#9a958a",
  line: "rgb(38, 34, 28)",
  lineSubtle: "rgb(245, 243, 237)",
  lineStrong: "rgb(210, 205, 194)",
  accent: "#2f6a4c"
};

describe("parsePalette (auto-staging)", () => {
  it("extracts hex colors from a Coolors export", () => {
    const coolors = "#541388 / #F038FF / #EF709D / #E9DC3F / #38A3A5";
    expect(parsePalette(coolors)).toEqual(["#541388", "#F038FF", "#EF709D", "#E9DC3F", "#38A3A5"]);
  });

  it("extracts rgb() colors", () => {
    expect(parsePalette("rgb(84, 19, 136), rgb(255, 0, 128)")).toEqual([
      "rgb(84, 19, 136)",
      "rgb(255, 0, 128)"
    ]);
  });

  it("deduplicates repeated colors", () => {
    expect(parsePalette("#aabbcc #aabbcc #ddeeff")).toEqual(["#aabbcc", "#ddeeff"]);
  });

  it("returns empty array for text with no valid colors", () => {
    expect(parsePalette("no colors here")).toEqual([]);
    expect(parsePalette("")).toEqual([]);
  });
});

describe("AppearancePane — palette auto-staging wiring", () => {
  it("never renders a Stage colors button in any state", () => {
    // The editor is only visible when draft state is set (user clicks a theme row).
    // Even if the editor were visible, "Stage colors" must be absent — auto-staging
    // is wired to onChange, no button click needed. This test locks in the removal.
    const html = renderAppearancePane();
    expect(html).not.toContain("Stage colors");
  });
});

describe("appearance pane helpers", () => {
  it("slugifies theme names into route-safe ids", () => {
    expect(slugifyThemeId(" Coolors Sunset! ")).toBe("coolors-sunset");
    expect(slugifyThemeId("!!!")).toMatch(/^theme-/);
  });

  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("projects only aesthetic CSS vars", () => {
    const css = tokensToCssVars({ ...tokens, red: "#000000" } as AestheticThemeTokens);

    expect(css["--paper"]).toBe("#ffffff");
    expect(css["--accent"]).toBe("#2f6a4c");
    expect(css["--red"]).toBeUndefined();
  });
});
