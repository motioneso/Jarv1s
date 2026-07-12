# Module Distribution & Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-12-module-distribution-install.md` (issue #964, epic #860). Read it before starting; §-references below point into it.

**Goal:** CI publishes per-module tarballs + a signed-hash `index.json` to a rolling GitHub Release; admins browse the registry in Settings, download/update/remove modules; a supervisor-plane boot reconcile stages, verifies, installs (tables + roles + RLS), purges, and drift-checks external modules.

**Architecture:** Three planes. (1) **Publish**: a script + GitHub workflow build `external-modules/*` into `.tgz` artifacts and an `index.json` on the rolling release tagged `modules`. (2) **Admin/API plane** (app RLS role): registry browse + synchronous download-and-stage into `JARVIS_MODULES_DIR`, persisting staged intent on `app.external_modules`. (3) **Supervisor plane** (bootstrap role, boot-time `scripts/module-reconcile.ts` under an advisory lock): sweep staging → execute purges → compose-ensure downloads → scan via the #818 loader → accept staged versions → run #914 `installModule` for `ownedTables` modules → persist drift.

**Tech Stack:** TypeScript (tsx scripts), Fastify + fast-json-stringify strict schemas, Kysely, `@jarv1s/host-fetch` (pinned-host fetch), `tar` (node-tar v7) for pack/extract, `tar-stream` (devDep, malicious-fixture authoring), pg advisory locks, React Query + jds primitives.

## Global Constraints

- Registry index URL (stable, hardcoded default): `https://github.com/motioneso/jarv1s/releases/download/modules/index.json`. Rolling release tag: `modules`.
- Pinned download hosts (exact set): `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`. Redirects allowed only within this set. HTTPS only (host-fetch enforces).
- Caps: index ≤ **1 MiB**; artifact ≤ **50 MiB** AND ≤ the index's `sizeBytes`; decompressed extraction ≤ **4×** the artifact cap (200 MiB); ≤ **2000** tar entries.
- Retain last **5** versions per module in the release; `previousVersions` is REQUIRED on every index entry (may be `[]`).
- `artifact` is a **bare filename** (never a URL). `signature: null` reserved field. Consumers MUST tolerate unknown index fields.
- Module ids are bare kebab slugs matching `MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/` (e.g. `job-search`, NOT `jarv1s.job-search`).
- `JARVIS_MODULE_REGISTRY_URL` override is test-only: refused (throw) when `NODE_ENV === "production"`.
- Hard invariants (CLAUDE.md): metadata-only audit payloads (`{ moduleId }` only — never hashes/URLs/content); secrets never in logs/responses; repositories accept only `DataContextDb`; never edit applied migrations — new file is **`packages/settings/sql/0161_external_module_distribution.sql`** (module SQL lives in the owning module's `sql/`, never `infra/`); no BYPASSRLS anywhere.
- fast-json-stringify trap: every response field MUST be declared in the shared route schema (`additionalProperties: false` silently drops undeclared fields). Full `required` arrays, `as const`.
- File-size gate: ALL source files ≤ 1000 lines. `apps/web/src/settings/settings-admin-panes.tsx` is at 987 and `packages/settings/src/repository.ts` at 970 — new UI goes in a NEW file; new repository functions go in `repository-external-modules.ts` and routes call them directly (no new class delegates).
- `@jarv1s/settings` must NOT import `@jarv1s/module-registry` (dependency cycle — module-registry already depends on settings). Cross-package needs are injected as structural types via `SettingsRoutesDependencies`, mirroring the existing `ExternalModulesDependencies.reconcile` port.
- Commits: stage by EXPLICIT PATH only (shared working tree — never `git add -A` / `git add .`). Run `pnpm prettier --write` on touched docs before committing.
- Gate per task: the commands listed in the task. Final gate (Task 10): `pnpm verify:foundation` + full `pnpm test:integration`.

### Known spec deviations (intentional, carry into the council review)

1. **Install-failed state source:** the spec reads install status from the `app.module_installs` journal; that table is FORCE-RLS supervisor-plane (migration 0156) and unreadable by the app role. The reconcile script instead mirrors failures into a new `app.external_modules.last_install_error` column, which the admin GET reads.
2. **Dev-boot parity:** the spec says "dev boot runs the same reconcile"; there is no `scripts/dev.ts`. Parity is delivered as a root `db:reconcile` package script + a docs note (Task 8/10).
3. **Spec JSON examples** use `jarv1s.job-search` ids; real ids are bare kebab. Task 10 fixes the spec examples.

## File Map

| Task | Files                                                                                                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | C `packages/module-registry/src/distribution/index-schema.ts`, C `.../distribution/ensure-list.ts`, M `packages/module-registry/src/node.ts`, C `tests/unit/module-registry-index-schema.test.ts`                                                                                                                      |
| 2    | M `packages/module-sdk/src/index.ts`, M `packages/module-registry/src/external/validate.ts`, M `packages/module-registry/src/external/hash.ts`, C `tests/unit/external-module-database-declaration.test.ts`                                                                                                            |
| 3    | C `packages/settings/sql/0161_external_module_distribution.sql`, M `packages/db/src/types.ts`, M `packages/settings/src/repository-external-modules.ts`, M `packages/settings/src/repository.ts`, M `tests/integration/foundation-schema-catalog.test.ts`, C `tests/integration/external-module-staging-state.test.ts` |
| 4    | C `scripts/publish-module-registry.ts`, C `.github/workflows/modules-registry.yml`, C `tests/unit/publish-module-registry.test.ts`                                                                                                                                                                                     |
| 5    | C `packages/module-registry/src/distribution/{constants,resolve-registry-url,registry-client,download,extract,stage,pipeline}.ts`, M `packages/module-registry/package.json`, M root `package.json` (tar-stream devDep), C `tests/unit/module-distribution-pipeline.test.ts`                                           |
| 6    | M `packages/shared/src/platform-api-modules.ts`, C `packages/module-registry/src/distribution/derive-rows.ts`, M `packages/settings/src/routes-modules.ts`, M `packages/settings/src/routes.ts`, M `apps/api/src/server.ts`, C `tests/unit/module-registry-derive-rows.test.ts`                                        |
| 7    | C `scripts/module-reconcile.ts`, M `scripts/module-install.ts` (structural manifest type), C `tests/integration/module-reconcile.test.ts`                                                                                                                                                                              |
| 8    | M `scripts/start-jarv1s.ts`, M `tests/unit/start-jarv1s-plan.test.ts`, M `infra/docker-compose.prod.yml`, M root `package.json` (`db:reconcile`)                                                                                                                                                                       |
| 9    | M `apps/web/src/api/client.ts`, M `apps/web/src/api/query-keys.ts`, C `apps/web/src/settings/settings-module-registry-section.tsx`, M `apps/web/src/settings/settings-admin-panes.tsx`, M `apps/web/src/settings/settings-feedback.tsx`                                                                                |
| 10   | C `tests/integration/module-distribution-e2e.test.ts`, M spec examples, docs                                                                                                                                                                                                                                           |

---

### Task 1: Registry index schema + ensure-list parsing

Pure validation/parsing — no I/O. Everything downstream (client, publish script, reconcile) consumes these types.

**Files:**

- Create: `packages/module-registry/src/distribution/index-schema.ts`
- Create: `packages/module-registry/src/distribution/ensure-list.ts`
- Modify: `packages/module-registry/src/node.ts` (re-export both)
- Test: `tests/unit/module-registry-index-schema.test.ts`

**Interfaces:**

- Consumes: `MODULE_ID_RE` from `packages/module-registry/src/external/validate.ts:24`.
- Produces (used by Tasks 4, 5, 6, 7):
  - Types `ModuleRegistryArtifactRef { version; artifact; sha256; sizeBytes }`, `ModuleRegistryEntry` (adds `id; name; description: string|null; requiresCore; capabilities; previousVersions`), `ModuleRegistryCapabilities { permissions: readonly string[]; fetchHosts: readonly string[]; tools: readonly {name,risk}[]; ownsTables: boolean }`, `ModuleRegistryIndex { schemaVersion: 1; generatedAt: string; modules }`.
  - `validateRegistryIndex(raw: unknown): { index: ModuleRegistryIndex | null; errors: readonly string[] }` — envelope failure ⇒ `index: null`; malformed entries are DROPPED (collected in `errors`), valid entries survive; unknown fields tolerated everywhere.
  - `resolveRegistryArtifact(index: ModuleRegistryIndex, id: string, version?: string): { entry: ModuleRegistryEntry; ref: ModuleRegistryArtifactRef } | null` — no version ⇒ current; pinned version searches current + `previousVersions`.
  - `parseModulesEnsure(raw: string | null | undefined): { entries: readonly { id: string; version?: string }[]; errors: readonly string[] }`.
  - Constants `ARTIFACT_FILENAME_RE`, `SHA256_HEX_RE`, `ARTIFACT_MAX_BYTES = 50 * 1024 * 1024`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/module-registry-index-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ARTIFACT_MAX_BYTES,
  parseModulesEnsure,
  resolveRegistryArtifact,
  validateRegistryIndex,
  type ModuleRegistryIndex
} from "../../packages/module-registry/src/node.js";

const goodEntry = {
  id: "job-search",
  name: "Job Search",
  description: "Track job applications",
  version: "1.2.0",
  artifact: "job-search-1.2.0.tgz",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
  requiresCore: ">=0.1.0",
  capabilities: { permissions: ["storage"], fetchHosts: [], tools: [], ownsTables: true },
  signature: null,
  previousVersions: [
    { version: "1.1.0", artifact: "job-search-1.1.0.tgz", sha256: "b".repeat(64), sizeBytes: 900 }
  ]
};

const goodIndex = {
  schemaVersion: 1,
  generatedAt: "2026-07-12T00:00:00.000Z",
  modules: [goodEntry]
};

