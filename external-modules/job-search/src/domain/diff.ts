// external-modules/job-search/src/domain/diff.ts
//
// JS-03 (#932) Task 1: line-based diff between resume revisions. Used by the
// resume.get projection so the user sees exactly what an AI critique changed.
// Contract (asserted in tests): concatenating equal+removed lines reproduces
// `before`, equal+added reproduces `after` — the diff can never drop or invent
// content. Pure function, no imports: domain code stays dependency-free.

export interface DiffHunk {
  readonly type: "equal" | "added" | "removed";
  readonly lines: readonly string[];
}

// Resume inputs are capped at 48 KB upstream (RESUME_INPUT_MAX_BYTES), so the
// quadratic LCS DP is bounded in practice; this guard keeps a pathological
// many-short-lines input from blowing up memory (O(n*m) table).
const MAX_DP_LINES = 10_000;

export function diffLines(before: string, after: string): readonly DiffHunk[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  if (beforeLines.length > MAX_DP_LINES || afterLines.length > MAX_DP_LINES) {
    return [
      { type: "removed", lines: beforeLines },
      { type: "added", lines: afterLines }
    ];
  }

  // Trim the common prefix/suffix before the DP — resumes edits are usually
  // local, so this collapses most of the input to a small middle window.
  let prefix = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefix < maxPrefix && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const midAfter = afterLines.slice(prefix, afterLines.length - suffix);

  // Per-line ops in order; hunks are merged from these at the end.
  const ops: { type: DiffHunk["type"]; line: string }[] = [];
  for (const line of beforeLines.slice(0, prefix)) {
    ops.push({ type: "equal", line });
  }
  ops.push(...lcsOps(midBefore, midAfter));
  for (const line of beforeLines.slice(beforeLines.length - suffix)) {
    ops.push({ type: "equal", line });
  }

  return mergeOps(ops);
}

// Standard LCS length table + backtrack. Emits removed-before-added within
// each edit region (backtrack prefers deletion on ties), matching the hunk
// ordering the tests pin.
function lcsOps(
  before: readonly string[],
  after: readonly string[]
): { type: DiffHunk["type"]; line: string }[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 && m === 0) {
    return [];
  }
  if (n === 0) {
    return after.map((line) => ({ type: "added" as const, line }));
  }
  if (m === 0) {
    return before.map((line) => ({ type: "removed" as const, line }));
  }

  // Flat (n+1)×(m+1) table; cell(i, j) = LCS length of before[i..] vs
  // after[j..]. Flat typed-array indexing keeps every read a plain number
  // (no per-row undefined under noUncheckedIndexedAccess).
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  const cell = (i: number, j: number): number => table[i * width + j]!;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const ops: { type: DiffHunk["type"]; line: string }[] = [];
  let i = 0;
  let j = 0;
  const pendingAdds: string[] = [];
  const flushAdds = (): void => {
    for (const line of pendingAdds) {
      ops.push({ type: "added", line });
    }
    pendingAdds.length = 0;
  };
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      flushAdds();
      ops.push({ type: "equal", line: before[i]! });
      i += 1;
      j += 1;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      // Buffer adds seen so far so a mixed edit region emits removed first.
      ops.push({ type: "removed", line: before[i]! });
      i += 1;
    } else {
      pendingAdds.push(after[j]!);
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "removed", line: before[i]! });
    i += 1;
  }
  flushAdds();
  while (j < m) {
    ops.push({ type: "added", line: after[j]! });
    j += 1;
  }
  return ops;
}

function mergeOps(ops: readonly { type: DiffHunk["type"]; line: string }[]): DiffHunk[] {
  const hunks: { type: DiffHunk["type"]; lines: string[] }[] = [];
  for (const op of ops) {
    const last = hunks[hunks.length - 1];
    if (last && last.type === op.type) {
      last.lines.push(op.line);
    } else {
      hunks.push({ type: op.type, lines: [op.line] });
    }
  }
  return hunks;
}
