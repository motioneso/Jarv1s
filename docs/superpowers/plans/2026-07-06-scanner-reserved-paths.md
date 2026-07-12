# Scanner Reserved Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Coordinated-build note:** in this repo the superpowers execution skills are disabled by design.
> Drive this plan yourself, task by task, under `superpowers:test-driven-development`.

**Goal:** Make `scanModuleWeb` (`packages/settings-ui/src/scanner.ts`) reject a module manifest
that declares a web route path already owned by the app shell (`apps/web/src/app-route-metadata.ts`
`webRoutes`), and guard against the denylist and the shell's route table silently drifting apart.

**Architecture:** Add a literal `SHELL_RESERVED_WEB_PATHS` export to `scanner.ts` (packages/settings-ui
cannot depend on apps/web, so this cannot be derived by import) and check every manifest navigation
entry's `path` against it inside `scanModuleWeb`, throwing in the same style as the existing
duplicate-path check. A drift-guard unit test in the root `tests/unit/` suite (which already
cross-imports both `packages/settings-ui/src/*` and `apps/web/src/*` by relative path, per
`tests/unit/module-web-scanner.test.ts` and `tests/unit/web-route-metadata.test.ts`) asserts the
literal list matches the shell's own non-module route paths, so it cannot go stale unnoticed.

**Tech Stack:** TypeScript, Vitest, existing scanner AST-walk (no new dependencies).

## Global Constraints

- Never edit shipped/applied migrations — N/A, no migrations in this change.
- No secrets in any doc, payload, log, or prompt (CLAUDE.md hard invariant) — N/A, no secrets touched.
- Module isolation: `packages/settings-ui` must not import `apps/web` internals — the denylist is a
  literal array in `scanner.ts`, never an import from `apps/web`.
- Preserve existing behavior for non-colliding paths: zero change to today's scan output for sports
  (spec `docs/superpowers/specs/2026-07-04-module-web-registry.md`, "Behavior change target: zero").
- File-size gate: `check:file-size` caps all source at 1000 lines — this change adds ~15 lines to
  `scanner.ts` (currently 450 lines) and a new ~70-line test file; no risk of tripping the gate.

---

### Task 1: Add the reserved-path denylist constant + drift-guard test

**Files:**

- Modify: `packages/settings-ui/src/scanner.ts` (add `SHELL_RESERVED_WEB_PATHS` export, no
  enforcement yet)
- Modify: `packages/settings-ui/src/vite.ts` (re-export `SHELL_RESERVED_WEB_PATHS`, matching the
  existing re-export pattern for `scanModuleWeb` etc.)
- Create: `tests/unit/module-web-reserved-paths.test.ts`

**Interfaces:**

- Consumes: `webRoutes` (`apps/web/src/app-route-metadata.ts`, existing export, array of
  `{ id: string; path: string; ... }`), `MODULE_WEB_ROUTES` (`virtual:jarvis-module-web`, aliased in
  `vitest.config.ts` to `tests/fixtures/virtual-jarvis-module-web.ts`, array of
  `{ moduleId: string; ...; path: string }`).