describe("validateRegistryIndex", () => {
  it("accepts a well-formed index", () => {
    const result = validateRegistryIndex(goodIndex);
    expect(result.errors).toEqual([]);
    expect(result.index?.modules).toHaveLength(1);
    expect(result.index?.modules[0]?.id).toBe("job-search");
    expect(result.index?.modules[0]?.previousVersions).toHaveLength(1);
  });

  it("tolerates unknown fields at every level (forward compat)", () => {
    const raw = {
      ...goodIndex,
      futureTopLevel: true,
      modules: [
        {
          ...goodEntry,
          futureField: "x",
          capabilities: { ...goodEntry.capabilities, futureCap: 1 }
        }
      ]
    };
    const result = validateRegistryIndex(raw);
    expect(result.index?.modules).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("fails closed on a bad envelope", () => {
    for (const raw of [
      null,
      [],
      "x",
      { schemaVersion: 2, generatedAt: "t", modules: [] },
      { schemaVersion: 1, modules: [] },
      { schemaVersion: 1, generatedAt: "t", modules: {} }
    ]) {
      const result = validateRegistryIndex(raw);
      expect(result.index).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = {
      ...goodIndex,
      modules: [
        goodEntry,
        { ...goodEntry, id: "Bad.Id" },
        { ...goodEntry, id: "no-artifact", artifact: "https://evil.example/x.tgz" },
        { ...goodEntry, id: "bad-sha", sha256: "zz" },
        { ...goodEntry, id: "too-big", sizeBytes: ARTIFACT_MAX_BYTES + 1 },
        { ...goodEntry, id: "no-prev", previousVersions: undefined },
        { ...goodEntry, id: "bad-prev", previousVersions: [{ version: "1.0.0" }] }
      ]
    };
    const result = validateRegistryIndex(raw);
    expect(result.index?.modules.map((m) => m.id)).toEqual(["job-search"]);
    expect(result.errors).toHaveLength(6);
  });

  it("rejects artifact filenames with path separators or traversal", () => {
    for (const artifact of ["../x.tgz", "a/b.tgz", "x.tar.gz.exe", ".hidden.tgz", "UPPER.tgz"]) {
      const result = validateRegistryIndex({ ...goodIndex, modules: [{ ...goodEntry, artifact }] });
      expect(result.index?.modules).toEqual([]);
    }
  });

  it("rejects duplicate module ids (both dropped is wrong — first wins, second errored)", () => {
    const result = validateRegistryIndex({
      ...goodIndex,
      modules: [goodEntry, { ...goodEntry, version: "9.9.9" }]
    });
    expect(result.index?.modules).toHaveLength(1);
    expect(result.index?.modules[0]?.version).toBe("1.2.0");
    expect(result.errors).toHaveLength(1);
  });
});

describe("resolveRegistryArtifact", () => {
  const index = validateRegistryIndex(goodIndex).index as ModuleRegistryIndex;

  it("resolves the current version when no pin is given", () => {
    const hit = resolveRegistryArtifact(index, "job-search");
    expect(hit?.ref.version).toBe("1.2.0");
    expect(hit?.entry.id).toBe("job-search");
  });

  it("resolves a pinned previous version", () => {
    expect(resolveRegistryArtifact(index, "job-search", "1.1.0")?.ref.artifact).toBe(
      "job-search-1.1.0.tgz"
    );
  });

  it("returns null for unknown module or unknown version", () => {
    expect(resolveRegistryArtifact(index, "nope")).toBeNull();
    expect(resolveRegistryArtifact(index, "job-search", "0.0.1")).toBeNull();
  });
});

describe("parseModulesEnsure", () => {
  it("parses comma/whitespace separated ids with optional @version pins", () => {
    const result = parseModulesEnsure("job-search, weather-plus@1.1.0\n  notes-extra");
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { id: "job-search" },
      { id: "weather-plus", version: "1.1.0" },
      { id: "notes-extra" }
    ]);
  });

  it("returns empty for unset/blank input", () => {
    expect(parseModulesEnsure(undefined).entries).toEqual([]);
    expect(parseModulesEnsure("").entries).toEqual([]);
    expect(parseModulesEnsure("  ").entries).toEqual([]);
  });

  it("collects errors for bad ids and duplicate ids (first wins)", () => {
    const result = parseModulesEnsure("Bad.Id, job-search@1.0.0, job-search@2.0.0, @1.0.0");
    expect(result.entries).toEqual([{ id: "job-search", version: "1.0.0" }]);
    expect(result.errors).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-registry-index-schema.test.ts`
Expected: FAIL — `validateRegistryIndex` is not exported from `../../packages/module-registry/src/node.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/module-registry/src/distribution/index-schema.ts`:

```ts
// Registry index contract (#964). Pure validation — no I/O. The index is REMOTE,
// UNTRUSTED input (fetched over the network in Task 5's client): every field is
// re-validated here fail-closed, and unknown fields are tolerated for forward compat
// (spec §4). Malformed ENTRIES are dropped individually so one bad module can't blank
// the whole registry; a malformed ENVELOPE fails the whole index closed.
import { MODULE_ID_RE } from "../external/validate.js";

export const REGISTRY_INDEX_SCHEMA_VERSION = 1;
// Bare filename only — never a URL or path (spec §4: `artifact` is joined onto the
// pinned release download URL by the client; a slash here would be path injection).
export const ARTIFACT_FILENAME_RE = /^[a-z0-9][a-z0-9.-]*\.tgz$/;
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;

export interface ModuleRegistryArtifactRef {
  readonly version: string;
  readonly artifact: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ModuleRegistryToolRef {
  readonly name: string;
  readonly risk: string;
}

export interface ModuleRegistryCapabilities {
  readonly permissions: readonly string[];
  readonly fetchHosts: readonly string[];
  readonly tools: readonly ModuleRegistryToolRef[];
  readonly ownsTables: boolean;
}

export interface ModuleRegistryEntry extends ModuleRegistryArtifactRef {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly requiresCore: string;
  readonly capabilities: ModuleRegistryCapabilities;
  readonly previousVersions: readonly ModuleRegistryArtifactRef[];
}

export interface ModuleRegistryIndex {
  readonly schemaVersion: typeof REGISTRY_INDEX_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly modules: readonly ModuleRegistryEntry[];
}

export interface RegistryIndexValidation {
  readonly index: ModuleRegistryIndex | null;
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validateArtifactRef(
  raw: unknown,
  where: string,
  errors: string[]
): ModuleRegistryArtifactRef | null {
  if (!isRecord(raw)) {
    errors.push(`${where}: artifact ref must be an object`);
    return null;
  }
  if (!nonEmptyString(raw.version, 64)) {
    errors.push(`${where}: missing/invalid version`);
    return null;
  }
  if (typeof raw.artifact !== "string" || !ARTIFACT_FILENAME_RE.test(raw.artifact)) {
    errors.push(`${where}: artifact must be a bare .tgz filename`);
    return null;
  }
  if (typeof raw.sha256 !== "string" || !SHA256_HEX_RE.test(raw.sha256)) {
    errors.push(`${where}: sha256 must be 64 lowercase hex chars`);
    return null;
  }
  if (
    typeof raw.sizeBytes !== "number" ||
    !Number.isInteger(raw.sizeBytes) ||
    raw.sizeBytes <= 0 ||
    raw.sizeBytes > ARTIFACT_MAX_BYTES
  ) {
    errors.push(`${where}: sizeBytes must be a positive integer ≤ ${ARTIFACT_MAX_BYTES}`);
    return null;
  }
  return {
    version: raw.version,
    artifact: raw.artifact,
    sha256: raw.sha256,
    sizeBytes: raw.sizeBytes
  };
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function validateCapabilities(
  raw: unknown,
  where: string,
  errors: string[]
): ModuleRegistryCapabilities | null {
  if (!isRecord(raw)) {
    errors.push(`${where}: capabilities must be an object`);
    return null;
  }
  const permissions = stringArray(raw.permissions);
  const fetchHosts = stringArray(raw.fetchHosts);
  if (
    !permissions ||
    !fetchHosts ||
    typeof raw.ownsTables !== "boolean" ||
    !Array.isArray(raw.tools)
  ) {
    errors.push(`${where}: capabilities requires permissions[], fetchHosts[], tools[], ownsTables`);
    return null;
  }
  const tools: ModuleRegistryToolRef[] = [];
  for (const tool of raw.tools) {
    if (!isRecord(tool) || !nonEmptyString(tool.name) || !nonEmptyString(tool.risk, 32)) {
      errors.push(`${where}: malformed tool entry`);
      return null;
    }
    tools.push({ name: tool.name, risk: tool.risk });
  }
  return { permissions, fetchHosts, tools, ownsTables: raw.ownsTables };
}

function validateEntry(
  raw: unknown,
  position: number,
  errors: string[]
): ModuleRegistryEntry | null {
  const where =
    isRecord(raw) && typeof raw.id === "string"
      ? `modules[${position}] (${raw.id})`
      : `modules[${position}]`;
  if (!isRecord(raw)) {
    errors.push(`${where}: entry must be an object`);
    return null;
  }
  if (typeof raw.id !== "string" || !MODULE_ID_RE.test(raw.id)) {
    errors.push(`${where}: id must be a bare kebab module slug`);
    return null;
  }
  if (!nonEmptyString(raw.name)) {
    errors.push(`${where}: missing/invalid name`);
    return null;
  }
  const description =
    raw.description === undefined || raw.description === null
      ? null
      : nonEmptyString(raw.description, 2000)
        ? raw.description
        : undefined;
  if (description === undefined) {
    errors.push(`${where}: description must be a string or null`);
    return null;
  }
  if (!nonEmptyString(raw.requiresCore, 64)) {
    errors.push(`${where}: missing/invalid requiresCore`);
    return null;
  }
  const ref = validateArtifactRef(raw, where, errors);
  if (!ref) return null;
  const capabilities = validateCapabilities(raw.capabilities, where, errors);
  if (!capabilities) return null;
  // previousVersions is REQUIRED (spec §4) — an empty array is fine, absence is not.
  if (!Array.isArray(raw.previousVersions)) {
    errors.push(`${where}: previousVersions array is required (may be empty)`);
    return null;
  }
  const previousVersions: ModuleRegistryArtifactRef[] = [];
  for (const [i, prev] of raw.previousVersions.entries()) {
    const prevRef = validateArtifactRef(prev, `${where}.previousVersions[${i}]`, errors);
    if (!prevRef) return null;
    previousVersions.push(prevRef);
  }
  return {
    ...ref,
    id: raw.id,
    name: raw.name,
    description,
    requiresCore: raw.requiresCore,
    capabilities,
    previousVersions
  };
}

export function validateRegistryIndex(raw: unknown): RegistryIndexValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) return { index: null, errors: ["index must be a JSON object"] };
  if (raw.schemaVersion !== REGISTRY_INDEX_SCHEMA_VERSION) {
    return {
      index: null,
      errors: [`unsupported index schemaVersion: ${String(raw.schemaVersion)}`]
    };
  }
  if (!nonEmptyString(raw.generatedAt, 64))
    return { index: null, errors: ["missing/invalid generatedAt"] };
  if (!Array.isArray(raw.modules)) return { index: null, errors: ["modules must be an array"] };

  const modules: ModuleRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const [i, entryRaw] of raw.modules.entries()) {
    const entry = validateEntry(entryRaw, i, errors);
    if (!entry) continue;
    if (seen.has(entry.id)) {
      errors.push(`modules[${i}] (${entry.id}): duplicate module id — first entry wins`);
      continue;
    }
    seen.add(entry.id);
    modules.push(entry);
  }
  return { index: { schemaVersion: 1, generatedAt: raw.generatedAt, modules }, errors };
}

export function resolveRegistryArtifact(
  index: ModuleRegistryIndex,
  id: string,
  version?: string
): { entry: ModuleRegistryEntry; ref: ModuleRegistryArtifactRef } | null {
  const entry = index.modules.find((m) => m.id === id);
  if (!entry) return null;
  if (version === undefined || version === entry.version) {
    return {
      entry,
      ref: {
        version: entry.version,
        artifact: entry.artifact,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes
      }
    };
  }
  const prev = entry.previousVersions.find((p) => p.version === version);
  return prev ? { entry, ref: prev } : null;
}
```

Create `packages/module-registry/src/distribution/ensure-list.ts`:

```ts
// JARVIS_MODULES_ENSURE parsing (#964, spec §7 compose-ensure). Format: comma- or
// whitespace-separated `id` / `id@version` tokens. Parsing never throws — bad tokens
// become errors so the boot reconcile can warn-and-continue (registry problems must
// never make boot fatal, spec §7).
import { MODULE_ID_RE } from "../external/validate.js";

export interface EnsureListEntry {
  readonly id: string;
  readonly version?: string;
}

export interface EnsureListParse {
  readonly entries: readonly EnsureListEntry[];
  readonly errors: readonly string[];
}

export function parseModulesEnsure(raw: string | null | undefined): EnsureListParse {
  const entries: EnsureListEntry[] = [];
  const errors: string[] = [];
  if (!raw || raw.trim() === "") return { entries, errors };

  const seen = new Set<string>();
  for (const token of raw.split(/[,\s]+/).filter((t) => t.length > 0)) {
    const at = token.indexOf("@");
    const id = at === -1 ? token : token.slice(0, at);
    const version = at === -1 ? undefined : token.slice(at + 1);
    if (!MODULE_ID_RE.test(id)) {
      errors.push(`invalid module id in JARVIS_MODULES_ENSURE: "${token}"`);
      continue;
    }
    if (version !== undefined && (version.length === 0 || version.length > 64)) {
      errors.push(`invalid version pin in JARVIS_MODULES_ENSURE: "${token}"`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`duplicate module id in JARVIS_MODULES_ENSURE: "${id}" (first entry wins)`);
      continue;
    }
    seen.add(id);
    entries.push(version === undefined ? { id } : { id, version });
  }
  return { entries, errors };
}
```

Modify `packages/module-registry/src/node.ts` — add to the existing `export *` block (after line 23, `export * from "./external/job-reconciler.js";`):

```ts
export * from "./distribution/index-schema.js";
export * from "./distribution/ensure-list.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/module-registry-index-schema.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @jarv1s/module-registry typecheck
git add packages/module-registry/src/distribution/index-schema.ts packages/module-registry/src/distribution/ensure-list.ts packages/module-registry/src/node.ts tests/unit/module-registry-index-schema.test.ts
git commit -m "feat(modules): registry index schema + JARVIS_MODULES_ENSURE parsing (#964)"
```

---

### Task 2: Manifest `database.ownedTables` declaration + hash coverage of `sql/**`

Downloadable modules that own tables declare them in the manifest; the manifest validator enforces a hard slug prefix, and the package hash starts covering `sql/**` so a swapped migration file drifts the module.

**Files:**

- Modify: `packages/module-sdk/src/index.ts` (interface at line ~627)
- Modify: `packages/module-registry/src/external/validate.ts` (FORBIDDEN_FIELDS at lines 37-55, re-shape at lines 425-450)
- Modify: `packages/module-registry/src/external/hash.ts` (hashable set at lines 82-95)
- Test: `tests/unit/external-module-database-declaration.test.ts`

**Interfaces:**

- Consumes: `validateExternalModuleManifest(raw, expectedId, coreVersion?, reservedQueueNames?)` (validate.ts:198), `hashExternalPackage(dir)` / `ExternalPackageEscapeError` (hash.ts).
- Produces (used by Tasks 4, 5, 7):
  - `export interface ExternalModuleDatabaseDeclaration { readonly ownedTables: readonly string[] }` in `@jarv1s/module-sdk`.
  - `JsonJarvisModuleManifest` gains `readonly database?: ExternalModuleDatabaseDeclaration`.
  - Manifests with a `database` block now VALIDATE (previously force-rejected); every owned table must match `/^app\.[a-z][a-z0-9_]*$/` AND be prefixed `app.<slug>_` (slug = module id with `-`→`_`), ≤32 tables, unique, non-empty.
  - `hashExternalPackage` output changes when any file under `sql/` changes.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/external-module-database-declaration.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ExternalPackageEscapeError,
  hashExternalPackage,
  validateExternalModuleManifest
} from "../../packages/module-registry/src/node.js";

const baseManifest = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis Labs",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" }
};

describe("manifest database.ownedTables validation (#964)", () => {
  it("accepts a well-formed database declaration with the module slug prefix", () => {
    const result = validateExternalModuleManifest(
      {
        ...baseManifest,
        database: { ownedTables: ["app.job_search_listings", "app.job_search_notes"] }
      },
      "job-search"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.database?.ownedTables).toEqual([
        "app.job_search_listings",
        "app.job_search_notes"
      ]);
    }
  });

  it("still accepts a manifest with no database block (metadata-only module)", () => {
    expect(validateExternalModuleManifest(baseManifest, "job-search").ok).toBe(true);
  });

  it("rejects tables outside the module's slug prefix (cross-module claim)", () => {
    for (const table of ["app.users", "app.notes_items", "app.jobsearch_x", "app.job_searchx"]) {
      const result = validateExternalModuleManifest(
        { ...baseManifest, database: { ownedTables: [table] } },
        "job-search"
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects unqualified, non-app-schema, and malformed table names", () => {
    for (const table of [
      "job_search_x",
      "public.job_search_x",
      "app.Job_Search",
      "app.job-search-x",
      'app."x"; DROP TABLE app.users'
    ]) {
      const result = validateExternalModuleManifest(
        { ...baseManifest, database: { ownedTables: [table] } },
        "job-search"
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects empty, oversized, duplicate, and unknown-key database blocks", () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `app.job_search_t${i}`);
    for (const database of [
      { ownedTables: [] },
      { ownedTables: tooMany },
      { ownedTables: ["app.job_search_a", "app.job_search_a"] },
      { ownedTables: ["app.job_search_a"], migrations: "sql/" },
      { ownedTables: "app.job_search_a" },
      []
    ]) {
      const result = validateExternalModuleManifest({ ...baseManifest, database }, "job-search");
      expect(result.ok).toBe(false);
    }
  });
});

describe("hashExternalPackage covers sql/** (#964)", () => {
  const dirs: string[] = [];
  const makeModule = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "mod-hash-"));
    dirs.push(dir);
    writeFileSync(join(dir, "jarvis.module.json"), JSON.stringify(baseManifest));
    mkdirSync(join(dir, "sql"));
    writeFileSync(
      join(dir, "sql", "0001_init.sql"),
      "CREATE TABLE app.job_search_listings (id uuid);"
    );
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("changes the package hash when a sql file changes", () => {
    const dir = makeModule();
    const before = hashExternalPackage(dir);
    writeFileSync(
      join(dir, "sql", "0001_init.sql"),
      "CREATE TABLE app.job_search_listings (id uuid, x int);"
    );
    expect(hashExternalPackage(dir)).not.toBe(before);
  });

  it("changes the package hash when a sql file is added", () => {
    const dir = makeModule();
    const before = hashExternalPackage(dir);
    writeFileSync(
      join(dir, "sql", "0002_more.sql"),
      "ALTER TABLE app.job_search_listings ADD COLUMN y int;"
    );
    expect(hashExternalPackage(dir)).not.toBe(before);
  });

  it("rejects a sql/ symlink escaping the module directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mod-hash-esc-"));
    dirs.push(dir);
    const outside = mkdtempSync(join(tmpdir(), "mod-hash-out-"));
    dirs.push(outside);
    writeFileSync(join(dir, "jarvis.module.json"), JSON.stringify(baseManifest));
    symlinkSync(outside, join(dir, "sql"));
    expect(() => hashExternalPackage(dir)).toThrow(ExternalPackageEscapeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-database-declaration.test.ts`
Expected: FAIL — the database-block manifests are rejected (`database` is in FORBIDDEN_FIELDS) and the sql-change tests fail (hash ignores `sql/**`).

- [ ] **Step 3: Implement**

**(a)** `packages/module-sdk/src/index.ts` — add immediately BEFORE `export interface JsonJarvisModuleManifest` (line ~627):

```ts
/**
 * Database surface of a downloadable module (#964). Declaration only — the privileged
 * installer (scripts/module-install.ts) creates tables from the module's sql/ directory;
 * the manifest declares which app-schema table names the module owns so install, purge,
 * and registry capability display all key off one list. Validation (module-registry)
 * enforces the `app.<module_slug>_` prefix so no module can claim another's tables.
 */
export interface ExternalModuleDatabaseDeclaration {
  readonly ownedTables: readonly string[];
}
```

and inside `JsonJarvisModuleManifest`, after the `readonly worker?: ExternalModuleWorkerDeclaration;` field (line 649):

```ts
  readonly database?: ExternalModuleDatabaseDeclaration;
```

**(b)** `packages/module-registry/src/external/validate.ts`:

1. Delete the `"database",` line from `FORBIDDEN_FIELDS` and update its doc comment's last sentence to: `` `auth`/`storage`/`web` are first-class as of #918 Slice 2 and `database` as of #964 (validated positively below) and are deliberately absent from this list. ``
2. Add the import of the new SDK type to the existing `@jarv1s/module-sdk` type-import list: `ExternalModuleDatabaseDeclaration`.
3. Add near `MODULE_ID_RE` (line 24):

```ts
// #964: owned-table names. Qualified app-schema, lowercase snake, and HARD-PREFIXED by
// the module's own slug (id with hyphens→underscores) so no downloadable module can
// declare — and later purge — another module's (or core's) tables. Name part capped at
// Postgres's 63-char identifier limit.
export const MODULE_OWNED_TABLE_RE = /^app\.[a-z][a-z0-9_]{0,62}$/;
```

4. Add this validation block inside `validateExternalModuleManifest`, after the `fetchHosts` block and before `if (errors.length > 0) return { ok: false, errors };`:

```ts
// #964: positive validation of the database declaration (previously forbidden).
let database: ExternalModuleDatabaseDeclaration | undefined;
if (obj.database !== undefined) {
  if (typeof obj.database !== "object" || obj.database === null || Array.isArray(obj.database)) {
    errors.push("database must be an object");
  } else {
    const databaseObj = obj.database as Record<string, unknown>;
    const unknownKeys = Object.keys(databaseObj).filter((key) => key !== "ownedTables");
    if (unknownKeys.length > 0) {
      errors.push(`database contains unknown fields: ${unknownKeys.join(", ")}`);
    }
    const ownedTables = databaseObj.ownedTables;
    const slugPrefix = `app.${expectedId.replace(/-/g, "_")}_`;
    if (!Array.isArray(ownedTables) || ownedTables.length === 0 || ownedTables.length > 32) {
      errors.push("database.ownedTables must be a non-empty array of at most 32 table names");
    } else {
      const seen = new Set<string>();
      const validated: string[] = [];
      for (const table of ownedTables) {
        if (typeof table !== "string" || !MODULE_OWNED_TABLE_RE.test(table)) {
          errors.push(`database.ownedTables entry is not a valid app-schema table name`);
        } else if (!table.startsWith(slugPrefix)) {
          errors.push(`database.ownedTables entry must be prefixed "${slugPrefix}": ${table}`);
        } else if (seen.has(table)) {
          errors.push(`database.ownedTables contains a duplicate: ${table}`);
        } else {
          seen.add(table);
          validated.push(table);
        }
      }
      if (errors.length === 0 && unknownKeys.length === 0) {
        database = { ownedTables: validated };
      }
    }
  }
}
```

5. Add to the re-shape literal (after the `...(worker !== undefined ? { worker } : {}),` line):

```ts
    ...(database !== undefined ? { database } : {}),
```

**(c)** `packages/module-registry/src/external/hash.ts` — after the `dist/web` block (line 95), add:

```ts
// #964: sql/** joins the hashable set. Module DDL is executed by the PRIVILEGED
// installer, so a swapped migration file must invalidate the trusted package hash
// exactly like a swapped worker bundle. Same containment discipline as dist/web.
if (includeIfContained("sql")) {
  const sqlDir = join(dir, "sql");
  if (statSync(sqlDir).isDirectory()) {
    for (const rel of walkFiles(sqlDir)) relPaths.push(`sql/${rel}`);
  }
}
```

Also extend the comment on line 82-84 ("The hashable set: ...") to read "the manifest, the worker bundle, everything the web bundle ships, and the sql migrations." and the `ExternalPackageEscapeError` doc's path list (line 49) to include `` `sql` ``.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/external-module-database-declaration.test.ts`
Expected: PASS. Also run the existing corpus to prove no regression: `pnpm vitest run tests/unit/external-module-validate.test.ts` (if a FORBIDDEN_FIELDS test asserts `database` is rejected, UPDATE that assertion — it now validates positively).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @jarv1s/module-sdk typecheck && pnpm --filter @jarv1s/module-registry typecheck
git add packages/module-sdk/src/index.ts packages/module-registry/src/external/validate.ts packages/module-registry/src/external/hash.ts tests/unit/external-module-database-declaration.test.ts
git commit -m "feat(modules): manifest database.ownedTables declaration + sql/** in package hash (#964)"
```

(If Step 4 required updating an existing unit test file, add that exact path to the `git add` too.)

---

### Task 3: Migration 0161 + staged/purge repository state

Adds the distribution columns to `app.external_modules` and the repository functions the admin routes (Task 6) write through. The boot reconcile (Task 7) writes the same columns directly on the bootstrap connection — these functions are the app-RLS-plane writers only.

**Files:**

- Create: `packages/settings/sql/0161_external_module_distribution.sql`
- Modify: `packages/db/src/types.ts` (`ExternalModulesTable`, line ~158)
- Modify: `packages/settings/src/repository-external-modules.ts` (append functions)
- Modify: `packages/settings/src/repository.ts` (make `externalModuleAuditWriter` public — line ~302; NO new delegates, the file is at 970/1000 lines)
- Modify: `tests/integration/foundation-schema-catalog.test.ts` (add the 0161 row after the 0160 row, line ~275)
- Test: `tests/integration/external-module-staging-state.test.ts`

**Interfaces:**

- Consumes: `assertDataContextDb`, `DataContextDb` from `@jarv1s/db`; `ExternalModuleAuditWriter` (already in repository-external-modules.ts).
- Produces (used by Tasks 6, 7, 9):
  - Columns on `app.external_modules`: `staged_version text`, `staged_package_hash text`, `staged_at timestamptz`, `staged_by uuid`, `staged_source text ('admin-download'|'compose-ensure')`, `purge_requested_at timestamptz`, `purge_requested_by uuid`, `last_install_error text (≤2000)`.
  - `updateExternalModuleStaging(scopedDb, input: { id; stagedVersion; stagedPackageHash; actorUserId; requestId }, writeAudit): Promise<void>` — always records `staged_source: 'admin-download'` (the compose-ensure writer is the supervisor-plane script) and clears `last_install_error`. Audit action `module.external_stage`, metadata `{ moduleId }` only.
  - `setExternalModulePurgeRequested(scopedDb, input: { id; requested: boolean; actorUserId; requestId }, writeAudit): Promise<boolean>` — update-only; `false` when no row exists. Audit `module.external_purge_request` / `module.external_purge_cancel`.
  - `listExternalModuleAdminStates(scopedDb): Promise<ExternalModuleAdminState[]>` with `ExternalModuleAdminState { id; status: "enabled"|"disabled"; packageHash: string|null; disabledReason: string|null; stagedVersion: string|null; stagedPackageHash: string|null; stagedSource: "admin-download"|"compose-ensure"|null; purgeRequestedAt: Date|null; lastInstallError: string|null }`.
  - `SettingsRepository.externalModuleAuditWriter(scopedDb)` is PUBLIC — Task 6's routes pass it to these standalone functions.

- [ ] **Step 1: Write the migration**

Create `packages/settings/sql/0161_external_module_distribution.sql`:

```sql
-- #964: module distribution & install — staged-download intent, purge marks, and the
-- last install failure on app.external_modules. Written by the admin download/remove
-- routes (app role; the 0152 admin RLS policies gate INSERT/UPDATE) and by the
-- supervisor-plane boot reconcile (bootstrap role, which bypasses nothing: it owns the
-- table). last_install_error mirrors the supervisor-plane app.module_installs journal
-- because that table is FORCE-RLS and unreadable by the app role (spec deviation 1).
-- Single top-level statement (module SQL runner contract).
ALTER TABLE app.external_modules
  ADD COLUMN staged_version text,
  ADD COLUMN staged_package_hash text,
  ADD COLUMN staged_at timestamptz,
  ADD COLUMN staged_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  ADD COLUMN staged_source text CHECK (staged_source IN ('admin-download', 'compose-ensure')),
  ADD COLUMN purge_requested_at timestamptz,
  ADD COLUMN purge_requested_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  ADD COLUMN last_install_error text CHECK (char_length(last_install_error) <= 2000);
```

- [ ] **Step 2: Register the migration in the foundation catalog test**

In `tests/integration/foundation-schema-catalog.test.ts`, the "applies versioned SQL migrations from an empty database" test asserts the FULL migration list with `toEqual`. Add after the `{ version: "0160", name: "0160_news_discovery.sql" }` row (line ~275):

```ts
      { version: "0161", name: "0161_external_module_distribution.sql" }
```

- [ ] **Step 3: Update the Kysely table type**

In `packages/db/src/types.ts`, replace the `ExternalModulesTable` interface (line ~158) with:

```ts
// External trusted-operator module enablement (#917). Instance-global, admin-managed.
// `'discovered'` is virtual (no row); only enabled/disabled modules have a row.
// Backed by migration 0152_external_modules.sql; distribution columns by 0161 (#964).
export interface ExternalModulesTable {
  id: string;
  status: "enabled" | "disabled";
  manifest_hash: string;
  package_hash: string;
  disabled_reason: string | null;
  enabled_by: string | null;
  enabled_at: NullableTimestampColumn;
  // #964 distribution: staged-download intent (accepted by the boot reconcile),
  // purge marks (executed by the boot reconcile), and the last install failure.
  staged_version: string | null;
  staged_package_hash: string | null;
  staged_at: NullableTimestampColumn;
  staged_by: string | null;
  staged_source: "admin-download" | "compose-ensure" | null;
  purge_requested_at: NullableTimestampColumn;
  purge_requested_by: string | null;
  last_install_error: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

- [ ] **Step 4: Write the failing integration test**

Create `tests/integration/external-module-staging-state.test.ts` (mirrors `tests/integration/external-modules-repository.test.ts`'s setup):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  listExternalModuleAdminStates,
  setExternalModulePurgeRequested,
  updateExternalModuleStaging
} from "../../packages/settings/src/repository-external-modules.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("external-module staging + purge state (#964)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("admin stages a download for a module with no row (insert path, status stays disabled)", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-1" }, (db) =>
      updateExternalModuleStaging(
        db,
        {
          id: "job-search",
          stagedVersion: "1.2.0",
          stagedPackageHash: "sha256:" + "a".repeat(64),
          actorUserId: ids.adminUser,
          requestId: "stage-1"
        },
        repo.externalModuleAuditWriter(db)
      )
    );

    const states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "stage-r1" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")).toMatchObject({
      status: "disabled",
      stagedVersion: "1.2.0",
      stagedSource: "admin-download",
      purgeRequestedAt: null,
      lastInstallError: null
    });
  });

  it("re-staging an existing row updates staged fields and clears last_install_error", async () => {
    // Simulate a prior failed install recorded by the supervisor plane.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-2" }, (db) =>
      db.db
        .updateTable("app.external_modules")
        .set({ last_install_error: "boom" })
        .where("id", "=", "job-search")
        .execute()
    );

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-3" }, (db) =>
      updateExternalModuleStaging(
        db,
        {
          id: "job-search",
          stagedVersion: "1.3.0",
          stagedPackageHash: "sha256:" + "b".repeat(64),
          actorUserId: ids.adminUser,
          requestId: "stage-3"
        },
        repo.externalModuleAuditWriter(db)
      )
    );

    const states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "stage-r2" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")).toMatchObject({
      stagedVersion: "1.3.0",
      lastInstallError: null
    });
  });

  it("purge request marks the row; cancel clears it; audit written for both", async () => {
    const marked = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-1" },
      (db) =>
        setExternalModulePurgeRequested(
          db,
          { id: "job-search", requested: true, actorUserId: ids.adminUser, requestId: "purge-1" },
          repo.externalModuleAuditWriter(db)
        )
    );
    expect(marked).toBe(true);

    let states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r1" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")?.purgeRequestedAt).toBeInstanceOf(Date);

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "purge-2" }, (db) =>
      setExternalModulePurgeRequested(
        db,
        { id: "job-search", requested: false, actorUserId: ids.adminUser, requestId: "purge-2" },
        repo.externalModuleAuditWriter(db)
      )
    );
    states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r2" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")?.purgeRequestedAt).toBeNull();

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r3" },
      (db) => repo.listAdminAuditEvents(db)
    );
    const actions = audit.filter((e) => e.target_id === "job-search").map((e) => e.action);
    expect(actions).toContain("module.external_stage");
    expect(actions).toContain("module.external_purge_request");
    expect(actions).toContain("module.external_purge_cancel");
  });

  it("purge request on a module with no row returns false", async () => {
    const marked = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-3" },
      (db) =>
        setExternalModulePurgeRequested(
          db,
          { id: "never-seen", requested: true, actorUserId: ids.adminUser, requestId: "purge-3" },
          repo.externalModuleAuditWriter(db)
        )
    );
    expect(marked).toBe(false);
  });

  it("RLS: a non-admin actor cannot stage a download", async () => {
    await expect(
      runner.withDataContext({ actorUserId: ids.userA, requestId: "stage-x" }, (db) =>
        updateExternalModuleStaging(
          db,
          {
            id: "sneaky",
            stagedVersion: "1.0.0",
            stagedPackageHash: "sha256:" + "c".repeat(64),
            actorUserId: ids.userA,
            requestId: "stage-x"
          },
          repo.externalModuleAuditWriter(db)
        )
      )
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/external-module-staging-state.test.ts` (dev Postgres up: `pnpm db:up`)
Expected: FAIL — `updateExternalModuleStaging` is not exported (and, before the migration lands, unknown columns).

- [ ] **Step 6: Implement the repository functions**

Append to `packages/settings/src/repository-external-modules.ts`:

```ts
// ── #964 distribution state ─────────────────────────────────────────────────

export interface UpdateExternalModuleStagingInput {
  readonly id: string;
  readonly stagedVersion: string;
  readonly stagedPackageHash: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * Record a verified admin download as staged intent (#964, spec §5 step 8). Upsert:
 * a not-yet-installed module has no row (insert, status 'disabled' — only the boot
 * reconcile flips to 'enabled' when it accepts the staged files); an update (re-download,
 * update, retry) touches ONLY the staged fields. Always 'admin-download' — the
 * compose-ensure writer is the supervisor-plane reconcile script, not this function.
 * Clears last_install_error so a retry gets a clean slate.
 */
export async function updateExternalModuleStaging(
  scopedDb: DataContextDb,
  input: UpdateExternalModuleStagingInput,
  writeAudit: ExternalModuleAuditWriter
): Promise<void> {
  assertDataContextDb(scopedDb);
  await scopedDb.db
    .insertInto("app.external_modules")
    .values({
      id: input.id,
      status: "disabled",
      // NOT NULL hash sentinels, same rationale as writeExternalModuleDisabledRow: a
      // disabled row is never active regardless of hash; the reconcile records the real
      // hashes when it accepts the staged package.
      manifest_hash: "",
      package_hash: "",
      disabled_reason: null,
      enabled_by: null,
      enabled_at: null,
      staged_version: input.stagedVersion,
      staged_package_hash: input.stagedPackageHash,
      staged_at: new Date(),
      staged_by: input.actorUserId,
      staged_source: "admin-download",
      last_install_error: null,
      created_at: new Date(),
      updated_at: new Date()
    })
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        staged_version: input.stagedVersion,
        staged_package_hash: input.stagedPackageHash,
        staged_at: new Date(),
        staged_by: input.actorUserId,
        staged_source: "admin-download",
        last_install_error: null,
        updated_at: new Date()
      })
    )
    .execute();

  // Metadata-only audit: { moduleId } ONLY — never the hash, version, or URL (#964).
  await writeAudit({
    actorUserId: input.actorUserId,
    action: "module.external_stage",
    targetType: "module",
    targetId: input.id,
    metadata: { moduleId: input.id },
    requestId: input.requestId
  });
}

export interface SetExternalModulePurgeInput {
  readonly id: string;
  readonly requested: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * Mark (or cancel) a data purge for the next boot reconcile (#964, spec §8). Update-only:
 * a module with no row has no recorded data to purge — returns false so the route can 404.
 * The mark is executed and cleared by the supervisor-plane reconcile, never here.
 */
export async function setExternalModulePurgeRequested(
  scopedDb: DataContextDb,
  input: SetExternalModulePurgeInput,
  writeAudit: ExternalModuleAuditWriter
): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .updateTable("app.external_modules")
    .set({
      purge_requested_at: input.requested ? new Date() : null,
      purge_requested_by: input.requested ? input.actorUserId : null,
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .executeTakeFirst();
  if ((result.numUpdatedRows ?? 0n) === 0n) return false;

  await writeAudit({
    actorUserId: input.actorUserId,
    action: input.requested ? "module.external_purge_request" : "module.external_purge_cancel",
    targetType: "module",
    targetId: input.id,
    metadata: { moduleId: input.id },
    requestId: input.requestId
  });
  return true;
}

/** Full admin-facing distribution state per row (#964). Superset of ExternalModuleState. */
export interface ExternalModuleAdminState {
  readonly id: string;
  readonly status: "enabled" | "disabled";
  readonly packageHash: string | null;
  readonly disabledReason: string | null;
  readonly stagedVersion: string | null;
  readonly stagedPackageHash: string | null;
  readonly stagedSource: "admin-download" | "compose-ensure" | null;
  readonly purgeRequestedAt: Date | null;
  readonly lastInstallError: string | null;
}

export async function listExternalModuleAdminStates(
  scopedDb: DataContextDb
): Promise<ExternalModuleAdminState[]> {
  assertDataContextDb(scopedDb);
  const rows = await scopedDb.db
    .selectFrom("app.external_modules")
    .select([
      "id",
      "status",
      "package_hash",
      "disabled_reason",
      "staged_version",
      "staged_package_hash",
      "staged_source",
      "purge_requested_at",
      "last_install_error"
    ])
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    packageHash: r.package_hash,
    disabledReason: r.disabled_reason,
    stagedVersion: r.staged_version,
    stagedPackageHash: r.staged_package_hash,
    stagedSource: r.staged_source,
    purgeRequestedAt: r.purge_requested_at,
    lastInstallError: r.last_install_error
  }));
}
```

In `packages/settings/src/repository.ts`, change the visibility of the audit-writer factory (line ~302) from `private externalModuleAuditWriter(` to `externalModuleAuditWriter(` and extend its doc comment with: `Public as of #964 so the distribution routes can call the standalone staging/purge writers in repository-external-modules.ts directly (repository.ts is at the file-size cap — no new delegates).`

- [ ] **Step 7: Run tests to verify they pass**

```
pnpm vitest run tests/integration/external-module-staging-state.test.ts
pnpm vitest run tests/integration/foundation-schema-catalog.test.ts
pnpm vitest run tests/integration/external-modules-repository.test.ts
```

Expected: all PASS (foundation catalog now includes the 0161 row).

- [ ] **Step 8: Commit**

```bash
pnpm --filter @jarv1s/db typecheck && pnpm --filter @jarv1s/settings typecheck && pnpm check:file-size
git add packages/settings/sql/0161_external_module_distribution.sql packages/db/src/types.ts packages/settings/src/repository-external-modules.ts packages/settings/src/repository.ts tests/integration/foundation-schema-catalog.test.ts tests/integration/external-module-staging-state.test.ts
git commit -m "feat(modules): migration 0161 — staged-download, purge-mark, install-error state (#964)"
```

---

### Task 4: Publish script + rolling-release GitHub workflow

Builds each module in `external-modules/`, packs a deterministic tarball, merges `previousVersions` (retain 5), writes `index.json`, and a new workflow publishes everything to the rolling GitHub Release tagged `modules`.

**Files:**

- Create: `scripts/publish-module-registry.ts`
- Create: `.github/workflows/modules-registry.yml`
- Modify: root `package.json` (devDependencies: `"tar": "^7.5.16"`, `"@types/tar": "^6.1.13"`; scripts: `"publish:module-registry"`)
- Test: `tests/unit/publish-module-registry.test.ts`

**Interfaces:**

- Consumes: `buildExternalModule(moduleDir)` (scripts/build-external-module.ts:14); `validateExternalModuleManifest`, `validateRegistryIndex`, `REGISTRY_INDEX_SCHEMA_VERSION`, `ARTIFACT_FILENAME_RE`, types `ModuleRegistryArtifactRef` / `ModuleRegistryEntry` / `ModuleRegistryIndex` (Task 1); manifest fields `assistantTools` (`{name, risk, permissionId}` per ExternalModuleAssistantToolDeclaration), `fetchHosts`, `database.ownedTables` (Task 2).
- Produces:
  - `export const REGISTRY_RETAINED_VERSIONS = 5;`
  - `mergePreviousVersions(existing: ModuleRegistryEntry | undefined, next: ModuleRegistryArtifactRef): readonly ModuleRegistryArtifactRef[]`
  - `packModuleArtifact(moduleDir: string, outDir: string, id: string, version: string): Promise<ModuleRegistryArtifactRef>`
  - `buildRegistryArtifacts(options: { moduleDirs: readonly string[]; outDir: string; previousIndex: ModuleRegistryIndex | null; generatedAt: string }): Promise<ModuleRegistryIndex>`
  - The `modules` release exposes `index.json` at the pinned URL Task 5 downloads from.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/publish-module-registry.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as tar from "tar";
import { afterAll, describe, expect, it } from "vitest";

import type {
  ModuleRegistryArtifactRef,
  ModuleRegistryEntry
} from "../../packages/module-registry/src/node.js";
import {
  mergePreviousVersions,
  packModuleArtifact,
  REGISTRY_RETAINED_VERSIONS
} from "../../scripts/publish-module-registry.js";

const ref = (version: string): ModuleRegistryArtifactRef => ({
  version,
  artifact: `job-search-${version}.tgz`,
  sha256: "a".repeat(64),
  sizeBytes: 10
});

const entry = (version: string, previous: ModuleRegistryArtifactRef[]): ModuleRegistryEntry => ({
  id: "job-search",
  name: "Job Search",
  description: null,
  requiresCore: ">=0.0.0",
  capabilities: { permissions: [], fetchHosts: [], tools: [], ownsTables: [] },
  previousVersions: previous,
  ...ref(version)
});

describe("mergePreviousVersions", () => {
  it("moves the old current version to the head of previousVersions", () => {
    const merged = mergePreviousVersions(entry("1.0.0", [ref("0.9.0")]), ref("1.1.0"));
    expect(merged.map((r) => r.version)).toEqual(["1.0.0", "0.9.0"]);
  });

  it("caps retained versions at REGISTRY_RETAINED_VERSIONS total (current + previous)", () => {
    const previous = ["1.4.0", "1.3.0", "1.2.0", "1.1.0"].map(ref);
    const merged = mergePreviousVersions(entry("1.5.0", previous), ref("1.6.0"));
    expect(merged).toHaveLength(REGISTRY_RETAINED_VERSIONS - 1);
    expect(merged.map((r) => r.version)).toEqual(["1.5.0", "1.4.0", "1.3.0", "1.2.0"]);
  });

  it("republishing the same version does not duplicate it in previousVersions", () => {
    const merged = mergePreviousVersions(entry("1.0.0", [ref("0.9.0")]), ref("1.0.0"));
    expect(merged.map((r) => r.version)).toEqual(["0.9.0"]);
  });

  it("first publish (no existing entry) has empty previousVersions", () => {
    expect(mergePreviousVersions(undefined, ref("1.0.0"))).toEqual([]);
  });
});

describe("packModuleArtifact", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("packs manifest + dist/** + sql/** with a schema-valid filename, sha256, and size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-mod-"));
    const out = mkdtempSync(join(tmpdir(), "pack-out-"));
    dirs.push(dir, out);
    writeFileSync(join(dir, "jarvis.module.json"), "{}");
    mkdirSync(join(dir, "dist", "web"), { recursive: true });
    writeFileSync(join(dir, "dist", "worker.js"), "// worker");
    writeFileSync(join(dir, "dist", "web", "index.js"), "// web");
    mkdirSync(join(dir, "sql"));
    writeFileSync(join(dir, "sql", "0001_init.sql"), "CREATE TABLE app.job_search_x (id uuid);");
    writeFileSync(join(dir, "README.md"), "must NOT be packed");

    const packed = await packModuleArtifact(dir, out, "job-search", "1.0.0");
    expect(packed.artifact).toBe("job-search-1.0.0.tgz");
    expect(packed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packed.sizeBytes).toBeGreaterThan(0);

    const entries: string[] = [];
    await tar.t({
      file: join(out, packed.artifact),
      onReadEntry: (e) => {
        entries.push(String(e.path));
      }
    });
    const files = entries.filter((p) => !p.endsWith("/"));
    expect(files.sort()).toEqual([
      "dist/web/index.js",
      "dist/worker.js",
      "jarvis.module.json",
      "sql/0001_init.sql"
    ]);
  });

  it("packs a module without sql/ (metadata-only module)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-nosql-"));
    const out = mkdtempSync(join(tmpdir(), "pack-nosql-out-"));
    dirs.push(dir, out);
    writeFileSync(join(dir, "jarvis.module.json"), "{}");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "worker.js"), "// worker");
    const packed = await packModuleArtifact(dir, out, "tiny", "0.1.0");
    expect(packed.artifact).toBe("tiny-0.1.0.tgz");
  });
});
```

- [ ] **Step 2: Add the dependency, run test to verify it fails**

```bash
pnpm add -D -w tar@^7.5.16 @types/tar@^6.1.13
pnpm vitest run tests/unit/publish-module-registry.test.ts
```

Expected: FAIL — `scripts/publish-module-registry.js` does not exist.

- [ ] **Step 3: Implement the publish script**

Create `scripts/publish-module-registry.ts`:

```ts
// scripts/publish-module-registry.ts
// #964: builds the module-registry publication set. For every module directory given
// (default: each child of external-modules/), it runs the JS-01 bundler, validates the
// manifest, packs a portable gzip tarball of exactly the on-disk trust set
// (jarvis.module.json + dist/** + sql/**), and emits index.json conforming to Task 1's
// registry schema. Runs only in CI (modules-registry.yml) and locally for testing —
// external-modules/ is dockerignored, the core image never ships it. Retention:
// current + 4 previous versions per module.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as tar from "tar";

