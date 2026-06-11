# Audit Slice C — Vault Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two independent vault-containment gaps: #129 (empty actorUserId collapses vaultRoot to shared base) and #130 (symlink inside vault can escape boundary via realpath).

**Architecture:** Two surgical changes — a guard at the `withVaultContext` entry point in `vault-context.ts`, and a new `assertNoSymlinkEscape` async helper called after every `resolveVaultPath` in `vault-ops.ts`. No migrations, no schema changes, no new files.

**Tech Stack:** TypeScript, Node.js `fs/promises` (`realpath`), existing `VaultPathError` pattern.

---

## File map

| File | Change |
|------|--------|
| `packages/vault/src/vault-context.ts` | Add `VaultContextError` class; add `actorUserId` guard in `withVaultContext` (line 31 area) |
| `packages/vault/src/vault-ops.ts` | Add `realpath` to import (line 1); add `assertNoSymlinkEscape` helper; call it after each of the 7 `resolveVaultPath` call sites |
| `packages/vault/src/index.ts` | Export `VaultContextError` |
| `tests/integration/vault.test.ts` | Add `symlink`, `writeFile`, `mkdir` to fs imports; import `VaultContextError`; add 5 new tests |

---

## Task 1: Write failing tests for #129 (actorUserId validation)

**Files:**
- Modify: `tests/integration/vault.test.ts`

- [ ] **Step 1: Add imports needed for new tests**

In `tests/integration/vault.test.ts`, update the imports block. Current line 2:
```typescript
import { rm } from "node:fs/promises";
```
Replace with:
```typescript
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
```

Also add `VaultContextError` to the `@jarv1s/vault` import block (currently lines 7–17). Add it to the named imports list:
```typescript
import {
  VaultContextError,
  VaultContextRunner,
  VaultPathError,
  deleteVaultFile,
  listVaultFiles,
  makeVaultDir,
  readVaultFile,
  resolveVaultPath,
  vaultFileExists,
  writeVaultFile
} from "@jarv1s/vault";
```

- [ ] **Step 2: Add the three #129 tests at the end of the file** (after the final `});` on line 182)

```typescript
// ── VaultContextRunner actorUserId validation (#129) ─────────────────────────

const validationBase = join(tmpdir(), `jarv1s-vault-validation-${randomUUID()}`);

afterAll(async () => {
  await rm(validationBase, { recursive: true, force: true });
});

describe("VaultContextRunner actorUserId validation (#129)", () => {
  it("throws VaultContextError on empty actorUserId", async () => {
    const runner = new VaultContextRunner(validationBase);
    await expect(
      runner.withVaultContext({ actorUserId: "" }, async () => {})
    ).rejects.toThrow(VaultContextError);
  });

  it("throws VaultContextError on whitespace-only actorUserId", async () => {
    const runner = new VaultContextRunner(validationBase);
    await expect(
      runner.withVaultContext({ actorUserId: "   " }, async () => {})
    ).rejects.toThrow(VaultContextError);
  });

  it("accepts a valid actorUserId and returns the work result", async () => {
    const runner = new VaultContextRunner(validationBase);
    const result = await runner.withVaultContext(
      { actorUserId: "00000000-0000-4000-8000-000000000001" },
      async (ctx) => ctx.actorUserId
    );
    expect(result).toBe("00000000-0000-4000-8000-000000000001");
  });
});
```

- [ ] **Step 3: Run the test file to confirm it fails to compile** (VaultContextError not exported yet)

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
pnpm typecheck 2>&1 | grep VaultContextError
```
Expected: error about `VaultContextError` not being exported from `@jarv1s/vault`.

---

## Task 2: Add VaultContextError + guard in vault-context.ts

**Files:**
- Modify: `packages/vault/src/vault-context.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Add VaultContextError class to vault-context.ts**

In `packages/vault/src/vault-context.ts`, add before line 6 (`export const vaultContextBrand`):

```typescript
export class VaultContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultContextError";
  }
}

```

- [ ] **Step 2: Add the actorUserId guard in withVaultContext**

In `packages/vault/src/vault-context.ts`, the `withVaultContext` method body currently starts at (adjusted line after the class addition):
```typescript
  async withVaultContext<T>(
    accessContext: AccessContext,
    work: (ctx: VaultContext) => Promise<T>
  ): Promise<T> {
    const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
```

Replace the method body opening (just the first line of the body):
```typescript
    const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
```
With:
```typescript
    if (!accessContext.actorUserId || !accessContext.actorUserId.trim()) {
      throw new VaultContextError("withVaultContext: actorUserId must be non-empty");
    }
    const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
```

- [ ] **Step 3: Export VaultContextError from index.ts**

