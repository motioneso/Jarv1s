import { describe, it, expect } from "vitest";
import { chatCommitmentProvider } from "@jarv1s/chat";
import { notesCommitmentProvider } from "@jarv1s/notes";

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
