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
  // #964: table names, not a flag — Task 6's admin DTO/UI and Task 9's confirm dialog
  // render these directly ("Owns database tables: app.foo"). Table names are
  // module-declared structural metadata, not secrets or user data, so surfacing them
  // in the public registry index is fine.
  readonly ownsTables: readonly string[];
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
  const ownsTables = stringArray(raw.ownsTables);
  if (!permissions || !fetchHosts || !ownsTables || !Array.isArray(raw.tools)) {
    errors.push(`${where}: capabilities requires permissions[], fetchHosts[], tools[], ownsTables[]`);
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
  return { permissions, fetchHosts, tools, ownsTables };
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
