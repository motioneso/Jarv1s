# Module Settings Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Repo override for this coordinated build: execute inline after coordinator approval. The execution/subagent skills are disabled by `coordinated-build`.

**Goal:** Let modules contribute settings UI from their own package through manifest metadata, a Vite-generated loader map, and shared settings UI atoms.

**Architecture:** Extract existing settings atoms into `@jarv1s/settings-ui`, keep `apps/web/src/settings/settings-ui.tsx` as a re-export shim, and add `entry?: string` to `ModuleSettingsSurfaceManifest`. A Vite plugin scans package manifests at build time and emits `virtual:jarvis-module-settings` with literal lazy imports plus metadata; web routes module rows to a small router with Suspense, per-surface error boundary, and fallback text. Legacy Briefings/Chat/Notifications stay hardcoded for now.

**Tech Stack:** TypeScript, React 19, Vite virtual module plugin, Vitest, existing workspace packages.

---

## Verified Current Branch State

- `packages/module-sdk/src/index.ts` has `ModuleSettingsSurfaceManifest` without `entry`.
- No `@jarv1s/settings-ui` package exists; only `HANDOFF.md` mentions that import.
- No `virtual:jarvis-module-settings` import/module exists.
- `apps/web/src/settings/settings-ui.tsx` still owns atoms.
- `apps/web/src/settings/settings-personal-data-panes.tsx` still hardcodes `BriefingSettings`, `ChatSettingsView`, and `NotificationSettings` behind `CONFIG_IDS`.
- `apps/web/vite.config.ts` has `plugins: [react()]`.
- Existing `/api/modules` already serializes declarative `settings[]` without `permissionId` or `entry`; the connector can rely on generated metadata for UI entry presence.

## Files

- Create: `packages/settings-ui/package.json`
- Create: `packages/settings-ui/tsconfig.json`
- Create: `packages/settings-ui/src/index.tsx`
- Create: `packages/settings-ui/src/router.tsx`
- Create: `packages/settings-ui/src/scanner.ts`
- Create: `packages/settings-ui/src/vite.ts`
- Modify: `packages/module-sdk/src/index.ts`
- Modify: `apps/web/src/settings/settings-ui.tsx`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Modify: `apps/web/src/vite-env.d.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Test: `tests/unit/module-settings-scanner.test.ts`
- Test: `tests/unit/module-settings-router.test.tsx`

## Task 1: Manifest Contract + Extracted Atoms

**Files:**
- Modify: `packages/module-sdk/src/index.ts`
- Create: `packages/settings-ui/package.json`
- Create: `packages/settings-ui/tsconfig.json`
- Create: `packages/settings-ui/src/index.tsx`
- Modify: `apps/web/src/settings/settings-ui.tsx`
- Modify: `apps/web/package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write minimal type/import test**

Create `tests/unit/module-settings-ui-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModuleSettingsSurfaceManifest } from "@jarv1s/module-sdk";
import { formatTimestamp } from "@jarv1s/settings-ui";

describe("settings UI package contract", () => {
  it("allows module manifests to declare a settings entry", () => {
    const surface: ModuleSettingsSurfaceManifest = {
      id: "fixture.settings",
      label: "Fixture",
      path: "/settings/modules/fixture",
      scope: "user",
      entry: "./settings"
    };

    expect(surface.entry).toBe("./settings");
  });

  it("exports existing settings atom helpers", () => {
    expect(formatTimestamp("not-a-date", "fallback")).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run tests/unit/module-settings-ui-contract.test.ts`

Expected: FAIL because `@jarv1s/settings-ui` does not resolve and `entry` is not typed.

- [ ] **Step 3: Add the smallest package + shim**

Add `entry?: string` to `ModuleSettingsSurfaceManifest`.

Move the current contents of `apps/web/src/settings/settings-ui.tsx` into `packages/settings-ui/src/index.tsx`, adding this exported prop type:

```ts
export interface ModuleSettingsSurfaceProps {
  readonly onBack: () => void;
  readonly onSelectSection?: (cat: string) => void;
  readonly onNavigate?: (path: string) => void;
}
```

Replace `apps/web/src/settings/settings-ui.tsx` with:

```ts
export * from "@jarv1s/settings-ui";
```