import {
  ARTIFACT_FILENAME_RE,
  REGISTRY_INDEX_SCHEMA_VERSION,
  validateExternalModuleManifest,
  validateRegistryIndex,
  type ModuleRegistryArtifactRef,
  type ModuleRegistryEntry,
  type ModuleRegistryIndex
} from "../packages/module-registry/src/node.js";
import { buildExternalModule } from "./build-external-module.js";

export const REGISTRY_RETAINED_VERSIONS = 5;

/**
 * Fold the previous index entry's current version into previousVersions, newest first,
 * capped so current + previous ≤ REGISTRY_RETAINED_VERSIONS. Republishing the same
 * version replaces it in place instead of duplicating it.
 */
export function mergePreviousVersions(
  existing: ModuleRegistryEntry | undefined,
  next: ModuleRegistryArtifactRef
): readonly ModuleRegistryArtifactRef[] {
  if (!existing) return [];
  const chain: ModuleRegistryArtifactRef[] = [
    {
      version: existing.version,
      artifact: existing.artifact,
      sha256: existing.sha256,
      sizeBytes: existing.sizeBytes
    },
    ...existing.previousVersions
  ];
  return chain.filter((r) => r.version !== next.version).slice(0, REGISTRY_RETAINED_VERSIONS - 1);
}

/** Pack the module's trust set into `<id>-<version>.tgz` and return its artifact ref. */
export async function packModuleArtifact(
  moduleDir: string,
  outDir: string,
  id: string,
  version: string
): Promise<ModuleRegistryArtifactRef> {
  const artifact = `${id}-${version}.tgz`;
  if (!ARTIFACT_FILENAME_RE.test(artifact)) {
    throw new Error(`artifact filename fails registry schema: ${artifact}`);
  }
  // Exactly the hashable set from external/hash.ts (#964 Task 2) — nothing else.
  // README, src/, node_modules must never reach the wire.
  const members = ["jarvis.module.json", "dist"];
  if (existsSync(join(moduleDir, "sql"))) members.push("sql");
  const file = join(outDir, artifact);
  // portable: strips uid/gid/atime metadata so identical trees pack identically.
  await tar.create({ gzip: true, portable: true, cwd: resolve(moduleDir), file }, members);
  const bytes = readFileSync(file);
  return {
    version,
    artifact,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: statSync(file).size
  };
}

export interface BuildRegistryArtifactsOptions {
  readonly moduleDirs: readonly string[];
  readonly outDir: string;
  readonly previousIndex: ModuleRegistryIndex | null;
  readonly generatedAt: string;
}

export async function buildRegistryArtifacts(
  options: BuildRegistryArtifactsOptions
): Promise<ModuleRegistryIndex> {
  mkdirSync(options.outDir, { recursive: true });
  const modules: ModuleRegistryEntry[] = [];
  for (const moduleDir of options.moduleDirs) {
    const id = basename(resolve(moduleDir));
    await buildExternalModule(moduleDir);
    const raw: unknown = JSON.parse(readFileSync(join(moduleDir, "jarvis.module.json"), "utf8"));
    const validation = validateExternalModuleManifest(raw, id);
    if (!validation.ok) {
      // Fail the whole publish: a broken manifest must never reach the registry.
      throw new Error(`manifest invalid for ${id}: ${validation.errors.join("; ")}`);
    }
    const manifest = validation.manifest;
    const ref = await packModuleArtifact(moduleDir, options.outDir, id, manifest.version);
    const existing = options.previousIndex?.modules.find((m) => m.id === id);
    modules.push({
      ...ref,
      id,
      name: manifest.name,
      description: manifest.description ?? null,
      requiresCore: manifest.compatibility.jarv1s,
      capabilities: {
        permissions: [...new Set((manifest.assistantTools ?? []).map((t) => t.permissionId))],
        fetchHosts: manifest.fetchHosts ?? [],
        tools: (manifest.assistantTools ?? []).map((t) => ({ name: t.name, risk: t.risk })),
        ownsTables: manifest.database?.ownedTables ?? []
      },
      previousVersions: mergePreviousVersions(existing, ref)
    });
  }
  const index: ModuleRegistryIndex = {
    schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    modules
  };
  // Self-check: the index we publish must round-trip our own validator.
  const check = validateRegistryIndex(JSON.parse(JSON.stringify(index)));
  if (!check.index || check.errors.length > 0) {
    throw new Error(`generated index fails own schema: ${check.errors.join("; ")}`);
  }
  writeFileSync(join(options.outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

// CLI: tsx scripts/publish-module-registry.ts --out dist/registry [--previous-index p]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outDir = argValue("--out") ?? "dist/registry";
  const previousIndexPath = argValue("--previous-index");
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const externalModulesDir = join(repoRoot, "external-modules");
  const moduleDirs = readdirSync(externalModulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(externalModulesDir, e.name));
  let previousIndex: ModuleRegistryIndex | null = null;
  if (previousIndexPath && existsSync(previousIndexPath)) {
    const parsed = validateRegistryIndex(JSON.parse(readFileSync(previousIndexPath, "utf8")));
    // Tolerate a corrupt previous index (history reset) — warn and publish fresh.
    if (!parsed.index)
      console.warn(`previous index invalid, ignoring: ${parsed.errors.join("; ")}`);
    previousIndex = parsed.index;
  }
  buildRegistryArtifacts({
    moduleDirs,
    outDir,
    previousIndex,
    generatedAt: new Date().toISOString()
  })
    .then((index) => console.log(`published ${index.modules.length} module(s) to ${outDir}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
```

Add to root `package.json` scripts (next to `build:external:job-search`):

```json
    "publish:module-registry": "tsx scripts/publish-module-registry.ts --out dist/registry",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/publish-module-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the workflow**

Create `.github/workflows/modules-registry.yml` (mirrors ci.yml's setup steps — checkout@v5, pnpm/action-setup@v4 version 10.6.2, setup-node@v5 node 24):

```yaml
# #964: publishes external modules to the rolling GitHub Release tagged `modules`.
# The release IS the module registry: index.json + <id>-<version>.tgz assets. Runs on
# main pushes that touch module sources, and manually. Serialized (no concurrent runs)
# because the previousVersions merge reads the release's current index.json.
name: modules-registry

on:
  push:
    branches: [main]
    paths:
      - "external-modules/**"
      - "scripts/publish-module-registry.ts"
      - ".github/workflows/modules-registry.yml"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: modules-registry
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 10.6.2
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Download current index (absent on first publish)
        run: |
          mkdir -p /tmp/registry-prev
          gh release download modules --pattern index.json --dir /tmp/registry-prev \
            || echo "no existing modules release/index — publishing fresh"
      - name: Build registry artifacts
        run: pnpm tsx scripts/publish-module-registry.ts --out dist/registry --previous-index /tmp/registry-prev/index.json
      - name: Ensure rolling release exists
        run: |
          gh release view modules \
            || gh release create modules --title "Module registry" --latest=false \
                 --notes "Rolling module-distribution release. Assets are managed by the modules-registry workflow — do not edit by hand."
      - name: Upload assets (clobber replaces index.json + republished versions)
        run: gh release upload modules dist/registry/* --clobber
      - name: Prune assets no longer referenced by the index
        run: |
          # Keep exactly: index.json + every artifact the new index names
          # (current + previousVersions). Retired versions fall off the release here.
          jq -r '[.modules[] | .artifact, (.previousVersions[]?.artifact)] + ["index.json"] | .[]' \
            dist/registry/index.json > /tmp/keep.txt
          gh api "repos/${{ github.repository }}/releases/tags/modules" \
            --jq '.assets[] | "\(.id)\t\(.name)"' | while IFS=$'\t' read -r id name; do
            if ! grep -qxF "$name" /tmp/keep.txt; then
              echo "pruning $name"
              gh api -X DELETE "repos/${{ github.repository }}/releases/assets/$id"
            fi
          done
```

- [ ] **Step 6: Validate locally + commit**

```bash
pnpm vitest run tests/unit/publish-module-registry.test.ts
pnpm publish:module-registry   # local end-to-end: builds job-search, packs, writes index.json under dist/registry
git add scripts/publish-module-registry.ts .github/workflows/modules-registry.yml tests/unit/publish-module-registry.test.ts package.json pnpm-lock.yaml
git commit -m "feat(modules): registry publish script + rolling-release workflow (#964)"
```

---

### Task 5: Download → verify → extract → stage pipeline

The core library that turns a registry entry into staged module files on disk, fail-closed at every step. Used by the admin download route (Task 6) and the boot reconcile's compose-ensure phase (Task 7).

**Files:**

- Create: `packages/module-registry/src/distribution/registry-source.ts`
- Create: `packages/module-registry/src/distribution/extract.ts`
- Create: `packages/module-registry/src/distribution/stage.ts`
- Create: `packages/module-registry/src/distribution/pipeline.ts`
- Modify: `packages/module-registry/src/node.ts` (add 4 `export *` lines after the Task 1 ones)
- Modify: `packages/module-registry/package.json` (dependencies: add `"tar": "^7.5.16"`; add `"@jarv1s/host-fetch": "workspace:*"` if not already present)
- Modify: root `package.json` (devDependencies: `"tar-stream": "^3.1.7"`, `"@types/tar-stream": "^3.1.3"` — for crafting malicious tarballs in tests)
- Test: `tests/unit/module-distribution-extract.test.ts`, `tests/unit/module-distribution-pipeline.test.ts`

**Interfaces:**

- Consumes: `createHostPinnedFetch(allowedHosts, options?: HostPinnedFetchOptions): typeof fetch` (@jarv1s/host-fetch — NOTE: its default resolver BLOCKS loopback/private IPs, which is why the non-prod override path below uses global fetch); Task 1's `validateRegistryIndex`, `resolveRegistryArtifact`, `ARTIFACT_MAX_BYTES`, `SHA256_HEX_RE`, types; `validateExternalModuleManifest` + `hashExternalPackage` (existing external/\*).
- Produces (used by Tasks 6, 7, 10):
  - `REGISTRY_INDEX_URL = "https://github.com/motioneso/jarv1s/releases/download/modules/index.json"`, `REGISTRY_ALLOWED_HOSTS`, `REGISTRY_INDEX_MAX_BYTES = 1 MiB`, `EXTRACT_MAX_RATIO = 4`, `EXTRACT_MAX_ENTRIES = 2000`
  - `resolveRegistryIndexUrl(env: NodeJS.ProcessEnv): string` — throws in production when `JARVIS_MODULE_REGISTRY_URL` is set
  - `fetchRegistryIndex(options: { env: NodeJS.ProcessEnv; fetchFn?: typeof fetch }): Promise<{ index: ModuleRegistryIndex | null; errors: readonly string[] }>`
  - `downloadArtifactBuffer(options: { url: string; expectedSha256: string; expectedSizeBytes: number; fetchFn: typeof fetch }): Promise<Buffer>`
  - `safeExtractModuleTarball(tarballPath: string, destDir: string): Promise<void>` + `ModuleTarballError` (`code: "entry-type" | "entry-path" | "too-many-entries" | "too-large"`)
  - `stageModuleDir(extractedDir: string, modulesDir: string, moduleId: string): void`, `sweepStagingDirs(modulesDir: string): void`
  - `downloadAndStageModule(options: DownloadAndStageOptions): Promise<DownloadAndStageResult>` + `ModuleDownloadError` (`code: ModuleDownloadErrorCode`)

- [ ] **Step 1: Write the failing extract test**

Create `tests/unit/module-distribution-extract.test.ts`:

```ts
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import * as tar from "tar";
import { pack } from "tar-stream";
import { afterAll, describe, expect, it } from "vitest";

import {
  ModuleTarballError,
  safeExtractModuleTarball
} from "../../packages/module-registry/src/node.js";

const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Craft an arbitrary (potentially malicious) .tgz with tar-stream. */
async function craftTarball(
  entries: readonly {
    name: string;
    type?: "file" | "symlink" | "link";
    linkname?: string;
    body?: string;
  }[]
): Promise<string> {
  const dir = tmp("craft-");
  const file = join(dir, "crafted.tgz");
  const p = pack();
  for (const e of entries) {
    if (e.type === "symlink" || e.type === "link") {
      p.entry({ name: e.name, type: e.type, linkname: e.linkname ?? "/etc/passwd" });
    } else {
      p.entry({ name: e.name }, e.body ?? "x");
    }
  }
  p.finalize();
  await pipeline(p, createGzip(), createWriteStream(file));
  return file;
}

describe("safeExtractModuleTarball (#964)", () => {
  it("extracts a legitimate module tarball", async () => {
    const src = tmp("legit-src-");
    writeFileSync(join(src, "jarvis.module.json"), "{}");
    mkdirSync(join(src, "dist"));
    writeFileSync(join(src, "dist", "worker.js"), "// w");
    const tarball = join(tmp("legit-tar-"), "mod.tgz");
    await tar.create({ gzip: true, portable: true, cwd: src, file: tarball }, [
      "jarvis.module.json",
      "dist"
    ]);
    const dest = tmp("legit-dest-");
    await safeExtractModuleTarball(tarball, dest);
    expect(readdirSync(dest).sort()).toEqual(["dist", "jarvis.module.json"]);
  });

  it("rejects path traversal and absolute paths", async () => {
    for (const name of ["../evil.js", "dist/../../evil.js", "/etc/cron.d/evil"]) {
      const tarball = await craftTarball([{ name }]);
      await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
        ModuleTarballError
      );
    }
  });

  it("rejects symlink and hardlink entries", async () => {
    for (const type of ["symlink", "link"] as const) {
      const tarball = await craftTarball([{ name: "dist/worker.js", type }]);
      await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
        ModuleTarballError
      );
    }
  });

  it("rejects tarballs with too many entries", async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ name: `dist/f${i}.js` }));
    const tarball = await craftTarball(entries);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });

  it("rejects a decompression bomb (extracted size > 4x tarball size)", async () => {
    // Highly compressible payload: 10 MiB of zeros gzips to ~10 KiB.
    const tarball = await craftTarball([
      { name: "dist/bomb.js", body: "\0".repeat(10 * 1024 * 1024) }
    ]);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });
});
```

- [ ] **Step 2: Add deps, run test to verify it fails**

```bash
pnpm add -D -w tar-stream@^3.1.7 @types/tar-stream@^3.1.3
pnpm --filter @jarv1s/module-registry add tar@^7.5.16
# add "@jarv1s/host-fetch": "workspace:*" to packages/module-registry/package.json dependencies if absent, then:
pnpm install
pnpm vitest run tests/unit/module-distribution-extract.test.ts
```

Expected: FAIL — `safeExtractModuleTarball` not exported.

- [ ] **Step 3: Implement extract + stage**

Create `packages/module-registry/src/distribution/extract.ts`:

```ts
// #964: fail-closed tarball extraction for downloaded module artifacts. The tarball is
// attacker-shaped input even though it came from our own release URL (a compromised
// release is exactly the threat model): only File/Directory entries, no absolute paths,
// no "..", bounded entry count and total extracted size (zip-bomb guard).
import { statSync } from "node:fs";

import * as tar from "tar";

export const EXTRACT_MAX_RATIO = 4;
export const EXTRACT_MAX_ENTRIES = 2000;

export type ModuleTarballErrorCode = "entry-type" | "entry-path" | "too-many-entries" | "too-large";

export class ModuleTarballError extends Error {
  constructor(
    readonly code: ModuleTarballErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ModuleTarballError";
  }
}

