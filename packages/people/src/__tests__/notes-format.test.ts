import { describe, expect, it } from "vitest";

import {
  formatPeopleNote,
  parsePeopleNote,
  replaceJarvisManagedSection
} from "../notes-format.js";

describe("people note format", () => {
  it("parses stable frontmatter without body loss", () => {
    const parsed = parsePeopleNote(`---
jarvisPersonId: 00000000-0000-4000-8000-000000000001
displayName: Ada Lovelace
aliases:
  - Ada
emails:
  - ada@example.test
phones: []
status: active
---
# Ada

Human text stays.
`);

    expect(parsed?.frontmatter.jarvisPersonId).toBe("00000000-0000-4000-8000-000000000001");
    expect(parsed?.frontmatter.aliases).toEqual(["Ada"]);
    expect(parsed?.body).toContain("Human text stays.");
  });

  it("formats frontmatter and preserves human section", () => {
    const output = formatPeopleNote({
      frontmatter: {
        jarvisPersonId: "00000000-0000-4000-8000-000000000002",
        displayName: "Grace Hopper",
        aliases: ["Grace"],
        emails: ["grace@example.test"],
        phones: [],
        status: "active"
      },
      body: "# Grace\n\nHuman notes."
    });

    expect(output).toContain("jarvisPersonId: 00000000-0000-4000-8000-000000000002");
    expect(output).toContain("- grace@example.test");
    expect(output).toContain("Human notes.");
  });

  it("replaces only the managed section", () => {
    const original =
      "# Person\n\nHuman before.\n\n<!-- jarvis:people:start -->\nold\n<!-- jarvis:people:end -->\n\nHuman after.";
    const next = replaceJarvisManagedSection(original, "new managed summary");

    expect(next).toContain("Human before.");
    expect(next).toContain("new managed summary");
    expect(next).toContain("Human after.");
    expect(next).not.toContain("\nold\n");
  });
});
