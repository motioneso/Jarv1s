import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("packages/ui/src/styles/components-jarvis-today.css", "utf8");

describe("Today narrow masthead", () => {
  it("stacks masthead content instead of squeezing lead copy beside the folio", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.jds-masthead__row\s*\{[\s\S]*?flex-direction:\s*column;/
    );
  });
});
