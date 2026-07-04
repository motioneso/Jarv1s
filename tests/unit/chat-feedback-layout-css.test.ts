import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/styles/kit-chat.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "m"));
  return match?.groups?.body ?? "";
}

describe("chat feedback layout CSS", () => {
  it("keeps assistant feedback out of the body text column", () => {
    expect(rule(".chatd-msg")).toContain("grid-template-columns: 26px minmax(0, 1fr)");
    expect(rule(".chatd-msg .feedback-menu")).toContain("grid-column: 2");
    expect(rule(".chatd-msg .feedback-menu")).toContain("max-width: 100%");
    expect(rule(".feedback-menu__status")).toContain("white-space: nowrap");
  });

  it("keeps user feedback aligned with the outgoing bubble", () => {
    expect(rule(".chatd-msg--me")).toContain("display: flex");
    expect(rule(".chatd-msg--me .feedback-menu")).toContain("align-self: flex-end");
  });
});
