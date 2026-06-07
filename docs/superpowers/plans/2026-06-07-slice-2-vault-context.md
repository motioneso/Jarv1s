# Vault Storage + VaultContext (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `packages/vault` platform primitive — a traversal-safe, per-user filesystem context that is the single chokepoint for all vault file I/O, mirroring `DataContextDb` for files.

**Architecture:** `VaultContextRunner.withVaultContext(accessContext, work)` resolves a per-user vault root at `<JARVIS_VAULT_ROOT>/<actorUserId>/` with mode `0700`, mints a branded `VaultContext` token, and passes it to the work callback. Every file operation takes a `VaultContext` plus a relative path; `resolveVaultPath` normalizes and bounds-checks the path before any `node:fs` call touches disk. No raw `fs` access is allowed outside `packages/vault`.

**Tech Stack:** Node.js `node:fs/promises`, `node:path`, `node:os`; TypeScript; Vitest (integration tests — no Postgres required for vault tests).

---

## File Structure

**Create:**

- `packages/vault/package.json` — package manifest (`@jarv1s/vault`)
- `packages/vault/tsconfig.json` — TypeScript config (extends root)
- `packages/vault/src/index.ts` — all public exports
- `packages/vault/src/vault-config.ts` — `getVaultBaseDir()` from `JARVIS_VAULT_ROOT` env
- `packages/vault/src/vault-context.ts` — `VaultContext` brand, `VaultContextRunner`, `assertVaultContext`
- `packages/vault/src/vault-path.ts` — `VaultPathError`, `resolveVaultPath`
- `packages/vault/src/vault-ops.ts` — `readVaultFile`, `writeVaultFile`, `listVaultFiles`, `deleteVaultFile`, `vaultFileExists`, `makeVaultDir`
- `tests/integration/vault.test.ts` — integration tests (no DB needed)

**Modify:**

- `tsconfig.json` — add `"@jarv1s/vault"` path alias
- `vitest.config.ts` — add `@jarv1s/vault` resolver alias
- `package.json` — add `test:vault` script

---

### Task 1: Package scaffold + tooling wiring

**Files:**

