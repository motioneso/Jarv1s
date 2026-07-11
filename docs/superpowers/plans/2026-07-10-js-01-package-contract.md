# JS-01 — Job Search Package Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. _(In this repo those execution skills are disabled by
> coordination policy — the coordinated-build agent drives the plan inline, task by task.)_

**Goal:** Establish the Job Search external module as an independently buildable package under
`external-modules/job-search/` that activates fail-closed through the merged external-module
platform, without touching the default image, `BUILT_IN_MODULES`, or any platform internals.

**Architecture:** One package directory (manifest + TS sources + esbuild-produced `dist/`
artifacts) outside the pnpm workspace, a repo-level build script that bundles a self-contained CJS
worker and an ESM browser web root, and three test layers: manifest/ABI unit tests, artifact
fail-closed unit tests, and an enable/disable/drift integration fixture against the real API
server. No platform file is modified.

**Tech Stack:** TypeScript, esbuild 0.25.12 (root devDep), vitest, Fastify integration harness
(`app.inject`), `@jarv1s/module-registry` validate/loader/hash/reconcile ABI (merged
#914/#917/#918/#919/#915), `@jarv1s/module-sdk/worker` JSON-RPC worker SDK.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-job-search-js-01-package-contract.md` (issue #930,
  epic #913). Risk tier `sensitive` — fail closed, adversarial fixtures, document the contract.
- **No platform edits.** Everything lands under `external-modules/job-search/`,
  `scripts/build-external-module.ts`, `tests/`, `.dockerignore`, root `package.json` scripts, and
  this plan. Never touch `packages/module-registry`, `packages/module-sdk`, `apps/api`,
  `apps/web/src/external-modules/loader.ts` (collision: #916 lane), or `MODULE_ID_RE`.
- **No migrations, no domain data, no live fetch/AI.** Spec non-goals. Flag the coordinator if a
  migration ever seems needed.
- Core version comparator: `compatibility.jarv1s` takes a **single** comparator (`>=0.1.0`);
  compound ranges fail closed. `CORE_VERSION` is `0.1.0`.
- Worker entrypoint must be exactly `dist/worker.js`; `workerContractVersion` exactly `1`; web
  `contractVersion` `1` (host gate). Artifact `package.json` has **no** `"type"` field so
  `dist/worker.js` runs as CJS under plain `node`.
- All identifiers module-prefixed `job-search.` (see Spec deltas). Queue ≤16 / schedule ≤32
  limits; schedule scope must be `"user"`; cron is 5-field.
- Tests live in top-level `tests/` (`tests/unit/external-*.test.ts`,
  `tests/integration/external-module-*.test.ts`) — never co-located under `apps/`.
- `git add` by explicit path only (shared tree). Conventional commits with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.

## Spec Deltas (coordinator rulings, 2026-07-10 — inherit these in JS-02..09)

The spec/design predate the merged ABI on two points. The coordinator ruled both times to
**conform to the merged platform; never widen platform grammar**:

1. **Module id is plain kebab `job-search`, not the spec's dotted `jarv1s.job-search`.** The
   merged ABI forbids dots (`MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`,
   `packages/module-registry/src/external/validate.ts:24`) and requires the directory name to
   equal the id. Therefore: id `job-search`, directory `external-modules/job-search/`, every
   namespace/tool/permission/queue/schedule identifier prefixed `job-search.`. Editing
   `MODULE_ID_RE`/`validate.ts` to allow dots is a banned platform edit (module-isolation
   invariant).
2. **`permissionId == tool name` for every assistant tool.** The design's four shared permission
   ids (`.read`, `.manage-profile`, `.manage-monitors`, `.decide`) violate the merged
   unique-permission-per-tool rule (`validate.ts:392`). JS-01 declares one permission per tool,
   equal to the tool name. The consolidated permission model is **deferred to JS-06**.

## File Structure

```text
external-modules/job-search/
  jarvis.module.json        # the contract manifest (Task 1)
  package.json              # artifact metadata; deliberately no "type" (Task 3)
  tsconfig.json             # standalone typecheck project (Task 3)
  README.md                 # contract documentation (Task 3)
  src/web/index.ts          # web contract-v1 root, host-React only (Task 3)
  src/worker/index.ts       # SDK worker: 13 tool stubs + monitor.run (Task 3)
  dist/                     # build output — git-ignored (root .gitignore `dist/`), never committed
scripts/build-external-module.ts        # esbuild bundler, exported + CLI (Task 4)
tests/unit/external-module-job-search-manifest.test.ts   # Task 1
tests/unit/external-module-job-search-absence.test.ts    # Task 2
tests/unit/external-module-job-search-bundle.test.ts     # Task 4
tests/unit/external-module-job-search-failclosed.test.ts # Task 5
tests/integration/external-module-job-search.test.ts     # Task 6
.dockerignore              # += external-modules (Task 2)
package.json               # += check:external-modules, build:external:job-search (Tasks 3–4)
```

---

### Task 1: Contract manifest + manifest validation test

**Files:**

- Create: `external-modules/job-search/jarvis.module.json`
- Test: `tests/unit/external-module-job-search-manifest.test.ts`

**Interfaces:**

- Consumes: `validateExternalModuleManifest(manifest, dirName, coreVersion)` from
  `@jarv1s/module-registry` (returns `{ok: true, manifest} | {ok: false, errors}`).
- Produces: the canonical manifest every later task builds/serves/hashes. Queue name
  `job-search.monitor-run`, handler ids listed below — Task 3's worker must implement exactly
  these handlers.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/external-module-job-search-manifest.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

// JS-01 (#930): the REAL shipped manifest must pass the merged external ABI, and
// targeted mutations must fail closed. Spec deltas (coordinator 2026-07-10): plain
// kebab id `job-search` (dotted ids are rejected by MODULE_ID_RE) and
// permissionId == tool name (unique-per-tool rule).
const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);
const loadManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

describe("job-search manifest contract (#930)", () => {
  it("accepts the shipped manifest against the merged ABI", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("job-search");
    expect(result.manifest.web).toEqual({ entrypoint: "dist/web/index.js", contractVersion: 1 });
    expect(result.manifest.runtime).toEqual({
      workerEntrypoint: "dist/worker.js",
      workerContractVersion: 1
    });
    expect(result.manifest.assistantTools).toHaveLength(13);
    // Spec delta 2: one permission per tool, equal to the tool name.
    for (const tool of result.manifest.assistantTools ?? []) {
      expect(tool.permissionId).toBe(tool.name);
      expect(tool.name.startsWith("job-search.")).toBe(true);
    }
    // Seven user-scoped KV namespaces from the parent design.
    expect(result.manifest.storage?.map((entry) => entry.namespace)).toEqual([
      "job-search.onboarding",
      "job-search.profile",
      "job-search.resume",
      "job-search.monitors",
      "job-search.opportunities",
      "job-search.runs",
      "job-search.feed"
    ]);
    expect(result.manifest.storage?.every((entry) => entry.scopes.length === 1)).toBe(true);
    expect(result.manifest.storage?.every((entry) => entry.scopes[0] === "user")).toBe(true);
    // No MVP credentials: the auth section must be absent entirely.
    expect(result.manifest.auth).toBeUndefined();
    expect(result.manifest.fetchHosts).toEqual([
      "boards-api.greenhouse.io",
      "api.lever.co",
      "api.ashbyhq.com"
    ]);
    expect(result.manifest.worker?.queues).toEqual([
      { name: "job-search.monitor-run", handler: "monitor.run", retryLimit: 3 }
    ]);
    expect(result.manifest.worker?.schedules).toEqual([
      {
        id: "job-search.monitor-sweep",
        cron: "*/15 * * * *",
        scope: "user",
        jobKind: "job-search.monitor-sweep",
        queue: "job-search.monitor-run"
      }
    ]);
  });

  it("rejects the design's original dotted id (spec delta 1)", () => {
    const mutated = { ...loadManifest(), id: "jarv1s.job-search" };
    const result = validateExternalModuleManifest(mutated, "jarv1s.job-search", "0.1.0");
    expect(result.ok).toBe(false);
  });

  it("rejects duplicated permission ids (spec delta 2 guard)", () => {
    const manifest = loadManifest();
    const tools = manifest.assistantTools as Array<Record<string, unknown>>;
    // Simulate the design's shared-permission model: two tools, one permission id.
    const mutated = {
      ...manifest,
      assistantTools: [
        { ...tools[0], permissionId: "job-search.read" },
        { ...tools[1], permissionId: "job-search.read" }
      ]
    };
    const result = validateExternalModuleManifest(mutated, "job-search", "0.1.0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("unique");
  });

  it("rejects a wrong schemaVersion", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), schemaVersion: 2 },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects forbidden executable-surface fields", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), permissions: [] },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed on a compound compatibility range", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), compatibility: { jarv1s: ">=0.1.0 <0.2.0" } },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: FAIL — `ENOENT ... external-modules/job-search/jarvis.module.json`.

