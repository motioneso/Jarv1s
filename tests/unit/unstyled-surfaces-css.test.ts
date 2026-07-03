import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = [
  "apps/web/src/styles/kit-chat.css",
  "apps/web/src/styles/onboarding-design.css",
  "apps/web/src/styles/settings-panes-2.css"
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("#686 unstyled surface CSS", () => {
  it("styles chat source, memory, onboarding auth, and activity classes", () => {
    for (const selector of [
      ".source-chips",
      ".source-chip",
      ".source-tray",
      ".memory-panel",
      ".memory-toggle",
      ".onb-auth__paste",
      ".onb-auth__code",
      ".audfilter",
      ".aud__row"
    ]) {
      expect(css).toContain(selector);
    }
  });
});
