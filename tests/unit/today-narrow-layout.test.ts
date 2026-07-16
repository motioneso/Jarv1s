import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles/kit-today.css", "utf8");

describe("Today narrow masthead", () => {
  it("stacks masthead content instead of squeezing lead copy beside the folio", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.cmd-masthead__row\s*\{[\s\S]*?flex-direction:\s*column;/
    );
  });
});