- [ ] **Step 3: Write the manifest**

```json
{
  "schemaVersion": 1,
  "id": "job-search",
  "name": "Job Search",
  "version": "0.1.0",
  "publisher": "Jarvis Project",
  "lifecycle": "optional",
  "compatibility": { "jarv1s": ">=0.1.0" },
  "storage": [
    { "namespace": "job-search.onboarding", "scopes": ["user"] },
    { "namespace": "job-search.profile", "scopes": ["user"] },
    { "namespace": "job-search.resume", "scopes": ["user"] },
    { "namespace": "job-search.monitors", "scopes": ["user"] },
    { "namespace": "job-search.opportunities", "scopes": ["user"] },
    { "namespace": "job-search.runs", "scopes": ["user"] },
    { "namespace": "job-search.feed", "scopes": ["user"] }
  ],
  "web": { "entrypoint": "dist/web/index.js", "contractVersion": 1 },
  "runtime": { "workerEntrypoint": "dist/worker.js", "workerContractVersion": 1 },
  "assistantTools": [
    {
      "name": "job-search.onboarding.get-state",
      "permissionId": "job-search.onboarding.get-state",
      "description": "Read the user's job-search onboarding progress",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "onboarding.get-state"
    },
    {
      "name": "job-search.profile.get",
      "permissionId": "job-search.profile.get",
      "description": "Read the user's job-search profile",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "profile.get"
    },
    {
      "name": "job-search.profile.save-draft",
      "permissionId": "job-search.profile.save-draft",
      "description": "Save a draft of the user's job-search profile",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "profile.save-draft"
    },
    {
      "name": "job-search.profile.approve",
      "permissionId": "job-search.profile.approve",
      "description": "Approve the drafted job-search profile",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "profile.approve"
    },
    {
      "name": "job-search.resume.get",
      "permissionId": "job-search.resume.get",
      "description": "Read the user's structured resume",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "resume.get"
    },
    {
      "name": "job-search.resume.save-draft",
      "permissionId": "job-search.resume.save-draft",
      "description": "Save a draft of the user's structured resume",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "resume.save-draft"
    },
    {
      "name": "job-search.resume.approve",
      "permissionId": "job-search.resume.approve",
      "description": "Approve the drafted structured resume",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "resume.approve"
    },
    {
      "name": "job-search.monitor.list",
      "permissionId": "job-search.monitor.list",
      "description": "List the user's job monitors",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "monitor.list"
    },
    {
      "name": "job-search.monitor.get",
      "permissionId": "job-search.monitor.get",
      "description": "Read one job monitor",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "monitor.get"
    },
    {
      "name": "job-search.monitor.save",
      "permissionId": "job-search.monitor.save",
      "description": "Create or update a job monitor",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "monitor.save"
    },
    {
      "name": "job-search.opportunities.list",
      "permissionId": "job-search.opportunities.list",
      "description": "List discovered job opportunities",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "opportunities.list"
    },
    {
      "name": "job-search.opportunities.get",
      "permissionId": "job-search.opportunities.get",
      "description": "Read one job opportunity",
      "risk": "read",
      "inputSchema": { "type": "object" },
      "handler": "opportunities.get"
    },
    {
      "name": "job-search.opportunity.decide",
      "permissionId": "job-search.opportunity.decide",
      "description": "Record the user's decision on a job opportunity",
      "risk": "write",
      "inputSchema": { "type": "object" },
      "handler": "opportunity.decide"
    }
  ],
  "worker": {
    "queues": [{ "name": "job-search.monitor-run", "handler": "monitor.run", "retryLimit": 3 }],
    "schedules": [
      {
        "id": "job-search.monitor-sweep",
        "cron": "*/15 * * * *",
        "scope": "user",
        "jobKind": "job-search.monitor-sweep",
        "queue": "job-search.monitor-run"
      }
    ]
  },
  "fetchHosts": ["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"]
}
```

