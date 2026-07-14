import { describe, expect, it } from "vitest";

import {
  activeSlashQuery,
  composeTurnText,
  filterEnabledSkills,
  moveSkillActiveIndex,
  resolveBoundSkill,
  resolveSkillByName,
  resolveTurnInvocation,
  skillCommandName,
  splitBareNameToken
} from "../../apps/web/src/chat/skill-autocomplete.js";
import type { ChatSkillDto } from "@jarv1s/shared";

function skill(overrides: Partial<ChatSkillDto> = {}): ChatSkillDto {
  return {
    id: "skill-1",
    ownerUserId: "user-1",
    name: "standup",
    description: null,
    frontmatter: {},
    body: "Ask for yesterday, today, and blockers.",
    enabled: true,
    source: "authored",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("activeSlashQuery", () => {
  it("returns the token text for a leading slash with no space", () => {
    expect(activeSlashQuery("/stand")).toBe("stand");
  });

  it("returns empty string for a bare slash", () => {
    expect(activeSlashQuery("/")).toBe("");
  });

  it("returns null once a space is typed", () => {
    expect(activeSlashQuery("/stand up")).toBeNull();
  });

  it("returns null when text doesn't start with a slash", () => {
    expect(activeSlashQuery("hello")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(activeSlashQuery("")).toBeNull();
  });
});

describe("skillCommandName", () => {
  it.each([
    [" Daily   standup ", "daily-standup"],
    ["Review\t\nNotes", "review-notes"],
    [" Café! ", "café!"],
    ["", ""]
  ])("derives %j as %j", (name, expected) => {
    expect(skillCommandName(name)).toBe(expected);
  });
});

describe("filterEnabledSkills", () => {
  it("excludes disabled skills", () => {
    const skills = [skill({ id: "a", enabled: true }), skill({ id: "b", enabled: false })];
    const result = filterEnabledSkills(skills, "");
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("filters case-insensitively by derived command and stored name", () => {
    const skills = [skill({ id: "a", name: "Daily Standup" }), skill({ id: "b", name: "Retro" })];
    expect(filterEnabledSkills(skills, "STAND").map((s) => s.id)).toEqual(["a"]);
    expect(filterEnabledSkills(skills, "daily-stand").map((s) => s.id)).toEqual(["a"]);
  });

  it("returns all enabled skills for an empty query", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b", name: "other" })];
    const result = filterEnabledSkills(skills, "");
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("preserves the input array order (server ordering is authoritative)", () => {
    const skills = [skill({ id: "z", name: "zzz" }), skill({ id: "a", name: "aaa" })];
    const result = filterEnabledSkills(skills, "");
    expect(result.map((s) => s.id)).toEqual(["z", "a"]);
  });
});

describe("moveSkillActiveIndex", () => {
  it.each([
    [0, 1, 3, 1],
    [0, -1, 3, 2],
    [2, 1, 3, 0],
    [0, 1, 0, -1]
  ])("moves %j by %j in %j items to %j", (index, delta, count, expected) => {
    expect(moveSkillActiveIndex(index, delta, count)).toBe(expected);
  });
});

describe("resolveSkillByName", () => {
  it("resolves first enabled duplicate derived command in API order", () => {
    const skills = [
      skill({ id: "a", name: "Daily   Standup", enabled: true }),
      skill({ id: "b", name: "daily standup", enabled: true })
    ];
    expect(resolveSkillByName(skills, "DAILY-STANDUP")?.id).toBe("a");
  });

  it("skips disabled skills even on exact name match", () => {
    const skills = [
      skill({ id: "a", name: "Daily Standup", enabled: false }),
      skill({ id: "b", name: "Daily Standup", enabled: true })
    ];
    expect(resolveSkillByName(skills, "daily-standup")?.id).toBe("b");
  });

  it("returns undefined when no enabled skill matches", () => {
    const skills = [skill({ id: "a", name: "Retro", enabled: true })];
    expect(resolveSkillByName(skills, "standup")).toBeUndefined();
  });

  it("returns undefined for an empty name", () => {
    const skills = [skill({ id: "a", name: "Standup" })];
    expect(resolveSkillByName(skills, "")).toBeUndefined();
  });
});

describe("resolveBoundSkill", () => {
  it("resolves an enabled skill by id", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b" })];
    expect(resolveBoundSkill(skills, "b")?.id).toBe("b");
  });

  it("returns undefined when the bound id belongs to a disabled skill", () => {
    const skills = [skill({ id: "a", enabled: false })];
    expect(resolveBoundSkill(skills, "a")).toBeUndefined();
  });

  it("returns undefined for a null boundSkillId", () => {
    const skills = [skill({ id: "a" })];
    expect(resolveBoundSkill(skills, null)).toBeUndefined();
  });

  it("returns undefined when no skill matches the id", () => {
    const skills = [skill({ id: "a" })];
    expect(resolveBoundSkill(skills, "missing")).toBeUndefined();
  });
});

describe("splitBareNameToken", () => {
  it("splits a slash-prefixed name and remainder", () => {
    expect(splitBareNameToken("/standup how's it going")).toEqual({
      name: "standup",
      remainder: "how's it going"
    });
  });

  it("returns empty remainder when there is no trailing text", () => {
    expect(splitBareNameToken("/standup")).toEqual({ name: "standup", remainder: "" });
  });

  it("returns null for text with no leading slash", () => {
    expect(splitBareNameToken("standup")).toBeNull();
  });

  it("returns null for a literal lone slash (no name token)", () => {
    expect(splitBareNameToken("/")).toBeNull();
  });
});

describe("resolveTurnInvocation", () => {
  it("prefers the bound skill over any bare-name text", () => {
    const skills = [skill({ id: "a", name: "standup" }), skill({ id: "b", name: "retro" })];
    const result = resolveTurnInvocation("/retro notes here", "a", skills);
    expect(result.skill?.id).toBe("a");
    expect(result.remainder).toBe("/retro notes here");
  });

  it("ignores a bound id that no longer resolves (e.g. disabled) and falls through to bare-name", () => {
    const skills = [skill({ id: "a", enabled: false, name: "standup" })];
    const result = resolveTurnInvocation("plain text", "a", skills);
    expect(result.skill).toBeUndefined();
    expect(result.remainder).toBe("plain text");
  });

  it("resolves by bare-name text when nothing is bound", () => {
    const skills = [skill({ id: "a", name: "Daily Standup" })];
    const result = resolveTurnInvocation("/daily-standup how are things", null, skills);
    expect(result.skill?.id).toBe("a");
    expect(result.remainder).toBe("how are things");
  });

  it("degrades to plain unmodified text when the bare name has no match", () => {
    const skills = [skill({ id: "a", name: "standup" })];
    const result = resolveTurnInvocation("/nope hello", null, skills);
    expect(result.skill).toBeUndefined();
    expect(result.remainder).toBe("/nope hello");
  });

  it("degrades a literal lone slash to plain, still-sendable text", () => {
    const result = resolveTurnInvocation("/", null, []);
    expect(result.skill).toBeUndefined();
    expect(result.remainder).toBe("/");
  });

  it("passes through plain text with no slash unchanged", () => {
    const result = resolveTurnInvocation("hello there", null, []);
    expect(result.skill).toBeUndefined();
    expect(result.remainder).toBe("hello there");
  });
});

describe("composeTurnText", () => {
  it("returns the trimmed remainder unchanged when no skill is bound", () => {
    expect(composeTurnText(undefined, "  hello  ")).toBe("hello");
  });

  it("prepends the skill body followed by the remainder", () => {
    const result = composeTurnText(skill({ body: "Ask for status." }), "extra context");
    expect(result).toBe("Ask for status.\n\nextra context");
  });

  it("sends the body alone when the remainder is empty", () => {
    const result = composeTurnText(skill({ body: "Ask for status." }), "   ");
    expect(result).toBe("Ask for status.");
  });
});
