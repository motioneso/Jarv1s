# OTNR 169 Chat Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the non-colliding #169 chat standards findings while skipping stale or active-lane collisions.

**Architecture:** Extract chat home resolution into a single live-chat helper consumed by runtime and persona rendering. Replace chat route MCP optionals with one nullable wiring bundle so TypeScript narrows tokens/gateway/server URL without non-null assertions.

**Tech Stack:** TypeScript, Vitest, Fastify chat routes, live chat runtime.

---

### Task 1: Relevance Check

**Files:**

- Read: `packages/chat/src/live/persona.ts`
- Read: `packages/chat/src/live/runtime.ts`
- Read: `packages/chat/src/routes.ts`
- Read: `packages/module-registry/src/index.ts`
- Read: `packages/connectors/src/routes.ts`
- Read: `packages/tasks/src/jobs.ts`
- Read: `packages/tasks/src/routes.ts`
- Read: `packages/tasks/src/recurrence.ts`
- Read: `packages/briefings/src/jobs.ts`
- Read: `packages/briefings/src/routes.ts`

- [x] **Step 1: Verify current code against #169**

Run: `rg -n "JARVIS_CHAT_HOME|tokens!|gateway!|mcpServerUrl|process\\.env|as unknown as Record<string, unknown>|as unknown as RecurrenceSpec" packages/chat/src packages/module-registry/src packages/connectors/src packages/tasks/src packages/briefings/src`

Expected: chat MED findings still present; connectors/tasks findings either collision lanes or changed shape.

### Task 2: Shared Chat Home Helper

**Files:**

- Create: `packages/chat/src/live/chat-home.ts`
- Modify: `packages/chat/src/live/persona.ts`
- Modify: `packages/chat/src/live/runtime.ts`
- Test: `tests/unit/chat-live-chat-home.test.ts`

- [x] **Step 1: Write failing test**

Add tests for `resolveChatHome()` default, env override, explicit override, and a source-level assertion that only `chat-home.ts` reads `JARVIS_CHAT_HOME`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/chat-live-chat-home.test.ts`

Expected: FAIL because `packages/chat/src/live/chat-home.ts` does not exist.

- [x] **Step 3: Implement helper and replace duplicate helpers**

Create `resolveChatHome(override?: string): string`, import it from `persona.ts` and `runtime.ts`, and remove local duplicate helpers/imports.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/chat-live-chat-home.test.ts`

Expected: PASS.

### Task 3: Chat Route Wiring Bundle

**Files:**

- Modify: `packages/chat/src/routes.ts`
- Test: `tests/unit/chat-route-standards.test.ts`

- [x] **Step 1: Write failing test**

Add a source-level standards test asserting `packages/chat/src/routes.ts` no longer contains `tokens!` or `gateway!`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/chat-route-standards.test.ts`

Expected: FAIL on current non-null assertions.

- [x] **Step 3: Refactor to a nullable wiring bundle**

Create `const wiring = dependencies.resolveActiveModules && dependencies.mcpServerUrl ? ... : null`, use `wiring` for runtime token lifecycle, MCP transport route, and action-request resolve route.

- [x] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/unit/chat-route-standards.test.ts tests/unit/chat-live-chat-home.test.ts`

Expected: PASS.

### Task 4: Verification and PR

**Files:**

- Verify only owned paths.

- [x] **Step 1: Run relevant checks**

Run focused unit tests, then `pnpm format:check && pnpm lint && pnpm typecheck`.

- [ ] **Step 2: Rebase against PR target**

Run: `git fetch origin overnight-batch-2026-06-16 && git rebase origin/overnight-batch-2026-06-16`

- [ ] **Step 3: Stage owned files only, push, PR**

Run explicit `git add` for owned files only, commit, push `otnr-standards-169`, and open PR targeting `overnight-batch-2026-06-16`.
