import { describe, expect, it } from "vitest";
import { PEOPLE_TOOLS } from "../tools.js";

describe("PEOPLE_TOOLS manifest properties", () => {
  it("has exactly 7 tools", () => {
    expect(PEOPLE_TOOLS).toHaveLength(7);
  });

  it("all tools have a name and description", () => {
    for (const tool of PEOPLE_TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.startsWith("people.")).toBe(true);
      expect(typeof tool.description).toBe("string");
    }
  });

  it("people.merge has risk=destructive and no auto executionPolicy", () => {
    const merge = PEOPLE_TOOLS.find((t) => t.name === "people.merge")!;
    expect(merge).toBeDefined();
    expect(merge.risk).toBe("destructive");
    expect((merge as unknown as Record<string, unknown>)["executionPolicy"]).not.toBe("auto");
  });

  it("people.splitIdentity has risk=destructive and no auto executionPolicy", () => {
    const split = PEOPLE_TOOLS.find((t) => t.name === "people.splitIdentity")!;
    expect(split).toBeDefined();
    expect(split.risk).toBe("destructive");
    expect((split as unknown as Record<string, unknown>)["executionPolicy"]).not.toBe("auto");
  });

  it("read tools have risk=read", () => {
    const readTools = ["people.resolve", "people.getContext", "people.listRecent"];
    for (const name of readTools) {
      const tool = PEOPLE_TOOLS.find((t) => t.name === name)!;
      expect(tool).toBeDefined();
      expect(tool.risk).toBe("read");
    }
  });

  it("write tools have risk=write", () => {
    const writeTools = ["people.acceptMatch", "people.rejectMatch"];
    for (const name of writeTools) {
      const tool = PEOPLE_TOOLS.find((t) => t.name === name)!;
      expect(tool).toBeDefined();
      expect(tool.risk).toBe("write");
    }
  });
});

it("acceptMatch and rejectMatch have execute functions", () => {
  const accept = PEOPLE_TOOLS.find((t) => t.name === "people.acceptMatch")!;
  const reject = PEOPLE_TOOLS.find((t) => t.name === "people.rejectMatch")!;
  expect(typeof accept.execute).toBe("function");
  expect(typeof reject.execute).toBe("function");
});
