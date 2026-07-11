// tests/unit/external-module-job-search-diff.test.ts
//
// JS-03 (#932) Task 1: line diff for resume revisions. The reconstruction
// property (equal+removed == before, equal+added == after) is the contract
// the resume.get diff projection relies on — a diff that drops or invents
// lines would misrepresent what the AI critique changed.
import { describe, expect, it } from "vitest";

import { diffLines, type DiffHunk } from "../../external-modules/job-search/src/domain/diff.js";

function reconstruct(hunks: readonly DiffHunk[], side: "before" | "after"): string[] {
  const keep = side === "before" ? "removed" : "added";
  const lines: string[] = [];
  for (const hunk of hunks) {
    if (hunk.type === "equal" || hunk.type === keep) {
      lines.push(...hunk.lines);
    }
  }
  return lines;
}

function expectReconstructs(before: string, after: string): readonly DiffHunk[] {
  const hunks = diffLines(before, after);
  expect(reconstruct(hunks, "before")).toEqual(before.split("\n"));
  expect(reconstruct(hunks, "after")).toEqual(after.split("\n"));
  return hunks;
}

describe("diffLines", () => {
  it("identical inputs produce a single equal hunk", () => {
    const text = "alpha\nbeta\ngamma";
    const hunks = diffLines(text, text);
    expect(hunks).toEqual([{ type: "equal", lines: ["alpha", "beta", "gamma"] }]);
  });

  it("pure insertion yields equal/added hunks that reconstruct both sides", () => {
    const before = "alpha\ngamma";
    const after = "alpha\nbeta\ngamma";
    const hunks = expectReconstructs(before, after);
    expect(hunks).toEqual([
      { type: "equal", lines: ["alpha"] },
      { type: "added", lines: ["beta"] },
      { type: "equal", lines: ["gamma"] }
    ]);
  });

  it("pure deletion yields equal/removed hunks that reconstruct both sides", () => {
    const before = "alpha\nbeta\ngamma";
    const after = "alpha\ngamma";
    const hunks = expectReconstructs(before, after);
    expect(hunks).toEqual([
      { type: "equal", lines: ["alpha"] },
      { type: "removed", lines: ["beta"] },
      { type: "equal", lines: ["gamma"] }
    ]);
  });

  it("replacement emits removed before added", () => {
    const before = "alpha\nold line\ngamma";
    const after = "alpha\nnew line\ngamma";
    const hunks = expectReconstructs(before, after);
    expect(hunks).toEqual([
      { type: "equal", lines: ["alpha"] },
      { type: "removed", lines: ["old line"] },
      { type: "added", lines: ["new line"] },
      { type: "equal", lines: ["gamma"] }
    ]);
  });

  it("empty before vs content is a single added hunk", () => {
    const hunks = diffLines("", "alpha\nbeta");
    expect(hunks).toEqual([
      { type: "removed", lines: [""] },
      { type: "added", lines: ["alpha", "beta"] }
    ]);
  });

  it("content vs empty after is removed then added-empty", () => {
    const hunks = diffLines("alpha\nbeta", "");
    expect(hunks).toEqual([
      { type: "removed", lines: ["alpha", "beta"] },
      { type: "added", lines: [""] }
    ]);
  });

  it("merges consecutive same-type lines into one hunk", () => {
    const before = "keep\na\nb\nc\nkeep2";
    const after = "keep\nx\ny\nkeep2";
    const hunks = expectReconstructs(before, after);
    expect(hunks).toEqual([
      { type: "equal", lines: ["keep"] },
      { type: "removed", lines: ["a", "b", "c"] },
      { type: "added", lines: ["x", "y"] },
      { type: "equal", lines: ["keep2"] }
    ]);
  });

  it("reconstructs interleaved edits (moved + changed lines)", () => {
    const before = "one\ntwo\nthree\nfour\nfive";
    const after = "zero\none\nthree\nfour-changed\nfive\nsix";
    expectReconstructs(before, after);
  });

  it("falls back to wholesale removed/added above the DP line guard", () => {
    // > 10_000 lines on one side must not run the quadratic LCS; the guard
    // returns a wholesale replacement that still reconstructs both sides.
    const big = Array.from({ length: 10_001 }, (_, i) => `line ${i}`).join("\n");
    const small = "line 0\nline 1";
    const hunks = expectReconstructs(big, small);
    expect(hunks).toEqual([
      { type: "removed", lines: big.split("\n") },
      { type: "added", lines: small.split("\n") }
    ]);
  });
});
