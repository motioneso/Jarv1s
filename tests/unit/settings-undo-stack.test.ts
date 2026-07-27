import { describe, it, expect } from "vitest";

import { SettingsUndoStack } from "../../packages/settings/src/undo-stack.js";

describe("SettingsUndoStack", () => {
  it("pushes and pops in LIFO order per actor+chat", () => {
    const stack = new SettingsUndoStack();
    stack.push("user1", "chat1", {
      mutationId: "m1",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      appliedAt: 0
    });
    stack.push("user1", "chat1", {
      mutationId: "m2",
      key: "k",
      previousValue: 2,
      previousRevision: 2,
      appliedAt: 1
    });
    expect(stack.pop("user1", "chat1")?.mutationId).toBe("m2");
    expect(stack.pop("user1", "chat1")?.mutationId).toBe("m1");
    expect(stack.pop("user1", "chat1")).toBeUndefined();
  });

  it("isolates stacks per actor+chat pair", () => {
    const stack = new SettingsUndoStack();
    stack.push("user1", "chatA", {
      mutationId: "a",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      appliedAt: 0
    });
    expect(stack.pop("user1", "chatB")).toBeUndefined();
    expect(stack.pop("user1", "chatA")?.mutationId).toBe("a");
  });

  it("caps the stack at 20 entries, dropping the oldest", () => {
    const stack = new SettingsUndoStack();
    for (let i = 0; i < 25; i++) {
      stack.push("user1", "chat1", {
        mutationId: `m${i}`,
        key: "k",
        previousValue: i,
        previousRevision: i,
        appliedAt: i
      });
    }
    let count = 0;
    while (stack.pop("user1", "chat1")) count++;
    expect(count).toBe(20);
  });

  it("clear() removes only the targeted actor+chat stack", () => {
    const stack = new SettingsUndoStack();
    stack.push("user1", "chat1", {
      mutationId: "a",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      appliedAt: 0
    });
    stack.push("user1", "chat2", {
      mutationId: "b",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      appliedAt: 0
    });
    stack.clear("user1", "chat1");
    expect(stack.pop("user1", "chat1")).toBeUndefined();
    expect(stack.pop("user1", "chat2")?.mutationId).toBe("b");
  });
});