Notes locked in by the ABI: no `auth` section (spec: no MVP credentials; the only allowed kind is
`api-key` anyway), schedule scope must be `"user"`, the schedule declares no `params` because the
queue declares no `paramsSchema`, and `fetchHosts` are the three keyless public boards from the
parent design (`assertValidFetchHosts` is syntactic-only — hosts still get documented in the
README as reviewed).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/jarvis.module.json tests/unit/external-module-job-search-manifest.test.ts
git commit -m "feat(job-search): external module contract manifest (#930)

Declares the Job Search external package manifest against the merged
external-module ABI: 7 user-scoped KV namespaces, 13 assistant tools
(permissionId == tool name per coordinator ruling), one monitor queue +
15-minute user-scoped sweep schedule, and 3 reviewed public fetch hosts.
Spec deltas: plain kebab id 'job-search' (dotted ids rejected by the
platform id grammar). Not user-visible yet — packaging groundwork only.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Keep the core image and built-in registry clean

**Files:**

- Modify: `.dockerignore` (append one line)
- Test: `tests/unit/external-module-job-search-absence.test.ts`

**Interfaces:**

- Consumes: `getBuiltInModuleManifests()` from `@jarv1s/module-registry`.
- Produces: the "default-image and built-in-registry absence assertions" required by the spec's
  Verification list.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/external-module-job-search-absence.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