Create `packages/settings-ui/package.json` with workspace deps already present in the repo:

```json
{
  "name": "@jarv1s/settings-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.tsx",
    "./vite": "./src/vite.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jarv1s/shared": "workspace:*",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0"
  }
}
```

Create `packages/settings-ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Add `@jarv1s/settings-ui` to `apps/web/package.json`, root `tsconfig.json` paths, and root `vitest.config.ts` aliases.

- [ ] **Step 4: Verify package contract**

Run: `pnpm vitest run tests/unit/module-settings-ui-contract.test.ts && pnpm --filter @jarv1s/settings-ui typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module-sdk/src/index.ts packages/settings-ui apps/web/src/settings/settings-ui.tsx apps/web/package.json tsconfig.json vitest.config.ts tests/unit/module-settings-ui-contract.test.ts
git commit -m "feat: extract settings ui package"
```

## Task 2: Scanner + Virtual Module

**Files:**
- Create: `packages/settings-ui/src/scanner.ts`
- Create: `packages/settings-ui/src/vite.ts`
- Create: `tests/unit/module-settings-scanner.test.ts`
- Modify: `apps/web/src/vite-env.d.ts`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Write scanner tests**

Create temp fixture packages in `tests/unit/module-settings-scanner.test.ts` and assert:

```ts
expect(result.surfaces).toEqual([
  {
    moduleId: "fixture",
    moduleName: "Fixture",
    id: "fixture.settings",
    label: "Fixture",
    path: "/settings/modules/fixture",
    scope: "user",
    order: 10,
    hasEntry: true
  },
  {
    moduleId: "declarative",
    moduleName: "Declarative",
    id: "declarative.settings",
    label: "Declarative",
    path: "/settings/modules/declarative",
    scope: "user",
    order: null,
    hasEntry: false
  }
]);
expect(result.components.fixture).toContain('import("@jarv1s/fixture/settings")');
```

Also assert duplicate paths throw `/duplicate settings path "\/settings\/modules\/fixture"/i`.

- [ ] **Step 2: Run failing scanner test**

Run: `pnpm vitest run tests/unit/module-settings-scanner.test.ts`

Expected: FAIL because scanner does not exist.

- [ ] **Step 3: Implement scanner**

Implement `scanModuleSettings({ rootDir })` using existing `typescript` parser support from the repo toolchain, not ad hoc regex. Read workspace `packages/*/package.json`, plus `node_modules/@jarv1s-*` and `node_modules/@jarv1s/*` when present. For each package, parse `src/manifest.ts`, find the top-level manifest object, and extract only static string/number `settings[]` fields.

Return:

```ts
export interface GeneratedSettingsSurface {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly scope: "user" | "admin" | "system";
  readonly order: number | null;
  readonly hasEntry: boolean;
}

export interface ScanResult {
  readonly surfaces: readonly GeneratedSettingsSurface[];
  readonly components: Readonly<Record<string, string>>;
}
```

Normalize `entry` by stripping leading `./`; emit component imports as `@jarv1s/<package-name-without-scope>/<entry>`. Keep surfaces without `entry` in metadata with `hasEntry: false`.

- [ ] **Step 4: Implement Vite plugin**

`packages/settings-ui/src/vite.ts` exports:

```ts
export function jarvisModuleSettingsPlugin(options: { readonly rootDir?: string } = {}) {
  const virtualId = "virtual:jarvis-module-settings";
  const resolvedId = "\0" + virtualId;
  return {
    name: "jarvis-module-settings",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id: string) {
      if (id !== resolvedId) return undefined;
      const result = scanModuleSettings({ rootDir: options.rootDir ?? process.cwd() });
      return emitVirtualModule(result);
    }
  };
}
```

Generated module imports React and exports `MODULE_SETTINGS_COMPONENTS` and `MODULE_SETTINGS_SURFACES`.

Add `declare module "virtual:jarvis-module-settings"` to `apps/web/src/vite-env.d.ts`.

Register plugin in `apps/web/vite.config.ts`:

```ts
import { jarvisModuleSettingsPlugin } from "@jarv1s/settings-ui/vite";

plugins: [react(), jarvisModuleSettingsPlugin({ rootDir: new URL("../..", import.meta.url).pathname })]
```

- [ ] **Step 5: Verify scanner + Vite typecheck**

Run: `pnpm vitest run tests/unit/module-settings-scanner.test.ts && pnpm --filter @jarv1s/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/settings-ui/src/scanner.ts packages/settings-ui/src/vite.ts apps/web/src/vite-env.d.ts apps/web/vite.config.ts tests/unit/module-settings-scanner.test.ts
git commit -m "feat: generate module settings virtual module"
```

## Task 3: Router + Modules Pane Wiring

**Files:**
- Create: `packages/settings-ui/src/router.tsx`
- Modify: `packages/settings-ui/src/index.tsx`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Test: `tests/unit/module-settings-router.test.tsx`

- [ ] **Step 1: Write router tests**

Use `react-dom/server` and a tiny in-test lazy component. Assert contributed surface renders with props, fallback renders when `hasEntry` is true but no component exists, and an erroring component is contained by error boundary.

Expected assertions:

```ts
expect(markup).toContain("Fixture settings body");
expect(markup).toContain("Fixture settings");
expect(markup).toContain("client surface isn't installed");
expect(markup).toContain("settings failed to load");
```

- [ ] **Step 2: Run failing router test**

Run: `pnpm vitest run tests/unit/module-settings-router.test.tsx`

Expected: FAIL because router does not exist.

- [ ] **Step 3: Implement router**

Export `ModuleSettingsRouter`, `ModuleSettingsSurface`, and `findModuleSettingsSurface`.

Keep router dumb:
- Inputs: `moduleId`, `surfaces`, `components`, `onBack`, `onSelectSection`, `onNavigate`.
- Find first user-scope surface for the module.
- If no surface, render fallback.
- If surface has `hasEntry` but no component exists, render installed-code fallback.
- Else `Suspense` + class-local error boundary around lazy component.

- [ ] **Step 4: Wire ModulesPane**

In `settings-personal-data-panes.tsx`, import virtual module and router:

```ts
import {
  MODULE_SETTINGS_COMPONENTS,
  MODULE_SETTINGS_SURFACES
} from "virtual:jarvis-module-settings";
import { ModuleSettingsRouter } from "@jarv1s/settings-ui";
```

Change `view` state to include contributed ids:

```ts
type ModuleSettingsView = ModuleSub | { readonly moduleId: string };
```

Leave existing `CONFIG_IDS` first. For modules with generated surfaces, route Configure to `setView({ moduleId: module.id })`. Pass `onBack`, `onSelectSection`, and `onNavigate` to the router.

- [ ] **Step 5: Verify router + web typecheck**

Run: `pnpm vitest run tests/unit/module-settings-router.test.tsx && pnpm --filter @jarv1s/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/settings-ui/src/router.tsx packages/settings-ui/src/index.tsx apps/web/src/settings/settings-personal-data-panes.tsx tests/unit/module-settings-router.test.tsx
git commit -m "feat: route contributed module settings"
```

## Task 4: Build Smoke + Final Gate

**Files:**
- Modify only if previous tasks reveal a type/lint issue.

- [ ] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/module-settings-ui-contract.test.ts tests/unit/module-settings-scanner.test.ts tests/unit/module-settings-router.test.tsx
pnpm --filter @jarv1s/settings-ui typecheck
pnpm --filter @jarv1s/web typecheck
pnpm build:web
```

Expected: all exit 0; web build proves virtual module resolves.

- [ ] **Step 2: Run pre-push trio**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all exit 0. If rebase changes files, rerun focused checks.

- [ ] **Step 3: Commit any verification fixes**

Only if Step 1 or Step 2 required edits:

```bash
git add <exact changed files>
git commit -m "fix: stabilize module settings connector"
```

## Self-Review

- Spec coverage: manifest `entry`, extracted atoms, Vite scan plugin, virtual module, router fallback/error boundary, ModulesPane generic branch, Vite registration, focused tests, build smoke covered.
- Intentional deviation: `@jarv1s/settings-ui` declares `lucide-react` because extracted atoms already render lucide icons; this is an existing workspace dependency, not a new package.
- Out of scope preserved: no DB migrations, no API routes, no legacy Briefings/Chat/Notifications migration, no runtime plugin/MFE loader, no CSS move.