- Create: `packages/vault/package.json`
- Create: `packages/vault/tsconfig.json`
- Create: `packages/vault/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `packages/vault/package.json`**

```json
{
  "name": "@jarv1s/vault",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jarv1s/db": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `packages/vault/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/vault/src/index.ts`** (empty barrel, filled by later tasks)

```typescript
export {};
```

- [ ] **Step 4: Add `@jarv1s/vault` alias to `tsconfig.json`**

In the `"paths"` section, add (keep alphabetical order):

```json
"@jarv1s/vault": ["packages/vault/src/index.ts"]
```

- [ ] **Step 5: Add `@jarv1s/vault` alias to `vitest.config.ts`**

In the `resolve.alias` array, add (keep alphabetical order):

```typescript
{
  find: "@jarv1s/vault",
  replacement: fileURLToPath(new URL("./packages/vault/src/index.ts", import.meta.url))
},
```

- [ ] **Step 6: Add `test:vault` script to `package.json`**

In the `scripts` object, add alongside the other `test:*` scripts:

```json
"test:vault": "vitest run tests/integration/vault.test.ts"
```

- [ ] **Step 7: Install to link the new workspace package**

```bash
pnpm install
```

Expected: exits 0; no errors.

- [ ] **Step 8: Typecheck the empty package**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/vault/ tsconfig.json vitest.config.ts package.json
git commit -m "feat(vault): scaffold @jarv1s/vault package"
```

---

### Task 2: `vault-path.ts` — traversal-safe path resolver

**Files:**

- Create: `packages/vault/src/vault-path.ts`
- Create: `tests/integration/vault.test.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/vault.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
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

// ── resolveVaultPath ──────────────────────────────────────────────────────────

const pathRoot = join(tmpdir(), "jarv1s-test-vault-path");

describe("resolveVaultPath", () => {
  it("resolves a simple relative path", () => {
    const result = resolveVaultPath(pathRoot, "notes/daily.md");
    expect(result).toBe(join(pathRoot, "notes/daily.md"));
  });

  it("resolves vault root itself (e.g. for directory listing)", () => {
    const result = resolveVaultPath(pathRoot, ".");
    expect(result).toBe(pathRoot);
  });

  it("blocks parent directory traversal", () => {
    expect(() => resolveVaultPath(pathRoot, "../other-user/secret.md")).toThrow(VaultPathError);
  });

  it("blocks absolute paths outside root", () => {
    expect(() => resolveVaultPath(pathRoot, "/etc/passwd")).toThrow(VaultPathError);
  });

  it("blocks path that normalises outside the root", () => {
    expect(() => resolveVaultPath(pathRoot, "notes/../../outside")).toThrow(VaultPathError);
  });

  it("blocks empty path", () => {
    expect(() => resolveVaultPath(pathRoot, "")).toThrow(VaultPathError);
  });
});

// ── VaultContextRunner ────────────────────────────────────────────────────────

const ctxBase = join(tmpdir(), `jarv1s-vault-ctx-${randomUUID()}`);

afterAll(async () => {
  await rm(ctxBase, { recursive: true, force: true });
});

describe("VaultContextRunner", () => {
  const runner = new VaultContextRunner(ctxBase);

  it("creates per-user vault root on first withVaultContext (mode 0700)", async () => {
    const userId = randomUUID();
    await runner.withVaultContext({ actorUserId: userId }, async (ctx) => {
      const { statSync } = await import("node:fs");
      const s = statSync(ctx.vaultRoot);
      expect(s.isDirectory()).toBe(true);
      expect(s.mode & 0o777).toBe(0o700);
    });
  });

  it("mints VaultContext with correct actorUserId and vaultRoot", async () => {
    const userId = randomUUID();
    await runner.withVaultContext({ actorUserId: userId }, async (ctx) => {
      expect(ctx.actorUserId).toBe(userId);
      expect(ctx.vaultRoot).toBe(join(ctxBase, userId));
    });
  });

  it("user A context cannot reach user B vault via path traversal", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await runner.withVaultContext({ actorUserId: userA }, async (ctx) => {
      expect(() => resolveVaultPath(ctx.vaultRoot, `../${userB}/secret.md`)).toThrow(
        VaultPathError
      );
    });
  });

  it("admin context is scoped to admin's own vault root (no cross-user bypass)", async () => {
    const adminId = randomUUID();
    const otherUserId = randomUUID();
    await runner.withVaultContext({ actorUserId: adminId }, async (ctx) => {
      expect(() => resolveVaultPath(ctx.vaultRoot, `../${otherUserId}/private.md`)).toThrow(
        VaultPathError
      );
    });
  });
});

// ── vault file operations ─────────────────────────────────────────────────────

const opsBase = join(tmpdir(), `jarv1s-vault-ops-${randomUUID()}`);
const opsRunner = new VaultContextRunner(opsBase);
const opsUserId = randomUUID();

afterAll(async () => {
  await rm(opsBase, { recursive: true, force: true });
});