// JS-01 (#930): the core image must never compile, copy, or register Job Search.
// These assertions pin the three exclusion seams: docker build context, built-in
// module registry, and the pnpm workspace globs.
const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("job-search stays out of the core image (#930)", () => {
  it(".dockerignore excludes external-modules from the build context", () => {
    const lines = repoFile(".dockerignore")
      .split("\n")
      .map((line) => line.trim());
    expect(lines).toContain("external-modules");
  });

  it("BUILT_IN_MODULES has no job-search registration", () => {
    const ids = getBuiltInModuleManifests().map((manifest) => manifest.id);
    expect(ids).not.toContain("job-search");
    expect(ids.some((id) => id.startsWith("job-search"))).toBe(false);
  });

  it("the pnpm workspace does not include external-modules", () => {
    // Workspace globs are apps/*, packages/*, spikes/* — external-modules/ must stay
    // outside so the core install/build never pulls the package in.
    expect(repoFile("pnpm-workspace.yaml")).not.toContain("external-modules");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-absence.test.ts`
Expected: FAIL — the `.dockerignore` assertion (no `external-modules` line yet). The other two
already pass; they are regression pins.

- [ ] **Step 3: Append the `.dockerignore` entry**

Add one line to `.dockerignore`, after the `spikes` line (grouped with the other
source-tree exclusions):

```text
external-modules
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/external-module-job-search-absence.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .dockerignore tests/unit/external-module-job-search-absence.test.ts
git commit -m "feat(job-search): exclude external-modules from the core image (#930)

The default Jarvis image build context now ignores external-modules/, and
unit assertions pin all three exclusion seams (dockerignore, built-in
registry, workspace globs). Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Package sources, standalone typecheck, and contract README

**Files:**

- Create: `external-modules/job-search/src/web/index.ts`
- Create: `external-modules/job-search/src/worker/index.ts`
- Create: `external-modules/job-search/package.json`
- Create: `external-modules/job-search/tsconfig.json`
- Create: `external-modules/job-search/README.md`
- Modify: root `package.json` (add `check:external-modules`, chain into `typecheck`)

**Interfaces:**

- Consumes: `defineModuleWorker({handlers})` from `@jarv1s/module-sdk/worker` (each handler is
  `(ctx: ModuleWorkerContext) => Promise<unknown>`); the handler ids declared in Task 1's
  manifest.
- Produces: `src/worker/index.ts` and `src/web/index.ts` as the two esbuild entrypoints Task 4
  bundles; web default export shape `{contractVersion: 1, Root}`.

There is no runnable unit test for raw sources (they only become testable as bundles in Task 4);
this task's verify cycle is the standalone typecheck, which is a real gate CI will run.

- [ ] **Step 1: Add the typecheck script and watch it fail**

In root `package.json`, add to `scripts` and chain into `typecheck`:

```json
"check:external-modules": "tsc -p external-modules/job-search --noEmit",
"typecheck": "tsc --noEmit && pnpm --filter @jarv1s/web typecheck && pnpm check:external-modules",
```

Run: `pnpm check:external-modules`
Expected: FAIL — no `external-modules/job-search/tsconfig.json` yet.

- [ ] **Step 2: Write the web root**

```typescript
// external-modules/job-search/src/web/index.ts
// JS-01 (#930): placeholder web root proving the external web contract v1.
// The bundle must never carry its own React — the host exposes its instance on
// the frozen global (see apps/web external-modules loader). We read the global
// directly instead of importing "react" so the browser bundle stays react-free
// by construction; later JS slices can move to an esbuild react-shim alias when
// real components need hooks/JSX.
type HostReact = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
};

type ModuleRuntime = { react: HostReact };

function hostReact(): HostReact {
  const runtime = (globalThis as { __JARVIS_MODULE_RUNTIME__?: ModuleRuntime })
    .__JARVIS_MODULE_RUNTIME__;
  if (!runtime) throw new Error("job-search web root requires the Jarvis module runtime");
  return runtime.react;
}

function Root(): unknown {
  const react = hostReact();
  return react.createElement(
    "section",
    { "data-module": "job-search" },
    react.createElement("h1", null, "Job Search"),
    react.createElement("p", null, "Module installed. Feature slices arrive in later releases.")
  );
}

export default { contractVersion: 1, Root };
```

- [ ] **Step 3: Write the worker**

```typescript
// external-modules/job-search/src/worker/index.ts
// JS-01 (#930): contract-proving worker. Every handler id declared in
// jarvis.module.json must resolve here (13 assistant tools + the monitor queue),
// but domain behavior lands in later JS slices — each stub answers
// not-implemented rather than pretending to work.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";

const notImplemented = async (): Promise<{ status: "not-implemented" }> => ({
  status: "not-implemented"
});

defineModuleWorker({
  handlers: {
    "onboarding.get-state": notImplemented,
    "profile.get": notImplemented,
    "profile.save-draft": notImplemented,
    "profile.approve": notImplemented,
    "resume.get": notImplemented,
    "resume.save-draft": notImplemented,
    "resume.approve": notImplemented,
    "monitor.list": notImplemented,
    "monitor.get": notImplemented,
    "monitor.save": notImplemented,
    "opportunities.list": notImplemented,
    "opportunities.get": notImplemented,
    "opportunity.decide": notImplemented,
    "monitor.run": notImplemented
  }
});
```

- [ ] **Step 4: Write the artifact package.json**

```json
{
  "name": "job-search",
  "private": true,
  "version": "0.1.0",
  "description": "Jarvis Job Search external module (epic #913). Prebuilt artifact package: jarvis.module.json + dist/worker.js + dist/web/index.js."
}
```

Deliberately **no `"type"` field**: the host spawns `node <dir>/dist/worker.js` with the module
dir as cwd, so the worker bundle must execute as CJS under default Node module resolution.

- [ ] **Step 5: Write the standalone tsconfig**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "paths": {
      "@jarv1s/module-sdk/worker": ["../../packages/module-sdk/src/worker.ts"]
    }
  },
  "include": ["src"]
}
```

The `paths` mapping lets the standalone project typecheck against the real SDK source without the
package living in the pnpm workspace (there is no `node_modules` under `external-modules/`).
`types: ["node"]` resolves from the repo root `node_modules/@types` via the default typeRoots
walk-up.

- [ ] **Step 6: Write the contract README**

`external-modules/job-search/README.md` — the `sensitive`-tier contract documentation. Full
content:

```markdown
# Job Search external module

Issue #930 (epic #913). This directory is the source of the Job Search **external** module
package. It is not part of the pnpm workspace, is excluded from the default Jarvis image via
`.dockerignore`, and never appears in `BUILT_IN_MODULES` — the core build must not compile, copy,
or register anything here.

## Package artifact

`pnpm build:external:job-search` produces the installable artifact:

​`text
job-search/
  package.json        # metadata only; NO "type" field — dist/worker.js runs as CJS
  jarvis.module.json  # the contract manifest (schemaVersion 1)
  dist/worker.js      # self-contained CJS bundle; SDK compiled in; node builtins only
  dist/web/index.js   # ESM browser bundle; default export {contractVersion: 1, Root}
​`

Install = place that directory under the host's `JARVIS_MODULES_DIR` (directory name must equal
the module id `job-search`) with `JARVIS_ENABLE_EXTERNAL_MODULES=1`. The host hashes
`jarvis.module.json`, `dist/worker.js`, and `dist/web/**` (`package.json` is not hashed).

## Contract summary

- **Id:** `job-search` (plain kebab — the platform id grammar forbids dots; the design's
  `jarv1s.job-search` was superseded by coordinator ruling 2026-07-10).
- **Permissions:** one per assistant tool, `permissionId == tool name` (ruling 2026-07-10; the
  consolidated permission model is deferred to JS-06).
- **Storage:** seven user-scoped KV namespaces (`job-search.onboarding`, `.profile`, `.resume`,
  `.monitors`, `.opportunities`, `.runs`, `.feed`). No instance-scoped data.
- **Credentials:** none in MVP — no `auth` section.
- **Worker:** JSON-RPC over stdio via `@jarv1s/module-sdk/worker` (contract version 1). Handlers:
  13 assistant-tool stubs + `monitor.run`; all answer `{status: "not-implemented"}` until later
  slices. Scrubbed env (LANG/LC_ALL/TZ only); no repo-relative resolution.
- **Web:** contract v1, entrypoint `dist/web/index.js`, uses the host React instance from the
  frozen `window.__JARVIS_MODULE_RUNTIME__` global; never bundles its own React.
- **Queue/schedule:** `job-search.monitor-run` (retryLimit 3) swept by user-scoped schedule
  `job-search.monitor-sweep` (`*/15 * * * *`). Declaration only in JS-01.
- **Fetch hosts (reviewed):** `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` —
  keyless public job-board APIs, consumed from JS-04 on.

## Fail-closed behavior (host-enforced, fixture-tested)

Invalid manifest, wrong schema/contract versions, path traversal or symlink escape, and post-
enable hash drift all keep (or auto-return) the module inactive; enablement is explicit and
admin-gated. See `tests/unit/external-module-job-search-*.test.ts` and
`tests/integration/external-module-job-search.test.ts`.
```

(Strip the zero-width escapes around the inner code fence when writing the real file — they exist
only so this plan renders.)

- [ ] **Step 7: Run the typecheck gate**

Run: `pnpm check:external-modules`
Expected: PASS (exit 0, no diagnostics).

Also run: `pnpm lint` — the new dir is covered by `eslint .`. If the flat config's typed rules
reject files outside its project service, escalate to the coordinator before touching eslint
config (platform-adjacent file).

- [ ] **Step 8: Commit**

```bash
git add external-modules/job-search/src/web/index.ts external-modules/job-search/src/worker/index.ts external-modules/job-search/package.json external-modules/job-search/tsconfig.json external-modules/job-search/README.md package.json
git commit -m "feat(job-search): package sources, standalone typecheck, contract docs (#930)

Adds the web contract-v1 root (host-React only), the SDK worker with all 14
declared handlers as not-implemented stubs, artifact package.json (CJS
worker by omitted type field), a standalone tsc project chained into the
root typecheck gate, and the package contract README. Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Build script + bundle-hygiene tests

**Files:**

- Create: `scripts/build-external-module.ts`
- Modify: root `package.json` (add `build:external:job-search`)
- Test: `tests/unit/external-module-job-search-bundle.test.ts`

**Interfaces:**

- Consumes: Task 3 entrypoints; esbuild 0.25.12 (root devDep).
- Produces: `buildExternalModule(moduleDir: string): Promise<void>` writing
  `<moduleDir>/dist/worker.js` (CJS, self-contained) and `<moduleDir>/dist/web/index.js` (ESM,
  browser). Tasks 5–6 call this to produce the artifact under test.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/external-module-job-search-bundle.test.ts
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930): the emitted artifacts must honor the two runtime contracts —
// browser bundle: ESM, no Node/server code, host React only; worker bundle:
// self-contained CJS that boots under plain `node` with no node_modules
// anywhere near it (a bare temp dir), speaks worker contract v1, and answers
// -32601 handler_not_found for undeclared handlers.
const moduleDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let bareDir: string;