In `packages/vault/src/index.ts`, update line 2:
```typescript
export { assertVaultContext, VaultContextRunner, vaultContextBrand } from "./vault-context.js";
```
Replace with:
```typescript
export { VaultContextError, assertVaultContext, VaultContextRunner, vaultContextBrand } from "./vault-context.js";
```

- [ ] **Step 4: Run #129 tests — confirm they pass**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
vitest run tests/integration/vault.test.ts --reporter=verbose 2>&1 | grep -A2 "actorUserId validation"
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
git add packages/vault/src/vault-context.ts packages/vault/src/index.ts tests/integration/vault.test.ts
git commit -m "$(cat <<'EOF'
fix(vault): guard empty actorUserId in withVaultContext (#129)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write failing tests for #130 (symlink escape)

**Files:**
- Modify: `tests/integration/vault.test.ts`

- [ ] **Step 1: Add symlink escape tests at end of file**

```typescript
// ── Symlink escape containment (#130) ────────────────────────────────────────

const symlinkBase = join(tmpdir(), `jarv1s-vault-symlink-${randomUUID()}`);

afterAll(async () => {
  await rm(symlinkBase, { recursive: true, force: true });
});

describe("symlink escape containment (#130)", () => {
  it("readVaultFile throws VaultPathError when path resolves through symlink to outside file", async () => {
    const outsideFile = join(symlinkBase, "outside.txt");
    await mkdir(symlinkBase, { recursive: true });
    await writeFile(outsideFile, "secret");
    const runner = new VaultContextRunner(join(symlinkBase, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-a" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-link");
      await symlink(outsideFile, linkPath);
      await expect(readVaultFile(ctx, "escape-link")).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile throws VaultPathError when parent dir is a symlink to outside dir", async () => {
    const outsideDir = join(symlinkBase, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    const runner = new VaultContextRunner(join(symlinkBase, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-b" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-dir");
      await symlink(outsideDir, linkPath);
      await expect(writeVaultFile(ctx, "escape-dir/evil.txt", "pwned")).rejects.toThrow(
        VaultPathError
      );
    });
  });
});
```

- [ ] **Step 2: Run symlink tests — confirm they fail** (no symlink check yet in vault-ops.ts)

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
vitest run tests/integration/vault.test.ts --reporter=verbose 2>&1 | grep -A3 "symlink escape"
```
Expected: 2 tests FAIL (the symlink escape succeeds — no `VaultPathError` thrown yet).

---

## Task 4: Add assertNoSymlinkEscape to vault-ops.ts

**Files:**
- Modify: `packages/vault/src/vault-ops.ts`

- [ ] **Step 1: Add `realpath` to the fs/promises import**

In `packages/vault/src/vault-ops.ts`, line 1:
```typescript
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
```
Replace with:
```typescript
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
```

- [ ] **Step 2: Add the assertNoSymlinkEscape helper**

Add after line 5 (`import { resolveVaultPath } from "./vault-path.js";`), before the first export:

```typescript
async function assertNoSymlinkEscape(fullPath: string, vaultRoot: string): Promise<void> {
  let realChecked: string;
  try {
    realChecked = await realpath(fullPath);
  } catch {
    realChecked = await realpath(dirname(fullPath));
  }
  const normalizedRoot = resolve(vaultRoot);
  if (realChecked !== normalizedRoot && !realChecked.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relative(vaultRoot, fullPath));
  }
}