describe("vault file operations", () => {
  it("writeVaultFile + readVaultFile round-trips content", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "notes/hello.md", "# Hello");
      const content = await readVaultFile(ctx, "notes/hello.md");
      expect(content).toBe("# Hello");
    });
  });

  it("vaultFileExists returns false before write, true after", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(false);
      await writeVaultFile(ctx, "notes/new.md", "content");
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(true);
    });
  });

  it("deleteVaultFile removes the file", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "notes/todelete.md", "bye");
      await deleteVaultFile(ctx, "notes/todelete.md");
      expect(await vaultFileExists(ctx, "notes/todelete.md")).toBe(false);
    });
  });

  it("listVaultFiles returns filenames of direct children in a directory", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "people/alice.md", "person A");
      await writeVaultFile(ctx, "people/bob.md", "person B");
      const files = await listVaultFiles(ctx, "people");
      expect(files.sort()).toEqual(["alice.md", "bob.md"].sort());
    });
  });

  it("makeVaultDir creates a subdirectory with mode 0700", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await makeVaultDir(ctx, "archive/2025");
      const { statSync } = await import("node:fs");
      const s = statSync(join(ctx.vaultRoot, "archive/2025"));
      expect(s.isDirectory()).toBe(true);
      expect(s.mode & 0o777).toBe(0o700);
    });
  });

  it("writeVaultFile creates intermediate directories automatically", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "deep/nested/path/file.md", "nested");
      const content = await readVaultFile(ctx, "deep/nested/path/file.md");
      expect(content).toBe("nested");
    });
  });

  it("readVaultFile throws VaultPathError on traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(readVaultFile(ctx, "../outside/secret.md")).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile throws VaultPathError on traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(writeVaultFile(ctx, "../outside/evil.md", "evil")).rejects.toThrow(
        VaultPathError
      );
    });
  });

  it("vaultFileExists throws VaultPathError on traversal (does not silently return false)", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(vaultFileExists(ctx, "../outside/secret.md")).rejects.toThrow(VaultPathError);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:vault
```

Expected: FAIL — `Cannot find module '@jarv1s/vault'` (nothing exported yet).

- [ ] **Step 3: Create `packages/vault/src/vault-path.ts`**

```typescript
import { resolve, sep } from "node:path";

export class VaultPathError extends Error {
  constructor(relativePath: string) {
    super(`Vault path blocked (traversal or empty): ${JSON.stringify(relativePath)}`);
    this.name = "VaultPathError";
  }
}

export function resolveVaultPath(vaultRoot: string, relativePath: string): string {
  if (!relativePath) {
    throw new VaultPathError(relativePath);
  }

  const normalized = resolve(vaultRoot, relativePath);
  const normalizedRoot = resolve(vaultRoot);

  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relativePath);
  }

  return normalized;
}
```

- [ ] **Step 4: Update `packages/vault/src/index.ts`** to export the path module

```typescript
export { VaultPathError, resolveVaultPath } from "./vault-path.js";
```

- [ ] **Step 5: Run the resolveVaultPath tests to verify they pass**

```bash
pnpm test:vault
```

Expected: The 6 `resolveVaultPath` tests pass. The VaultContextRunner and vault-ops tests still fail with "VaultContextRunner is not a constructor" — that is expected at this stage.

- [ ] **Step 6: Commit**

```bash
git add packages/vault/src/vault-path.ts packages/vault/src/index.ts tests/integration/vault.test.ts
git commit -m "feat(vault): add traversal-safe path resolver"
```

---

### Task 3: `vault-context.ts` — VaultContext brand + VaultContextRunner

**Files:**

- Create: `packages/vault/src/vault-context.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Create `packages/vault/src/vault-context.ts`**

```typescript
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AccessContext } from "@jarv1s/db";

export const vaultContextBrand: unique symbol = Symbol("VaultContext");

export interface VaultContext {
  readonly [vaultContextBrand]: true;
  readonly actorUserId: string;
  readonly vaultRoot: string;
}

export function assertVaultContext(value: unknown): asserts value is VaultContext {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<VaultContext>)[vaultContextBrand] !== true
  ) {
    throw new Error("Vault file access requires withVaultContext");
  }
}

export class VaultContextRunner {
  constructor(private readonly vaultsBaseDir: string) {}

  async withVaultContext<T>(
    accessContext: AccessContext,
    work: (ctx: VaultContext) => Promise<T>
  ): Promise<T> {
    const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
    await mkdir(vaultRoot, { recursive: true, mode: 0o700 });

    return work({
      [vaultContextBrand]: true,
      actorUserId: accessContext.actorUserId,
      vaultRoot
    });
  }
}
```

- [ ] **Step 2: Update `packages/vault/src/index.ts`**

```typescript
export { VaultPathError, resolveVaultPath } from "./vault-path.js";
export { assertVaultContext, VaultContextRunner, vaultContextBrand } from "./vault-context.js";
export type { VaultContext } from "./vault-context.js";
```

- [ ] **Step 3: Run the VaultContextRunner tests**

```bash
pnpm test:vault
```

Expected: The 6 resolveVaultPath tests and 4 VaultContextRunner tests pass (10 total). The vault-ops tests still fail — expected.

