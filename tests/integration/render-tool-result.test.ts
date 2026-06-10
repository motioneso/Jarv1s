import { describe, expect, it } from "vitest";
import { renderToolResult } from "../../packages/module-sdk/src/index.js";

describe("renderToolResult", () => {
  it("renders a uniform flat list as a Markdown pipe table with columns sorted alphabetically", () => {
    const result = renderToolResult({
      data: { items: [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }] }
    });
    expect(result).toBe("| id | name |\n| --- | --- |\n| 1 | alpha |\n| 2 | beta |");
  });

  it("respects columnOrder — preferred columns first, remaining sorted after", () => {
    const result = renderToolResult({
      data: {
        items: [
          { id: "1", name: "alpha", status: "active" },
          { id: "2", name: "beta", status: "done" }
        ]
      },
      columnOrder: ["name", "status"]
    });
    expect(result).toBe(
      "| name | status | id |\n| --- | --- | --- |\n| alpha | active | 1 |\n| beta | done | 2 |"
    );
  });

  it("renders null cell values as empty string", () => {
    const result = renderToolResult({
      data: { items: [{ id: "1", dueAt: null }] }
    });
    expect(result).toBe("| dueAt | id |\n| --- | --- |\n|  | 1 |");
  });

  it("falls back to formatted JSON for empty items array", () => {
    const result = renderToolResult({ data: { items: [] } });
    expect(result).toBe(JSON.stringify({ items: [] }, null, 2));
  });

  it("falls back to formatted JSON for non-uniform items (different key sets)", () => {
    const data = { items: [{ id: "1", name: "alpha" }, { id: "2" }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON for items with nested object values", () => {
    const data = { items: [{ id: "1", meta: { x: 1 } }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON for items containing arrays", () => {
    const data = { items: [{ id: "1", tags: ["a", "b"] }] };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON when data has no items key", () => {
    const data = { task: { id: "1", subtasks: [] } };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });

  it("falls back to formatted JSON when items is not an array", () => {
    const data = { items: "not-an-array" };
    expect(renderToolResult({ data })).toBe(JSON.stringify(data, null, 2));
  });
});