- Produces: `SHELL_RESERVED_WEB_PATHS: readonly string[]` exported from both
  `packages/settings-ui/src/scanner.ts` and `packages/settings-ui/src/vite.ts` — Task 2 imports this
  from `vite.ts` (same module Task 2's test already imports `scanModuleWeb` from).

- [ ] **Step 1: Write the failing drift-guard test**

Create `tests/unit/module-web-reserved-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { SHELL_RESERVED_WEB_PATHS } from "../../packages/settings-ui/src/vite.js";
import { webRoutes } from "../../apps/web/src/app-route-metadata.js";
import { MODULE_WEB_ROUTES } from "virtual:jarvis-module-web";

describe("module web scanner reserved paths", () => {
  it("keeps the scanner's shell-reserved denylist in sync with the shell's own route table", () => {
    const moduleRouteIds = new Set(MODULE_WEB_ROUTES.map((route) => route.moduleId));
    const shellOwnedPaths = webRoutes
      .filter((route) => !moduleRouteIds.has(route.id))
      .map((route) => route.path)
      .sort();

    expect([...SHELL_RESERVED_WEB_PATHS].sort()).toEqual(shellOwnedPaths);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-web-reserved-paths.test.ts`
Expected: FAIL — `SHELL_RESERVED_WEB_PATHS` does not exist / import error, since `vite.ts` does not
export it yet.

- [ ] **Step 3: Add the literal denylist export**

In `packages/settings-ui/src/scanner.ts`, insert immediately before `export function scanModuleWeb`
(after the `WebScanResult`/`PackageInfo`/`ScanOptions` interfaces, i.e. around current line 116):

```ts
// Paths owned by the app shell (`apps/web/src/app-route-metadata.ts` `webRoutes`, the entries not
// covered by `MODULE_WEB_ROUTES`). A module manifest declaring one of these would render dead —
// shell <Route>s are declared first in `apps/web/src/app.tsx` and win — and could hijack the
// shell's topbar title via the `startsWith` match in `resolvePageHeading`. Kept as a literal list
// rather than importing from `apps/web` (packages/settings-ui must not depend on the app); a
// drift-guard test (`tests/unit/module-web-reserved-paths.test.ts`) ties this list to the live
// shell route table so the two can't silently diverge.
export const SHELL_RESERVED_WEB_PATHS: readonly string[] = [
  "/today",
  "/tasks",
  "/notifications",
  "/calendar",
  "/wellness",
  "/settings"
];
```

In `packages/settings-ui/src/vite.ts`, change:

```ts
import {
  emitVirtualModule,
  emitWebVirtualModule,
  scanModuleSettings,
  scanModuleWeb
} from "./scanner.ts";

export { emitVirtualModule, emitWebVirtualModule, scanModuleSettings, scanModuleWeb };
```

to:

```ts
import {
  emitVirtualModule,
  emitWebVirtualModule,
  scanModuleSettings,
  scanModuleWeb,
  SHELL_RESERVED_WEB_PATHS
} from "./scanner.ts";

export {
  emitVirtualModule,
  emitWebVirtualModule,
  scanModuleSettings,
  scanModuleWeb,
  SHELL_RESERVED_WEB_PATHS
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/module-web-reserved-paths.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/settings-ui/src/scanner.ts packages/settings-ui/src/vite.ts tests/unit/module-web-reserved-paths.test.ts
git commit -m "feat(settings-ui): add shell-reserved web path denylist with drift guard"
```

---

### Task 2: Enforce the denylist in `scanModuleWeb` + fixture test

**Files:**

- Modify: `packages/settings-ui/src/scanner.ts` (throw in `scanModuleWeb` when a manifest navigation
  entry's path is reserved)
- Modify: `tests/unit/module-web-reserved-paths.test.ts` (add the fixture test)

**Interfaces:**

- Consumes: `scanModuleWeb(options: { rootDir: string }): WebScanResult` (existing, from
  `packages/settings-ui/src/vite.ts`), `SHELL_RESERVED_WEB_PATHS` (from Task 1).
- Produces: `scanModuleWeb` throws `Error` with message
  `module web route path "<path>" is reserved by the app shell and cannot be claimed by "<moduleId>"`
  when a manifest's navigation path collides with a shell-reserved path.

- [ ] **Step 1: Write the failing fixture test**

Append to `tests/unit/module-web-reserved-paths.test.ts` (add these imports at the top alongside the
existing ones, and this second `it` block inside the existing `describe`):

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";

import { scanModuleWeb } from "../../packages/settings-ui/src/vite.js";
```

```ts
let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function makeRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "jarvis-module-web-reserved-"));
  roots.push(rootDir);
  return rootDir;
}

