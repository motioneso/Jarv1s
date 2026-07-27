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
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.push("user1", "chat1", {
      mutationId: "m2",
      key: "k",
      previousValue: 2,
      previousRevision: 2,
      resultingRevision: 3,
      appliedAt: Date.now()
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
      resultingRevision: 2,
      appliedAt: Date.now()
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
        resultingRevision: i + 1,
        appliedAt: Date.now()
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
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.push("user1", "chat2", {
      mutationId: "b",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.clear("user1", "chat1");
    expect(stack.pop("user1", "chat1")).toBeUndefined();
    expect(stack.pop("user1", "chat2")?.mutationId).toBe("b");
  });

  it("does not let ':'-concatenation collisions cross actors (a,'b:c' vs 'a:b',c)", () => {
    const stack = new SettingsUndoStack();
    stack.push("a", "b:c", {
      mutationId: "for-a",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.push("a:b", "c", {
      mutationId: "for-ab",
      key: "k",
      previousValue: 2,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    expect(stack.pop("a", "b:c")?.mutationId).toBe("for-a");
    expect(stack.pop("a:b", "c")?.mutationId).toBe("for-ab");
  });

  it("sweeps entries older than maxEntryAgeMs on access", async () => {
    const stack = new SettingsUndoStack({ maxEntryAgeMs: 10 });
    stack.push("user1", "chat1", {
      mutationId: "old",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stack.pop("user1", "chat1")).toBeUndefined();
  });

  it("LRU-evicts the least-recently-touched chat stack once maxTrackedChats is exceeded", () => {
    const stack = new SettingsUndoStack({ maxTrackedChats: 2 });
    stack.push("user1", "chat1", {
      mutationId: "first",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.push("user1", "chat2", {
      mutationId: "second",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    stack.push("user1", "chat3", {
      mutationId: "third",
      key: "k",
      previousValue: 1,
      previousRevision: 1,
      resultingRevision: 2,
      appliedAt: Date.now()
    });
    expect(stack.pop("user1", "chat1")).toBeUndefined();
    expect(stack.pop("user1", "chat2")?.mutationId).toBe("second");
    expect(stack.pop("user1", "chat3")?.mutationId).toBe("third");
  });
});