beforeAll(async () => {
  await buildExternalModule(moduleDir);
  bareDir = mkdtempSync(join(tmpdir(), "job-search-bare-"));
  copyFileSync(join(moduleDir, "dist/worker.js"), join(bareDir, "worker.js"));
}, 60_000);

afterAll(() => {
  rmSync(bareDir, { recursive: true, force: true });
});

type Rpc = { method?: string; id?: string; params?: unknown; result?: unknown; error?: unknown };

// Boots the worker in the bare dir, collects JSON lines until `until` matches,
// then kills the child. Requests in `sends` go to stdin after worker.ready.
async function runWorker(sends: readonly object[], until: (m: Rpc) => boolean): Promise<Rpc[]> {
  const child = spawn(process.execPath, ["worker.js"], { cwd: bareDir, stdio: "pipe" });
  const seen: Rpc[] = [];
  try {
    return await new Promise<Rpc[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker timed out")), 15_000);
      child.on("error", reject);
      createInterface({ input: child.stdout }).on("line", (line) => {
        const message = JSON.parse(line) as Rpc;
        seen.push(message);
        if (message.method === "worker.ready") {
          for (const send of sends) child.stdin.write(`${JSON.stringify(send)}\n`);
        }
        if (until(message)) {
          clearTimeout(timer);
          resolve(seen);
        }
      });
    });
  } finally {
    child.kill();
  }
}