async function makeFixturePackage(rootDir: string, manifestBody: string) {
  const packageDir = join(rootDir, "packages", "fixture");
  await mkdir(join(packageDir, "src"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "@jarv1s/fixture",
      type: "module",
      exports: { ".": "./src/index.ts", "./web": "./src/web/index.tsx" }
    }),
    "utf8"
  );
  await writeFile(join(packageDir, "src", "manifest.ts"), manifestBody, "utf8");
}
```

Add inside the existing `describe("module web scanner reserved paths", ...)` block, after the
drift-guard test:

```ts
it("throws when a module's web route path collides with a shell-reserved path", async () => {
  const rootDir = await makeRoot();
  await makeFixturePackage(
    rootDir,
    `export const fixtureModuleManifest = {
        id: "fixture",
        name: "Fixture",
        lifecycle: "user-toggleable",
        navigation: [
          {
            id: "fixture",
            label: "Fixture",
            path: "/settings",
            icon: "star",
            order: 40
          }
        ]
      };`
  );

  expect(() => scanModuleWeb({ rootDir })).toThrow(
    /module web route path "\/settings" is reserved by the app shell/i
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-web-reserved-paths.test.ts`
Expected: FAIL on the new test — `scanModuleWeb` currently registers `/settings` for `fixture`
without throwing (no reserved-path check yet); the drift-guard test from Task 1 still passes.

- [ ] **Step 3: Implement the enforcement**

In `packages/settings-ui/src/scanner.ts`, inside `scanModuleWeb`, change:

```ts
export function scanModuleWeb(options: ScanOptions): WebScanResult {
  const routes: GeneratedWebRoute[] = [];
  const contributions: Record<string, string> = {};
  const manifestFiles: string[] = [];
  const seenPaths = new Map<string, string>();
```

to:

```ts
export function scanModuleWeb(options: ScanOptions): WebScanResult {
  const routes: GeneratedWebRoute[] = [];
  const contributions: Record<string, string> = {};
  const manifestFiles: string[] = [];
  const seenPaths = new Map<string, string>();
  const reservedPaths = new Set(SHELL_RESERVED_WEB_PATHS);
```

and change the navigation loop from:

```ts
    for (const entry of manifest.navigation) {
      const owner = seenPaths.get(entry.path);
      if (owner) {
        throw new Error(
          `duplicate web route path "${entry.path}" claimed by "${owner}" and "${manifest.id}"`
        );
      }
      seenPaths.set(entry.path, manifest.id);
```

to:

```ts
    for (const entry of manifest.navigation) {
      if (reservedPaths.has(entry.path)) {
        throw new Error(
          `module web route path "${entry.path}" is reserved by the app shell and cannot be claimed by "${manifest.id}"`
        );
      }
      const owner = seenPaths.get(entry.path);
      if (owner) {
        throw new Error(
          `duplicate web route path "${entry.path}" claimed by "${owner}" and "${manifest.id}"`
        );
      }
      seenPaths.set(entry.path, manifest.id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/module-web-reserved-paths.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full existing scanner + route-metadata suites for regressions**

Run: `pnpm vitest run tests/unit/module-web-scanner.test.ts tests/unit/web-route-metadata.test.ts tests/unit/module-web-browser-safety.test.ts tests/unit/module-settings-ui-contract.test.ts`
Expected: PASS, zero behavior change to the existing sports-only scan output.

- [ ] **Step 6: Commit**

```bash
git add packages/settings-ui/src/scanner.ts tests/unit/module-web-reserved-paths.test.ts
git commit -m "feat(settings-ui): reject module web routes colliding with shell-reserved paths"
```

---

## Exit Criteria (from issue #835)

- [x] Task 1 covers: drift guard tying the denylist to the shell entries in `app-route-metadata.ts`.
- [x] Task 2 covers: fixture test — a module declaring a shell-reserved path fails `scanModuleWeb`
      with a clear error.

## Verification (before wrap-up)

- `pnpm format:check && pnpm lint && pnpm typecheck` (pre-push trio).
- `pnpm vitest run tests/unit/module-web-reserved-paths.test.ts tests/unit/module-web-scanner.test.ts tests/unit/web-route-metadata.test.ts`
- Full gate per `coordinated-wrap-up` before opening the PR.
