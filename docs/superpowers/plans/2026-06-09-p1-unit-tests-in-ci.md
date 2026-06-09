# Wire tests/unit into Gate + CI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `test:unit` script and wire it into `verify:foundation` so that a failing unit test breaks the build.

**Architecture:** Two single-line edits to root `package.json` — add a `test:unit` script entry and insert `pnpm test:unit &&` into the `verify:foundation` script between `pnpm typecheck` and `pnpm db:migrate`. No new files, no DB changes, no CI workflow changes (CI already calls `pnpm verify:foundation`).

**Tech Stack:** vitest (already in devDependencies), pnpm workspaces, TypeScript

---

### Task 1: Add `test:unit` script and update `verify:foundation` in package.json

**Files:**

- Modify: `package.json` (scripts section — two lines)

- [ ] **Step 1: Confirm current state**

```bash
cd /home/ben/Jarv1s/.clone/worktrees/p1-unit-tests-in-ci
# read the two lines we'll change:
node -e "const p=require('./package.json'); console.log('verify:foundation:', p.scripts['verify:foundation']); console.log('test:unit exists:', !!p.scripts['test:unit'])"
```

Expected output:

```
verify:foundation: pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm db:migrate && pnpm test:integration
test:unit exists: false
```

- [ ] **Step 2: Add `test:unit` and update `verify:foundation`**

Edit `package.json` — add after the `test:integration` line (keeping the existing block intact):

```json
"test:unit": "vitest run tests/unit",
```

And update `verify:foundation` to:

```json
"verify:foundation": "pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm test:unit && pnpm db:migrate && pnpm test:integration"
```

- [ ] **Step 3: Verify `test:unit` runs all 14 files and exits 0 (no DB required)**

```bash
pnpm test:unit 2>&1 > /tmp/unit-baseline.txt; echo "exit=$?"
cat /tmp/unit-baseline.txt | grep -E "(PASS|FAIL|Files|Tests|Duration|exit)"
```

Expected: 14 test files, all PASS, exit=0. No postgres connection attempted.

- [ ] **Step 4: Introduce a deliberately-failing assertion in one unit test (canary)**

In `tests/unit/chat-types.test.ts`, add at the bottom of any `it()` block:

```typescript
// CANARY — remove before commit
expect(1).toBe(2);
```

- [ ] **Step 5: Run `pnpm test:unit` to confirm it exits non-zero**

```bash
pnpm test:unit 2>&1 > /tmp/unit-canary.txt; echo "exit=$?"
cat /tmp/unit-canary.txt | grep -E "(FAIL|exit)"
```

Expected: FAIL, exit=1

- [ ] **Step 6: Run `pnpm verify:foundation` to confirm the gate fails on the canary**

```bash
pnpm verify:foundation > /tmp/gate-canary.txt 2>&1; echo "exit=$?"
cat /tmp/gate-canary.txt | grep -E "(FAIL|error|exit)"
```

Expected: exits non-zero, fails at `test:unit` before reaching `db:migrate`.

- [ ] **Step 7: Revert the canary**

Remove the `expect(1).toBe(2)` line from `tests/unit/chat-types.test.ts`.

- [ ] **Step 8: Run the full gate to confirm it is green**

```bash
pnpm verify:foundation > /tmp/gate-final.txt 2>&1; echo "exit=$?"
tail -20 /tmp/gate-final.txt
```

Expected: all steps pass, exit=0.

- [ ] **Step 9: Commit**

```bash
git add package.json
git commit -m "feat(ci): wire tests/unit into verify:foundation gate (P1 #51)

- Add test:unit script: vitest run tests/unit (14 files, no DB required)
- Insert pnpm test:unit after typecheck, before db:migrate in verify:foundation
- CI picks this up automatically (verify step already calls verify:foundation)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review vs Spec

**Spec Exit Criteria:**

1. ✅ `pnpm test:unit` in root package.json, runs 14 files, exits 0 — covered by Steps 2+3.
2. ✅ `verify:foundation` includes `test:unit` and fails when any unit test fails — covered by Steps 2+6.
3. ✅ Deliberately-failing assertion rejected by gate before revert — Steps 4+5+6.
4. ✅ CI `verify` job stays green — CI calls `verify:foundation`; the updated string flows through automatically.
5. ✅ Full gate green — Step 8.

**Placeholder scan:** None found — every step shows exact commands and expected output.

**Type consistency:** N/A (no new code types introduced).