describe("job-search bundle hygiene (#930)", () => {
  it("web bundle is browser-only ESM using the host React runtime", () => {
    const source = readFileSync(join(moduleDir, "dist/web/index.js"), "utf8");
    expect(source).toContain("__JARVIS_MODULE_RUNTIME__");
    expect(source).toContain("export"); // ESM output
    expect(source).not.toContain("node:"); // no Node/server code
    expect(source).not.toContain("require("); // no CJS/react bundled in
    expect(source).not.toMatch(/react[./-]dom|react\.development|react\.production/);
  });

  it("worker bundle boots without node_modules and reports contract v1", async () => {
    const messages = await runWorker([], (m) => m.method === "worker.ready");
    expect(messages.at(-1)).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  });

  it("answers a declared handler with not-implemented", async () => {
    const messages = await runWorker(
      [{ jsonrpc: "2.0", id: "t1", method: "module.invoke", params: { handler: "profile.get" } }],
      (m) => m.id === "t1"
    );
    expect(messages.at(-1)).toMatchObject({ id: "t1", result: { status: "not-implemented" } });
  });

  it("answers an undeclared handler with -32601 handler_not_found", async () => {
    const messages = await runWorker(
      [{ jsonrpc: "2.0", id: "t2", method: "module.invoke", params: { handler: "nope" } }],
      (m) => m.id === "t2"
    );
    expect(messages.at(-1)).toMatchObject({
      id: "t2",
      error: { code: -32601, message: "handler_not_found" }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-bundle.test.ts`
Expected: FAIL — cannot resolve `../../scripts/build-external-module.js`.

- [ ] **Step 3: Write the build script**

```typescript
// scripts/build-external-module.ts
// JS-01 (#930): bundles an external module package's two artifacts. Kept at the
// repo root (not inside the package) because it needs the workspace's esbuild
// and the SDK source path; the core image never runs it (external-modules/ is
// dockerignored and this script is only wired to explicit build:external:*
// package scripts).
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function buildExternalModule(moduleDir: string): Promise<void> {
  const dir = resolve(moduleDir);
  // Worker: self-contained CJS for `node dist/worker.js` in a scrubbed env with
  // no node_modules — the SDK is compiled in via the workspace source alias.
  await build({
    entryPoints: [join(dir, "src/worker/index.ts")],
    outfile: join(dir, "dist/worker.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    logLevel: "silent",
    alias: { "@jarv1s/module-sdk/worker": join(repoRoot, "packages/module-sdk/src/worker.ts") }
  });
  // Web: browser ESM; must stay react-free (the source reads the host runtime
  // global instead of importing react — asserted by the bundle-hygiene test).
  await build({
    entryPoints: [join(dir, "src/web/index.ts")],
    outfile: join(dir, "dist/web/index.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    logLevel: "silent"
  });
}

// CLI: `tsx scripts/build-external-module.ts external-modules/job-search`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: tsx scripts/build-external-module.ts <module-dir>");
    process.exit(1);
  }
  buildExternalModule(target).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

Add to root `package.json` scripts:

```json
"build:external:job-search": "tsx scripts/build-external-module.ts external-modules/job-search",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/external-module-job-search-bundle.test.ts`
Expected: PASS (4 tests). Also run `pnpm build:external:job-search` once by hand — exit 0,
`external-modules/job-search/dist/{worker.js,web/index.js}` exist (git-ignored).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-external-module.ts tests/unit/external-module-job-search-bundle.test.ts package.json
git commit -m "feat(job-search): external package build command + bundle-hygiene tests (#930)

pnpm build:external:job-search bundles the installable artifact: a
self-contained CJS worker (SDK compiled in, boots under plain node with no
node_modules, speaks worker contract v1) and a react-free browser ESM web
root. Tests spawn the real worker in a bare temp dir and probe the
JSON-RPC surface, including handler_not_found. Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Fail-closed artifact fixtures (loader + hash unit level)

**Files:**

- Test: `tests/unit/external-module-job-search-failclosed.test.ts`

**Interfaces:**

- Consumes: `getExternalModuleRegistrations({modulesDir, coreVersion})`, `hashExternalPackage`
  from `@jarv1s/module-registry/node`; `buildExternalModule` from Task 4.
- Produces: the spec's "package path, traversal, symlink, hash, and contract-version tests"
  against the REAL built artifact (not synthetic fixtures).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/external-module-job-search-failclosed.test.ts
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getExternalModuleRegistrations, hashExternalPackage } from "@jarv1s/module-registry/node";

import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930, sensitive tier): a package that doesn't match the contract must
// simply not load. Each case plants one hostile/malformed mutation of the REAL
// built artifact in a temp modules dir and asserts fail-closed behavior.
const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let modulesDir: string;
let dir: string;

beforeAll(async () => {
  await buildExternalModule(sourceDir);
}, 60_000);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "job-search-failclosed-"));
  modulesDir = join(root, "modules");
  dir = join(modulesDir, "job-search");
  mkdirSync(join(dir, "dist/web"), { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(dir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(dir, "dist"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const discover = () => getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });

const mutateManifest = (mutate: (manifest: Record<string, unknown>) => void): void => {
  const manifest = JSON.parse(readFileSync(join(dir, "jarvis.module.json"), "utf8")) as Record<
    string,
    unknown
  >;
  mutate(manifest);
  writeFileSync(join(dir, "jarvis.module.json"), JSON.stringify(manifest));
};

describe("job-search fail-closed artifact fixtures (#930)", () => {
  it("discovers the untouched artifact with manifest and package hashes", () => {
    const result = discover();
    expect(result.rejected).toEqual([]);
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.id).toBe("job-search");
    expect(result.discoveries[0]!.manifestHash.startsWith("sha256:")).toBe(true);
    expect(result.discoveries[0]!.packageHash.startsWith("sha256:")).toBe(true);
  });

  it("tampering dist/worker.js changes the package hash (drift detection input)", () => {
    const before = hashExternalPackage(dir);
    writeFileSync(join(dir, "dist/worker.js"), `${readFileSync(join(dir, "dist/worker.js"))}\n//x`);
    expect(hashExternalPackage(dir)).not.toBe(before);
  });

  it("rejects a symlink escaping the package under dist/web", () => {
    symlinkSync(join(root, ".."), join(dir, "dist/web/escape"));
    expect(() => hashExternalPackage(dir)).toThrow();
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects a path-traversal web entrypoint", () => {
    mutateManifest((manifest) => {
      manifest.web = { entrypoint: "../outside.js", contractVersion: 1 };
    });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects an unsupported workerContractVersion", () => {
    mutateManifest((manifest) => {
      manifest.runtime = { workerEntrypoint: "dist/worker.js", workerContractVersion: 2 };
    });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("passes a future web contractVersion through to the host gate", () => {
    // The manifest layer accepts any positive int; the apps/web loader is the
    // gate that requires exactly 1 and refuses to mount anything else. Assert
    // the declared value survives discovery so that gate sees it.
    mutateManifest((manifest) => {
      manifest.web = { entrypoint: "dist/web/index.js", contractVersion: 2 };
    });
    const result = discover();
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.manifest.web?.contractVersion).toBe(2);
  });

  it("rejects a malformed manifest JSON", () => {
    writeFileSync(join(dir, "jarvis.module.json"), "{ not json");
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects a dir name that does not equal the manifest id", () => {
    const renamed = join(modulesDir, "job-search-x");
    cpSync(dir, renamed, { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/unit/external-module-job-search-failclosed.test.ts`
Expected: PASS on first run — these tests exercise already-merged platform behavior against the
new artifact; they are contract pins, not new implementation. If ANY case fails, that is a real
contract gap: **stop and escalate to the coordinator** (the fix may be in scope for JS-01 or a
platform bug — the coordinator routes it; platform edits are banned for this lane). Two shape
assumptions to confirm on first run and adjust the test (not the platform) to match observed
reality if needed: the exact discovery-object field for the parsed manifest, and whether the
loader surfaces a symlink escape as a rejection entry or an empty scan.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/external-module-job-search-failclosed.test.ts
git commit -m "test(job-search): fail-closed artifact fixtures (#930)

Adversarial unit fixtures run the real built package through the external
loader/hasher: tamper drift, symlink escape, path-traversal entrypoint,
wrong worker contract version, malformed manifest, and dir/id mismatch all
fail closed. Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Enable/disable/drift integration fixture

**Files:**

- Test: `tests/integration/external-module-job-search.test.ts`

**Interfaces:**

- Consumes: real API server (`createApiServer` with
  `apiServerConfig.enableExternalModules/externalModulesDir`), harness helpers mirrored from
  `tests/integration/external-modules-routes.test.ts`; `buildExternalModule` from Task 4.
- Produces: the spec's "enable/disable/hash-drift integration fixture" — the full activation
  lifecycle against the real routes with the real artifact.

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/external-module-job-search.test.ts
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930): full activation lifecycle of the REAL Job Search artifact against
// the real server — discovered→enable→active (web asset served, member-visible)
// →tamper→drift auto-disable→re-enable (new hash baseline)→explicit disable.
// Harness mirrors tests/integration/external-modules-routes.test.ts (better-auth
// first-signup bootstraps the admin) — do not invent a new auth path.
const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let installedDir: string;
let appDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;
let memberCookie: string;
let memberUserId: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  await buildExternalModule(sourceDir);

  root = mkdtempSync(join(tmpdir(), "job-search-int-"));
  const modulesDir = join(root, "modules");
  installedDir = join(modulesDir, "job-search");
  mkdirSync(installedDir, { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(installedDir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(installedDir, "dist"), { recursive: true });

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  server = createApiServer({
    appDb,
    logger: false,
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      enableExternalModules: true,
      externalModulesDir: modulesDir
    }
  });
  await server.ready();

  const admin = await signUp(server, "owner@job-search.test", "Owner");
  adminCookie = admin.cookie;
  const member = await signUp(server, "member@job-search.test", "Member");
  memberCookie = member.cookie;
  memberUserId = member.userId;
  const approve = await server.inject({
    method: "POST",
    url: `/api/admin/users/${memberUserId}/approve`,
    headers: { cookie: adminCookie }
  });
  expect(approve.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  rmSync(root, { recursive: true, force: true });
});

const setEnabled = (enabled: boolean) =>
  server.inject({
    method: "POST",
    url: "/api/admin/external-modules/job-search",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { enabled }
  });

const adminView = async (): Promise<Record<string, unknown>> => {
  const res = await server.inject({
    method: "GET",
    url: "/api/admin/external-modules",
    headers: { cookie: adminCookie }
  });
  expect(res.statusCode).toBe(200);
  const modules = res.json<{ modules: Array<Record<string, unknown> & { id: string }> }>().modules;
  const found = modules.find((module) => module.id === "job-search");
  expect(found).toBeDefined();
  return found!;
};

const memberSeesModule = async (): Promise<boolean> => {
  const res = await server.inject({
    method: "GET",
    url: "/api/modules",
    headers: { cookie: memberCookie }
  });
  expect(res.statusCode).toBe(200);
  return res
    .json<{ modules: Array<{ id: string }> }>()
    .modules.some((module) => module.id === "job-search");
};

describe("job-search activation lifecycle (#930)", () => {
  it("is discovered but inactive before any enablement row exists", async () => {
    expect(await adminView()).toMatchObject({ status: "discovered", active: false });
    expect(await memberSeesModule()).toBe(false);
  });

  it("enable → active; web asset served; member sees the module", async () => {
    const res = await setEnabled(true);
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ status: "enabled", active: true });

    // The declared web contribution is actually servable, end to end.
    const asset = await server.inject({
      method: "GET",
      url: "/api/modules/job-search/web/dist/web/index.js",
      headers: { cookie: memberCookie }
    });
    expect(asset.statusCode).toBe(200);
    expect(String(asset.headers["content-type"])).toContain("javascript");
    expect(asset.body).toContain("__JARVIS_MODULE_RUNTIME__");

    expect(await memberSeesModule()).toBe(true);
  });

  it("post-enable artifact tamper → drift auto-disable; contributions vanish", async () => {
    const workerPath = join(installedDir, "dist/worker.js");
    writeFileSync(workerPath, `${readFileSync(workerPath, "utf8")}\n// tampered`);

    expect(await adminView()).toMatchObject({
      status: "disabled",
      active: false,
      drifted: true,
      disabledReason: "package changed since it was enabled"
    });
    expect(await memberSeesModule()).toBe(false);
    const asset = await server.inject({
      method: "GET",
      url: "/api/modules/job-search/web/dist/web/index.js",
      headers: { cookie: memberCookie }
    });
    expect(asset.statusCode).toBe(404);
  });

  it("re-enable accepts the current package as the new hash baseline", async () => {
    const res = await setEnabled(true);
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ status: "enabled", active: true });
    expect(await memberSeesModule()).toBe(true);
  });

  it("explicit admin disable → inactive without a drift reason", async () => {
    const res = await setEnabled(false);
    expect(res.statusCode).toBe(200);
    expect(await adminView()).toMatchObject({ status: "disabled", active: false, drifted: false });
    expect(await memberSeesModule()).toBe(false);
  });
});

async function signUp(
  target: ReturnType<typeof createApiServer>,
  email: string,
  name: string
): Promise<{ cookie: string; userId: string }> {
  const res = await target.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up for ${email} failed (${res.statusCode}): ${res.body}`);
  }
  return {
    cookie: cookieHeader(res.headers),
    userId: res.json<{ user: { id: string } }>().user.id
  };
}

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run tests/integration/external-module-job-search.test.ts`
(Integration suite — needs the dev Postgres; do NOT run concurrently with another agent's
integration run, per the multi-agent PG contention trap.)
Expected: PASS (5 tests). Like Task 5 these pin merged platform behavior around the new artifact.
Adjust only test-side details to observed route responses (e.g. exact web-asset URL shape or a
reconcile trigger needed between tamper and the admin GET) — never server code. If activation
itself misbehaves, escalate.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/external-module-job-search.test.ts
git commit -m "test(job-search): enable/disable/hash-drift activation fixture (#930)

Integration fixture drives the real Job Search artifact through the full
lifecycle on a real server: discovered, admin enable (web asset served,
member-visible), tamper-triggered drift auto-disable, re-enable with a new
hash baseline, explicit disable. Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full gate + wrap-up

**Files:** none (verification only; fixups get their own commits).

- [ ] **Step 1: Full local gate**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit
pnpm vitest run tests/integration/external-module-job-search.test.ts tests/integration/external-modules-routes.test.ts
```

Expected: all exit 0. Record exact commands + exit codes for the PR body. Note:
`foundation.test.ts` asserts the FULL migration list — JS-01 adds no migration, so it must stay
green untouched; if it goes red, something leaked.

- [ ] **Step 2: Pre-push trio + rebase, push, PR via `coordinated-wrap-up`**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Then invoke the `coordinated-wrap-up` skill: push, open the PR against `main` (title
`feat(job-search): external package contract + fail-closed fixtures (#930)`, body with
user-facing summary — "groundwork for installable modules; nothing user-visible yet" — spec
deltas, and gate evidence), and report to the coordinator. No merge, no board moves. Flag at
wrap-up: whether `apps/web/src/external-modules/loader.ts` was touched (it must NOT be — #916
collision), and that no migration was added.

## Self-Review Notes (spec coverage)

- Contract section: manifest (Task 1), outside workspace + dockerignore + separate build command
  (Tasks 2–4), prebuilt artifacts layout incl. no-`type` package.json (Tasks 3–4), 7 KV
  namespaces / no credentials / prefixed ids / fetch hosts / queue+schedule (Task 1), host-React
  web + self-contained worker (Tasks 3–4).
- Fail-closed fixture section: discovered-inactive / disabled / invalid-or-incompatible / drift /
  valid-enabled states (Tasks 5–6); missing-entrypoint + traversal/symlink (Task 5); default-image
  and `BUILT_IN_MODULES` absence (Task 2).
- Verification section: manifest schema/prefix/collision (Task 1); path/traversal/symlink/hash/
  contract-version (Task 5); browser-bundle purity + worker standalone boot (Task 4);
  enable/disable/drift integration (Task 6); absence assertions (Task 2).
- Non-goals honored: no domain records/KV writes, no live adapters or schedule execution
  (declaration only), no AI, no migrations, no marketplace/signing/downloader.