- [ ] **Step 4: Commit**

```bash
git add packages/vault/src/vault-context.ts packages/vault/src/index.ts
git commit -m "feat(vault): add VaultContext brand and VaultContextRunner"
```

---

### Task 4: `vault-config.ts` — env-driven vault base directory

**Files:**

- Create: `packages/vault/src/vault-config.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Create `packages/vault/src/vault-config.ts`**

```typescript
const DEFAULT_VAULT_BASE_DIR = "/data/vaults";

export function getVaultBaseDir(): string {
  return process.env["JARVIS_VAULT_ROOT"] ?? DEFAULT_VAULT_BASE_DIR;
}
```

- [ ] **Step 2: Update `packages/vault/src/index.ts`**

```typescript
export { VaultPathError, resolveVaultPath } from "./vault-path.js";
export { assertVaultContext, VaultContextRunner, vaultContextBrand } from "./vault-context.js";
export type { VaultContext } from "./vault-context.js";
export { getVaultBaseDir } from "./vault-config.js";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/vault/src/vault-config.ts packages/vault/src/index.ts
git commit -m "feat(vault): add getVaultBaseDir from JARVIS_VAULT_ROOT"
```

---

### Task 5: `vault-ops.ts` — traversal-safe file operations

**Files:**

- Create: `packages/vault/src/vault-ops.ts`
- Modify: `packages/vault/src/index.ts`

- [ ] **Step 1: Create `packages/vault/src/vault-ops.ts`**

```typescript
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { VaultContext } from "./vault-context.js";
import { resolveVaultPath } from "./vault-path.js";

export async function readVaultFile(ctx: VaultContext, relativePath: string): Promise<string> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  return readFile(fullPath, "utf8");
}

export async function writeVaultFile(
  ctx: VaultContext,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, content, "utf8");
}

export async function listVaultFiles(ctx: VaultContext, relativeDir: string): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

export async function deleteVaultFile(ctx: VaultContext, relativePath: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await rm(fullPath);
}

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

export async function makeVaultDir(ctx: VaultContext, relativeDir: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await mkdir(fullPath, { recursive: true, mode: 0o700 });
}
```

- [ ] **Step 2: Update `packages/vault/src/index.ts`** (final state)

```typescript
export { VaultPathError, resolveVaultPath } from "./vault-path.js";
export { assertVaultContext, VaultContextRunner, vaultContextBrand } from "./vault-context.js";
export type { VaultContext } from "./vault-context.js";
export { getVaultBaseDir } from "./vault-config.js";
export {
  deleteVaultFile,
  listVaultFiles,
  makeVaultDir,
  readVaultFile,
  vaultFileExists,
  writeVaultFile
} from "./vault-ops.js";
```

- [ ] **Step 3: Run all vault tests**

```bash
pnpm test:vault
```

Expected: All 19 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/vault/src/vault-ops.ts packages/vault/src/index.ts
git commit -m "feat(vault): add traversal-safe file operations"
```

---

### Task 6: Foundation gate

**Files:** none

- [ ] **Step 1: Run lint + format + typecheck**

```bash
pnpm lint && pnpm format:check && pnpm typecheck
```

If format fails, run `pnpm format` then re-check.

- [ ] **Step 2: Run the full integration suite**

```bash
pnpm db:up
pnpm verify:foundation
```

Expected:

```
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 27 already current
Integration Test Files  13 passed (13)
Integration Tests       138 passed (138)
```

(vault.test.ts adds 19 tests; total is 119 + 19 = 138.)

- [ ] **Step 3: Commit any format-only changes**

If `pnpm format` changed anything:

```bash
git add -A
git commit -m "chore: format after vault package addition"
```

---

## Verification Commands

```bash
pnpm test:vault                     # vault isolation + file ops (no DB needed)
pnpm verify:foundation              # full gate: lint, format, size, types, migrate, all tests
```

Expected vault result:

```
Test Files  1 passed (1)
Tests       19 passed (19)
```

Expected foundation result after this slice:

```
Integration Test Files  13 passed (13)
Integration Tests       138 passed (138)
```