const isSafeEntryPath = (path: string): boolean => {
  if (path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return false;
  return !segments.includes("..");
};

export async function safeExtractModuleTarball(
  tarballPath: string,
  destDir: string
): Promise<void> {
  const maxTotalBytes = statSync(tarballPath).size * EXTRACT_MAX_RATIO;
  let entryCount = 0;
  let totalBytes = 0;
  // Validation pass BEFORE extraction: nothing touches disk until every entry passes.
  await tar.t({
    file: tarballPath,
    onReadEntry: (entry) => {
      entryCount += 1;
      if (entryCount > EXTRACT_MAX_ENTRIES) {
        throw new ModuleTarballError(
          "too-many-entries",
          `more than ${EXTRACT_MAX_ENTRIES} entries`
        );
      }
      if (entry.type !== "File" && entry.type !== "Directory") {
        throw new ModuleTarballError(
          "entry-type",
          `forbidden entry type ${entry.type}: ${entry.path}`
        );
      }
      if (!isSafeEntryPath(String(entry.path))) {
        throw new ModuleTarballError("entry-path", `unsafe entry path: ${entry.path}`);
      }
      totalBytes += entry.size ?? 0;
      if (totalBytes > maxTotalBytes) {
        throw new ModuleTarballError(
          "too-large",
          `extracted size exceeds ${EXTRACT_MAX_RATIO}x tarball size`
        );
      }
    }
  });
  // Extraction pass re-applies the path/type filter — defense in depth against a
  // tar library reading entries differently across the two passes.
  await tar.x({
    file: tarballPath,
    cwd: destDir,
    filter: (path, entry) =>
      (entry.type === "File" || entry.type === "Directory") && isSafeEntryPath(String(path))
  });
}
```

Create `packages/module-registry/src/distribution/stage.ts`:

```ts
// #964: atomic-ish staging of an extracted module into the modules directory. Work
// happens in dot-prefixed siblings of the final path (same filesystem → rename is
// atomic; dot-prefix means the discovery scanner never sees partial state — it lists
// module dirs by manifest presence and these names can never be a module id, which
// must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/).
import { existsSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const stagingDirFor = (modulesDir: string, moduleId: string): string =>
  join(modulesDir, `.staging-${moduleId}`);

const prevDirFor = (modulesDir: string, moduleId: string): string =>
  join(modulesDir, `.prev-${moduleId}`);

/**
 * Swap extractedDir into place as modulesDir/moduleId. If a version is already
 * installed it is parked at .prev-<id> and restored when the swap fails, so a crash
 * mid-update never leaves the module missing.
 */
export function stageModuleDir(extractedDir: string, modulesDir: string, moduleId: string): void {
  const target = join(modulesDir, moduleId);
  const prev = prevDirFor(modulesDir, moduleId);
  rmSync(prev, { recursive: true, force: true });
  const hadPrevious = existsSync(target);
  if (hadPrevious) renameSync(target, prev);
  try {
    renameSync(extractedDir, target);
  } catch (error) {
    if (hadPrevious) renameSync(prev, target);
    throw error;
  }
  rmSync(prev, { recursive: true, force: true });
}

/** Remove leftover .staging-* / .prev-* from a crashed earlier run (reconcile phase 1). */
export function sweepStagingDirs(modulesDir: string): void {
  if (!existsSync(modulesDir)) return;
  for (const name of readdirSync(modulesDir)) {
    if (name.startsWith(".staging-") || name.startsWith(".prev-")) {
      rmSync(join(modulesDir, name), { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 4: Run extract test to verify it passes**

Run: `pnpm vitest run tests/unit/module-distribution-extract.test.ts` (after adding the node.ts exports in Step 7 — or import from the source files directly first, then switch to node.js re-exports; final test file imports from `node.js`).
Expected: PASS.

- [ ] **Step 5: Write the failing pipeline test**

Create `tests/unit/module-distribution-pipeline.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as tar from "tar";
import { afterAll, describe, expect, it } from "vitest";

import {
  downloadAndStageModule,
  fetchRegistryIndex,
  ModuleDownloadError,
  REGISTRY_INDEX_URL,
  resolveRegistryIndexUrl,
  type ModuleRegistryIndex
} from "../../packages/module-registry/src/node.js";

const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const manifest = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.2.0",
  publisher: "Jarvis Labs",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" }
};

/** Build a real module tarball and the index entry pointing at it. */
async function makeFixture(overrides?: { manifestVersion?: string }): Promise<{
  index: ModuleRegistryIndex;
  tarballBytes: Buffer;
}> {
  const src = tmp("pipe-src-");
  writeFileSync(
    join(src, "jarvis.module.json"),
    JSON.stringify({ ...manifest, version: overrides?.manifestVersion ?? manifest.version })
  );
  mkdirSync(join(src, "dist"));
  writeFileSync(join(src, "dist", "worker.js"), "// w");
  const tarball = join(tmp("pipe-tar-"), "job-search-1.2.0.tgz");
  await tar.create({ gzip: true, portable: true, cwd: src, file: tarball }, [
    "jarvis.module.json",
    "dist"
  ]);
  const tarballBytes = readFileSync(tarball);
  return {
    tarballBytes,
    index: {
      schemaVersion: 1,
      generatedAt: "2026-07-12T00:00:00.000Z",
      modules: [
        {
          id: "job-search",
          name: "Job Search",
          description: null,
          version: "1.2.0",
          artifact: "job-search-1.2.0.tgz",
          sha256: createHash("sha256").update(tarballBytes).digest("hex"),
          sizeBytes: tarballBytes.length,
          requiresCore: ">=0.0.0",
          capabilities: { permissions: [], fetchHosts: [], tools: [], ownsTables: [] },
          previousVersions: []
        }
      ]
    }
  };
}

/** Fake fetch serving the index and the tarball, standing in for the release URL. */
const fakeFetch =
  (index: ModuleRegistryIndex, tarballBytes: Buffer): typeof fetch =>
  async (input) => {
    const url = String(input);
    if (url.endsWith("/index.json")) return new Response(JSON.stringify(index), { status: 200 });
    if (url.endsWith(".tgz")) return new Response(new Uint8Array(tarballBytes), { status: 200 });
    return new Response("not found", { status: 404 });
  };

describe("resolveRegistryIndexUrl (#964)", () => {
  it("defaults to the pinned release URL", () => {
    expect(resolveRegistryIndexUrl({} as NodeJS.ProcessEnv)).toBe(REGISTRY_INDEX_URL);
  });
  it("honors JARVIS_MODULE_REGISTRY_URL outside production", () => {
    const env = {
      JARVIS_MODULE_REGISTRY_URL: "http://127.0.0.1:9/index.json"
    } as NodeJS.ProcessEnv;
    expect(resolveRegistryIndexUrl(env)).toBe("http://127.0.0.1:9/index.json");
  });
  it("REFUSES the override in production", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_MODULE_REGISTRY_URL: "http://127.0.0.1:9/index.json"
    } as NodeJS.ProcessEnv;
    expect(() => resolveRegistryIndexUrl(env)).toThrow(/test-only/);
  });
});

describe("fetchRegistryIndex (#964)", () => {
  it("returns the validated index", async () => {
    const { index, tarballBytes } = await makeFixture();
    const result = await fetchRegistryIndex({
      env: {} as NodeJS.ProcessEnv,
      fetchFn: fakeFetch(index, tarballBytes)
    });
    expect(result.index?.modules[0]?.id).toBe("job-search");
  });
  it("fails closed on an oversized index", async () => {
    const big: typeof fetch = async () =>
      new Response("x".repeat(1024 * 1024 + 1), { status: 200 });
    const result = await fetchRegistryIndex({ env: {} as NodeJS.ProcessEnv, fetchFn: big });
    expect(result.index).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it("fails closed on a non-200 response", async () => {
    const nope: typeof fetch = async () => new Response("gone", { status: 404 });
    const result = await fetchRegistryIndex({ env: {} as NodeJS.ProcessEnv, fetchFn: nope });
    expect(result.index).toBeNull();
  });
});

describe("downloadAndStageModule (#964)", () => {
  it("stages a verified module and returns its package hash", async () => {
    const { index, tarballBytes } = await makeFixture();
    const modulesDir = tmp("pipe-mods-");
    const result = await downloadAndStageModule({
      moduleId: "job-search",
      modulesDir,
      env: {} as NodeJS.ProcessEnv,
      fetchFn: fakeFetch(index, tarballBytes)
    });
    expect(result.version).toBe("1.2.0");
    expect(result.packageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(existsSync(join(modulesDir, "job-search", "jarvis.module.json"))).toBe(true);
    expect(existsSync(join(modulesDir, ".staging-job-search"))).toBe(false);
  });

  it("rejects on sha256 mismatch without touching the modules dir", async () => {
    const { index, tarballBytes } = await makeFixture();
    const tampered = {
      ...index,
      modules: [{ ...index.modules[0]!, sha256: "b".repeat(64) }]
    };
    const modulesDir = tmp("pipe-mods-");
    await expect(
      downloadAndStageModule({
        moduleId: "job-search",
        modulesDir,
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(tampered, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "integrity-mismatch" });
    expect(existsSync(join(modulesDir, "job-search"))).toBe(false);
  });

  it("rejects when the inner manifest version disagrees with the index", async () => {
    const { tarballBytes } = await makeFixture({ manifestVersion: "9.9.9" });
    // Index advertises 1.2.0 but must carry the REAL sha/size of the 9.9.9 tarball so
    // integrity passes and the version check is what trips.
    const { index } = await makeFixture();
    const lying = {
      ...index,
      modules: [
        {
          ...index.modules[0]!,
          sha256: createHash("sha256").update(tarballBytes).digest("hex"),
          sizeBytes: tarballBytes.length
        }
      ]
    };
    await expect(
      downloadAndStageModule({
        moduleId: "job-search",
        modulesDir: tmp("pipe-mods-"),
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(lying, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "version-mismatch" });
  });

  it("rejects an unknown module id", async () => {
    const { index, tarballBytes } = await makeFixture();
    await expect(
      downloadAndStageModule({
        moduleId: "nope",
        modulesDir: tmp("pipe-mods-"),
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(index, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "module-not-found" });
  });
});
```

- [ ] **Step 6: Implement registry-source + pipeline**

Create `packages/module-registry/src/distribution/registry-source.ts`:

```ts
// #964: where the registry lives and how we talk to it. The index URL and host list
// are HARDCODED — an env override exists for tests only and is refused outright in
// production so no runtime configuration can redirect module downloads.
import { createHostPinnedFetch } from "@jarv1s/host-fetch";

import { validateRegistryIndex, type ModuleRegistryIndex } from "./index-schema.js";

export const REGISTRY_INDEX_URL =
  "https://github.com/motioneso/jarv1s/releases/download/modules/index.json";

// github.com serves the release URL; the two githubusercontent hosts are where GitHub
// redirects release-asset downloads.
export const REGISTRY_ALLOWED_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
] as const;

export const REGISTRY_INDEX_MAX_BYTES = 1024 * 1024;

export function resolveRegistryIndexUrl(env: NodeJS.ProcessEnv): string {
  const override = env.JARVIS_MODULE_REGISTRY_URL;
  if (override !== undefined && override !== "") {
    if (env.NODE_ENV === "production") {
      throw new Error("JARVIS_MODULE_REGISTRY_URL is test-only and refused in production");
    }
    return override;
  }
  return REGISTRY_INDEX_URL;
}

/**
 * The fetch used for all registry traffic. Default: host-pinned fetch locked to the
 * three GitHub hosts (SSRF/redirect containment + private-IP blocklist). When a
 * test override URL is active — impossible in production, resolveRegistryIndexUrl
 * throws there — we use plain fetch, because the mock registry sits on loopback,
 * which the host-pinned resolver correctly blocks.
 */
export function createRegistryFetch(env: NodeJS.ProcessEnv, fetchFn?: typeof fetch): typeof fetch {
  if (fetchFn) return fetchFn;
  if (env.JARVIS_MODULE_REGISTRY_URL !== undefined && env.JARVIS_MODULE_REGISTRY_URL !== "") {
    if (env.NODE_ENV === "production") {
      throw new Error("JARVIS_MODULE_REGISTRY_URL is test-only and refused in production");
    }
    return fetch;
  }
  return createHostPinnedFetch(REGISTRY_ALLOWED_HOSTS, {
    maxResponseBytes: 50 * 1024 * 1024 + 1024
  });
}

export interface FetchRegistryIndexOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly fetchFn?: typeof fetch;
}

/** Never throws for remote/shape problems — returns { index: null, errors } instead. */
export async function fetchRegistryIndex(
  options: FetchRegistryIndexOptions
): Promise<{ index: ModuleRegistryIndex | null; errors: readonly string[] }> {
  try {
    const url = resolveRegistryIndexUrl(options.env);
    const doFetch = createRegistryFetch(options.env, options.fetchFn);
    const response = await doFetch(url);
    if (!response.ok) return { index: null, errors: [`registry index HTTP ${response.status}`] };
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > REGISTRY_INDEX_MAX_BYTES) {
      return { index: null, errors: ["registry index exceeds 1 MiB cap"] };
    }
    return validateRegistryIndex(JSON.parse(text));
  } catch (error) {
    return { index: null, errors: [`registry index unavailable: ${String(error)}`] };
  }
}

export interface DownloadArtifactOptions {
  readonly url: string;
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
  readonly fetchFn: typeof fetch;
}

/**
 * Download an artifact into memory (≤50 MiB by schema cap — acceptable resident cost
 * for an admin-initiated action) and verify size + sha256 BEFORE anything reaches disk.
 */
export async function downloadArtifactBuffer(options: DownloadArtifactOptions): Promise<Buffer> {
  const response = await options.fetchFn(options.url);
  if (!response.ok) throw new Error(`artifact HTTP ${response.status}`);
  const cap = options.expectedSizeBytes;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const body = response.body;
  if (!body) throw new Error("artifact response has no body");
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    // Abort mid-stream the moment the payload exceeds what the index promised.
    if (received > cap) {
      await reader.cancel();
      throw new Error(`artifact exceeds declared size ${cap}`);
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length !== options.expectedSizeBytes) {
    throw new Error(`artifact size ${buffer.length} != declared ${options.expectedSizeBytes}`);
  }
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (sha256 !== options.expectedSha256) {
    throw new Error("artifact sha256 does not match the registry index");
  }
  return buffer;
}
```

Create `packages/module-registry/src/distribution/pipeline.ts`:

```ts
// #964: the 8-step admin-download pipeline (spec §5): index → resolve → download →
// integrity → extract → manifest validation → version cross-check → atomic stage.
// Everything before the final rename happens in dot-prefixed staging paths, so a
// failure at any step leaves the modules directory exactly as it was.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hashExternalPackage } from "../external/hash.js";
import { validateExternalModuleManifest } from "../external/validate.js";
import {
  ARTIFACT_MAX_BYTES,
  resolveRegistryArtifact,
  type ModuleRegistryIndex
} from "./index-schema.js";
import { safeExtractModuleTarball } from "./extract.js";
import {
  createRegistryFetch,
  downloadArtifactBuffer,
  fetchRegistryIndex,
  resolveRegistryIndexUrl
} from "./registry-source.js";
import { stageModuleDir, stagingDirFor } from "./stage.js";

export type ModuleDownloadErrorCode =
  | "index-unavailable"
  | "module-not-found"
  | "download-failed"
  | "integrity-mismatch"
  | "extract-failed"
  | "manifest-invalid"
  | "version-mismatch";

export class ModuleDownloadError extends Error {
  constructor(
    readonly code: ModuleDownloadErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ModuleDownloadError";
  }
}

export interface DownloadAndStageOptions {
  readonly moduleId: string;
  /** Pin a previousVersions entry; omit for the current version. */
  readonly version?: string;
  readonly modulesDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fetchFn?: typeof fetch;
  /** Reuse an already-fetched index (Task 6's cache); omitted → fetched fresh. */
  readonly index?: ModuleRegistryIndex;
}

export interface DownloadAndStageResult {
  readonly moduleId: string;
  readonly version: string;
  readonly sha256: string;
  readonly packageHash: string;
}

export async function downloadAndStageModule(
  options: DownloadAndStageOptions
): Promise<DownloadAndStageResult> {
  let index = options.index;
  if (!index) {
    const fetched = await fetchRegistryIndex({ env: options.env, fetchFn: options.fetchFn });
    if (!fetched.index) {
      throw new ModuleDownloadError("index-unavailable", fetched.errors.join("; "));
    }
    index = fetched.index;
  }
  const resolved = resolveRegistryArtifact(index, options.moduleId, options.version);
  if (!resolved) {
    throw new ModuleDownloadError(
      "module-not-found",
      `module ${options.moduleId}${options.version ? `@${options.version}` : ""} is not in the registry index`
    );
  }
  const { ref } = resolved;
  if (ref.sizeBytes > ARTIFACT_MAX_BYTES) {
    throw new ModuleDownloadError(
      "integrity-mismatch",
      "declared artifact size exceeds the 50 MiB cap"
    );
  }
  // artifact is schema-validated to a bare filename → resolving it against the index
  // URL can only land inside the same release download path.
  const artifactUrl = new URL(ref.artifact, resolveRegistryIndexUrl(options.env)).toString();
  let tarballBytes: Buffer;
  try {
    tarballBytes = await downloadArtifactBuffer({
      url: artifactUrl,
      expectedSha256: ref.sha256,
      expectedSizeBytes: ref.sizeBytes,
      fetchFn: createRegistryFetch(options.env, options.fetchFn)
    });
  } catch (error) {
    const message = String(error);
    throw new ModuleDownloadError(
      /sha256|size/.test(message) ? "integrity-mismatch" : "download-failed",
      message
    );
  }
  mkdirSync(options.modulesDir, { recursive: true });
  const stagingDir = stagingDirFor(options.modulesDir, options.moduleId);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  try {
    const tarballPath = join(stagingDir, ".artifact.tgz");
    writeFileSync(tarballPath, tarballBytes);
    try {
      await safeExtractModuleTarball(tarballPath, stagingDir);
    } catch (error) {
      throw new ModuleDownloadError("extract-failed", String(error));
    }
    rmSync(tarballPath);
    const rawManifest: unknown = JSON.parse(
      readFileSync(join(stagingDir, "jarvis.module.json"), "utf8")
    );
    const validation = validateExternalModuleManifest(rawManifest, options.moduleId);
    if (!validation.ok) {
      throw new ModuleDownloadError("manifest-invalid", validation.errors.join("; "));
    }
    if (validation.manifest.version !== ref.version) {
      throw new ModuleDownloadError(
        "version-mismatch",
        `manifest version ${validation.manifest.version} != index version ${ref.version}`
      );
    }
    // Hash the staged tree NOW — this is the packageHash the reconcile will trust.
    const packageHash = hashExternalPackage(stagingDir);
    stageModuleDir(stagingDir, options.modulesDir, options.moduleId);
    return { moduleId: options.moduleId, version: ref.version, sha256: ref.sha256, packageHash };
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    if (error instanceof ModuleDownloadError) throw error;
    throw new ModuleDownloadError("extract-failed", String(error));
  }
}
```

- [ ] **Step 7: Export from node.ts**

In `packages/module-registry/src/node.ts`, after the Task 1 `export *` lines, add:

```ts
export * from "./distribution/registry-source.js";
export * from "./distribution/extract.js";
export * from "./distribution/stage.js";
export * from "./distribution/pipeline.js";
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
pnpm vitest run tests/unit/module-distribution-extract.test.ts tests/unit/module-distribution-pipeline.test.ts
pnpm --filter @jarv1s/module-registry typecheck
pnpm check:package-deps
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/module-registry/src/distribution/registry-source.ts packages/module-registry/src/distribution/extract.ts packages/module-registry/src/distribution/stage.ts packages/module-registry/src/distribution/pipeline.ts packages/module-registry/src/node.ts packages/module-registry/package.json package.json pnpm-lock.yaml tests/unit/module-distribution-extract.test.ts tests/unit/module-distribution-pipeline.test.ts
git commit -m "feat(modules): download/verify/extract/stage pipeline for registry artifacts (#964)"
```

---

### Task 6: Shared registry contracts, lifecycle derivation, admin registry routes, server wiring

Spec §5 (contracts), §6 (routes + download pipeline entry), §8 (the 9 lifecycle states),
§9 (remove/purge intent recording).

> **Deviation from earlier drafts:** `packages/settings/src/routes-modules.ts` already
> exists (320 lines, the #917 built-in + external-module enable/disable routes). The new
> registry routes go in a NEW file `routes-module-registry.ts` that reuses the exported
> `ModuleRoutesContext` — do not grow routes-modules.ts.

**Files:**

- Modify: `packages/shared/src/platform-api-modules.ts` (append after the module-credential
  section; file is 384 lines, stays well under the 1000-line gate)
- Create: `packages/settings/src/module-registry-rows.ts` (pure derivation, no I/O)
- Create: `packages/settings/src/routes-module-registry.ts`
- Modify: `packages/settings/src/routes.ts` (new `ModuleDistributionDependencies` port +
  registration call at ~L806)
- Modify: `apps/api/src/server.ts` (10-minute index cache closure + port wiring)
- Test: `tests/unit/module-registry-rows.test.ts`

**Interfaces:**

- Consumes: Task 1 `ModuleRegistryEntry` (structurally, via a local mirror — settings must
  NOT import `@jarv1s/module-registry`; that package depends on `@jarv1s/settings`, same
  cycle rule as the existing `ExternalModuleDiscovery` mirror at routes.ts:113);
  Task 3 `listExternalModuleAdminStates`, `updateExternalModuleStaging`,
  `setExternalModulePurgeRequested`, public `repository.externalModuleAuditWriter(scopedDb)`;
  Task 5 `fetchRegistryIndex`, `downloadAndStageModule`, `ModuleDownloadError`;
  `satisfiesCoreVersion` / `compareJarvisVersions` from `@jarv1s/module-sdk/core-version`
  (settings already depends on module-sdk).
- Produces: `ModuleRegistryLifecycleState` (9-value union), `ModuleRegistryRowDto`,
  `GetModuleRegistryResponse`, `deriveModuleRegistryRows(input): ModuleRegistryRowDto[]`,
  `ModuleDistributionDependencies` (the injected port), routes
  `GET /api/admin/module-registry`, `POST /api/admin/external-modules/:id/download`,
  `POST /api/admin/external-modules/:id/remove`,
  `DELETE /api/admin/external-modules/:id/purge`. Task 9 (web UI) consumes the DTOs and
  routes; Task 10 integration-tests them via `app.inject`.

- [ ] **Step 1: Append shared contracts to `packages/shared/src/platform-api-modules.ts`**

Append at end of file. Every response field is declared in the schema with a full
`required` array — the fast-json-stringify `additionalProperties:false` trap silently
drops undeclared emitted fields (bit us on #859/#885); nullable fields use the
`type: ["string", "null"]` array form exactly like `externalModuleSchema` above.

```ts
// ── Module registry / distribution (#964) ───────────────────────────────────
// Admin surface for the pinned module registry. States mirror spec §8 exactly.

export const MODULE_REGISTRY_LIFECYCLE_STATES = [
  "not-installed",
  "pending-restart",
  "installed-enabled",
  "installed-disabled",
  "update-available",
  "update-pending-restart",
  "install-failed",
  "declared-not-present",
  "incompatible"
] as const;

export type ModuleRegistryLifecycleState = (typeof MODULE_REGISTRY_LIFECYCLE_STATES)[number];

export interface ModuleRegistryToolDto {
  readonly name: string;
  readonly risk: string;
}

/** Capability block shown in the pre-download confirm dialog (spec §8). */
export interface ModuleRegistryCapabilitiesDto {
  readonly permissions: readonly string[];
  readonly fetchHosts: readonly string[];
  readonly tools: readonly ModuleRegistryToolDto[];
  readonly ownsTables: readonly string[];
}

export interface ModuleRegistryRowDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: ModuleRegistryLifecycleState;
  /** Version loaded at boot (null when not installed or not yet loaded). */
  readonly installedVersion: string | null;
  /** Latest version in the registry index (null when the id is local-only). */
  readonly latestVersion: string | null;
  readonly stagedVersion: string | null;
  /** Index compat range, for the "requires Jarvis ≥ X" copy on incompatible rows. */
  readonly requiresCore: string | null;
  /** null when the module is not in the registry index. */
  readonly capabilities: ModuleRegistryCapabilitiesDto | null;
  readonly lastInstallError: string | null;
  /** True while a purge is pending next boot; the UI hides Download and offers Cancel. */
  readonly purgePending: boolean;
}

export interface GetModuleRegistryResponse {
  readonly enabled: boolean;
  readonly registryUnavailable: boolean;
  readonly modules: readonly ModuleRegistryRowDto[];
}

export interface DownloadExternalModuleRequest {
  readonly version?: string;
}

export interface RemoveExternalModuleRequest {
  readonly purgeData: boolean;
}

const moduleRegistryToolSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "risk"],
  properties: { name: { type: "string" }, risk: { type: "string" } }
} as const;

const moduleRegistryCapabilitiesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["permissions", "fetchHosts", "tools", "ownsTables"],
  properties: {
    permissions: { type: "array", items: { type: "string" } },
    fetchHosts: { type: "array", items: { type: "string" } },
    tools: { type: "array", items: moduleRegistryToolSchema },
    ownsTables: { type: "array", items: { type: "string" } }
  }
} as const;

const moduleRegistryRowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "description",
    "state",
    "installedVersion",
    "latestVersion",
    "stagedVersion",
    "requiresCore",
    "capabilities",
    "lastInstallError",
    "purgePending"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    state: { type: "string", enum: MODULE_REGISTRY_LIFECYCLE_STATES },
    installedVersion: { type: ["string", "null"] },
    latestVersion: { type: ["string", "null"] },
    stagedVersion: { type: ["string", "null"] },
    requiresCore: { type: ["string", "null"] },
    // Nullable via type array, same pattern as externalModuleSchema.web (#918).
    capabilities: { ...moduleRegistryCapabilitiesSchema, type: ["object", "null"] },
    lastInstallError: { type: ["string", "null"] },
    purgePending: { type: "boolean" }
  }
} as const;

export const getModuleRegistryRouteSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: { refresh: { type: "string", enum: ["1"] } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "registryUnavailable", "modules"],
      properties: {
        enabled: { type: "boolean" },
        registryUnavailable: { type: "boolean" },
        modules: { type: "array", items: moduleRegistryRowSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

const moduleRegistryRowResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["module"],
  properties: { module: { ...moduleRegistryRowSchema } }
} as const;

export const downloadExternalModuleRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    properties: { version: { type: "string", minLength: 1, maxLength: 100 } }
  },
  response: {
    200: moduleRegistryRowResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema,
    502: errorResponseSchema,
    503: errorResponseSchema
  }
} as const;

export const removeExternalModuleRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["purgeData"],
    properties: { purgeData: { type: "boolean" } }
  },
  response: {
    200: moduleRegistryRowResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema
  }
} as const;

export const cancelExternalModulePurgeRouteSchema = {
  params: adminModuleParamsSchema,
  response: {
    200: moduleRegistryRowResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Write the failing derive test**

Create `tests/unit/module-registry-rows.test.ts`:

```ts
// Task 6 (#964): lifecycle-state derivation for the admin module-registry surface.
// Pure function — every spec §8 state gets a case, plus the precedence rules
// (staged beats install-error; update-available requires enabled).
import { describe, expect, it } from "vitest";

import {
  deriveModuleRegistryRows,
  type ModuleRegistryDeriveInput
} from "../../packages/settings/src/module-registry-rows.js";

const indexEntry = {
  id: "job-search",
  name: "Job search",
  description: "Job listings watcher",
  version: "0.2.0",
  requiresCore: ">=0.1.0",
  capabilities: {
    permissions: ["job-search.read"],
    fetchHosts: ["api.example.com"],
    tools: [{ name: "job_search_query", risk: "low" }],
    ownsTables: ["app.job_search_listings"]
  }
} as const;

const adminState = {
  id: "job-search",
  status: "enabled" as const,
  packageHash: "sha256:aaaa",
  disabledReason: null,
  stagedVersion: null,
  stagedPackageHash: null,
  stagedSource: null,
  purgeRequestedAt: null,
  lastInstallError: null
};

const discovery = {
  id: "job-search",
  name: "Job search",
  version: "0.1.0",
  description: "Job listings watcher"
};

function derive(overrides: Partial<ModuleRegistryDeriveInput>) {
  const input: ModuleRegistryDeriveInput = {
    registryEntries: [indexEntry],
    discoveries: [],
    rejected: [],
    adminStates: [],
    onDiskIds: [],
    ensureIds: [],
    ...overrides
  };
  return deriveModuleRegistryRows(input);
}

describe("deriveModuleRegistryRows", () => {
  it("in index, nothing local → not-installed with capabilities", () => {
    const rows = derive({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "job-search",
      state: "not-installed",
      latestVersion: "0.2.0",
      installedVersion: null,
      capabilities: indexEntry.capabilities,
      purgePending: false
    });
  });

  it("incompatible index entry → incompatible with requiresCore surfaced", () => {
    const rows = derive({
      registryEntries: [{ ...indexEntry, requiresCore: ">=99.0.0" }]
    });
    expect(rows[0].state).toBe("incompatible");
    expect(rows[0].requiresCore).toBe(">=99.0.0");
  });

  it("staged + not in boot discovery → pending-restart", () => {
    const rows = derive({
      onDiskIds: ["job-search"],
      adminStates: [
        {
          ...adminState,
          status: "disabled",
          stagedVersion: "0.2.0",
          stagedPackageHash: "sha256:bbbb"
        }
      ]
    });
    expect(rows[0].state).toBe("pending-restart");
    expect(rows[0].stagedVersion).toBe("0.2.0");
  });

  it("staged + present in boot discovery → update-pending-restart", () => {
    const rows = derive({
      discoveries: [discovery],
      onDiskIds: ["job-search"],
      adminStates: [{ ...adminState, stagedVersion: "0.2.0", stagedPackageHash: "sha256:bbbb" }]
    });
    expect(rows[0].state).toBe("update-pending-restart");
    expect(rows[0].installedVersion).toBe("0.1.0");
  });

  it("staged wins over a stale lastInstallError (retry re-downloaded)", () => {
    const rows = derive({
      onDiskIds: ["job-search"],
      adminStates: [
        {
          ...adminState,
          status: "disabled",
          stagedVersion: "0.2.0",
          stagedPackageHash: "sha256:bbbb",
          lastInstallError: "boom"
        }
      ]
    });
    expect(rows[0].state).toBe("pending-restart");
  });

  it("lastInstallError without staged → install-failed", () => {
    const rows = derive({
      onDiskIds: ["job-search"],
      adminStates: [
        { ...adminState, status: "disabled", lastInstallError: "migration 0001 failed" }
      ]
    });
    expect(rows[0].state).toBe("install-failed");
    expect(rows[0].lastInstallError).toBe("migration 0001 failed");
  });

  it("boot-rejected package → install-failed with the rejection reason", () => {
    const rows = derive({
      onDiskIds: ["job-search"],
      rejected: [{ id: "job-search", reason: "manifest id mismatch" }]
    });
    expect(rows[0].state).toBe("install-failed");
    expect(rows[0].lastInstallError).toBe("manifest id mismatch");
  });

  it("enabled on disk, index newer → update-available", () => {
    const rows = derive({
      discoveries: [discovery],
      onDiskIds: ["job-search"],
      adminStates: [adminState]
    });
    expect(rows[0].state).toBe("update-available");
    expect(rows[0].installedVersion).toBe("0.1.0");
    expect(rows[0].latestVersion).toBe("0.2.0");
  });

  it("enabled on disk, index same version → installed-enabled", () => {
    const rows = derive({
      registryEntries: [{ ...indexEntry, version: "0.1.0" }],
      discoveries: [discovery],
      onDiskIds: ["job-search"],
      adminStates: [adminState]
    });
    expect(rows[0].state).toBe("installed-enabled");
  });

  it("disabled on disk → installed-disabled even when the index is newer", () => {
    const rows = derive({
      discoveries: [discovery],
      onDiskIds: ["job-search"],
      adminStates: [{ ...adminState, status: "disabled", disabledReason: "disabled by admin" }]
    });
    expect(rows[0].state).toBe("installed-disabled");
    expect(rows[0].latestVersion).toBe("0.2.0");
  });

  it("ensure-declared, missing from disk and index fetch → declared-not-present", () => {
    const rows = derive({ registryEntries: [], ensureIds: ["job-search"] });
    expect(rows[0].state).toBe("declared-not-present");
  });

  it("purge pending after remove: dir gone, DB row remains → not-installed + purgePending", () => {
    const rows = derive({
      adminStates: [
        { ...adminState, status: "disabled", purgeRequestedAt: "2026-07-12T00:00:00.000Z" }
      ]
    });
    expect(rows[0].state).toBe("not-installed");
    expect(rows[0].purgePending).toBe(true);
  });

  it("registryEntries null (registry unavailable) → local rows only, no index fields", () => {
    const rows = deriveModuleRegistryRows({
      registryEntries: null,
      discoveries: [discovery],
      rejected: [],
      adminStates: [adminState],
      onDiskIds: ["job-search"],
      ensureIds: []
    });
    expect(rows[0].state).toBe("installed-enabled");
    expect(rows[0].latestVersion).toBeNull();
    expect(rows[0].capabilities).toBeNull();
  });

  it("sorts rows by id", () => {
    const rows = derive({
      registryEntries: [{ ...indexEntry, id: "zeta", name: "Zeta" }, indexEntry]
    });
    expect(rows.map((r) => r.id)).toEqual(["job-search", "zeta"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm vitest run tests/unit/module-registry-rows.test.ts
```

Expected: FAIL — `module-registry-rows.js` does not exist.

- [ ] **Step 4: Implement `packages/settings/src/module-registry-rows.ts`**

```ts
// Task 6 (#964): pure derivation of the admin module-registry rows (spec §8).
// No I/O here — the route feeds it the cached index, the BOOT discovery snapshot,
// a LIVE on-disk id listing (so remove/download reflect immediately, before the
// restart that refreshes the boot snapshot), the app.external_modules admin state,
// and the JARVIS_MODULES_ENSURE ids. Settings must not import @jarv1s/module-registry
// (dependency cycle — see ExternalModuleDiscovery's doc-comment in routes.ts), so the
// index entry is a structural mirror of Task 1's ModuleRegistryEntry subset.
import { compareJarvisVersions, satisfiesCoreVersion } from "@jarv1s/module-sdk/core-version";
import type {
  ModuleRegistryCapabilitiesDto,
  ModuleRegistryLifecycleState,
  ModuleRegistryRowDto
} from "@jarv1s/shared";

import type { ExternalModuleAdminState } from "./repository-external-modules.js";

/** Structural subset of @jarv1s/module-registry's ModuleRegistryEntry (Task 1). */
export interface ModuleRegistryEntryLike {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: string;
  readonly requiresCore: string;
  readonly capabilities: ModuleRegistryCapabilitiesDto;
}

/** Structural subset of the boot discovery (id + manifest identity fields). */
export interface DiscoveredModuleLike {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

export interface ModuleRegistryDeriveInput {
  /** null = registry fetch failed (degrade to local-only rows; spec §6). */
  readonly registryEntries: readonly ModuleRegistryEntryLike[] | null;
  /** Boot-time discovery snapshot (loaded modules with manifest info). */
  readonly discoveries: readonly DiscoveredModuleLike[];
  /** Boot-time loader rejections (present on disk but refused). */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
  readonly adminStates: readonly ExternalModuleAdminState[];
  /** LIVE readdir of JARVIS_MODULES_DIR (excludes dot-dirs) — presence truth. */
  readonly onDiskIds: readonly string[];
  readonly ensureIds: readonly string[];
}

export function deriveModuleRegistryRows(input: ModuleRegistryDeriveInput): ModuleRegistryRowDto[] {
  const entries = new Map((input.registryEntries ?? []).map((e) => [e.id, e]));
  const discoveries = new Map(input.discoveries.map((d) => [d.id, d]));
  const rejections = new Map(input.rejected.map((r) => [r.id, r.reason]));
  const states = new Map(input.adminStates.map((s) => [s.id, s]));
  const onDisk = new Set(input.onDiskIds);

  const ids = new Set<string>([
    ...entries.keys(),
    ...discoveries.keys(),
    ...rejections.keys(),
    ...states.keys(),
    ...onDisk,
    ...input.ensureIds
  ]);

  const rows: ModuleRegistryRowDto[] = [];
  for (const id of [...ids].sort()) {
    const entry = entries.get(id);
    const discovery = discoveries.get(id);
    const state = states.get(id);
    const rejectionReason = rejections.get(id) ?? null;
    const present = onDisk.has(id);
    const staged = state?.stagedVersion != null;

    // Precedence (first match wins). Staged beats a stale install error — a retry
    // re-download means "try this content next boot", so the old error is history.
    let lifecycle: ModuleRegistryLifecycleState;
    if (staged) {
      lifecycle = discovery ? "update-pending-restart" : "pending-restart";
    } else if (state?.lastInstallError != null) {
      lifecycle = "install-failed";
    } else if (present && rejectionReason !== null) {
      lifecycle = "install-failed";
    } else if (present && discovery) {
      if (state?.status === "enabled") {
        lifecycle =
          entry && compareJarvisVersions(entry.version, discovery.version) > 0
            ? "update-available"
            : "installed-enabled";
      } else {
        lifecycle = "installed-disabled";
      }
    } else if (present) {
      // On disk but not loaded at boot (dropped in mid-session, no rejection row):
      // treat as disabled until the next boot classifies it.
      lifecycle = "installed-disabled";
    } else if (input.ensureIds.includes(id)) {
      lifecycle = "declared-not-present";
    } else if (entry && !satisfiesCoreVersion(entry.requiresCore)) {
      lifecycle = "incompatible";
    } else {
      // In the index (downloadable), or a leftover DB row after Remove (renders as
      // not-installed; purgePending flags the pending destruction).
      lifecycle = "not-installed";
    }

    rows.push({
      id,
      name: entry?.name ?? discovery?.name ?? id,
      description: entry?.description ?? discovery?.description ?? null,
      state: lifecycle,
      installedVersion: discovery?.version ?? null,
      latestVersion: entry?.version ?? null,
      stagedVersion: state?.stagedVersion ?? null,
      requiresCore: entry?.requiresCore ?? null,
      capabilities: entry?.capabilities ?? null,
      lastInstallError: state?.lastInstallError ?? rejectionReason,
      purgePending: state?.purgeRequestedAt != null
    });
  }
  return rows;
}
```

- [ ] **Step 5: Run the derive test to verify it passes**

```bash
pnpm vitest run tests/unit/module-registry-rows.test.ts
```

Expected: PASS (14 tests).

- [ ] **Step 6: Add the repo helper `markExternalModuleRemoved` + the distribution port**

**(a)** Append to `packages/settings/src/repository-external-modules.ts` (after the Task 3
functions):

```ts
export interface MarkExternalModuleRemovedInput {
  readonly id: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * Admin Remove (#964 spec §9): pin the module off and clear staged intent. Data is
 * preserved (tables/ledger/KV/credentials untouched) — purge is a separate, explicit
 * flag consumed at boot. Update-only; returns false when the module has no row yet
 * (files-only remove still succeeds at the route layer). Audit is METADATA ONLY.
 */
export async function markExternalModuleRemoved(
  scopedDb: DataContextDb,
  input: MarkExternalModuleRemovedInput,
  writeAudit: ExternalModuleAuditWriter
): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .updateTable("app.external_modules")
    .set({
      status: "disabled",
      disabled_reason: "removed by admin",
      staged_version: null,
      staged_package_hash: null,
      staged_at: null,
      staged_by: null,
      staged_source: null,
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) return false;
  await writeAudit({
    actorUserId: input.actorUserId,
    action: "module.external_remove",
    targetType: "external_module",
    targetId: input.id,
    metadata: { moduleId: input.id },
    requestId: input.requestId
  });
  return true;
}
```

(If Task 3's chunk already picked a different `updated_at` idiom for its updates, match
it — the file is the source of truth once Task 3 has landed.)

**(b)** In `packages/settings/src/routes.ts`, directly after the
`ExternalModulesDependencies` interface (~L131-150), add the distribution port. Same
discipline as `reconcile`: the composition root (apps/api) implements it; settings never
imports `@jarv1s/module-registry`.

```ts
/**
 * #964 — module-distribution port injected by the composition root. Network + filesystem
 * only; all DB writes stay in this package (updateExternalModuleStaging etc.), so the
 * pipeline never needs a database handle and settings never imports module-registry.
 */
export interface ModuleDistributionDependencies {
  /**
   * Pinned-registry index entries, served through the composition root's 10-minute
   * in-process cache; `refresh: true` busts it. null = registry unreachable/invalid —
   * the GET degrades to local-only rows, never a 500 (spec §6).
   */
  readonly fetchRegistryEntries: (options: {
    readonly refresh: boolean;
  }) => Promise<readonly ModuleRegistryEntryLike[] | null>;
  /** Run download→verify→extract→stage (Task 5 pipeline). Never touches the DB. */
  readonly download: (input: {
    readonly moduleId: string;
    readonly version?: string;
  }) => Promise<
    | { readonly ok: true; readonly version: string; readonly packageHash: string }
    | { readonly ok: false; readonly code: string; readonly message: string }
  >;
  /** Delete JARVIS_MODULES_DIR/<id>. Idempotent; missing dir is fine. */
  readonly removeModuleFiles: (moduleId: string) => Promise<void>;
  /** LIVE readdir of JARVIS_MODULES_DIR (module dirs only, no dot-dirs). */
  readonly listOnDiskModuleIds: () => Promise<readonly string[]>;
  /** Ids declared in JARVIS_MODULES_ENSURE (for declared-not-present rows). */
  readonly ensureIds: readonly string[];
}
```

Import `ModuleRegistryEntryLike` from `./module-registry-rows.js` at the top of routes.ts.
Add to `SettingsRoutesDependencies` (next to `externalModules?`):

```ts
  /** #964 module-distribution port; registry routes degrade to enabled:false when absent. */
  readonly moduleDistribution?: ModuleDistributionDependencies;
```

And at ~L806, after the existing `registerModuleRoutes(...)` call:

```ts
registerModuleRegistryRoutes(server, {
  dependencies,
  repository,
  assertAdminUser,
  requireRequestId
});
```

with the import `import { registerModuleRegistryRoutes } from "./routes-module-registry.js";`
next to the routes-modules import at L84.

- [ ] **Step 7: Implement `packages/settings/src/routes-module-registry.ts`**

```ts
// Task 6 (#964): admin module-registry surface — list (index ⋈ local state), download,
// remove, cancel-purge. Same non-leak discipline as routes-modules.ts: assertAdminUser
// runs FIRST, before any 404/409 branch, so a non-admin can never probe module state.
// Network/fs work (index fetch, download pipeline) runs OUTSIDE withDataContext — a
// download can take tens of seconds and must not pin a pooled RLS connection.
import type { FastifyInstance } from "fastify";
import {
  cancelExternalModulePurgeRouteSchema,
  downloadExternalModuleRouteSchema,
  getModuleRegistryRouteSchema,
  removeExternalModuleRouteSchema,
  type GetModuleRegistryResponse,
  type ModuleRegistryRowDto
} from "@jarv1s/shared";

import { deriveModuleRegistryRows, type ModuleRegistryEntryLike } from "./module-registry-rows.js";
import {
  listExternalModuleAdminStates,
  markExternalModuleRemoved,
  setExternalModulePurgeRequested,
  updateExternalModuleStaging,
  type ExternalModuleAdminState
} from "./repository-external-modules.js";
import { HttpError, handleRouteError } from "./route-error.js";
import type { ModuleRoutesContext } from "./routes-modules.js";

// Task 5 pipeline error code → HTTP status. Codes are strings across the port boundary
// (settings cannot import module-registry's ModuleDownloadError); unknown codes → 502.
const DOWNLOAD_ERROR_STATUS: Record<string, number> = {
  "module-not-found": 404,
  "version-mismatch": 422,
  "integrity-mismatch": 422,
  "manifest-invalid": 422,
  "extract-failed": 422,
  "index-unavailable": 503,
  "download-failed": 502
};

export function registerModuleRegistryRoutes(
  server: FastifyInstance,
  ctx: ModuleRoutesContext
): void {
  const { dependencies, repository, assertAdminUser, requireRequestId } = ctx;

  /** Everything a derive needs besides the index; runs inside ONE admin RLS context. */
  async function loadLocalState(accessContext: {
    readonly actorUserId: string;
  }): Promise<readonly ExternalModuleAdminState[]> {
    return dependencies.dataContext.withDataContext(
      accessContext as Parameters<typeof dependencies.dataContext.withDataContext>[0],
      async (scopedDb) => {
        // Authorize FIRST — before any feature/404/409 branch.
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        return listExternalModuleAdminStates(scopedDb);
      }
    );
  }

  async function deriveRows(
    entries: readonly ModuleRegistryEntryLike[] | null,
    adminStates: readonly ExternalModuleAdminState[]
  ): Promise<ModuleRegistryRowDto[]> {
    const ext = dependencies.externalModules;
    const dist = dependencies.moduleDistribution;
    const onDiskIds = dist ? await dist.listOnDiskModuleIds() : [];
    return deriveModuleRegistryRows({
      registryEntries: entries,
      discoveries: (ext?.discoveries ?? []).map((d) => ({
        id: d.id,
        name: d.manifest.name,
        version: d.manifest.version,
        description: d.manifest.description
      })),
      rejected: ext?.rejected ?? [],
      adminStates,
      onDiskIds,
      ensureIds: dist?.ensureIds ?? []
    });
  }

  server.get<{ Querystring: { refresh?: string } }>(
    "/api/admin/module-registry",
    { schema: getModuleRegistryRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const adminStates = await loadLocalState(accessContext);
        const ext = dependencies.externalModules;
        const dist = dependencies.moduleDistribution;
        if (!ext?.enabled || !dist) {
          const body: GetModuleRegistryResponse = {
            enabled: false,
            registryUnavailable: false,
            modules: []
          };
          return body;
        }
        const entries = await dist.fetchRegistryEntries({
          refresh: request.query.refresh === "1"
        });
        const body: GetModuleRegistryResponse = {
          enabled: true,
          registryUnavailable: entries === null,
          modules: await deriveRows(entries, adminStates)
        };
        return body;
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { id: string }; Body: { version?: string } }>(
    "/api/admin/external-modules/:id/download",
    { schema: downloadExternalModuleRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const moduleId = request.params.id;
        // Context 1: authorize + purge-guard. The download route must never clear or
        // race a pending purge (spec §9) — the admin cancels it explicitly first.
        const priorStates = await loadLocalState(accessContext);
        const dist = dependencies.moduleDistribution;
        if (!dependencies.externalModules?.enabled || !dist) {
          throw new HttpError(409, "External modules are not enabled on this instance");
        }
        if (priorStates.some((s) => s.id === moduleId && s.purgeRequestedAt != null)) {
          throw new HttpError(409, "A data purge is pending for this module — cancel it first");
        }

        // Network + fs pipeline, OUTSIDE any DB context.
        const result = await dist.download({ moduleId, version: request.body?.version });
        if (!result.ok) {
          throw new HttpError(DOWNLOAD_ERROR_STATUS[result.code] ?? 502, result.message);
        }

        // Context 2: record staged intent (spec §6 step 8) and re-derive the row.
        const adminStates = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            await updateExternalModuleStaging(
              scopedDb,
              {
                id: moduleId,
                stagedVersion: result.version,
                stagedPackageHash: result.packageHash,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              },
              repository.externalModuleAuditWriter(scopedDb)
            );
            return listExternalModuleAdminStates(scopedDb);
          }
        );
        const entries = await dist.fetchRegistryEntries({ refresh: false });
        const rows = await deriveRows(entries, adminStates);
        const row = rows.find((r) => r.id === moduleId);
        if (!row) throw new HttpError(404, "External module not found");
        return { module: row };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { id: string }; Body: { purgeData: boolean } }>(
    "/api/admin/external-modules/:id/remove",
    { schema: removeExternalModuleRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const moduleId = request.params.id;
        const dist = dependencies.moduleDistribution;
        const adminStates = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            if (!dependencies.externalModules?.enabled || !dist) {
              throw new HttpError(409, "External modules are not enabled on this instance");
            }
            const onDisk = await dist.listOnDiskModuleIds();
            const states = await listExternalModuleAdminStates(scopedDb);
            const hasRow = states.some((s) => s.id === moduleId);
            if (!onDisk.includes(moduleId) && !hasRow) {
              throw new HttpError(404, "External module not found");
            }
            if (hasRow) {
              await markExternalModuleRemoved(
                scopedDb,
                {
                  id: moduleId,
                  actorUserId: accessContext.actorUserId,
                  requestId: requireRequestId(accessContext)
                },
                repository.externalModuleAuditWriter(scopedDb)
              );
            }
            if (request.body.purgeData) {
              // Records intent only; destruction runs in the boot reconcile (Task 7),
              // the sole holder of DROP privileges. No-op false is fine when there was
              // never a row (files-only leftovers have no data to purge).
              await setExternalModulePurgeRequested(
                scopedDb,
                {
                  id: moduleId,
                  requested: true,
                  actorUserId: accessContext.actorUserId,
                  requestId: requireRequestId(accessContext)
                },
                repository.externalModuleAuditWriter(scopedDb)
              );
            }
            return listExternalModuleAdminStates(scopedDb);
          }
        );
        // fs delete LAST — if it fails the module is already pinned disabled (safe),
        // and the admin can retry Remove.
        await dist!.removeModuleFiles(moduleId);
        const entries = await dist!.fetchRegistryEntries({ refresh: false });
        const rows = await deriveRows(entries, adminStates);
        const row = rows.find((r) => r.id === moduleId);
        if (!row) throw new HttpError(404, "External module not found");
        return { module: row };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/api/admin/external-modules/:id/purge",
    { schema: cancelExternalModulePurgeRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const moduleId = request.params.id;
        const dist = dependencies.moduleDistribution;
        const adminStates = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            if (!dependencies.externalModules?.enabled || !dist) {
              throw new HttpError(409, "External modules are not enabled on this instance");
            }
            const cancelled = await setExternalModulePurgeRequested(
              scopedDb,
              {
                id: moduleId,
                requested: false,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              },
              repository.externalModuleAuditWriter(scopedDb)
            );
            if (!cancelled) throw new HttpError(404, "External module not found");
            return listExternalModuleAdminStates(scopedDb);
          }
        );
        const entries = await dist!.fetchRegistryEntries({ refresh: false });
        const rows = await deriveRows(entries, adminStates);
        const row = rows.find((r) => r.id === moduleId);
        if (!row) throw new HttpError(404, "External module not found");
        return { module: row };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
```

Note for the implementer: `loadLocalState`'s `accessContext` cast exists because this file
only sees the structural `{ actorUserId }`; if `AccessContext` is exported from routes.ts'
import set, type it directly instead — match whatever routes-modules.ts does and drop the
cast if it isn't needed.

- [ ] **Step 8: Wire the port in `apps/api/src/server.ts`**

**(a)** Extend the module-registry import at the top (the same specifier that provides
`getExternalModuleRegistrations`, ~L55) with the Task 1/5 exports:

```ts
import {
  downloadAndStageModule,
  fetchRegistryIndex,
  ModuleDownloadError,
  parseModulesEnsure
} from "@jarv1s/module-registry/node";
```

(Match the exact specifier already used for `getExternalModuleRegistrations` — if that
import is from `"@jarv1s/module-registry/node"`, merge into it.)

**(b)** Inside `createApiServer`, before the `registerSettingsRoutes` call, build the port
(only when the external runtime is on — reuse `externalRuntimeEnabled` from ~L200):

```ts
// #964: module-distribution port for the settings registry routes. The index cache
// is per-process (10 min, spec §6); a failed refetch returns null (degrade) and
// leaves any previous cache untouched so the next request can retry.
const REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000;
let registryCache: { at: number; entries: readonly ModuleRegistryEntryLike[] } | null = null;
const moduleDistribution =
  externalRuntimeEnabled && apiServerConfig.externalModulesDir !== null
    ? {
        fetchRegistryEntries: async ({ refresh }: { refresh: boolean }) => {
          if (!refresh && registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_TTL_MS) {
            return registryCache.entries;
          }
          const { index, errors } = await fetchRegistryIndex({
            env: process.env,
            fetchFn: options.fetchFn
          });
          if (!index) {
            server.log.warn({ errors }, "module registry index unavailable (#964)");
            return null;
          }
          registryCache = { at: Date.now(), entries: index.modules };
          return index.modules;
        },
        download: async (input: { moduleId: string; version?: string }) => {
          try {
            const result = await downloadAndStageModule({
              moduleId: input.moduleId,
              version: input.version,
              modulesDir: apiServerConfig.externalModulesDir!,
              env: process.env,
              fetchFn: options.fetchFn
            });
            return { ok: true as const, version: result.version, packageHash: result.packageHash };
          } catch (error) {
            if (error instanceof ModuleDownloadError) {
              return { ok: false as const, code: error.code, message: error.message };
            }
            server.log.error(
              { moduleId: input.moduleId, errorName: (error as Error).name },
              "module download failed (#964)"
            );
            return { ok: false as const, code: "download-failed", message: "Download failed" };
          }
        },
        removeModuleFiles: async (moduleId: string) => {
          await rm(join(apiServerConfig.externalModulesDir!, moduleId), {
            recursive: true,
            force: true
          });
        },
        listOnDiskModuleIds: async () => {
          const dirents = await readdir(apiServerConfig.externalModulesDir!, {
            withFileTypes: true
          }).catch(() => []);
          return dirents
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name);
        },
        ensureIds: parseModulesEnsure(process.env.JARVIS_MODULES_ENSURE).entries.map((e) => e.id)
      }
    : undefined;
```

Type the closure's `ModuleRegistryEntryLike` via
`import type { ModuleRegistryEntryLike } from "@jarv1s/settings";` (export it from
settings' index alongside the other route types — `module-registry-rows.ts` exports flow
through the package index the same way `routes.ts` types do; add the export line to
`packages/settings/src/index.ts` mirroring how `routes.js` is re-exported there). Add
`import { readdir, rm } from "node:fs/promises";` and `join` to the existing `node:path`
import if not present.

**Path-safety note for the implementer:** `removeModuleFiles` joins an id that came from a
URL param. Guard it in the port with the same id shape the loader enforces:

```ts
if (!/^[a-z][a-z0-9-]*$/.test(moduleId) || moduleId.includes("..")) {
  return;
}
```

placed first in `removeModuleFiles` (a non-module id simply has nothing to delete — and
this makes path traversal structurally impossible regardless of route-layer validation).

**(c)** Add to the `registerSettingsRoutes` dependencies object (next to
`externalModules:` at ~L525):

```ts
      moduleDistribution,
```

- [ ] **Step 9: Typecheck + full unit suite**

```bash
pnpm --filter @jarv1s/shared typecheck
pnpm --filter @jarv1s/settings typecheck
pnpm --filter @jarv1s/api typecheck
pnpm vitest run tests/unit/module-registry-rows.test.ts
pnpm check:package-deps
```

Expected: all PASS. `check:package-deps` confirms settings still has no
module-registry dependency (route logic reached it only through the injected port).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/platform-api-modules.ts packages/settings/src/module-registry-rows.ts packages/settings/src/routes-module-registry.ts packages/settings/src/repository-external-modules.ts packages/settings/src/routes.ts packages/settings/src/index.ts apps/api/src/server.ts tests/unit/module-registry-rows.test.ts
git commit -m "feat(modules): admin module-registry surface — list/download/remove/cancel-purge routes (#964)"
```

---

### Task 7: Boot-time module reconcile (`scripts/module-reconcile.ts`)

The supervisor-plane script that runs once at container boot (before the API starts) and
makes disk + database agree: it destroys purge-marked modules, downloads compose-ensured
modules, promotes staged downloads to installed, runs each module's DB install, and
persists drift. Spec §7 defines the phase order; this task implements it verbatim.

**Files:**

- Create: `scripts/module-reconcile.ts`
- Modify: `scripts/module-install.ts:25-31` (loosen the `manifest` option to a structural type)
- Test: `tests/unit/module-reconcile-plan.test.ts` (pure-logic units), plus the
  integration coverage in Task 10

**Interfaces:**

- Consumes (all verified against the working tree):
  - `getJarvisDatabaseUrls(env?)` → `{ bootstrap, migration, ... }` from `@jarv1s/db`
    (`packages/db/src/urls.ts`). **The `bootstrap` URL is the `postgres` superuser**
    (verified: `packages/db/src/urls.ts:25-27`; in production it comes from
    `JARVIS_BOOTSTRAP_DATABASE_URL`, which deploy docs define as the superuser role).
    Superusers are exempt from RLS **including FORCE RLS**, which is why this script can
    write `app.external_modules` (FORCE RLS with app-runtime-only policies, 0152:40-41)
    and read/write `app.module_installs` (FORCE RLS, 0156) without any policy changes —
    the exact precedent set by `scripts/module-install.ts`'s `journalUpsert`.
  - `moduleRuntimeRoleName(moduleId)` / `moduleInstallRoleName(moduleId)` from
    `@jarv1s/db` (`packages/db/src/module-role-broker.ts:31-37`) →
    `jarvis_mod_<slug>_runtime` / `jarvis_mod_<slug>_install` (slug = id with hyphens →
    underscores).
  - `installModule(options)` from `scripts/module-install.ts` (this task loosens its
    `manifest` option — see Step 3).
  - `getExternalModuleRegistrations({ modulesDir, coreVersion?, reservedQueueNames? })`
    from `@jarv1s/module-registry/node` (`node.ts:32`) → `{ discoveries, rejected }`;
    `ExternalModuleDiscovery = { id, dir, manifest, manifestHash, packageHash }`
    (`external/types.ts:6-12`).
  - `parseModulesEnsure(raw)`, `downloadAndStageModule(...)`, `ModuleDownloadError`,
    and `sweepStaging(modulesDir)` from Tasks 1 and 5.
  - `CORE_VERSION` from `@jarv1s/module-sdk/core-version`; `getAllQueueDefinitions`
    from `@jarv1s/module-registry` (reserved queue names, mirroring
    `apps/api/src/server.ts:164-187`).
  - Advisory-lock precedent: `packages/db/src/migrations/sql-runner.ts:199` uses
    `SELECT pg_advisory_lock(hashtext('jarv1s:migrations'))` — we mirror it with the key
    `'jarv1s:module-reconcile'`.
- Produces: `reconcileModules(options): Promise<ReconcileReport>` (exact shape in
  Step 2) + a CLI entrypoint (`tsx scripts/module-reconcile.ts`) that Task 8 wires into
  container boot and the root `db:reconcile` package script.

**Design notes (why, before the how):**

- **One pg Client, one advisory lock.** Every phase runs on a single bootstrap
  connection holding `pg_advisory_lock(hashtext('jarv1s:module-reconcile'))` so two
  containers sharing a database can't interleave destructive phases.
  `installModule` opens its own connections internally (roles/journal/installer); that
  is fine — the lock serializes _reconcilers_, and the module-role-broker already
  handles its own crash recovery.
- **Warn-and-continue everywhere except the lock.** A failed download, failed install,
  or failed purge of ONE module must never prevent the API from booting or other
  modules from reconciling. Every per-module failure is caught, recorded (journal +
  `last_install_error` where applicable), pushed onto the report, and the loop
  continues. Only failure to connect/acquire the lock exits non-zero.
- **Purge is the single destruction point** (spec §9). The admin routes only _mark_
  `purge_requested_at`; all DROPs happen here, in dependency-safe order, with the
  `external_modules` row deleted **last** so a crash mid-purge re-runs the purge on
  next boot rather than orphaning tables/roles.
- **Table-name fail-closed guard.** `owned_tables` values come from the FORCE-RLS
  journal (supervisor-written), but we still never interpolate a table name into DROP
  SQL without shape-checking it — defense in depth against a corrupted journal row.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/module-reconcile-plan.test.ts`. These cover the two pure functions
the script exports for testability: the qualified-table-name guard and the
accept-staged decision.

```ts
// tests/unit/module-reconcile-plan.test.ts
// #964: pure-logic units for the boot reconcile script. The end-to-end phases
// (purge/ensure/install) are covered by the Task 10 integration suite against a
// real Postgres; here we pin the fail-closed guards that protect DROP statements.
import { describe, expect, it } from "vitest";

import { assertQualifiedModuleTable, decideStagedAcceptance } from "../../scripts/module-reconcile";

describe("assertQualifiedModuleTable", () => {
  it("accepts app-schema tables owned by the module prefix", () => {
    expect(() => assertQualifiedModuleTable("app.job_search_leads", "job-search")).not.toThrow();
    expect(() => assertQualifiedModuleTable("app.job_search_notes_v2", "job-search")).not.toThrow();
  });

  it("rejects tables outside the module's prefix (cross-module DROP attempt)", () => {
    expect(() => assertQualifiedModuleTable("app.users", "job-search")).toThrow(/prefix/);
    expect(() => assertQualifiedModuleTable("app.notes_items", "job-search")).toThrow(/prefix/);
  });

  it("rejects non-app schemas, quoting tricks, and injection shapes", () => {
    expect(() => assertQualifiedModuleTable("public.job_search_leads", "job-search")).toThrow();
    expect(() => assertQualifiedModuleTable('app."job_search_leads"', "job-search")).toThrow();
    expect(() =>
      assertQualifiedModuleTable("app.job_search_leads; DROP TABLE app.users", "job-search")
    ).toThrow();
    expect(() => assertQualifiedModuleTable("app.job_search_leads--", "job-search")).toThrow();
  });
});

describe("decideStagedAcceptance", () => {
  it("accepts when the on-disk package hash matches the staged hash", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: "abc" })).toEqual({
      accept: true
    });
  });

  it("declines with a reason when hashes differ (partial swap / tamper)", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: "def" })).toEqual({
      accept: false,
      reason: "staged package hash abc does not match on-disk package hash def"
    });
  });

  it("declines when the module is staged but missing on disk", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: null })).toEqual({
      accept: false,
      reason: "staged package hash abc does not match on-disk package hash <absent>"
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/module-reconcile-plan.test.ts`
Expected: FAIL — `scripts/module-reconcile` does not exist.

- [ ] **Step 3: Loosen `installModule`'s manifest option (structural, no behavior change)**

`scripts/module-install.ts` reads the manifest for exactly one thing —
`manifest.database?.ownedTables ?? []` (line 37; verified single use by grep). The
reconcile script holds a `JsonJarvisModuleManifest` (the loader's JSON shape), not the
branded `JarvisModuleManifest`, so the option type must become structural.

In `scripts/module-install.ts`, replace:

```ts
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
```

with nothing (delete the import), and replace the options interface:

```ts
export interface ModuleInstallOptions {
  readonly moduleId: string;
  // Structural on purpose (#964): installModule only reads database.ownedTables, and
  // callers hold either the branded JarvisModuleManifest (dev CLI) or the loader's
  // JsonJarvisModuleManifest (boot reconcile). Both satisfy this shape.
  readonly manifest: { readonly database?: { readonly ownedTables?: readonly string[] } };
  readonly bootstrapConnectionString: string;
  readonly migrationConnectionString: string;
  readonly migrationsDirectory: string;
}
```

No other line in the file changes. (Both existing callers pass richer objects that
satisfy the structural type, so this compiles everywhere.)

- [ ] **Step 4: Write `scripts/module-reconcile.ts` — header, exports, guards**

```ts
// scripts/module-reconcile.ts
// #964 (epic #860): boot-time module reconcile. Runs ONCE per container start, on the
// bootstrap (superuser) connection, BEFORE the API boots. Phase order is spec
// docs/superpowers/specs/2026-07-12-module-distribution-install.md §7 verbatim:
//   0. advisory lock  1. sweep staging temp dirs  2. purges (the ONLY destruction point)
//   3. ensure-present (JARVIS_MODULES_ENSURE)     4. scan disk
//   5. accept staged downloads                    6. DB install per module
//   7. persist drift
// Superuser is REQUIRED and intentional: app.external_modules and app.module_installs
// are FORCE RLS with app-runtime-only policies; the supervisor plane bypasses RLS as
// superuser exactly like scripts/module-install.ts's journalUpsert does today.
// Failure model: per-module failures WARN and continue (a broken module must never
// stop the platform booting); only lock/connection failures exit non-zero.
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "pg";

import { getJarvisDatabaseUrls, moduleInstallRoleName, moduleRuntimeRoleName } from "@jarv1s/db";
import { CORE_VERSION } from "@jarv1s/module-sdk/core-version";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";
import { getExternalModuleRegistrations, hashExternalPackage } from "@jarv1s/module-registry/node";
import {
  downloadAndStageModule,
  ModuleDownloadError,
  parseModulesEnsure,
  sweepStaging
} from "@jarv1s/module-registry/node";

import { installModule } from "./module-install";

// Matches external/reconcile.ts:12 — the request-time reconciler uses the same copy so
// the admin UI's drift reason is identical whether drift was caught at boot or live.
const DRIFT_DISABLED_REASON = "package changed since it was enabled";

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

export interface ReconcileReport {
  readonly purged: string[];
  readonly ensured: string[];
  readonly accepted: string[];
  readonly installed: string[];
  readonly drifted: string[];
  /** Per-module failures that were logged and skipped (never fatal). */
  readonly warnings: { moduleId: string; phase: string; message: string }[];
}

/**
 * Fail-closed guard for table names read from the app.module_installs journal before
 * they are interpolated into DROP TABLE statements. Requires the exact shape the
 * manifest validator enforced at install time (Task 2): `app.<slug>_<rest>` where slug
 * is the module id with hyphens as underscores. Anything else — other schemas, quotes,
 * whitespace, comments, other modules' prefixes — throws.
 */
export function assertQualifiedModuleTable(qualified: string, moduleId: string): void {
  const slug = moduleId.replace(/-/g, "_");
  if (!/^app\.[a-z][a-z0-9_]*$/.test(qualified)) {
    throw new Error(`refusing to drop "${qualified}": not a plain app-schema table name`);
  }
  if (!qualified.startsWith(`app.${slug}_`)) {
    throw new Error(
      `refusing to drop "${qualified}": outside module "${moduleId}" prefix app.${slug}_`
    );
  }
}

/** Pure decision for phase 5 so the hash-match rule is unit-testable. */
export function decideStagedAcceptance(input: {
  readonly stagedPackageHash: string;
  readonly onDiskPackageHash: string | null;
}): { accept: true } | { accept: false; reason: string } {
  if (input.onDiskPackageHash !== null && input.onDiskPackageHash === input.stagedPackageHash) {
    return { accept: true };
  }
  return {
    accept: false,
    reason: `staged package hash ${input.stagedPackageHash} does not match on-disk package hash ${input.onDiskPackageHash ?? "<absent>"}`
  };
}
```

- [ ] **Step 5: Write `reconcileModules` — phases 0–2 (lock, sweep, purge)**

Append to `scripts/module-reconcile.ts`:

```ts
interface ExternalModuleAdminRow {
  readonly id: string;
  readonly status: "enabled" | "disabled";
  readonly package_hash: string | null;
  readonly staged_version: string | null;
  readonly staged_package_hash: string | null;
  readonly purge_requested_at: Date | null;
}

export interface ReconcileModulesOptions {
  readonly modulesDir: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam (Task 10): injected fetch for the mock registry. */
  readonly fetchFn?: typeof fetch;
}

export async function reconcileModules(options: ReconcileModulesOptions): Promise<ReconcileReport> {
  const env = options.env ?? process.env;
  const urls = getJarvisDatabaseUrls(env);
  const report: ReconcileReport = {
    purged: [],
    ensured: [],
    accepted: [],
    installed: [],
    drifted: [],
    warnings: []
  };
  const warn = (moduleId: string, phase: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    report.warnings.push({ moduleId, phase, message });
    console.warn(`[module-reconcile] ${phase} ${moduleId}: ${message}`);
  };

  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  try {
    // Phase 0 — one lock for the whole run (sql-runner.ts:199 precedent). Session-level
    // (not xact) because destructive phases intentionally run OUTSIDE one big
    // transaction: a purge is a sequence of DDL + fs operations that cannot roll back
    // together, and re-runnability (row deleted LAST) is the recovery model instead.
    await client.query("SELECT pg_advisory_lock(hashtext('jarv1s:module-reconcile'))");

    // Phase 1 — sweep leftover staging temp dirs from crashed downloads (Task 5).
    await sweepStaging(options.modulesDir).catch((error) => warn("*", "sweep", error));

    // Phase 2 — purges: the ONLY place module data is destroyed (spec §9).
    const purgeRows = await client.query<ExternalModuleAdminRow>(
      `SELECT id, status, package_hash, staged_version, staged_package_hash, purge_requested_at
         FROM app.external_modules
        WHERE purge_requested_at IS NOT NULL
        ORDER BY id`
    );
    for (const row of purgeRows.rows) {
      try {
        await purgeModule(client, options.modulesDir, row.id);
        report.purged.push(row.id);
      } catch (error) {
        warn(row.id, "purge", error);
      }
    }
```

- [ ] **Step 6: Phases 3–5 (ensure-present, scan, accept staged)**

Continue the function body:

```ts
// Phase 3 — ensure-present (spec §7b): JARVIS_MODULES_ENSURE lists modules that
// must exist on disk. One-way: removing an id from the list never uninstalls.
// Already-on-disk ids are skipped here (any staged update still flows via phase 5).
const ensure = parseModulesEnsure(env.JARVIS_MODULES_ENSURE ?? "");
for (const parseError of ensure.errors) {
  warn("*", "ensure-parse", new Error(parseError));
}
const preScan = getExternalModuleRegistrations({
  modulesDir: options.modulesDir,
  coreVersion: CORE_VERSION,
  reservedQueueNames: new Set(getAllQueueDefinitions().map((queue) => queue.name))
});
const onDisk = new Set([
  ...preScan.discoveries.map((d) => d.id),
  ...preScan.rejected.map((r) => r.id)
]);
for (const entry of ensure.entries) {
  if (onDisk.has(entry.id)) continue;
  try {
    const staged = await downloadAndStageModule({
      moduleId: entry.id,
      version: entry.version,
      modulesDir: options.modulesDir,
      env,
      fetchFn: options.fetchFn
    });
    // Record the staging exactly like the admin download route does, but with
    // staged_source 'compose-ensure' and no acting user. INSERT-or-UPDATE because
    // a compose-ensured module may have no external_modules row yet; new rows are
    // born disabled (fail-closed) and phase 5 enables them via the hash match.
    await client.query(
      `INSERT INTO app.external_modules
             (id, status, package_hash, staged_version, staged_package_hash, staged_at, staged_by, staged_source, created_at, updated_at)
           VALUES ($1, 'disabled', NULL, $2, $3, now(), NULL, 'compose-ensure', now(), now())
           ON CONFLICT (id) DO UPDATE SET
             staged_version = EXCLUDED.staged_version,
             staged_package_hash = EXCLUDED.staged_package_hash,
             staged_at = now(),
             staged_by = NULL,
             staged_source = 'compose-ensure',
             updated_at = now()`,
      [entry.id, staged.version, staged.packageHash]
    );
    report.ensured.push(entry.id);
  } catch (error) {
    // Includes ModuleDownloadError (registry down, bad hash, …): warn + continue —
    // an unreachable registry must never block boot (spec §7b).
    warn(entry.id, "ensure-download", error);
  }
}

// Phase 4 — authoritative post-ensure scan (full validation incl. hashes).
const scan = getExternalModuleRegistrations({
  modulesDir: options.modulesDir,
  coreVersion: CORE_VERSION,
  reservedQueueNames: new Set(getAllQueueDefinitions().map((queue) => queue.name))
});
const discoveriesById = new Map(scan.discoveries.map((d) => [d.id, d]));

// Phase 5 — accept staged downloads: staged hash must equal the on-disk package
// hash computed by the validating loader. Match → the staged version becomes the
// enabled baseline and staged_* fields clear. Mismatch → leave the row staged and
// warn; the admin UI keeps showing pending-restart with the discrepancy logged.
const stagedRows = await client.query<ExternalModuleAdminRow>(
  `SELECT id, status, package_hash, staged_version, staged_package_hash, purge_requested_at
         FROM app.external_modules
        WHERE staged_package_hash IS NOT NULL
        ORDER BY id`
);
for (const row of stagedRows.rows) {
  const discovery = discoveriesById.get(row.id);
  const decision = decideStagedAcceptance({
    stagedPackageHash: row.staged_package_hash as string,
    onDiskPackageHash: discovery?.packageHash ?? null
  });
  if (!decision.accept) {
    warn(row.id, "accept-staged", new Error(decision.reason));
    continue;
  }
  await client.query(
    `UPDATE app.external_modules
            SET status = 'enabled',
                package_hash = $2,
                disabled_reason = NULL,
                staged_version = NULL,
                staged_package_hash = NULL,
                staged_at = NULL,
                staged_by = NULL,
                staged_source = NULL,
                updated_at = now()
          WHERE id = $1`,
    [row.id, row.staged_package_hash]
  );
  report.accepted.push(row.id);
}
```

- [ ] **Step 7: Phases 6–7 (DB install, drift persist) + purge helper + CLI**

Finish the file:

```ts
    // Phase 6 — DB install for every discovered module (idempotent: installModule
    // skips already-recorded migrations via app.module_schema_migrations). Failure →
    // journal 'failed' happens inside installModule's own flow where applicable; here
    // we additionally persist last_install_error and pin the module disabled so the
    // API surfaces install-failed instead of booting a half-installed module.
    for (const discovery of scan.discoveries) {
      const sqlDir = join(discovery.dir, "sql");
      try {
        const { installed } = await installModule({
          moduleId: discovery.id,
          manifest: discovery.manifest,
          bootstrapConnectionString: urls.bootstrap,
          migrationConnectionString: urls.migration,
          migrationsDirectory: sqlDir
        });
        if (installed.length > 0) report.installed.push(discovery.id);
        // A previous failure heals on successful install: clear the error but do NOT
        // touch status — enable/disable stays an admin (or accept-staged) decision.
        await client.query(
          `UPDATE app.external_modules SET last_install_error = NULL, updated_at = now()
            WHERE id = $1 AND last_install_error IS NOT NULL`,
          [discovery.id]
        );
      } catch (error) {
        warn(discovery.id, "install", error);
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
        await client
          .query(
            `UPDATE app.external_modules
                SET last_install_error = $2,
                    status = 'disabled',
                    disabled_reason = 'database install failed',
                    updated_at = now()
              WHERE id = $1`,
            [discovery.id, message]
          )
          .catch((persistError) => warn(discovery.id, "install-error-persist", persistError));
      }
    }

    // Phase 7 — drift persist: enabled row whose baseline hash no longer matches disk
    // → disable with the SAME reason string external/reconcile.ts:12 uses at request
    // time, so boot-caught and live-caught drift read identically in the admin UI.
    const enabledRows = await client.query<ExternalModuleAdminRow>(
      `SELECT id, status, package_hash, staged_version, staged_package_hash, purge_requested_at
         FROM app.external_modules
        WHERE status = 'enabled'
        ORDER BY id`
    );
    for (const row of enabledRows.rows) {
      const discovery = discoveriesById.get(row.id);
      if (discovery && discovery.packageHash === row.package_hash) continue;
      await client.query(
        `UPDATE app.external_modules
            SET status = 'disabled', disabled_reason = $2, updated_at = now()
          WHERE id = $1`,
        [row.id, DRIFT_DISABLED_REASON]
      );
      report.drifted.push(row.id);
    }

    return report;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('jarv1s:module-reconcile'))")
      .catch(() => undefined);
    await client.end();
  }
}

/**
 * Destroys one module completely (spec §9). Order is dependency-safe and re-runnable:
 * the external_modules row (holding purge_requested_at) is deleted LAST, so a crash at
 * any earlier step re-triggers the purge on next boot. Every DROP is idempotent
 * (IF EXISTS) for the same reason.
 */
async function purgeModule(client: Client, modulesDir: string, moduleId: string): Promise<void> {
  if (!MODULE_ID_RE.test(moduleId)) {
    throw new Error(`invalid module id "${moduleId}" in purge mark`);
  }

  // 1. Owned tables from the supervisor-written journal — guard each name anyway.
  const journal = await client.query<{ owned_tables: string[] | null }>(
    "SELECT owned_tables FROM app.module_installs WHERE module_id = $1",
    [moduleId]
  );
  for (const table of journal.rows[0]?.owned_tables ?? []) {
    assertQualifiedModuleTable(table, moduleId);
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }

  // 2. Platform-table rows keyed by module id (KV, credentials, enablement).
  await client.query("DELETE FROM app.module_kv WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_credentials WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_enablement WHERE module_id = $1", [moduleId]);

  // 3. Migration ledger + install journal.
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [moduleId]);

  // 4. Roles. DROP OWNED first releases grants/objects so DROP ROLE can't fail on
  // dependencies. Role names are derived, never read from data.
  for (const role of [moduleRuntimeRoleName(moduleId), moduleInstallRoleName(moduleId)]) {
    await client.query(
      `DO $$ BEGIN
         IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
           EXECUTE format('DROP OWNED BY %I', '${role}');
           EXECUTE format('DROP ROLE %I', '${role}');
         END IF;
       END $$`
    );
  }

  // 5. Files. MODULE_ID_RE above already proved the id is a bare slug (no traversal).
  await rm(join(modulesDir, moduleId), { recursive: true, force: true });

  // 6. The mark itself — LAST, making every earlier step re-runnable after a crash.
  await client.query("DELETE FROM app.external_modules WHERE id = $1", [moduleId]);
}

// CLI: `tsx scripts/module-reconcile.ts` (Task 8 wires this into container boot after
// migrate.ts and into the root `db:reconcile` script for dev parity). No-op unless
// external modules are enabled — mirrors apps/api/src/server.ts:140-141 gating.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const enabled = process.env.JARVIS_ENABLE_EXTERNAL_MODULES === "1";
  const modulesDir = process.env.JARVIS_MODULES_DIR ?? null;
  if (!enabled || modulesDir === null) {
    console.log("[module-reconcile] external modules disabled — nothing to do");
    process.exit(0);
  }
  reconcileModules({ modulesDir })
    .then((report) => {
      console.log(
        `[module-reconcile] purged=${report.purged.length} ensured=${report.ensured.length} ` +
          `accepted=${report.accepted.length} installed=${report.installed.length} ` +
          `drifted=${report.drifted.length} warnings=${report.warnings.length}`
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error("[module-reconcile] fatal:", error);
      process.exit(1);
    });
}
```

Note on imports: consolidate the two `node:path` imports (`join`, `resolve`) and place
`fileURLToPath` at the top of the file with the other imports when writing the real
file — shown split here only to keep the CLI block self-contained.

- [ ] **Step 8: Run the unit tests to verify they pass**

Run: `pnpm vitest run tests/unit/module-reconcile-plan.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Typecheck everything the loosened option touches**

```bash
pnpm --filter @jarv1s/module-registry typecheck
pnpm typecheck
```

Expected: PASS — including both existing `installModule` callers, which now satisfy
the structural manifest option.

- [ ] **Step 10: Commit**

```bash
git add scripts/module-reconcile.ts scripts/module-install.ts tests/unit/module-reconcile-plan.test.ts
git commit -m "feat(modules): boot-time reconcile — purge, compose-ensure, accept-staged, install, drift (#964)"
```

---

### Task 8: Boot & compose wiring (`start-jarv1s.ts`, prod compose, `db:reconcile`)

Wire Task 7's script into container boot (after migrate, before the resident processes),
give prod a persistent modules volume, repoint the `module-install` ops service at the
reconcile entrypoint, and add a root `db:reconcile` script for dev parity (the spec's
"dev boot runs the same reconcile" is satisfied by this script + a docs note — there is
no `scripts/dev.ts` to hook).

**Files:**

- Modify: `scripts/start-jarv1s.ts:14` (StartupPlan `oneShot` → `oneShots` array), `:100-121` (buildStartupPlan), `:123-135` (prepareRuntimeDirs), `:163-166` (main loop)
- Modify: `tests/unit/start-jarv1s-plan.test.ts:20-23`
- Modify: `infra/docker-compose.prod.yml` (`module-install` service :58-70, `jarv1s` service env/volumes :79-124, top-level `volumes:` :145-151)
- Modify: `package.json:23` area (root scripts)

**Interfaces:**

- Consumes: `scripts/module-reconcile.ts` CLI from Task 7 (exits 0 when
  `JARVIS_ENABLE_EXTERNAL_MODULES !== "1"` or `JARVIS_MODULES_DIR` unset — safe to run
  unconditionally once gated in the plan builder).
- Produces: `buildStartupPlan(env).oneShots: readonly OneShotSpec[]` — **rename**, all
  callers in this repo are `main()` and the unit test, both updated here.

- [ ] **Step 1: Update the startup-plan unit test (failing first)**

In `tests/unit/start-jarv1s-plan.test.ts`, replace the body of the first test
(lines 20-23) and add a second case:

```ts
    expect(plan.oneShots.map((oneShot) => oneShot.command)).toEqual([
      ["node_modules/.bin/tsx", "scripts/migrate.ts"]
    ]);
    expect(plan.oneShots[0]!.uid).toBe(1234);
    expect(plan.oneShots[0]!.gid).toBe(1235);
    expect(plan.resident.map((p) => p.role)).toEqual(["cli-runner", "worker", "api"]);
  });

  it("appends module reconcile after migrate when external modules are enabled", () => {
    const plan = buildStartupPlan({
      NODE_ENV: "production",
      JARVIS_HOST_UID: "1234",
      JARVIS_HOST_GID: "1235",
      JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret",
      JARVIS_ENABLE_EXTERNAL_MODULES: "1",
      JARVIS_MODULES_DIR: "/data/modules"
    } as NodeJS.ProcessEnv);

    expect(plan.oneShots.map((oneShot) => oneShot.command)).toEqual([
      ["node_modules/.bin/tsx", "scripts/migrate.ts"],
      ["node_modules/.bin/tsx", "scripts/module-reconcile.ts"]
    ]);
```

(Close the new `it` with the usual `});`. The flag-off ordering assertion is the first
test itself — exactly one one-shot.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/start-jarv1s-plan.test.ts`
Expected: FAIL — `plan.oneShots` is undefined (plan still has `oneShot`).

- [ ] **Step 3: Implement the plan changes in `scripts/start-jarv1s.ts`**

Interface (line 14 region) — rename the member and extract the spec type:

```ts
interface OneShotSpec {
  readonly command: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly uid: number;
  readonly gid: number;
}

export interface StartupPlan {
  readonly uid: number;
  readonly gid: number;
  /** Run sequentially, in order, before any resident process starts (#964). */
  readonly oneShots: readonly OneShotSpec[];
  readonly resident: readonly ProcessSpec[];
}
```

`buildStartupPlan` (lines 100-121) — build the array; reconcile is appended only when
the feature is actually on (mirrors `apps/api/src/server.ts:140-141` gating, and the
CLI itself no-ops on the same condition as a second belt):

```ts
export function buildStartupPlan(env: NodeJS.ProcessEnv = process.env): StartupPlan {
  const { uid, gid } = runtimeUidGid(env);
  const oneShotEnv = { ...env, NODE_ENV: env.NODE_ENV ?? "production" };
  const oneShots: OneShotSpec[] = [
    { command: ["node_modules/.bin/tsx", "scripts/migrate.ts"], env: oneShotEnv, uid, gid }
  ];
  // #964: reconcile modules AFTER core migrations (module installs depend on the
  // platform tables existing) and BEFORE the api/worker boot (they must see the
  // post-reconcile module set).
  if (env.JARVIS_ENABLE_EXTERNAL_MODULES === "1" && env.JARVIS_MODULES_DIR) {
    oneShots.push({
      command: ["node_modules/.bin/tsx", "scripts/module-reconcile.ts"],
      env: oneShotEnv,
      uid,
      gid
    });
  }
  return {
    uid,
    gid,
    oneShots,
    resident: [
      /* unchanged — keep the existing cli-runner / worker / api entries verbatim */
    ]
  };
}
```

(The `resident` array's three entries are untouched — do not retype them, keep the
existing lines.)

`prepareRuntimeDirs` (lines 123-135) — add the modules dir to the existing list:

```ts
  for (const dir of [
    "/data/cli-tools",
    "/data/cli-auth",
    "/data/vaults",
    "/data/modules",
    "/app/.cache/huggingface",
    "/run/jarv1s"
  ]) {
```

`main()` (line 166) — replace the single `runOneShot` call with a sequential loop
(order matters; do NOT parallelize):

```ts
for (const oneShot of plan.oneShots) {
  await runOneShot(oneShot.command, oneShot.env, oneShot.uid, oneShot.gid);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/start-jarv1s-plan.test.ts`
Expected: PASS (all cases, including the two new ordering assertions).

- [ ] **Step 5: Prod compose — volume, env, and the ops service repoint**

In `infra/docker-compose.prod.yml`:

1. Top-level `volumes:` (line 145) — add one entry alongside the existing six:

```yaml
volumes:
  jarv1s-postgres-data:
  jarv1s-vault-data:
  jarv1s-model-cache:
  jarv1s-cli-tools:
  jarv1s-cli-auth:
  jarv1s-cli-socket:
  # #964: downloaded module packages survive image upgrades — modules are data, not image.
  jarv1s-modules:
```

2. `jarv1s` service — append to `environment:` (after line 99) and `volumes:`
   (after line 124):

```yaml
JARVIS_ENABLE_EXTERNAL_MODULES: "${JARVIS_ENABLE_EXTERNAL_MODULES:-1}"
JARVIS_MODULES_DIR: /data/modules
```

```yaml
- jarv1s-modules:/data/modules
```

(`JARVIS_MODULES_ENSURE` needs no compose entry — it flows through the existing
`env_file` anchor when the operator sets it in `env.production.local`, which is
exactly the spec §7b usage.)

3. `module-install` service (lines 58-70) — repoint the command at the full reconcile
   and give it the same modules volume + env so `--profile ops run --rm module-install`
   performs an on-demand reconcile (download ensures, apply staged, purge) without a
   container restart:

```yaml
  module-install:
    image: ghcr.io/motioneso/jarv1s:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    build:
      context: ..
      dockerfile: Dockerfile
    <<: *app-env-file
    # #964: was scripts/module-install.ts (DB install only); reconcile is a superset —
    # purge → ensure-present → accept-staged → DB install → drift, same script boot runs.
    command: ["node_modules/.bin/tsx", "scripts/module-reconcile.ts"]
    environment:
      JARVIS_ENABLE_EXTERNAL_MODULES: "${JARVIS_ENABLE_EXTERNAL_MODULES:-1}"
      JARVIS_MODULES_DIR: /data/modules
    volumes:
      - jarv1s-modules:/data/modules
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["ops"]
    networks:
      - jarv1s
```

Also update the usage comment at line 19 (`--profile ops run --rm module-install`) to
say "reconcile modules (download/install/purge)" instead of "install module schemas".

4. Root `package.json` — add next to `db:migrate` (line 23):

```json
    "db:reconcile": "tsx scripts/module-reconcile.ts",
```

- [ ] **Step 6: Validate compose + gates**

```bash
docker compose -f infra/docker-compose.prod.yml --env-file /dev/null config --quiet 2>&1 | head -5
pnpm vitest run tests/unit/start-jarv1s-plan.test.ts
```

Expected: compose errors ONLY about the required `:?` vars (`JARVIS_IMAGE_TAG`,
`POSTGRES_PASSWORD`, `JARVIS_CLI_RUNNER_RPC_SECRET`) — no YAML/volume errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/start-jarv1s.ts tests/unit/start-jarv1s-plan.test.ts infra/docker-compose.prod.yml package.json
git commit -m "feat(modules): run module reconcile at container boot + prod modules volume (#964)"
```

---

### Task 9: Admin web UI — module registry section

Functional pass only (Ben's functionality-vs-design rule): reuse existing `jds-*`
patterns, no new visual language; Ben annotates the look later. Everything lands in a
NEW file — `settings-admin-panes.tsx` is at 987/1000 lines (file-size gate).

**Files:**

- Modify: `apps/web/src/api/query-keys.ts:18` (add sibling key)
- Modify: `apps/web/src/api/client.ts` (~line 392, after `setExternalModuleEnabled`)
- Modify: `apps/web/src/settings/settings-feedback.tsx` (ConfirmOptions :24-31, dialog :117-146)
- Modify: `apps/web/src/settings/settings-admin-panes.tsx` (~line 553 `InstanceModulesPane` — import + one render line only)
- Create: `apps/web/src/settings/settings-module-registry-section.tsx`

**Interfaces:**

- Consumes: Task 6's shared DTOs from `@jarv1s/shared` (`ModuleRegistryRowDto`,
  `GetModuleRegistryResponse`, `MODULE_REGISTRY_LIFECYCLE_STATES`) and routes
  (`GET /api/admin/module-registry[?refresh=1]`,
  `POST /api/admin/module-registry/:id/download` body `{ version? }`,
  `POST /api/admin/module-registry/:id/remove` body `{ purgeData }`,
  `DELETE /api/admin/module-registry/:id/purge`); `requestJson<T>` at
  `apps/web/src/api/client.ts:1182`; `useFeedback()` toast/confirm.
- Produces: `ModuleRegistrySection` component; `queryKeys.settings.adminModuleRegistry`;
  `ConfirmOptions.requireText?: string` (type-to-confirm support usable by any caller).

- [ ] **Step 1: Query key + client functions**

`apps/web/src/api/query-keys.ts` — after line 18 (`adminExternalModules`):

```ts
    // #964: registry-backed distribution rows (superset of adminExternalModules info).
    adminModuleRegistry: ["settings", "admin", "module-registry"] as const,
```

`apps/web/src/api/client.ts` — extend the existing `@jarv1s/shared` type import with
`GetModuleRegistryResponse` and `ModuleRegistryRowDto`, then append after
`setExternalModuleEnabled` (line 392):

```ts
/** Admin: registry-backed module list — install/update/remove states (#964). */
export async function getModuleRegistry(refresh: boolean): Promise<GetModuleRegistryResponse> {
  return requestJson<GetModuleRegistryResponse>(
    `/api/admin/module-registry${refresh ? "?refresh=1" : ""}`
  );
}

/** Admin: download+stage a module from the registry; applies on next restart (#964). */
export async function downloadRegistryModule(
  id: string,
  version?: string
): Promise<{ module: ModuleRegistryRowDto }> {
  return requestJson<{ module: ModuleRegistryRowDto }>(
    `/api/admin/module-registry/${encodeURIComponent(id)}/download`,
    { method: "POST", body: version ? { version } : {} }
  );
}

/** Admin: remove a module (disable + delete files); purge destroys data on restart (#964). */
export async function removeRegistryModule(
  id: string,
  purgeData: boolean
): Promise<{ module: ModuleRegistryRowDto }> {
  return requestJson<{ module: ModuleRegistryRowDto }>(
    `/api/admin/module-registry/${encodeURIComponent(id)}/remove`,
    { method: "POST", body: { purgeData } }
  );
}

/** Admin: cancel a pending data purge before it runs at restart (#964). */
export async function cancelModulePurge(id: string): Promise<{ module: ModuleRegistryRowDto }> {
  return requestJson<{ module: ModuleRegistryRowDto }>(
    `/api/admin/module-registry/${encodeURIComponent(id)}/purge`,
    { method: "DELETE" }
  );
}
```

- [ ] **Step 2: Type-to-confirm support in `settings-feedback.tsx`**

Add to `ConfirmOptions` (after `danger?`, line 29):

```ts
  /**
   * #964: type-to-confirm. When set, the dialog renders a text input and the confirm
   * button stays disabled until the typed value matches exactly (spec §9: purging a
   * module's data requires typing the module id).
   */
  readonly requireText?: string;
```

Component changes — add state next to the existing `dialog` state:

```ts
const [confirmInput, setConfirmInput] = useState("");
```

Reset it whenever a dialog opens (in the existing `confirm` callback, line 65-67):

```ts
const confirm = useCallback((options: ConfirmOptions) => {
  setConfirmInput("");
  setDialog(options);
}, []);
```

In the dialog markup, between `__head` (line 131) and `__foot` (line 132):

```tsx
{
  dialog.requireText !== undefined ? (
    <div className="jds-dialog__body">
      <label>
        Type <strong>{dialog.requireText}</strong> to confirm
        <input
          className="jds-input"
          value={confirmInput}
          onChange={(event) => setConfirmInput(event.target.value)}
          autoFocus
        />
      </label>
    </div>
  ) : null;
}
```

And disable the confirm button (line 136-142) until it matches:

```tsx
<button
  type="button"
  className={`jds-btn ${dialog.danger ? "jds-btn--danger" : "jds-btn--primary"}`}
  onClick={runConfirm}
  disabled={dialog.requireText !== undefined && confirmInput !== dialog.requireText}
>
  {dialog.confirmLabel ?? "Confirm"}
</button>
```

`runConfirm` (line 75-78) is untouched — it already runs `onConfirm` outside the state
updater (StrictMode trap, keep the existing comment).

- [ ] **Step 3: The section component**

Create `apps/web/src/settings/settings-module-registry-section.tsx`:

```tsx
// #964: registry-backed module distribution — install/update/remove from the admin
// Instance-modules pane. Functional pass only: reuses jds primitives; visual design
// is a later annotation round. All states come from the server-derived
// ModuleRegistryRowDto.state (spec §8) — no client-side state math beyond labels.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ModuleRegistryRowDto } from "@jarv1s/shared";

import {
  cancelModulePurge,
  downloadRegistryModule,
  getModuleRegistry,
  removeRegistryModule
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Note } from "./settings-ui";

const STATE_LABELS: Record<ModuleRegistryRowDto["state"], string> = {
  "not-installed": "Not installed",
  "pending-restart": "Downloaded — restart to apply",
  "installed-enabled": "Installed",
  "installed-disabled": "Installed (disabled)",
  "update-available": "Update available",
  "update-pending-restart": "Update downloaded — restart to apply",
  "install-failed": "Install failed",
  "declared-not-present": "Declared in compose — will install on restart",
  incompatible: "Incompatible with this Jarvis version"
};

// Spec §8: the pre-download confirm shows the index capabilities block so the admin
// reviews what the module can do BEFORE anything is fetched. Plain-text rendering —
// ConfirmOptions.description is a string; richer layout is a later design pass.
function describeCapabilities(row: ModuleRegistryRowDto): string {
  const caps = row.capabilities;
  const parts = [
    caps.permissions.length ? `Permissions: ${caps.permissions.join(", ")}.` : "No permissions.",
    caps.fetchHosts.length
      ? `May fetch from: ${caps.fetchHosts.join(", ")}.`
      : "No network access.",
    caps.tools.length
      ? `Tools: ${caps.tools.map((tool) => `${tool.name} (${tool.risk})`).join(", ")}.`
      : "No assistant tools.",
    caps.ownsTables.length
      ? `Owns database tables: ${caps.ownsTables.join(", ")}.`
      : "No database tables."
  ];
  return `${parts.join(" ")} The download applies on the next restart.`;
}

export function ModuleRegistrySection() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();

  const registryQuery = useQuery({
    queryKey: queryKeys.settings.adminModuleRegistry,
    queryFn: () => getModuleRegistry(false),
    retry: false
  });

  const invalidate = () =>
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminModuleRegistry }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminExternalModules })
    ]);

  const downloadMutation = useMutation({
    mutationFn: (input: { id: string; version?: string }) =>
      downloadRegistryModule(input.id, input.version),
    onSuccess: (result) => {
      invalidate();
      toast(`${result.module.name} downloaded — restart Jarvis to apply`, { tone: "ready" });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const removeMutation = useMutation({
    mutationFn: (input: { id: string; purgeData: boolean }) =>
      removeRegistryModule(input.id, input.purgeData),
    onSuccess: (result, input) => {
      invalidate();
      toast(
        input.purgeData
          ? `${result.module.id} removed — data purge runs on next restart`
          : `${result.module.id} removed — its data is kept`,
        { tone: "ready" }
      );
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const cancelPurgeMutation = useMutation({
    mutationFn: (id: string) => cancelModulePurge(id),
    onSuccess: () => {
      invalidate();
      toast("Purge cancelled", { tone: "ready" });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const refreshMutation = useMutation({
    mutationFn: () => getModuleRegistry(true),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.adminModuleRegistry, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const onInstall = (row: ModuleRegistryRowDto) => {
    confirm({
      title:
        row.state === "update-available"
          ? `Update ${row.name} to v${row.latestVersion}?`
          : `Install ${row.name}?`,
      description: describeCapabilities(row),
      confirmLabel: row.state === "update-available" ? "Download update" : "Download",
      onConfirm: () => downloadMutation.mutate({ id: row.id })
    });
  };

  const onRemove = (row: ModuleRegistryRowDto) => {
    confirm({
      title: `Remove ${row.name}?`,
      description:
        "The module stops on next restart and its files are deleted. Its data is kept " +
        "and comes back if you reinstall. To also destroy its data, use “Remove + purge”.",
      confirmLabel: "Remove, keep data",
      onConfirm: () => removeMutation.mutate({ id: row.id, purgeData: false })
    });
  };

  const onRemovePurge = (row: ModuleRegistryRowDto) => {
    confirm({
      title: `Remove ${row.name} and destroy its data?`,
      description:
        "This permanently deletes every table and record the module owns on the next " +
        "restart. There is no undo after the restart runs.",
      confirmLabel: "Remove + purge data",
      danger: true,
      requireText: row.id,
      onConfirm: () => removeMutation.mutate({ id: row.id, purgeData: true })
    });
  };

  const data = registryQuery.data;
  if (registryQuery.isPending) return <p className="jds-muted">Loading module registry…</p>;
  if (registryQuery.isError) return <p className="jds-muted">{readError(registryQuery.error)}</p>;
  if (!data || !data.enabled) return null;

  const canInstall = (row: ModuleRegistryRowDto) =>
    (row.state === "not-installed" ||
      row.state === "update-available" ||
      row.state === "declared-not-present" ||
      row.state === "install-failed") &&
    !row.purgePending;
  const canRemove = (row: ModuleRegistryRowDto) =>
    row.state !== "not-installed" && row.state !== "declared-not-present" && !row.purgePending;

  return (
    <section aria-label="Module registry">
      <h3>Available modules</h3>
      {data.registryUnavailable ? (
        <p className="jds-muted">
          The module registry is unreachable — showing installed modules only.
        </p>
      ) : null}
      {data.modules.some(
        (row) => row.state === "pending-restart" || row.state === "update-pending-restart"
      ) ? (
        <Note>
          Downloaded modules apply on the next restart. From your deployment directory:{" "}
          <code>{"docker compose pull && docker compose up -d"}</code> (or restart the container).
        </Note>
      ) : null}
      <button
        type="button"
        className="jds-btn jds-btn--quiet"
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
      >
        {refreshMutation.isPending ? "Refreshing…" : "Refresh from registry"}
      </button>
      <ul>
        {data.modules.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.name}</strong> <code>{row.id}</code>
              {row.installedVersion ? <span> v{row.installedVersion}</span> : null}
              {row.latestVersion && row.latestVersion !== row.installedVersion ? (
                <span> (latest v{row.latestVersion})</span>
              ) : null}
            </div>
            {row.description ? <p>{row.description}</p> : null}
            <p>
              {STATE_LABELS[row.state]}
              {row.purgePending ? " · data purge pending — takes effect on restart" : null}
            </p>
            {row.state === "install-failed" && row.lastInstallError ? (
              <p className="jds-muted">{row.lastInstallError}</p>
            ) : null}
            {row.state === "incompatible" ? (
              <p className="jds-muted">Requires Jarvis {row.requiresCore}.</p>
            ) : null}
            <div>
              {canInstall(row) ? (
                <button
                  type="button"
                  className="jds-btn jds-btn--primary"
                  onClick={() => onInstall(row)}
                  disabled={downloadMutation.isPending}
                >
                  {row.state === "update-available"
                    ? "Download update"
                    : row.state === "install-failed"
                      ? "Retry download"
                      : "Install"}
                </button>
              ) : null}
              {canRemove(row) ? (
                <>
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet"
                    onClick={() => onRemove(row)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet"
                    onClick={() => onRemovePurge(row)}
                  >
                    Remove + purge
                  </button>
                </>
              ) : null}
              {row.purgePending ? (
                <button
                  type="button"
                  className="jds-btn jds-btn--quiet"
                  onClick={() => cancelPurgeMutation.mutate(row.id)}
                  disabled={cancelPurgeMutation.isPending}
                >
                  Cancel purge
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Import specifiers verified against `settings-admin-panes.tsx`: `useFeedback` from
`./settings-feedback`, `readError` from `./settings-types`, `Note` from
`./settings-ui` (the authored footnote primitive — spec §8's "settings-footnote
pattern").

Deviation note (spec §8 table): the **Enable/Disable** action for installed modules is
NOT duplicated here — it remains the existing #818 toggle in the external-modules list
that `InstanceModulesPane` already renders directly above this section. The registry
section owns install/update/remove/purge only; one control per action, same pane.

- [ ] **Step 4: Render it from `InstanceModulesPane`**

In `apps/web/src/settings/settings-admin-panes.tsx`: add the import at the top and
render `<ModuleRegistrySection />` at the END of `InstanceModulesPane`'s JSX (after the
existing external-modules block), keeping the addition to ~3 lines total — the file is
at 987/1000 lines and must stay under the gate. If the addition tips the file over
1000, move ONLY the `InstanceModulesPane` external-modules JSX into the new section
file instead — but measure first (`wc -l`), don't restructure preemptively.

- [ ] **Step 5: Gates + manual check**

```bash
pnpm --filter @jarv1s/web typecheck
pnpm check:file-size
pnpm --filter @jarv1s/web lint
```

Expected: PASS. Then a LAN-visible smoke check (dev servers, `--host`):
`pnpm --filter @jarv1s/web dev -- --host` + api dev server, open Settings → Instance
modules as the owner and confirm the section renders (registry may show
"unreachable" locally — that IS the correct degraded rendering).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/query-keys.ts apps/web/src/api/client.ts apps/web/src/settings/settings-feedback.tsx apps/web/src/settings/settings-module-registry-section.tsx apps/web/src/settings/settings-admin-panes.tsx
git commit -m "feat(web): module registry admin section — install/update/remove/purge (#964)"
```

---

### Task 10: Integration suite, docs, spec-example fix, full gates

End-to-end proof against a REAL local registry: a `node:http` server on `127.0.0.1:0`
serving an index + a tarball built by the Task 4 packer, wired in via
`JARVIS_MODULE_REGISTRY_URL` (the test-only override; both index and artifact fetches
use plain un-pinned fetch on this path — Task 5). Also the documentation and the spec
example-id fix.

**Files:**

- Create: `tests/integration/module-distribution.e2e.test.ts`
- Modify: `docs/module-developer-guide.md` (new "Distribution" section at the end)
- Modify: `docs/superpowers/specs/2026-07-12-module-distribution-install.md` (example ids `jarv1s.job-search` → `job-search` — real module ids are bare kebab slugs, `MODULE_ID_RE` at `validate.ts:24` rejects dots)

**Interfaces:**

- Consumes: everything — Task 4's `buildRegistryArtifacts`, Task 5's pipeline via the
  admin routes, Task 6's routes/DTOs, Task 7's `reconcileModules`. Test harness
  patterns copied from `tests/integration/external-modules-routes.test.ts` (fixture
  module + `createApiServer({ appDb, logger:false, apiServerConfig })` + the local
  `signUp` helper — copy that file's `signUp` function verbatim, lines 214-end).
- Produces: nothing downstream — this is the acceptance gate.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/module-distribution.e2e.test.ts`. Skeleton below is
complete except where it references the copied `signUp` helper:

```ts
// #964: end-to-end module distribution — download from a real (local) registry via
// the admin route, accept + install via boot reconcile, then remove + purge.
// Mirrors tests/integration/external-modules-routes.test.ts (fixture module, real
// server, signUp cookie auth) and adds a node:http mock registry: index.json + a
// tarball produced by the SAME packer the publish workflow uses (Task 4), so the
// hash/format contract is tested against the real artifact shape, not a hand-rolled one.
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { Client } from "pg";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { createApiServer } from "../../apps/api/src/server.js";
import { packModuleArtifact } from "../../scripts/publish-module-registry.js";
import { reconcileModules } from "../../scripts/module-reconcile.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

let root: string;
let modulesDir: string;
let registry: Server;
let registryUrl: string;
let latestVersion: "0.2.0" | "0.3.0" = "0.2.0";
let refs: Record<string, { artifact: string; sha256: string; sizeBytes: number }>;
let appDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;
let memberCookie: string;

const MANIFEST = {
  schemaVersion: 1,
  id: "acme-widgets",
  name: "Acme Widgets",
  version: "0.2.0",
  publisher: "Acme, Inc.",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.1.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
  worker: { queues: [{ name: "acme-widgets.manual", handler: "manual", allowManualRun: true }] },
  database: { ownedTables: ["app.acme_widgets_items"] }
};

beforeAll(async () => {
  await resetEmptyFoundationDatabase();

  root = mkdtempSync(join(tmpdir(), "moddist-"));
  modulesDir = join(root, "modules");
  mkdirSync(modulesDir, { recursive: true });

  // Build the publishable module source, then pack it with the real packer.
  const srcDir = join(root, "src-module");
  mkdirSync(join(srcDir, "dist"), { recursive: true });
  mkdirSync(join(srcDir, "sql"), { recursive: true });
  writeFileSync(join(srcDir, "dist", "worker.js"), "// fixture worker\n");
  writeFileSync(
    join(srcDir, "sql", "0001_items.sql"),
    "CREATE TABLE IF NOT EXISTS app.acme_widgets_items (id bigint PRIMARY KEY);\n"
  );
  writeFileSync(join(srcDir, "jarvis.module.json"), JSON.stringify(MANIFEST));
  // Pack BOTH versions with the REAL Task 4 packer (writes <id>-<version>.tgz into
  // outDir, returns { version, artifact, sha256, sizeBytes }) so the hash/format
  // contract is tested against the exact artifact shape the publish workflow produces.
  // 0.3.0 adds a second migration — the update test asserts only NEW migrations run.
  const outDir = join(root, "registry-out");
  mkdirSync(outDir, { recursive: true });
  const ref020 = await packModuleArtifact(srcDir, outDir, "acme-widgets", "0.2.0");
  writeFileSync(
    join(srcDir, "sql", "0002_labels.sql"),
    "ALTER TABLE app.acme_widgets_items ADD COLUMN IF NOT EXISTS label text;\n"
  );
  writeFileSync(
    join(srcDir, "jarvis.module.json"),
    JSON.stringify({ ...MANIFEST, version: "0.3.0" })
  );
  const ref030 = await packModuleArtifact(srcDir, outDir, "acme-widgets", "0.3.0");
  refs = { "0.2.0": ref020, "0.3.0": ref030 };

  // Mock registry on an ephemeral port. The index is built PER REQUEST from the
  // mutable `latestVersion` so the update test can "publish" 0.3.0 mid-suite.
  registry = createServer((req, res) => {
    if (req.url === "/index.json") {
      const latest = refs[latestVersion];
      const index = {
        schemaVersion: 1,
        generatedAt: "2026-07-12T00:00:00Z",
        modules: [
          {
            id: "acme-widgets",
            name: "Acme Widgets",
            description: "Fixture module",
            version: latestVersion,
            requiresCore: ">=0.1.0",
            artifact: `${registryUrl}/${latest.artifact}`,
            sha256: latest.sha256,
            sizeBytes: latest.sizeBytes,
            capabilities: {
              permissions: [],
              fetchHosts: [],
              tools: [],
              ownsTables: ["app.acme_widgets_items"]
            },
            previousVersions:
              latestVersion === "0.3.0"
                ? [
                    {
                      version: "0.2.0",
                      artifact: `${registryUrl}/${refs["0.2.0"].artifact}`,
                      sha256: refs["0.2.0"].sha256,
                      sizeBytes: refs["0.2.0"].sizeBytes
                    }
                  ]
                : []
          }
        ]
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(index));
      return;
    }
    if (req.url?.endsWith(".tgz")) {
      const file = join(outDir, req.url.slice(1));
      if (existsSync(file)) {
        res.setHeader("content-type", "application/gzip");
        res.end(readFileSync(file));
        return;
      }
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
  registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`;
  process.env.JARVIS_MODULE_REGISTRY_URL = `${registryUrl}/index.json`;

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

  const admin = await signUp(server, "owner@moddist.test", "Owner");
  adminCookie = admin.cookie;
  const member = await signUp(server, "member@moddist.test", "Member");
  memberCookie = member.cookie;
});

afterAll(async () => {
  delete process.env.JARVIS_MODULE_REGISTRY_URL;
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  await new Promise((resolve) => registry?.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

describe("module distribution e2e (#964)", () => {
  it("denies non-admin access to every registry route", async () => {
    for (const [method, url] of [
      ["GET", "/api/admin/module-registry"],
      ["POST", "/api/admin/module-registry/acme-widgets/download"],
      ["POST", "/api/admin/module-registry/acme-widgets/remove"],
      ["DELETE", "/api/admin/module-registry/acme-widgets/purge"]
    ] as const) {
      const res = await server.inject({
        method,
        url,
        headers: { cookie: memberCookie, "content-type": "application/json" },
        payload: method === "POST" ? {} : undefined
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("lists the registry module as not-installed with full capabilities", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.registryUnavailable).toBe(false);
    const row = body.modules.find((m: { id: string }) => m.id === "acme-widgets");
    // Every DTO field must survive fast-json-stringify (additionalProperties:false
    // drops undeclared fields SILENTLY — the recurring trap; assert them all).
    expect(row).toEqual({
      id: "acme-widgets",
      name: "Acme Widgets",
      description: "Fixture module",
      state: "not-installed",
      installedVersion: null,
      latestVersion: "0.2.0",
      stagedVersion: null,
      requiresCore: ">=0.1.0",
      capabilities: {
        permissions: [],
        fetchHosts: [],
        tools: [],
        ownsTables: ["app.acme_widgets_items"]
      },
      lastInstallError: null,
      purgePending: false
    });
  });

  it("downloads + stages via the admin route → pending-restart, files on disk", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/download",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ state: "pending-restart", stagedVersion: "0.2.0" });
    expect(existsSync(join(modulesDir, "acme-widgets", "jarvis.module.json"))).toBe(true);
    expect(existsSync(join(modulesDir, "acme-widgets", "sql", "0001_items.sql"))).toBe(true);
  });

  it("boot reconcile accepts the staged download and installs the module schema", async () => {
    const report = await reconcileModules({ modulesDir });
    expect(report.accepted).toEqual(["acme-widgets"]);
    expect(report.installed).toEqual(["acme-widgets"]);
    expect(report.warnings).toEqual([]);

    // 4-phase install evidence (spec §12): table created, both module roles exist,
    // the installer role's login is disabled after phase D, migration ledger recorded.
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    const table = await client.query("SELECT to_regclass('app.acme_widgets_items') AS t");
    const roles = await client.query<{ rolname: string; rolcanlogin: boolean }>(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'jarvis_mod_acme_widgets_%' ORDER BY rolname"
    );
    const ledger = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.module_schema_migrations WHERE module_id = 'acme-widgets'"
    );
    await client.end();
    expect(table.rows[0].t).toBe("app.acme_widgets_items");
    expect(roles.rows.some((r) => r.rolname === "jarvis_mod_acme_widgets_runtime")).toBe(true);
    expect(
      roles.rows.find((r) => r.rolname === "jarvis_mod_acme_widgets_install")?.rolcanlogin
    ).toBe(false);
    expect(ledger.rows[0].n).toBe(1);

    const list = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry",
      headers: { cookie: adminCookie }
    });
    const row = list.json().modules.find((m: { id: string }) => m.id === "acme-widgets");
    expect(row).toMatchObject({ state: "installed-enabled", installedVersion: "0.2.0" });
  });

  it("download while a purge is pending is refused with 409", async () => {
    // Mark remove+purge first…
    const remove = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/remove",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { purgeData: true }
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().module).toMatchObject({ purgePending: true });
    // …then a download attempt must not clear or race the mark.
    const download = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/download",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: {}
    });
    expect(download.statusCode).toBe(409);
  });

  it("cancel purge restores the removable state without touching data", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/api/admin/module-registry/acme-widgets/purge",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().module.purgePending).toBe(false);
  });

  it("remove+purge then reconcile destroys tables, roles, journal, files, and the row", async () => {
    await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/remove",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { purgeData: true }
    });
    const report = await reconcileModules({ modulesDir });
    expect(report.purged).toEqual(["acme-widgets"]);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    const table = await client.query("SELECT to_regclass('app.acme_widgets_items') AS t");
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'jarvis_mod_acme_widgets_runtime'"
    );
    const journal = await client.query(
      "SELECT 1 FROM app.module_installs WHERE module_id = 'acme-widgets'"
    );
    const row = await client.query("SELECT 1 FROM app.external_modules WHERE id = 'acme-widgets'");
    await client.end();
    expect(table.rows[0].t).toBeNull();
    expect(role.rowCount).toBe(0);
    expect(journal.rowCount).toBe(0);
    expect(row.rowCount).toBe(0);
    expect(existsSync(join(modulesDir, "acme-widgets"))).toBe(false);

    const list = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry",
      headers: { cookie: adminCookie }
    });
    const listed = list.json().modules.find((m: { id: string }) => m.id === "acme-widgets");
    expect(listed).toMatchObject({ state: "not-installed", purgePending: false });
  });

  it("purge re-run is idempotent (crash-safety)", async () => {
    const report = await reconcileModules({ modulesDir });
    expect(report.purged).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("compose-ensure downloads and installs a missing module in one boot", async () => {
    const report = await reconcileModules({
      modulesDir,
      env: { ...process.env, JARVIS_MODULES_ENSURE: "acme-widgets" }
    });
    expect(report.ensured).toEqual(["acme-widgets"]);
    expect(report.accepted).toEqual(["acme-widgets"]);
    expect(report.installed).toEqual(["acme-widgets"]);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    const table = await client.query("SELECT to_regclass('app.acme_widgets_items') AS t");
    await client.end();
    expect(table.rows[0].t).toBe("app.acme_widgets_items");
  });

  it("registry outage during ensure → boot completes with a warning, not a failure", async () => {
    const report = await reconcileModules({
      modulesDir,
      env: {
        ...process.env,
        JARVIS_MODULES_ENSURE: "some-other-module",
        // Dead port: connection refused. The reconcile must warn and keep going.
        JARVIS_MODULE_REGISTRY_URL: "http://127.0.0.1:9/index.json"
      }
    });
    expect(report.warnings.some((w) => w.moduleId === "some-other-module")).toBe(true);
  });

  it("published 0.3.0 → update-available → download → boot applies ONLY new migrations", async () => {
    latestVersion = "0.3.0";
    // ?refresh=1 busts the server's 10-minute index cache (Task 6).
    const list = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry?refresh=1",
      headers: { cookie: adminCookie }
    });
    expect(list.json().modules.find((m: { id: string }) => m.id === "acme-widgets")).toMatchObject({
      state: "update-available",
      installedVersion: "0.2.0",
      latestVersion: "0.3.0"
    });

    const download = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/download",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: {}
    });
    expect(download.statusCode).toBe(200);
    expect(download.json().module).toMatchObject({
      state: "update-pending-restart",
      stagedVersion: "0.3.0"
    });

    const report = await reconcileModules({ modulesDir });
    expect(report.accepted).toEqual(["acme-widgets"]);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    const ledger = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.module_schema_migrations WHERE module_id = 'acme-widgets'"
    );
    const column = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'acme_widgets_items' AND column_name = 'label'"
    );
    await client.end();
    // 0001 was applied before the update and is NOT re-run; only 0002 is added.
    expect(ledger.rows[0].n).toBe(2);
    expect(column.rowCount).toBe(1);

    const after = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry",
      headers: { cookie: adminCookie }
    });
    expect(after.json().modules.find((m: { id: string }) => m.id === "acme-widgets")).toMatchObject(
      { state: "installed-enabled", installedVersion: "0.3.0" }
    );
  });

  it("remove keeps data; reinstall resumes the migration ledger instead of re-running", async () => {
    const remove = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/remove",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { purgeData: false }
    });
    expect(remove.statusCode).toBe(200);
    await reconcileModules({ modulesDir });
    expect(existsSync(join(modulesDir, "acme-widgets"))).toBe(false);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    const kept = await client.query("SELECT to_regclass('app.acme_widgets_items') AS t");
    expect(kept.rows[0].t).toBe("app.acme_widgets_items"); // data preserved

    // Reinstall: download again + reconcile — ledger resumes, nothing re-runs.
    const download = await server.inject({
      method: "POST",
      url: "/api/admin/module-registry/acme-widgets/download",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: {}
    });
    expect(download.statusCode).toBe(200);
    const report = await reconcileModules({ modulesDir });
    expect(report.accepted).toEqual(["acme-widgets"]);
    const ledger = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.module_schema_migrations WHERE module_id = 'acme-widgets'"
    );
    await client.end();
    expect(ledger.rows[0].n).toBe(2); // unchanged — 0001/0002 skipped as already applied
  });

  it("tampered on-disk package → drift-disabled at the next boot", async () => {
    writeFileSync(join(modulesDir, "acme-widgets", "dist", "worker.js"), "// tampered\n");
    const report = await reconcileModules({ modulesDir });
    expect(report.drifted).toEqual(["acme-widgets"]);

    const list = await server.inject({
      method: "GET",
      url: "/api/admin/module-registry",
      headers: { cookie: adminCookie }
    });
    expect(list.json().modules.find((m: { id: string }) => m.id === "acme-widgets")).toMatchObject({
      state: "installed-disabled"
    });
  });
});

// signUp: copy VERBATIM from tests/integration/external-modules-routes.test.ts:214-end
// (better-auth sign-up cookie pattern; first sign-up bootstraps the instance admin).
```

Note for the implementer: if Task 6's `createApiServer` wiring reads the distribution
config from env rather than `apiServerConfig`, set those env vars via `process.env`
before construction exactly as `JARVIS_MODULE_REGISTRY_URL` is set above.

- [ ] **Step 2: Run it**

```bash
pnpm vitest run tests/integration/module-distribution.e2e.test.ts
```

Expected: PASS (13 tests). This is the acceptance suite for the whole feature — it
covers every integration scenario in spec §12: download/stage/403, 4-phase install
evidence, purge + crash-safe re-run, compose-ensure, registry outage, update with
ledger resume, remove-keeps-data + reinstall, and tamper→drift — all against real
Postgres and a real HTTP registry.

- [ ] **Step 3: Docs**

Append a "Distribution" section to `docs/module-developer-guide.md` covering, in this
order (a paragraph each, written for a module author):

1. Publishing: modules under `external-modules/` are packed and published to the
   rolling GitHub Release tag `modules` by `.github/workflows/modules-registry.yml` on
   merge to main; the index lives at
   `https://github.com/motioneso/jarv1s/releases/download/modules/index.json`.
2. Owning tables: declare `database.ownedTables` in `jarvis.module.json` (every table
   `app.<slug>_*`); ship migrations in `sql/NNNN_name.sql` — CREATE TABLE / CREATE
   INDEX / ALTER TABLE only, applied by the boot reconcile with generated RLS.
3. Install lifecycle: admins install from Settings → Instance modules; downloads stage
   and apply on restart ("restart to apply"); removal keeps data unless the admin
   explicitly purges (type-the-id confirm).
4. Compose ensure: `JARVIS_MODULES_ENSURE="job-search,other-module@0.2.0"` in
   `env.production.local` auto-installs on boot; ensure is one-way (removing an id
   never uninstalls).
5. Dev parity: `pnpm db:reconcile` runs the same reconcile against the dev database
   (`JARVIS_ENABLE_EXTERNAL_MODULES=1 JARVIS_MODULES_DIR=<dir> pnpm db:reconcile`).

- [ ] **Step 4: Spec example-id fix**

In `docs/superpowers/specs/2026-07-12-module-distribution-install.md`, replace every
occurrence of the id `jarv1s.job-search` with `job-search` (real module ids are bare
kebab-case slugs — `MODULE_ID_RE` at `packages/module-registry/src/external/validate.ts:24`
rejects dots; the spec's JSON examples predate that check).

- [ ] **Step 5: Full gates**

```bash
pnpm prettier --write docs/module-developer-guide.md docs/superpowers/specs/2026-07-12-module-distribution-install.md
pnpm verify:foundation
```

Expected: exit 0. `verify:foundation` includes lint, format:check, file-size,
design-tokens, no-ambient-dates, package-deps, typecheck, unit, migrate, and the FULL
integration suite — the `foundation-schema-catalog.test.ts` migration-list assertion
(Task 3 added 0161's row) is exercised here.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/module-distribution.e2e.test.ts docs/module-developer-guide.md docs/superpowers/specs/2026-07-12-module-distribution-install.md
git commit -m "test(modules): distribution e2e vs local registry + developer-guide distribution docs (#964)"
```

---

## Execution notes (for the implementing session)

- **Shared working tree:** stage by explicit path only (never `git add -A` / `git add .`);
  other sessions may have uncommitted work. Prettier any docs you touch BEFORE
  committing (format:check gates them).
- **Task order is dependency order** — 1→10, no skipping. Tasks 6, 7, and 10 consume
  exact names produced by Tasks 1–5; if you rename anything, chase it forward.
- **Integration tests need the dev database up:** `pnpm db:up` first;
  `resetEmptyFoundationDatabase()` handles per-suite state. Don't run two integration
  suites concurrently against the shared dev Postgres.
- **The fast-json-stringify trap is the #1 recurring bug in this repo:** every response
  field must be declared in the shared schema or it is SILENTLY dropped. When a test
  sees a missing field, check the schema before the handler.
- **Do not weaken the hard invariants** (CLAUDE.md): metadata-only audit/job payloads,
  DataContextDb-only in request paths, no module-registry import inside settings
  (structural mirrors + injected port), never edit applied migrations (0161 is the ONLY
  new SQL file, in `packages/settings/sql/`).
