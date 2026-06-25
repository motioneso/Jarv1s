# Auth Bootstrap Flake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `auth-bootstrap-recovery.test.ts` from timing out under CI load while waiting for the two race users to appear.

**Architecture:** Keep this as a test-only stability fix. The existing helper already polls; the current 5s deadline is too tight for loaded CI, so loosen that deadline in place and leave auth runtime behavior untouched.

**Tech Stack:** Vitest, Fastify `server.inject`, PostgreSQL advisory locks, `pg`.

---

## Current Branch Check

- Handoff scope verified against current branch: `tests/integration/auth-bootstrap-recovery.test.ts:92-100` still uses `Date.now() + 5000`.
- Local targeted run before planning passed: `pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts`.
- Issue is still actionable because CI-load timeout premise remains: short helper deadline still exists even though local run did not reproduce the flake.

## File Structure

- Modify: `tests/integration/auth-bootstrap-recovery.test.ts`
  - Responsibility: integration coverage for owner bootstrap recovery and disabled-registration race behavior.
  - Change: loosen only `waitForUserCountByEmailPrefix` deadline from `5000` to `20_000`.

## Task 1: Loosen Race Setup Wait

**Files:**

- Modify: `tests/integration/auth-bootstrap-recovery.test.ts:92-100`

- [ ] **Step 1: Confirm baseline surface**

Run:

```bash
pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts
```

Expected locally: PASS, or the known timeout:

```text
Timed out waiting for 2 users with prefix disabled-racer-
```

- [ ] **Step 2: Make minimal test-stability change**

Replace:

```ts
const deadline = Date.now() + 5000;
```

With:

```ts
const deadline = Date.now() + 20_000;
```

- [ ] **Step 3: Run targeted integration test**

Run:

```bash
pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run verification floor**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/integration/auth-bootstrap-recovery.test.ts docs/superpowers/plans/2026-06-25-issue-469-auth-bootstrap-flake.md
git commit -m "test: loosen auth bootstrap race wait"
```

## Self-Review

- Spec coverage: handoff asks for targeted stability in `tests/integration/auth-bootstrap-recovery.test.ts`; Task 1 changes only that file and verifies the relevant test plus floor commands.
- Placeholder scan: no TBD/TODO/fill-later text.
- Type consistency: no new types or APIs.
