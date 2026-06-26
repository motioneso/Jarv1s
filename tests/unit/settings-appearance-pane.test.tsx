import { describe, expect, it } from "vitest";

import type { AestheticThemeTokens } from "@jarv1s/shared";
import {
  contrastRatio,
  slugifyThemeId,
  tokensToCssVars
} from "../../apps/web/src/settings/settings-appearance-pane.js";

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
