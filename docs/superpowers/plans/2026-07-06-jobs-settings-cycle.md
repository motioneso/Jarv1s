# Untangle jobs↔settings↔proactive-monitoring dependency cycle — Implementation Plan

> **For agentic workers:** This plan is executed inline task-by-task with
> `superpowers:test-driven-development` (per `coordinated-build` — the subagent-driven/executing-plans
> sub-skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the workspace dependency cycle `jobs → settings → proactive-monitoring → jobs`
(plus the direct `settings ↔ jobs` 2-cycle) so `pnpm install` reports zero cyclic workspace
dependencies, and add an automated gate so a reintroduced cycle fails CI red instead of silently
passing.

**Architecture:** The only edge that closes the cycle is `packages/jobs/src/upgrade-notify.ts`
importing `SETTINGS_MODULE_ID` from `@jarv1s/settings` — purely to tag a notification's
`moduleId` with the literal string `"settings"`. Every other module in the repo that needs a
module-id string tag defines it as a local literal in its own file (precedent:
`packages/calendar/src/routes.ts:25`, `const CALENDAR_WRITEBACK_MODULE_ID = "calendar";`) rather
than importing another module's manifest constant — this is currently the **only** cross-package
`_MODULE_ID` import in the repo, and it directly violates the module-isolation Hard Invariant
("Modules collaborate only through declared public APIs/events"). Inlining the literal in `jobs`
and dropping the now-unused `@jarv1s/settings` workspace dependency removes both the direct
`settings↔jobs` cycle and the 3-cycle through `proactive-monitoring` in one edit — `settings → jobs`
and `proactive-monitoring → jobs` both remain (legitimate: settings enqueues data-export jobs;
proactive-monitoring registers pg-boss workers), but `jobs` no longer points back at either,
so the graph becomes acyclic.

Separately, `scripts/check-package-deps.ts` (the `check:package-deps` gate, part of
`verify:foundation`) currently only checks declared-vs-used workspace deps — it has no cycle
detection, so this exact regression could reappear silently. This plan adds a pure, unit-tested
`detectDependencyCycles` function and wires it into the script's `main()` so a cycle among
`@jarv1s/*` packages fails the gate red.

**Tech Stack:** TypeScript, tsx (scripts), vitest (`tests/unit`), pnpm workspaces.

## Global Constraints

- Never edit applied migrations; not applicable here (no SQL in this change).
- Module isolation Hard Invariant: modules collaborate only through declared public APIs/events —
  this plan is the fix, not a regression risk once landed.
- `git add` by explicit path only — never `git add -A` (per handoff run-specific ban).
- Work only in `packages/jobs`, `packages/settings`, `packages/proactive-monitoring`,
  `scripts/check-package-deps.ts`, `tests/unit/` — per collision notes, no other packages are
  touched by this run.
- `pnpm verify:foundation` must be green at the end; `pnpm install` must report **no** cyclic
  workspace dependency warning.

---

### Task 1: Pure cycle-detection function + unit tests

**Files:**

- Modify: `scripts/check-package-deps.ts` — add and `export` a pure function (no I/O), used by
  `main()` in Task 2.
- Create: `tests/unit/check-package-deps-cycles.test.ts`

**Interfaces:**

- Produces: `export function detectDependencyCycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][]`
  — `graph` maps a package name to the set of package names it directly depends on (only edges
  relevant to cycle detection need to be present, e.g. `@jarv1s/*` packages). Returns one array per
  distinct cycle found, each array being the cycle path in traversal order with the repeated start
  node appended at the end (e.g. `["@jarv1s/jobs", "@jarv1s/settings", "@jarv1s/jobs"]` for a
  2-cycle). Returns `[]` for an acyclic graph. Dedupes so the same cycle isn't reported once per
  entry node.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/check-package-deps-cycles.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { detectDependencyCycles } from "../../scripts/check-package-deps.js";

describe("detectDependencyCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/a", new Set(["@jarv1s/b"])],
      ["@jarv1s/b", new Set(["@jarv1s/c"])],
      ["@jarv1s/c", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("returns no cycles for a diamond (shared dependency, not a cycle)", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/a", new Set(["@jarv1s/b", "@jarv1s/c"])],
      ["@jarv1s/b", new Set(["@jarv1s/d"])],
      ["@jarv1s/c", new Set(["@jarv1s/d"])],
      ["@jarv1s/d", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("detects a direct 2-cycle", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/jobs", new Set(["@jarv1s/settings"])],
      ["@jarv1s/settings", new Set(["@jarv1s/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["@jarv1s/jobs", "@jarv1s/settings", "@jarv1s/jobs"]);
  });

  it("detects a 3-cycle through an intermediate package", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/jobs", new Set(["@jarv1s/settings"])],
      ["@jarv1s/settings", new Set(["@jarv1s/proactive-monitoring"])],
      ["@jarv1s/proactive-monitoring", new Set(["@jarv1s/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual([
      "@jarv1s/jobs",
      "@jarv1s/settings",
      "@jarv1s/proactive-monitoring",
      "@jarv1s/jobs"
    ]);
  });

  it("does not report a self-reference as a cycle", () => {
    const graph = new Map<string, Set<string>>([["@jarv1s/a", new Set(["@jarv1s/a"])]]);

    // A package can't declare a dependency on itself in package.json, but guard the
    // detector against it anyway so a malformed graph never throws or infinite-loops.
    expect(() => detectDependencyCycles(graph)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/check-package-deps-cycles.test.ts`
Expected: FAIL — `detectDependencyCycles` is not exported from `scripts/check-package-deps.ts`
(module has no such export yet).

- [ ] **Step 3: Write minimal implementation**

In `scripts/check-package-deps.ts`, add this function (place it after `loadPackageDescriptor`,
before `scanReferencedPackages` — pure graph logic grouped together):

```ts
/**
 * DFS cycle detection over the declared `@jarv1s/*` dependency graph (#834 — jobs, settings,
 * and proactive-monitoring formed a cycle because a package.json-declared dependency doesn't
 * show up any other way; `check:package-deps`'s existing undeclared/unused checks don't catch
 * cycles, so this is a separate pass over the same descriptors).
 */
export function detectDependencyCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function visit(node: string): void {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      const cyclePath = [...stack.slice(start), node];
      const key = canonicalCycleKey(cyclePath);
      if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        cycles.push(cyclePath);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      visit(dependency);
    }

    stack.pop();
    onStack.delete(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
}

/** Rotates a cycle path to start at its lexicographically smallest node, so the same cycle
 *  discovered from different entry points dedupes to one report. */
function canonicalCycleKey(cyclePath: string[]): string {
  const withoutRepeat = cyclePath.slice(0, -1);
  const minIndex = withoutRepeat.reduce(
    (best, _, index) => (withoutRepeat[index]! < withoutRepeat[best]! ? index : best),
    0
  );
  const rotated = [...withoutRepeat.slice(minIndex), ...withoutRepeat.slice(0, minIndex)];
  return rotated.join(">");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/check-package-deps-cycles.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-package-deps.ts tests/unit/check-package-deps-cycles.test.ts
git commit -m "test(check-package-deps): add pure cycle-detection function for #834"
```

---

### Task 2: Wire cycle detection into the `check:package-deps` gate

**Files:**

- Modify: `scripts/check-package-deps.ts:56-111` (`Violation` interface and `main()`)

**Interfaces:**

- Consumes: `detectDependencyCycles` from Task 1; `PackageDescriptor` (existing, unchanged) from
  `loadPackageDescriptor`.
- Produces: `main()` now also fails (`process.exitCode = 1`) when a cycle exists among any
  packages' declared `@jarv1s/*` dependencies, printing each cycle as
  `[cycle] <pkg-a> -> <pkg-b> -> ... -> <pkg-a>`.

- [ ] **Step 1: Manually verify the current (pre-fix) state reproduces the live cycle**

Run: `pnpm --filter @jarv1s/jobs exec node -e "console.log(require('./package.json').dependencies)"`
Expected: still lists `"@jarv1s/settings": "workspace:*"` (fix lands in Task 3, not yet).

This step just re-confirms — before wiring the gate — that the live graph you're about to point
the new code at still contains the real cycle, so Step 4 below is a genuine red run against real
repo state, not a synthetic one.

- [ ] **Step 2: Extend `Violation` and add the graph-build + check in `main()`**

Change the `Violation` interface (`scripts/check-package-deps.ts:56-60`):

```ts
interface Violation {
  readonly package: string;
  readonly kind: "undeclared" | "unused" | "cycle";
  readonly detail: string;
}
```

In `main()`, after the existing per-package `for` loop (right before the
`if (violations.length > 0)` block, `scripts/check-package-deps.ts:99-101`), add:

```ts
const dependencyGraph = new Map<string, Set<string>>();
for (const packageDirectory of packageDirectories) {
  const descriptor = await loadPackageDescriptor(packageDirectory);
  if (!descriptor) continue;
  const workspaceDeps = new Set(
    [...descriptor.declaredDependencyNames].filter((name) => name.startsWith("@jarv1s/"))
  );
  dependencyGraph.set(descriptor.name, workspaceDeps);
}

for (const cyclePath of detectDependencyCycles(dependencyGraph)) {
  violations.push({
    package: cyclePath[0]!,
    kind: "cycle",
    detail: cyclePath.join(" -> ")
  });
}
```

(This re-loads descriptors rather than threading them out of the earlier loop — `loadPackageDescriptor`
is a cheap single `readFile` + `JSON.parse`, and keeping the two passes independent avoids coupling
the new check's data shape to the existing loop's control flow.)

- [ ] **Step 3: Run the full check:package-deps script and confirm it goes RED on the live cycle**

Run: `pnpm check:package-deps`
Expected: exits 1, prints a `[cycle]` violation whose detail contains
`@jarv1s/jobs -> @jarv1s/settings -> @jarv1s/proactive-monitoring -> @jarv1s/jobs` (or the
equivalent rotation/direction — confirm it names all three packages).

This is the task's real test: the gate must catch the actual bug from #834 before you fix it,
proving the detector works against live repo state, not just the synthetic unit-test graphs.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-package-deps.ts
git commit -m "feat(check-package-deps): fail the gate on a workspace dependency cycle (#834)"
```

(Tree is intentionally red at `check:package-deps` after this commit — Task 3 fixes it. Do not
run full `verify:foundation` as a gate between Task 2 and Task 3; the point of Task 2 is to prove
the new check catches the real, still-present bug.)

---

### Task 3: Break the cycle — inline the module-id literal in `jobs`, drop the dependency

**Files:**

- Modify: `packages/jobs/src/upgrade-notify.ts:1-3`
- Modify: `packages/jobs/package.json` (remove `"@jarv1s/settings": "workspace:*"`)

**Interfaces:**

- Consumes: nothing new.
- Produces: `packages/jobs` no longer has any import of, or declared dependency on,
  `@jarv1s/settings`.

- [ ] **Step 1: Edit `packages/jobs/src/upgrade-notify.ts`**

Current top of file:

```ts
import type { DataContextDb } from "@jarv1s/db";
import { NotificationsRepository } from "@jarv1s/notifications";
import { SETTINGS_MODULE_ID } from "@jarv1s/settings";
import type { Job, PgBoss } from "./pg-boss.js";
import { UPGRADE_NOTIFY_QUEUE, registerDataContextWorker } from "./pg-boss.js";
import type { DataContextRunner } from "@jarv1s/db";
import type { UpgradeNotifyPayload } from "./upgrade-check.js";

export interface UpgradeNotifyOptions {
```

Replace with:

```ts
import type { DataContextDb } from "@jarv1s/db";
import { NotificationsRepository } from "@jarv1s/notifications";
import type { Job, PgBoss } from "./pg-boss.js";
import { UPGRADE_NOTIFY_QUEUE, registerDataContextWorker } from "./pg-boss.js";
import type { DataContextRunner } from "@jarv1s/db";
import type { UpgradeNotifyPayload } from "./upgrade-check.js";

// Local literal, not an import of @jarv1s/settings's own SETTINGS_MODULE_ID (#834): jobs is
// generic job infrastructure and must not depend on any specific module — that edge is what
// closed the jobs -> settings -> proactive-monitoring -> jobs cycle. Every other module in the
// repo that tags a notification/record with another module's id does the same (see
// packages/calendar/src/routes.ts's local CALENDAR_WRITEBACK_MODULE_ID). Must stay in sync with
// packages/settings/src/manifest.ts's SETTINGS_MODULE_ID ("settings").
const SETTINGS_MODULE_ID = "settings";

export interface UpgradeNotifyOptions {
```

(The rest of the file — `handleUpgradeNotifyJob`, `registerUpgradeNotifyWorker` — is unchanged;
`SETTINGS_MODULE_ID` is used exactly as before at line 32.)

- [ ] **Step 2: Remove the dependency from `packages/jobs/package.json`**

Read the file first, then remove the `"@jarv1s/settings": "workspace:*"` line from
`dependencies`, keeping the rest (including trailing-comma correctness — it's currently the last
entry per the earlier `pnpm install` output, so the new last entry needs its trailing comma
dropped).

- [ ] **Step 3: Reinstall to refresh the lockfile / workspace symlinks**

Run: `pnpm install`
Expected: succeeds with **no** "cyclic workspace dependencies" warning (previously printed for
`packages/jobs, packages/settings, packages/proactive-monitoring`).

- [ ] **Step 4: Confirm the existing upgrade-notify unit test still passes**

Run: `pnpm vitest run tests/unit/upgrade-notify.test.ts`
Expected: PASS, unchanged (behavior is identical — same literal string, same notification
`moduleId`).

- [ ] **Step 5: Confirm the gate is now green**

Run: `pnpm check:package-deps`
Expected: exits 0, prints "No undeclared or unused workspace package dependencies." with no
`[cycle]` line.

- [ ] **Step 6: Commit**

```bash
git add packages/jobs/src/upgrade-notify.ts packages/jobs/package.json pnpm-lock.yaml
git commit -m "fix(jobs): inline settings module id literal, drop cyclic workspace dependency (#834)"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full local gate**

Run: `pnpm verify:foundation`
Expected: exits 0. This runs lint, format:check, check:file-size, check:design-tokens,
check:no-ambient-dates, check:package-deps (now cycle-aware), typecheck, test:unit, db:migrate,
test:integration — record the exit code, don't pipe through `tail`.

- [ ] **Step 2: Re-confirm the cycle is gone at the pnpm-workspace level**

Run: `pnpm install`
Expected: no "cyclic workspace dependencies" warning in the output (this is the acceptance
criterion from the handoff, checked independently of the custom gate script).

- [ ] **Step 3: Record results**

Note the `verify:foundation` exit code and the absence of the cyclic-dependency warning in your
report to the coordinator (per `coordinated-wrap-up`) — no separate commit for this task.
