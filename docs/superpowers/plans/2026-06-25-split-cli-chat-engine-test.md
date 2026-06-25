# Split Cli Chat Engine Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `tests/unit/cli-chat-engine.test.ts` below the 1000-line limit and remove its file-size exemption.

**Architecture:** Keep behavior unchanged. Move the tail `probeProvider` and security/failure-ordering describe blocks into one sibling Vitest file so both files stay under the gate. Do not touch production code.

**Tech Stack:** TypeScript, Vitest, existing `pnpm` scripts.

---

## Grounding

- Current branch: `fix-470-split-cli-chat-engine-test`.
- Current `tests/unit/cli-chat-engine.test.ts`: 1098 lines.
- Current `scripts/check-file-size.ts`: `exemptFiles` contains `tests/unit/cli-chat-engine.test.ts`.
- Existing matching test command: `pnpm vitest run tests/unit/cli-chat-engine*.test.ts`.

## Files

- Modify: `tests/unit/cli-chat-engine.test.ts`
- Create: `tests/unit/cli-chat-engine-probe-security.test.ts`
- Modify: `scripts/check-file-size.ts`

## Task 1: Characterize Current Tests

- [ ] **Step 1: Run current targeted suite**

```bash
pnpm vitest run tests/unit/cli-chat-engine.test.ts
```

Expected: existing suite passes before refactor.

- [ ] **Step 2: Commit nothing**

No file changes in this task.

## Task 2: Split Tail Describe Blocks

- [ ] **Step 1: Create sibling test file**

Create `tests/unit/cli-chat-engine-probe-security.test.ts` with imports needed by moved blocks:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";
import type { Multiplexer } from "../../packages/ai/src/adapters/multiplexer.js";
import { CliChatEngineImpl, probeProvider } from "../../packages/chat/src/live/cli-chat-engine.js";
import { CliChatUnavailableError } from "../../packages/chat/src/live/errors.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}
```

- [ ] **Step 2: Move complete describe blocks**

Move these complete blocks from `tests/unit/cli-chat-engine.test.ts` into the new file, preserving body text:

```ts
describe("probeProvider (§4.8)", () => { ... });
describe("#342 §13 same-UID token-file readability (DOCUMENTING — not a regression)", () => { ... });
describe("CliChatEngineImpl — §6.7 no secret on launch line / argv / tmux env", () => { ... });
describe("CliChatEngineImpl — Gemini settings chmod failure cleanup", () => { ... });
describe("CliChatEngineImpl — §6.5 POST-mux-create failure ordering (UNPROVEN-2)", () => { ... });
```

Delete now-unused imports from original:

```ts
import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";
```

Also remove any original imports that become unused after the move.

- [ ] **Step 3: Run targeted split suite**

```bash
pnpm vitest run tests/unit/cli-chat-engine*.test.ts
```

Expected: same tests pass across both files.

- [ ] **Step 4: Commit split**

```bash
git add tests/unit/cli-chat-engine.test.ts tests/unit/cli-chat-engine-probe-security.test.ts
git commit -m "test: split cli chat engine unit tests"
```

## Task 3: Remove File-Size Exemption

- [ ] **Step 1: Remove exemption**

Change `scripts/check-file-size.ts` from:

```ts
// Files exempt from the line-count limit (tracked for follow-up decomposition).
const exemptFiles = new Set(["tests/unit/cli-chat-engine.test.ts"]);
```

to:

```ts
const exemptFiles = new Set<string>();
```

- [ ] **Step 2: Verify file-size gate**

```bash
pnpm check:file-size
```

Expected: `No checked files exceed 1000 lines.`

- [ ] **Step 3: Run verification floor**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm vitest run tests/unit/cli-chat-engine*.test.ts
pnpm check:file-size
```

Expected: all pass.

- [ ] **Step 4: Commit exemption removal**

```bash
git add scripts/check-file-size.ts
git commit -m "chore: remove cli chat engine test size exemption"
```

## Self-Review

- Exit criteria covered: split test below 1000 lines, remove exemption, run verification floor.
- No production behavior change planned.
- No migration, RLS, AccessContext, or frontend surface touched.