```

Note: `VaultPathError` is not currently imported in `vault-ops.ts`. Add it to the import from `./vault-path.js`:

In `packages/vault/src/vault-ops.ts`, find the line:
```typescript
import { resolveVaultPath } from "./vault-path.js";
```
Replace with:
```typescript
import { VaultPathError, resolveVaultPath } from "./vault-path.js";
```

- [ ] **Step 3: Add assertNoSymlinkEscape calls at all 7 resolveVaultPath call sites**

**readVaultFile** (currently lines 7–10):
```typescript
export async function readVaultFile(ctx: VaultContext, relativePath: string): Promise<string> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  return readFile(fullPath, "utf8");
}
```
Replace with:
```typescript
export async function readVaultFile(ctx: VaultContext, relativePath: string): Promise<string> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  return readFile(fullPath, "utf8");
}
```

**writeVaultFile** (currently lines 12–20):
```typescript
export async function writeVaultFile(
  ctx: VaultContext,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, content, "utf8");
}
```
Replace with:
```typescript
export async function writeVaultFile(
  ctx: VaultContext,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, content, "utf8");
}
```

**listVaultFiles** (currently lines 22–26):
```typescript
export async function listVaultFiles(ctx: VaultContext, relativeDir: string): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}
```
Replace with:
```typescript
export async function listVaultFiles(ctx: VaultContext, relativeDir: string): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}
```

**deleteVaultFile** (currently lines 28–31):
```typescript
export async function deleteVaultFile(ctx: VaultContext, relativePath: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await rm(fullPath);
}
```
Replace with:
```typescript
export async function deleteVaultFile(ctx: VaultContext, relativePath: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  await rm(fullPath);
}
```

**vaultFileExists** (currently lines 33–42 — note resolveVaultPath is intentionally outside the try block so VaultPathError propagates; assertNoSymlinkEscape must also be outside):
```typescript
export async function vaultFileExists(ctx: VaultContext, relativePath: string): Promise<boolean> {
  // resolveVaultPath is called outside the try block so VaultPathError propagates
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  try {
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}
```
Replace with:
```typescript
export async function vaultFileExists(ctx: VaultContext, relativePath: string): Promise<boolean> {
  // resolveVaultPath + assertNoSymlinkEscape outside the try so their errors propagate
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  try {
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}
```

**makeVaultDir** (currently lines 44–47):
```typescript
export async function makeVaultDir(ctx: VaultContext, relativeDir: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await mkdir(fullPath, { recursive: true, mode: 0o700 });
}
```
Replace with:
```typescript
export async function makeVaultDir(ctx: VaultContext, relativeDir: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  await mkdir(fullPath, { recursive: true, mode: 0o700 });
}
```

**listVaultFilesRecursive** (currently lines 63–69):
```typescript
export async function listVaultFilesRecursive(
  ctx: VaultContext,
  relativeDir: string = "."
): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  return collectFilesRecursive(fullPath, ctx.vaultRoot);
}
```
Replace with:
```typescript
export async function listVaultFilesRecursive(
  ctx: VaultContext,
  relativeDir: string = "."
): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await assertNoSymlinkEscape(fullPath, ctx.vaultRoot);
  return collectFilesRecursive(fullPath, ctx.vaultRoot);
}
```

- [ ] **Step 4: Run all vault tests — confirm all pass**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
vitest run tests/integration/vault.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: all existing tests still pass + 2 new symlink tests now pass.

- [ ] **Step 5: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
git add packages/vault/src/vault-ops.ts tests/integration/vault.test.ts
git commit -m "$(cat <<'EOF'
fix(vault): realpath symlink-escape check on all vault-ops paths (#130)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full gate + PR

**Files:** no changes

- [ ] **Step 1: Run the maintainability gate**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
pnpm format:check && pnpm lint && pnpm check:file-size && pnpm typecheck
```
Expected: all pass (0 warnings).

- [ ] **Step 2: If format:check fails, fix it**

```bash
pnpm format
git add packages/vault/src/vault-context.ts packages/vault/src/vault-ops.ts packages/vault/src/index.ts tests/integration/vault.test.ts
git commit -m "$(cat <<'EOF'
chore: prettier format

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Run full integration suite**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
pnpm db:up && pnpm db:migrate && pnpm test:integration 2>&1 | tail -5
```
Note the final test count and exit code.

- [ ] **Step 4: Rebase on origin/main**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/audit-slice-c
git fetch origin main
git rebase origin/main
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin audit-slice-c
```

- [ ] **Step 6: Open PR via gh**

```bash
gh pr create \
  --title "fix(vault): actorUserId validation + symlink-escape containment (#129, #130)" \
  --body "$(cat <<'EOF'
## Summary

- **#129**: Guard `withVaultContext` against empty/whitespace `actorUserId` — an empty string collapses `vaultRoot` to the shared base directory. Throws `VaultContextError` (new typed error) before constructing the path.
- **#130**: Add `assertNoSymlinkEscape` to `vault-ops.ts` — calls `realpath` after every `resolveVaultPath` to catch symlinks that resolve outside the vault boundary. Pre-write paths fall back to checking the parent directory so new-file writes are also protected.

## Changes

- `packages/vault/src/vault-context.ts` — `VaultContextError` class + `actorUserId` guard
- `packages/vault/src/vault-ops.ts` — `realpath` import + `assertNoSymlinkEscape` helper + 7 call sites
- `packages/vault/src/index.ts` — export `VaultContextError`
- `tests/integration/vault.test.ts` — 5 new tests (3 × #129, 2 × #130)

## Test plan

- [x] `vitest run tests/integration/vault.test.ts` — all tests pass
- [x] `pnpm verify:foundation` — full gate green
- [ ] Cross-model (Opus) QA — security tier

Closes #129, #130

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Report to Coordinator**

Send to label `Coordinator`:
```
[SliceC] PR ready: <PR URL>. VF_EXIT=<exit code> TEST_COUNT=<N>. Issues #129 + #130. Ready for cross-model QA + merge sign-off.
```
