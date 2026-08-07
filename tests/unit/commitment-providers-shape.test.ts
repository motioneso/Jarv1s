import { describe, it, expect } from "vitest";
import { chatCommitmentProvider } from "@moss/chat";
import { notesCommitmentProvider } from "@moss/notes";

describe("commitment extraction providers", () => {
  it("chatCommitmentProvider has correct sourceKind", () => {
    expect(chatCommitmentProvider.sourceKind).toBe("chat");
    expect(typeof chatCommitmentProvider.getTextBoundaries).toBe("function");
  });

  it("notesCommitmentProvider has correct sourceKind", () => {
    expect(notesCommitmentProvider.sourceKind).toBe("notes");
    expect(typeof notesCommitmentProvider.getTextBoundaries).toBe("function");
  });
});
