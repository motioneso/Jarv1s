# External-module navigation ABI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> NOTE (this build): the `coordinated-build` skill governing this run disables both execution
> skills above — tasks are driven inline, self-directed, task-by-task with
> `superpowers:test-driven-development`, not by subagent dispatch or `executing-plans`.

**Goal:** Fix #1019 — installed external (downloadable) modules get no navigation entry because
`serializeExternalModule` hardcodes `navigation: []`. Let a module manifest declare 1-4 nav
entries; validate them defensively; surface them in the shell under a new "Modules" section.

**Architecture:** Extend the external-module ABI (`JsonJarvisModuleManifest`) with an optional,
positively-validated `navigation` field (mirrors the #964 `database` field precedent exactly).
Carry it through `reconcileExternalModules` → `ReconciledExternalModule.navigation`. In
`serializeExternalModule`, map each entry to the existing wire type `ModuleNavigationEntryDto`,
prefixing `path` with `/m/<moduleId>` — this is the ONLY place that turns a manifest-declared
relative path into a real route. On the web side, `buildShellNavigation` gains module context so
`external: true` entries bypass the built-in `SECTION_OF` table entirely and land in a new
"Modules" section appended after "You" (existing tail mechanism, no new sort logic needed).

**Tech Stack:** TypeScript, Fastify (`apps/api`), React Router (`apps/web`), Vitest, pnpm
workspaces. No new dependencies.

## Global Constraints (from the approved spec, `docs/superpowers/specs/2026-07-13-external-module-navigation-abi.md`)

- D1: `navigation` is optional on the manifest. NO `schemaVersion` bump — existing v1 manifests
  with no `navigation` must still validate.
- D2: wire shape = the existing `ModuleNavigationEntryDto` (`packages/shared/src/platform-api.ts`)
  — already fully declared in the fast-json-stringify schema (`moduleSchema` /
  `moduleNavigationEntrySchema`). **No shared-schema change needed.** Manifest subset is narrower:
  `{id, label, path, icon?, order?}` — reject the built-in-only `permissionId`/`featureFlagId`.
- D3: manifest `path` is module-relative. `serializeExternalModule` is the single choke point that
  prefixes `/m/<moduleId>`. Validator rejects `..`, `.`, `//`, `\`, `?`, `#`; path segments must
  match `[a-z0-9-]`; path ≤128 chars.
- D4: icon is a validated slug with a safe fallback (`Layers3`) in the shell — no allowlist table.
  Add `briefcase` to the shell `iconMap`.
- D5: new labeled "Modules" nav section appended after "You". External entry ids MUST be
  `<moduleId>`-prefixed (anti-spoof vs `HIDDEN_NAV_IDS` / `SECTION_OF`). External entries never
  consult `SECTION_OF`.
- D6: caps — 1-4 entries; label ≤40 chars; id ≤64 chars (prefixed + unique); `|order| ≤ 10000`;
  unknown keys on a nav entry are rejected (mirrors the #964 `database` rule).
- D7: job-search manifest declares one root entry: `path: "/"`, label `"Job Search"`, icon
  `"briefcase"`. **Deviation flagged, not applied:** the spec also says to bump
  `compatibility.jarv1s` "to the core version that ships this ABI" — `CORE_VERSION` has never been
  bumped past `"0.1.0"` and no prior capability-adding manifest change (#918 auth/storage/web, #964
  database) bumped `compatibility.jarv1s` either. This plan leaves `CORE_VERSION` and
  `compatibility.jarv1s` at `">=0.1.0"` (still trivially satisfied) and flags the deviation to the
  coordinator instead of silently diverging from established practice.
- D8: API — add `navigation` to `ReconciledExternalModule`, carry it through
  `reconcileExternalModules`, map+prefix it in `serializeExternalModule`, drop the hardcoded `[]`.
  Settings surface stays `[]` (unchanged).
- D9: tests — validator (rejects over-cap / traversal / absolute / unknown-key), reconcile carries
  `navigation`, `app.inject` on `/api/modules` returns prefixed entries, `buildShellNavigation`
  renders the Modules section. **No migration** — do not touch `infra/postgres/migrations/` or
  `foundation-schema-catalog`.
- D10: dev-UAT is a HARD exit gate — isolated stack, real signup, Playwright click-through (see
  the handoff doc; not part of this plan's tasks, run after Task 9 passes).
- Add generous why-comments citing **#1019** at every guard: the prefix choke point, the validator
  path rules, the caps.

---

### Task 1: Add `ExternalModuleNavigationEntry` to the module-sdk ABI types

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Test: `tests/unit/module-sdk-external-types.test.ts` (existing file, add one case)

**Interfaces:**

- Produces: `ExternalModuleNavigationEntry { id, label, path, icon?, order? }`, and
  `JsonJarvisModuleManifest.navigation?: readonly ExternalModuleNavigationEntry[]` — every later
  task imports `ExternalModuleNavigationEntry` from `@jarv1s/module-sdk`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/module-sdk-external-types.test.ts` (append inside the existing top-level
`describe`, using the file's existing imports — this file only type-checks fixtures through
`validateExternalModuleManifest`, so add via a small integration-style check that the type compiles
and round-trips through JSON):

```ts
it("accepts a manifest whose navigation field type-checks (module-sdk ABI shape)", () => {
  const manifest: import("@jarv1s/module-sdk").JsonJarvisModuleManifest = {
    schemaVersion: 1,
    id: "acme-widgets",
    name: "Acme Widgets",
    version: "0.1.0",
    publisher: "Acme, Inc.",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.1.0" },
    navigation: [{ id: "acme-widgets", label: "Acme Widgets", path: "/" }]
  };
  expect(manifest.navigation?.[0]?.id).toBe("acme-widgets");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-sdk-external-types.test.ts`
Expected: FAIL — TypeScript error, `navigation` does not exist on type `JsonJarvisModuleManifest`.

- [ ] **Step 3: Write minimal implementation**

In `packages/module-sdk/src/index.ts`, insert a new interface immediately after
`ExternalModuleDatabaseDeclaration` (after the line `readonly ownedTables: readonly string[];` /
closing `}` at what is currently lines 626-628), i.e. right before the
`/**\n * The JSON-serializable subset...` doc comment for `JsonJarvisModuleManifest`:

```ts
/**
 * A single nav-menu entry a downloadable module contributes (#1019). Narrower than the
 * built-in `ModuleNavigationEntryManifest` — deliberately omits `permissionId` /
 * `featureFlagId` (those gate built-in-only surfaces); an external module cannot declare
 * either through this ABI. `path` is module-relative; `serializeExternalModule`
 * (apps/api/src/server.ts) is the ONLY place that turns it into a real route by prefixing
 * it with `/m/<moduleId>`.
 */
export interface ExternalModuleNavigationEntry {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly order?: number;
}
```

Then add the field to `JsonJarvisModuleManifest` (currently ends `readonly database?:
ExternalModuleDatabaseDeclaration;` followed by the closing `}`):

```diff
   readonly database?: ExternalModuleDatabaseDeclaration;
+  /**
+   * Nav-menu entries this module contributes (#1019). Optional — a metadata-only module
+   * declares none and gets no nav entry, same as before this field existed. 1-4 entries,
+   * validated positively in packages/module-registry/src/external/validate.ts.
+   */
+  readonly navigation?: readonly ExternalModuleNavigationEntry[];
 }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/module-sdk-external-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/module-sdk/src/index.ts tests/unit/module-sdk-external-types.test.ts
git commit -m "feat(module-sdk): add ExternalModuleNavigationEntry ABI type (#1019)"
```

---

### Task 2: Validate `navigation` in `validateExternalModuleManifest`

**Files:**

- Modify: `packages/module-registry/src/external/validate.ts`
- Test: `tests/unit/external-validate.test.ts` (existing file — replace one stale test, add new ones)

**Interfaces:**

- Consumes: `ExternalModuleNavigationEntry` from `@jarv1s/module-sdk` (Task 1).
- Produces: `validateExternalModuleManifest(...)` now accepts a well-formed `navigation` array and
  returns it on `result.manifest.navigation`; rejects malformed ones with an error string
  containing `"navigation"`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/external-validate.test.ts`, **replace** the existing test (lines 74-82) —
`"rejects an executable/surface field (navigation)"` — since navigation is no longer forbidden.

**Coordinator hard requirement (D7 approval, 2026-07-13):** with `compatibility.jarv1s` staying
unbumped, `FORBIDDEN_FIELDS` unknown-field rejection is now the SOLE fail-closed guard for an old
core parsing a manifest with fields it doesn't understand yet (an old core must reject the whole
manifest before it ever reaches a field like `navigation`). Do NOT just delete the only test that
exercises that rejection path — replace it with an equivalent test against a field that is _still_
forbidden (`"routes"`, unaffected by this change), so `FORBIDDEN_FIELDS` coverage is preserved
verbatim, not weakened:

```ts
it("still rejects an executable/surface field that remains forbidden (routes) — the sole fail-closed guard for old cores now that compatibility.jarv1s is not bumped for this ABI addition", () => {
  const result = validateExternalModuleManifest(
    { ...base, routes: [{ path: "/x", handler: "x" }] },
    "acme-widgets",
    "0.1.0"
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(" ")).toContain("routes");
});

it("accepts a well-formed navigation declaration", () => {
  const result = validateExternalModuleManifest(
    {
      ...base,
      navigation: [{ id: "acme-widgets", label: "Widgets", path: "/", icon: "briefcase", order: 5 }]
    },
    "acme-widgets",
    "0.1.0"
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.manifest.navigation).toEqual([
      { id: "acme-widgets", label: "Widgets", path: "/", icon: "briefcase", order: 5 }
    ]);
  }
});

it("still accepts a manifest with no navigation block (metadata-only module)", () => {
  const result = validateExternalModuleManifest(base, "acme-widgets", "0.1.0");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.manifest.navigation).toBeUndefined();
});

it("rejects an id that is not prefixed with the module id (anti-spoof)", () => {
  const result = validateExternalModuleManifest(
    { ...base, navigation: [{ id: "settings", label: "Settings", path: "/" }] },
    "acme-widgets",
    "0.1.0"
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(" ")).toContain("navigation entry id");
});

it("rejects duplicate navigation ids", () => {
  const entry = { id: "acme-widgets", label: "Widgets", path: "/" };
  const result = validateExternalModuleManifest(
    { ...base, navigation: [entry, entry] },
    "acme-widgets",
    "0.1.0"
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(" ")).toContain("unique");
});

it("rejects a navigation path that escapes the module (traversal / absolute / host)", () => {
  for (const path of ["..", "/../x", "//evil.com", "/a//b", "/a\\b", "/a?x=1", "/a#frag", "x"]) {
    const result = validateExternalModuleManifest(
      { ...base, navigation: [{ id: "acme-widgets", label: "Widgets", path }] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  }
});

it("rejects zero, more than 4, and unknown-key navigation entries", () => {
  const tooMany = Array.from({ length: 5 }, (_, i) => ({
    id: `acme-widgets.item-${i}`,
    label: `Item ${i}`,
    path: `/item-${i}`
  }));
  for (const navigation of [
    [],
    tooMany,
    [{ id: "acme-widgets", label: "Widgets", path: "/", permissionId: "acme-widgets.x" }]
  ]) {
    const result = validateExternalModuleManifest({ ...base, navigation }, "acme-widgets", "0.1.0");
    expect(result.ok).toBe(false);
  }
});

it("rejects an over-long label and an out-of-range order", () => {
  const overLongLabel = { id: "acme-widgets", label: "x".repeat(41), path: "/" };
  const overRangeOrder = { id: "acme-widgets", label: "Widgets", path: "/", order: 10_001 };
  for (const entry of [overLongLabel, overRangeOrder]) {
    const result = validateExternalModuleManifest(
      { ...base, navigation: [entry] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/external-validate.test.ts`
Expected: FAIL — `"accepts a well-formed navigation declaration"` fails because `navigation` is
still in `FORBIDDEN_FIELDS` (error contains `"is not permitted"`, `result.ok` is `false`). The new
`"routes"` FORBIDDEN_FIELDS test passes already (routes was never touched) — that's expected; it's
there to pin current behavior, not to go red-then-green.

- [ ] **Step 3: Write minimal implementation**

In `packages/module-registry/src/external/validate.ts`:

1. Add `ExternalModuleNavigationEntry` to the type import block (after
   `ExternalModuleDatabaseDeclaration`):

```diff
 import type {
   JsonJarvisModuleManifest,
   ExternalModuleAssistantToolDeclaration,
   ExternalModuleDatabaseDeclaration,
+  ExternalModuleNavigationEntry,
   ExternalModuleWorkerDeclaration,
   ModuleAuthDeclaration,
   ModuleLifecycle,
   ModuleStorageDeclaration,
   ModuleWebDeclaration
 } from "@jarv1s/module-sdk";
```

2. Remove `"navigation"` from `FORBIDDEN_FIELDS` and update the doc comment above it:

```diff
-// Every field of the compiled JarvisModuleManifest that carries executable behavior
-// or a UI/data surface. Presence of ANY of these in an external manifest is a
-// rejection. `auth`/`storage`/`web` are first-class as of #918 Slice 2 and `database`
-// as of #964 (validated positively below) and are deliberately absent from this list.
+// Every field of the compiled JarvisModuleManifest that carries executable behavior
+// or a UI/data surface. Presence of ANY of these in an external manifest is a
+// rejection. `auth`/`storage`/`web` are first-class as of #918 Slice 2, `database` as
+// of #964, and `navigation` as of #1019 (each validated positively below) and are
+// deliberately absent from this list.
 const FORBIDDEN_FIELDS: readonly string[] = [
   "availability",
-  "navigation",
   "settings",
```

3. Update the file-header comment (lines 1-5) so it no longer claims nav is unconditionally
   rejected:

```diff
 // Pure, browser-safe validation of an external module's jarvis.module.json (#917).
-// Slice 1 accepts METADATA ONLY: identity + compatibility. Any executable or
-// surface-contributing field is rejected so an external module can never inject
-// nav/routes/tools/SQL before the slices that safely host those land. No node:*
-// imports here — this is re-exported from @jarv1s/module-registry's browser entry.
+// Slice 1 accepts METADATA ONLY: identity + compatibility, plus a small allow-listed set
+// of surfaces (auth/storage/web/database/navigation) each validated positively below.
+// Any OTHER executable or surface-contributing field is rejected so an external module
+// can never inject routes/tools/SQL before the slices that safely host those land. No
+// node:* imports here — this is re-exported from @jarv1s/module-registry's browser entry.
```

4. Insert navigation validation right after the `database` block (after its closing `}` at what is
   currently line 463, before `if (errors.length > 0) return { ok: false, errors };`):

```ts
// #1019: positive validation of the navigation declaration (previously forbidden — see
// the FORBIDDEN_FIELDS carve-out above). Caps mirror the #964 database-capability rule:
// bounded count, bounded string lengths, unknown keys rejected outright (rather than
// silently dropped) so a manifest can't smuggle built-in-only fields like `permissionId`
// / `featureFlagId` (ModuleNavigationEntryManifest) through the external ABI.
let navigation: readonly ExternalModuleNavigationEntry[] | undefined;
if (obj.navigation !== undefined) {
  if (!Array.isArray(obj.navigation)) {
    errors.push("navigation must be an array");
  } else if (obj.navigation.length === 0 || obj.navigation.length > 4) {
    errors.push("navigation must declare between 1 and 4 entries");
  } else {
    const ids = new Set<string>();
    const validated: ExternalModuleNavigationEntry[] = [];
    for (const entry of obj.navigation) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push("navigation entries must be objects");
        continue;
      }
      const navEntry = entry as Record<string, unknown>;
      const unknownKeys = Object.keys(navEntry).filter(
        (key) => !["id", "label", "path", "icon", "order"].includes(key)
      );
      if (unknownKeys.length > 0) {
        errors.push(`navigation entry contains unknown fields: ${unknownKeys.join(", ")}`);
      }
      const { id, label, path, icon, order } = navEntry;
      let entryValid = unknownKeys.length === 0;

      // #1019 (D5): anti-spoof — a nav entry id must be prefixed with this module's own
      // id, mirroring the storage-namespace check above, so an external module can never
      // collide with a built-in HIDDEN_NAV_IDS / SECTION_OF key
      // (apps/web/src/app-route-metadata.ts).
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 64 ||
        (id !== expectedId && !id.startsWith(`${expectedId}.`))
      ) {
        errors.push(
          `navigation entry id must be "${expectedId}" or "${expectedId}.<slug>" (max 64 chars)`
        );
        entryValid = false;
      } else if (ids.has(id)) {
        errors.push(`navigation entry id must be unique: ${id}`);
        entryValid = false;
      } else {
        ids.add(id);
      }

      if (typeof label !== "string" || label.length === 0 || label.length > 40) {
        errors.push("navigation entry label must be a non-empty string (max 40 chars)");
        entryValid = false;
      }

      // #1019 (D3): path is validated module-relative here; apps/api/src/server.ts
      // serializeExternalModule is the ONLY place that turns it into a real route, by
      // prefixing it with /m/<moduleId>. Rejecting ".." "//" "\" "?" "#" and restricting
      // segments to [a-z0-9-] means a manifest can never smuggle an absolute or host
      // route through this field.
      if (
        typeof path !== "string" ||
        path.length === 0 ||
        path.length > 128 ||
        !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path)
      ) {
        errors.push(
          `navigation entry path must be a clean module-relative path (e.g. "/" or "/settings"): ${String(path)}`
        );
        entryValid = false;
      }

      if (
        icon !== undefined &&
        (typeof icon !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(icon))
      ) {
        errors.push("navigation entry icon must be a lowercase kebab-case slug (max 32 chars)");
        entryValid = false;
      }

      if (
        order !== undefined &&
        (typeof order !== "number" || !Number.isFinite(order) || Math.abs(order) > 10_000)
      ) {
        errors.push("navigation entry order must be a number with absolute value <= 10000");
        entryValid = false;
      }

      if (entryValid) {
        validated.push({
          id: id as string,
          label: label as string,
          path: path as string,
          ...(icon !== undefined ? { icon: icon as string } : {}),
          ...(order !== undefined ? { order: order as number } : {})
        });
      }
    }
    if (errors.length === 0) {
      navigation = validated;
    }
  }
}
```

5. Add `navigation` to the final re-shape allowlist (after the `database` line):

```diff
     ...(worker !== undefined ? { worker } : {}),
     ...(obj.fetchHosts !== undefined ? { fetchHosts: obj.fetchHosts as readonly string[] } : {}),
-    ...(database !== undefined ? { database } : {})
+    ...(database !== undefined ? { database } : {}),
+    ...(navigation !== undefined ? { navigation } : {})
   };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-validate.test.ts`
Expected: PASS (all tests, including the pre-existing ones — confirm nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/external/validate.ts tests/unit/external-validate.test.ts
git commit -m "feat(module-registry): positively validate manifest navigation (#1019)"
```

---

### Task 3: Carry `navigation` through `ReconciledExternalModule`

**Files:**

- Modify: `packages/module-registry/src/external/types.ts`
- Modify: `packages/module-registry/src/external/reconcile.ts`
- Test: `tests/unit/external-reconcile.test.ts` (existing file, add cases)

**Interfaces:**

- Consumes: `ExternalModuleNavigationEntry` from `@jarv1s/module-sdk` (Task 1).
- Produces: `ReconciledExternalModule.navigation: readonly ExternalModuleNavigationEntry[]`
  (always present, defaults to `[]`) — Task 5 (`serializeExternalModule`) consumes this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/external-reconcile.test.ts` (uses the existing `discovery` helper — extend it to
optionally accept a manifest override, or add a second small helper; simplest is a local override
inline per test):

```ts
it("carries navigation from the manifest through to the reconciled module", () => {
  const nav = [{ id: "a", label: "A", path: "/" }];
  const withNav: ExternalModuleDiscovery = {
    ...discovery("a", "sha256:1"),
    manifest: { ...discovery("a", "sha256:1").manifest, navigation: nav }
  };
  const { modules } = reconcileExternalModules([withNav], []);
  expect(modules[0]?.navigation).toEqual(nav);
});

it("defaults navigation to an empty array when the manifest declares none", () => {
  const { modules } = reconcileExternalModules([discovery("a", "sha256:1")], []);
  expect(modules[0]?.navigation).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/external-reconcile.test.ts`
Expected: FAIL — `modules[0]?.navigation` is `undefined` (property does not exist yet on the
reconciled object; TypeScript will also fail to compile `.navigation` off `ReconciledExternalModule`
once accessed with `expect`, since the field doesn't exist).

- [ ] **Step 3: Write minimal implementation**

In `packages/module-registry/src/external/types.ts`, add the import and field:

```diff
+import type { ExternalModuleNavigationEntry } from "@jarv1s/module-sdk";
+
 export interface ReconciledExternalModule {
   readonly id: string;
   readonly name: string;
   readonly version: string;
   readonly publisher: string;
   readonly status: ExternalModuleStatus;
   readonly active: boolean;
   readonly drifted: boolean;
   readonly disabledReason: string | null;
   readonly web: { readonly entrypoint: string; readonly contractVersion: number } | null;
+  // #1019: nav-menu entries this module contributes; always present, defaults to [] for a
+  // metadata-only module. apps/api/src/server.ts serializeExternalModule maps + prefixes
+  // these into the wire-shape ModuleNavigationEntryDto.
+  readonly navigation: readonly ExternalModuleNavigationEntry[];
 }
```

(Confirm the actual top-of-file import block in `types.ts` before inserting — add
`ExternalModuleNavigationEntry` to any existing `@jarv1s/module-sdk` type import there instead of a
new import statement if one already exists.)

In `packages/module-registry/src/external/reconcile.ts`, add the field to the `base` object:

```diff
   const { id, manifest, packageHash } = discovery;
   const base = {
     id,
     name: manifest.name,
     version: manifest.version,
     publisher: manifest.publisher,
-    web: manifest.web ?? null
+    web: manifest.web ?? null,
+    // #1019: default to [] so every reconciled module has a navigation array — downstream
+    // code (serializeExternalModule, buildShellNavigation) never needs an undefined check.
+    navigation: manifest.navigation ?? []
   };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-reconcile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/external/types.ts packages/module-registry/src/external/reconcile.ts tests/unit/external-reconcile.test.ts
git commit -m "feat(module-registry): carry navigation through reconcileExternalModules (#1019)"
```

---

### Task 4: Add `briefcase` to the shell icon map

**Files:**

- Modify: `apps/web/src/shell/app-shell.tsx`

**Interfaces:**

- Produces: `iconMap["briefcase"]` resolves to `Briefcase` — Task 7's new test and the job-search
  manifest (Task 8) both depend on this key existing so the icon renders instead of falling back to
  `Layers3`.

This task has no isolated unit test (icon rendering is exercised end-to-end by dev-UAT, D10); make
the change directly and verify via `pnpm typecheck` (Briefcase must be a real `lucide-react`
export) plus a visual check in Task 9's dev-UAT pass.

- [ ] **Step 1: Add the import**

In `apps/web/src/shell/app-shell.tsx`, add `Briefcase` to the `lucide-react` import block
(alphabetical, before `CalendarDays`):

```diff
 import {
   Bell,
+  Briefcase,
   CalendarDays,
   CheckSquare,
   ChevronUp,
   FileText,
   HeartPulse,
   House,
   Layers3,
   LogOut,
   Mail,
   Menu,
   MessageSquare,
   Newspaper,
   Settings,
   Trophy
 } from "lucide-react";
```

- [ ] **Step 2: Add the icon-map entry**

```diff
 const iconMap: Record<string, ComponentType<{ readonly size?: number }>> = {
   house: House,
   bell: Bell,
+  briefcase: Briefcase,
   "calendar-days": CalendarDays,
   "check-square": CheckSquare,
   "file-text": FileText,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @jarv1s/web typecheck`
Expected: PASS (no unused-import or missing-export errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/shell/app-shell.tsx
git commit -m "feat(web): add briefcase icon to the shell nav icon map (#1019)"
```

---

### Task 5: Emit prefixed navigation from `serializeExternalModule`

**Files:**

- Modify: `apps/api/src/server.ts`
- Test: `tests/integration/external-modules-routes.test.ts` (existing file, extend fixture + add a case)

**Interfaces:**

- Consumes: `ReconciledExternalModule.navigation` (Task 3).
- Produces: `serializeExternalModule(m).navigation` — `ModuleNavigationEntryDto[]` with `path`
  prefixed `/m/<moduleId>`. This is the field the web shell (Task 7) renders.

- [ ] **Step 1: Write the failing test**

In `tests/integration/external-modules-routes.test.ts`, add `navigation` to the fixture manifest
written in `beforeAll` (the `acme-widgets` manifest JSON — insert alongside the existing
`compatibility` field):

```diff
       lifecycle: "optional",
       compatibility: { jarv1s: ">=0.1.0" },
+      navigation: [{ id: "acme-widgets", label: "Widgets", path: "/", icon: "briefcase", order: 3 }],
       runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
```

Then add a new assertion inside the existing `"enables the module, then /api/modules includes it
with external:true"` test, right after the existing `expect(listed).toMatchObject(...)` line:

```ts
expect(listed).toMatchObject({
  id: "acme-widgets",
  external: true,
  navigation: [
    { id: "acme-widgets", label: "Widgets", path: "/m/acme-widgets", icon: "briefcase", order: 3 }
  ]
});
```

(This replaces the standalone `expect(listed).toMatchObject({ id: "acme-widgets", external: true
});` line already there — fold the two assertions into one `toMatchObject` call.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/external-modules-routes.test.ts -t "enables the module"`
Expected: FAIL — `listed.navigation` is `[]`, not the expected prefixed entry (requires the
integration test DB; see `tests/integration/test-database.ts` setup already used by this file — no
new setup needed, it's an existing suite).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/server.ts`, replace `serializeExternalModule` and its preceding comment:

```diff
-  // #917: an ACTIVE external module surfaces on /api/modules as metadata only — no
-  // navigation, no settings surfaces (Slice 1 modules declare none). external:true lets
-  // the shell tag it without loading any of its code.
+  // #1019: an ACTIVE external module surfaces on /api/modules with its manifest-declared
+  // navigation (validated + capped by validateExternalModuleManifest) — settings surfaces
+  // still stay [] (Slice 1 declares none). This is the ONLY place a manifest-relative nav
+  // path becomes a real app route: prefixing with /m/<moduleId> is what stops an external
+  // module from ever declaring an absolute or host route. external:true lets the shell tag
+  // it without loading any of its code.
   function serializeExternalModule(m: ReconciledExternalModule): ModuleDto {
     return {
       id: m.id,
       name: m.name,
       version: m.version,
       lifecycle: "optional",
-      navigation: [],
+      navigation: m.navigation.map((entry) => ({
+        id: entry.id,
+        label: entry.label,
+        path: entry.path === "/" ? `/m/${m.id}` : `/m/${m.id}${entry.path}`,
+        icon: entry.icon ?? null,
+        order: entry.order ?? null
+      })),
       settings: [],
       external: true,
       // #918: ModuleDto.web is optional — omit rather than emit null when the module
       // declares no web surface (ReconciledExternalModule.web itself IS nullable).
       ...(m.web ? { web: m.web } : {})
     };
   }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/external-modules-routes.test.ts`
Expected: PASS (full file — confirm no other test in the file broke from the fixture change).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts tests/integration/external-modules-routes.test.ts
git commit -m "fix(api): serialize prefixed navigation for external modules (#1019, Closes #1019)"
```

---

### Task 6: Add the "Modules" section to `buildShellNavigation`

**Files:**

- Modify: `apps/web/src/app-route-metadata.ts`
- Test: `tests/unit/web-route-metadata.test.ts` (existing file, extend helper + add a case)

**Interfaces:**

- Consumes: `ModuleDto.external` (existing field), `ModuleDto.navigation` (existing field).
- Produces: `buildShellNavigation(modules, disabledModuleIds): NavSection[]` now returns a
  `{ key: "Modules", label: "Modules", items: [...] }` section (appended after `"You"`) whenever
  any non-disabled module has `external === true` with nav entries.

- [ ] **Step 1: Write the failing test**

In `tests/unit/web-route-metadata.test.ts`, extend the `moduleWithNav` helper to accept an optional
`external` flag, then add a new test:

```diff
 function moduleWithNav(
   id: string,
   label: string,
   path: string,
   icon: string,
-  order: number
+  order: number,
+  external = false
 ): ModuleDto {
   return {
     id,
     name: label,
     version: "0.0.0",
     lifecycle: "optional",
     navigation: [{ id, label, path, icon, order }],
-    settings: []
+    settings: [],
+    ...(external ? { external: true } : {})
   };
 }
```

Add a new `it` inside the `describe("web route metadata", ...)` block, after the existing
`"keeps shell navigation policy..."` test:

```ts
it("places external-module navigation in a Modules section after You", () => {
  const modules: ModuleDto[] = [
    moduleWithNav("tasks", "Tasks", "/tasks", "check-square", 20),
    moduleWithNav("wellness", "Wellness", "/wellness", "heart-pulse", 50),
    moduleWithNav("job-search", "Job Search", "/m/job-search", "briefcase", 0, true)
  ];

  const sections = buildShellNavigation(modules, []);
  expect(sections.map((section) => section.key)).toEqual(["__top", "Plan", "You", "Modules"]);
  const modulesSection = sections.find((section) => section.key === "Modules");
  expect(modulesSection?.label).toBe("Modules");
  expect(modulesSection?.items).toEqual([
    { id: "job-search", label: "Job Search", path: "/m/job-search", icon: "briefcase", order: 0 }
  ]);
});

it("never lets an external module's entry consult SECTION_OF even if its id collides with a built-in section key", () => {
  const modules: ModuleDto[] = [
    moduleWithNav("wellness", "Fake Wellness", "/m/wellness", "briefcase", 0, true)
  ];
  const sections = buildShellNavigation(modules, []);
  const you = sections.find((section) => section.key === "You");
  const modulesSection = sections.find((section) => section.key === "Modules");
  expect(you).toBeUndefined();
  expect(modulesSection?.items.map((item) => item.id)).toEqual(["wellness"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/web-route-metadata.test.ts`
Expected: FAIL — current `buildShellNavigation` has no `"Modules"` key and routes the id-collision
case through `SECTION_OF["wellness"] = "You"` instead of a dedicated Modules section.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/app-route-metadata.ts`, replace the body of `buildShellNavigation`:

```diff
+const MODULES_SECTION = "Modules";
+
 export function buildShellNavigation(
   modules: readonly ModuleDto[],
   disabledModuleIds: readonly string[]
 ): NavSection[] {
   const disabled = new Set(disabledModuleIds);
   const entries = modules
     .filter((module) => !disabled.has(module.id))
-    .flatMap((module) => module.navigation)
-    .filter((entry) => !HIDDEN_NAV_IDS.has(entry.id))
+    .flatMap((module) =>
+      module.navigation
+        .filter((entry) => !HIDDEN_NAV_IDS.has(entry.id))
+        .map((entry) => ({ entry, external: module.external === true }))
+    )
     .sort((left, right) => {
-      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
-      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
-      return leftOrder - rightOrder || left.label.localeCompare(right.label);
+      const leftOrder = left.entry.order ?? Number.MAX_SAFE_INTEGER;
+      const rightOrder = right.entry.order ?? Number.MAX_SAFE_INTEGER;
+      return leftOrder - rightOrder || left.entry.label.localeCompare(right.entry.label);
     });

   const bySection = new Map<string, ModuleNavigationEntryDto[]>();
   bySection.set(TOP_SECTION, [todayNavEntry]);
-  for (const entry of entries) {
-    const section = SECTION_OF[entry.id] ?? TOP_SECTION;
+  for (const { entry, external } of entries) {
+    // #1019 (D5): an external module's entries NEVER consult SECTION_OF — they always land
+    // in the dedicated "Modules" tail section, even if the manifest id happens to collide
+    // with a built-in section key (the validator's #1019 id-prefix rule makes a real
+    // collision impossible, but the shell doesn't rely on that alone).
+    const section = external ? MODULES_SECTION : (SECTION_OF[entry.id] ?? TOP_SECTION);
     const bucket = bySection.get(section) ?? [];
     bucket.push(entry);
     bySection.set(section, bucket);
   }
```

The rest of the function (`orderedKeys` computation and the final `.map`) is unchanged — `"Modules"`
is not in `SECTION_ORDER`, so it naturally sorts into the tail portion via the existing
`[...bySection.keys()].filter((key) => !SECTION_ORDER.includes(key))` line, appended after
`"You"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/web-route-metadata.test.ts`
Expected: PASS (all tests, including the original ordering test — confirm `["__top", "Plan",
"You"]` still holds when no module has `external: true`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app-route-metadata.ts tests/unit/web-route-metadata.test.ts
git commit -m "feat(web): render external-module nav in a Modules section (#1019)"
```

---

### Task 7: Declare navigation in the job-search manifest

**Files:**

- Modify: `external-modules/job-search/jarvis.module.json`
- Test: `tests/unit/external-module-job-search-manifest.test.ts` (existing file, extend the first test)

**Interfaces:**

- Consumes: the Task 2 validator (the shipped manifest must pass it).
- Produces: the real on-disk manifest that dev-UAT (D10) installs and clicks through.

- [ ] **Step 1: Write the failing test**

In `tests/unit/external-module-job-search-manifest.test.ts`, extend the first test, `"accepts the
shipped manifest against the merged ABI"`, adding an assertion for `navigation` (append to whatever
assertions already exist in that test body, using the same `result.manifest` variable):

```ts
expect(result.manifest.navigation).toEqual([
  { id: "job-search", label: "Job Search", path: "/", icon: "briefcase" }
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: FAIL — `result.manifest.navigation` is `undefined` (the on-disk manifest has no
`navigation` field yet).

- [ ] **Step 3: Write minimal implementation**

In `external-modules/job-search/jarvis.module.json`, add a `navigation` array. Insert it near the
top of the manifest, immediately after the `"compatibility"` field (before `"storage"`), following
the file's existing key ordering convention:

```diff
   "compatibility": { "jarv1s": ">=0.1.0" },
+  "navigation": [
+    { "id": "job-search", "label": "Job Search", "path": "/", "icon": "briefcase" }
+  ],
   "storage": [
```

(Do not touch `compatibility.jarv1s` — see the Global Constraints D7 deviation note; flagged to the
coordinator, not applied here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: PASS (full file — this manifest is also exercised by `hashExternalPackage`-adjacent tests
elsewhere; a manifest content change shifts its hash, which is expected and is exactly why D7 notes
"packageHash drift → admin must re-enable" for the real running instance. No test in this repo
asserts a literal hash value for job-search, so no other test should break.)

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/jarvis.module.json tests/unit/external-module-job-search-manifest.test.ts
git commit -m "feat(job-search): declare a Job Search nav entry (#1019)"
```

---

### Task 8: Full-suite verification pass

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full unit + integration suite**

Run: `pnpm test:unit && pnpm test:integration`
Expected: PASS. Pay particular attention to any other test that reads `/api/modules` output or
`ModuleDto` shape and could be affected by the now-non-empty `navigation` array on an
`external: true` module (grep first: `grep -rln "external.*true" tests/`).

- [ ] **Step 2: Run the full local gate**

Run: `pnpm verify:foundation`
Expected: PASS. Record the exact exit code in the wrap-up report (per `coordinated-build` /
`coordinated-wrap-up` requirements) — this is the final gate before dev-UAT (D10, handoff-doc HARD
exit gate, not part of this plan's tasks) and PR.

- [ ] **Step 3: Commit** (only if Step 1/2 required any follow-up fixes; otherwise skip — nothing to
      commit from a clean verification pass)

---

## Self-review notes (spec coverage)

- D1 (optional field, no schemaVersion bump): Task 1 (`navigation?`), Task 2 (`schemaVersion`
  untouched, existing "still accepts a manifest with no navigation block" test).
- D2 (wire shape = `ModuleNavigationEntryDto`, no shared-schema change): confirmed in Global
  Constraints; Task 5 emits exactly that shape; no `packages/shared/src/platform-api.ts` task
  exists because none is needed.
- D3 (module-relative path, single prefix choke point, forbidden chars): Task 2 (validator regex +
  traversal test), Task 5 (the one prefixing site).
- D4 (icon slug + fallback, `briefcase` in shell): Task 2 (icon slug validation), Task 4 (iconMap).
- D5 (Modules section, id anti-spoof, bypass SECTION_OF): Task 2 (id-prefix validator), Task 6
  (section placement + bypass test).
- D6 (caps): Task 2, exhaustively tested (count, label length, id length/uniqueness, order range,
  unknown keys).
- D7 (job-search manifest + compatibility deviation): Task 7 + Global Constraints deviation note,
  **approved by the coordinator 2026-07-13** with one hard requirement — Task 2 must keep a test
  exercising `FORBIDDEN_FIELDS` rejection (now the sole old-core fail-closed guard since
  `compatibility.jarv1s` isn't bumped); satisfied by the `"routes"` test added alongside the
  navigation-acceptance tests, not a deletion of the old navigation-rejection test.
- D8 (API carry-through): Task 3 (`ReconciledExternalModule`/`reconcileExternalModules`), Task 5
  (`serializeExternalModule`).
- D9 (tests): every task carries its own tests; Task 8 is the full-suite confirmation pass.
- D10 (dev-UAT hard gate): explicitly out of scope for this plan (no task performs it) — it is the
  next step after Task 8 passes, per the handoff doc, using the isolated-stack + Playwright
  procedure already specified there.
- "No migration" constraint: no task in this plan touches `infra/postgres/migrations/` or
  `foundation-schema-catalog` — the DB row for an external module stores only id/status/hash,
  unaffected by this change (confirmed by reading `packages/module-registry/src/external/reconcile.ts`
  in full: `active/status/disabledReason` bookkeeping is untouched by Task 3's diff).
- Why-comments citing #1019 at each guard: present in Task 2 (prefix choke-point comment, path-rule
  comment, id anti-spoof comment), Task 3 (default-to-`[]` comment), Task 5 (choke-point comment),
  Task 6 (bypass-SECTION_OF comment), Task 1 (ABI-narrowing comment).
