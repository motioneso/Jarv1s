// Pure, browser-safe validation of an external module's jarvis.module.json (#917).
// Slice 1 accepts METADATA ONLY: identity + compatibility. Any executable or
// surface-contributing field is rejected so an external module can never inject
// nav/routes/tools/SQL before the slices that safely host those land. No node:*
// imports here — this is re-exported from @jarv1s/module-registry's browser entry.
import type {
  JsonJarvisModuleManifest,
  ExternalModuleAssistantToolDeclaration,
  ModuleAuthDeclaration,
  ModuleLifecycle,
  ModuleStorageDeclaration,
  ModuleWebDeclaration
} from "@jarv1s/module-sdk";
import { satisfiesCoreVersion } from "@jarv1s/module-sdk/core-version";

export type ExternalModuleValidation =
  | { readonly ok: true; readonly manifest: JsonJarvisModuleManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Module ids are lowercase kebab slugs; the id also names the package directory. */
export const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const LIFECYCLES: readonly ModuleLifecycle[] = [
  "required",
  "optional",
  "user-toggleable",
  "workspace-toggleable"
];

// Every field of the compiled JarvisModuleManifest that carries executable behavior
// or a UI/data surface. Presence of ANY of these in an external manifest is a
// rejection. `auth`/`storage`/`web` are first-class as of #918 Slice 2 (validated
// positively below) and are deliberately absent from this list.
const FORBIDDEN_FIELDS: readonly string[] = [
  "availability",
  "database",
  "navigation",
  "settings",
  "permissions",
  "featureFlags",
  "notifications",
  "routes",
  "jobs",
  "shareableResources",
  "assistantActionFamilies",
  "sourceBehaviors",
  "focusSignal",
  "proactiveMonitor",
  "personContextProvider",
  "dataLifecycle",
  "externalSources"
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateExternalModuleManifest(
  raw: unknown,
  expectedId: string,
  coreVersion?: string
): ExternalModuleValidation {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest must be a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;

  // On-disk envelope contract version (#917, spec revision 2026-07-10 for PR #924). Slice 1
  // requires exactly the number 1; a missing, non-numeric, or future value fails closed. This is
  // the single "contract version" a metadata-only module carries — worker/web contract versions
  // are deferred to Slices 2-3 (see the JsonJarvisModuleManifest.schemaVersion doc + spec revision).
  if (obj.schemaVersion !== 1) {
    errors.push("schemaVersion must be the number 1");
  }

  // Identity.
  if (!isNonEmptyString(obj.id)) {
    errors.push("id is required and must be a non-empty string");
  } else if (!MODULE_ID_RE.test(obj.id)) {
    errors.push(`id "${obj.id}" is not a valid lowercase kebab-case slug`);
  } else if (obj.id !== expectedId) {
    errors.push(`id "${obj.id}" must equal the module directory name "${expectedId}"`);
  }

  if (!isNonEmptyString(obj.name)) errors.push("name is required");
  if (!isNonEmptyString(obj.version)) errors.push("version is required");
  if (!isNonEmptyString(obj.publisher)) errors.push("publisher is required");
  if (obj.description !== undefined && typeof obj.description !== "string") {
    errors.push("description must be a string when present");
  }

  if (!isNonEmptyString(obj.lifecycle) || !LIFECYCLES.includes(obj.lifecycle as ModuleLifecycle)) {
    errors.push(`lifecycle must be one of: ${LIFECYCLES.join(", ")}`);
  }

  // Compatibility — fail closed on an unparseable or out-of-range core version.
  const compatibility = obj.compatibility as Record<string, unknown> | undefined;
  if (
    typeof compatibility !== "object" ||
    compatibility === null ||
    !isNonEmptyString(compatibility.jarv1s)
  ) {
    errors.push("compatibility.jarv1s is required and must be a non-empty string");
  } else if (!satisfiesCoreVersion(compatibility.jarv1s, coreVersion)) {
    errors.push(
      `module is not compatible with this core (compatibility.jarv1s="${compatibility.jarv1s}")`
    );
  }

  // Metadata-only gate: reject any executable/surface field (#917).
  for (const field of FORBIDDEN_FIELDS) {
    if (obj[field] !== undefined) {
      errors.push(`field "${field}" is not permitted for external modules in this slice`);
    }
  }

  // #918 Slice 2: auth/storage/web are now first-class. Everything else
  // (routes, tools, jobs, database, dataLifecycle, ...) stays forbidden via FORBIDDEN_FIELDS.
  if (obj.auth !== undefined) {
    if (!Array.isArray(obj.auth)) {
      errors.push("auth must be an array");
    } else {
      const ids: string[] = [];
      for (const entry of obj.auth) {
        if (typeof entry !== "object" || entry === null) {
          errors.push("auth entries must be objects");
          continue;
        }
        const { id, displayName, kind, scope } = entry as Record<string, unknown>;
        if (
          typeof id !== "string" ||
          !id.startsWith(`${expectedId}.`) ||
          id.length <= expectedId.length + 1
        ) {
          errors.push(`auth id must be prefixed with "${expectedId}."`);
        } else {
          ids.push(id);
        }
        if (
          typeof displayName !== "string" ||
          displayName.length === 0 ||
          displayName.length > 200
        ) {
          errors.push("auth displayName must be a non-empty string (max 200)");
        }
        if (kind !== "api-key") errors.push('auth kind must be "api-key"');
        if (scope !== "instance" && scope !== "user") {
          errors.push('auth scope must be "instance" or "user"');
        }
      }
      if (new Set(ids).size !== ids.length) errors.push("auth ids must be unique");
    }
  }
  if (obj.storage !== undefined) {
    if (!Array.isArray(obj.storage)) {
      errors.push("storage must be an array");
    } else {
      for (const entry of obj.storage) {
        if (typeof entry !== "object" || entry === null) {
          errors.push("storage entries must be objects");
          continue;
        }
        const { namespace, scopes } = entry as Record<string, unknown>;
        if (
          typeof namespace !== "string" ||
          (namespace !== expectedId && !namespace.startsWith(`${expectedId}.`))
        ) {
          errors.push(`storage namespace must be "${expectedId}" or "${expectedId}.<slug>"`);
        }
        if (
          !Array.isArray(scopes) ||
          scopes.length === 0 ||
          scopes.some((s) => s !== "instance" && s !== "user")
        ) {
          errors.push('storage scopes must be a non-empty array of "instance" | "user"');
        }
      }
    }
  }
  if (obj.web !== undefined) {
    if (typeof obj.web !== "object" || obj.web === null) {
      errors.push("web must be an object");
    } else {
      const { entrypoint, contractVersion } = obj.web as Record<string, unknown>;
      if (
        typeof entrypoint !== "string" ||
        entrypoint.length === 0 ||
        entrypoint.startsWith("/") ||
        entrypoint.includes("\\") ||
        entrypoint.split("/").some((seg) => seg === ".." || seg === "." || seg.length === 0)
      ) {
        errors.push("web.entrypoint must be a clean package-relative path");
      }
      if (
        typeof contractVersion !== "number" ||
        !Number.isInteger(contractVersion) ||
        contractVersion < 1
      ) {
        errors.push("web.contractVersion must be a positive integer");
      }
    }
  }

  if (obj.runtime !== undefined) {
    if (typeof obj.runtime !== "object" || obj.runtime === null) {
      errors.push("runtime must be an object");
    } else {
      const { workerEntrypoint, workerContractVersion } = obj.runtime as Record<string, unknown>;
      if (workerEntrypoint !== "dist/worker.js") {
        errors.push('runtime.workerEntrypoint must be "dist/worker.js"');
      }
      if (workerContractVersion !== 1) {
        errors.push("runtime.workerContractVersion must be the number 1");
      }
    }
  }
  if (obj.assistantTools !== undefined) {
    if (!Array.isArray(obj.assistantTools)) {
      errors.push("assistantTools must be an array");
    } else {
      if (obj.runtime === undefined) errors.push("runtime is required when assistantTools exist");
      const names: string[] = [];
      const permissions: string[] = [];
      const handlers: string[] = [];
      for (const entry of obj.assistantTools) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          errors.push("assistantTools entries must be objects");
          continue;
        }
        const tool = entry as Record<string, unknown>;
        if (typeof tool.name !== "string" || !tool.name.startsWith(`${expectedId}.`)) {
          errors.push(`assistant tool names must be prefixed with "${expectedId}."`);
        } else names.push(tool.name);
        if (
          typeof tool.permissionId !== "string" ||
          !tool.permissionId.startsWith(`${expectedId}.`)
        ) {
          errors.push(`assistant tool permission ids must be prefixed with "${expectedId}."`);
        } else permissions.push(tool.permissionId);
        if (!isNonEmptyString(tool.description))
          errors.push("assistant tool description is required");
        if (tool.risk !== "read" && tool.risk !== "write" && tool.risk !== "destructive") {
          errors.push('assistant tool risk must be "read", "write", or "destructive"');
        }
        if (!isNonEmptyString(tool.handler)) errors.push("assistant tool handler is required");
        else handlers.push(tool.handler);
      }
      if (new Set(names).size !== names.length) errors.push("assistant tool names must be unique");
      if (new Set(permissions).size !== permissions.length) {
        errors.push("assistant tool permission ids must be unique");
      }
      if (new Set(handlers).size !== handlers.length)
        errors.push("assistant tool handlers must be unique");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Re-shape to exactly the allowed fields (drop unknown keys defensively). schemaVersion is
  // pinned to the literal 1 — validation above guarantees obj.schemaVersion === 1 to reach here.
  const manifest: JsonJarvisModuleManifest = {
    schemaVersion: 1,
    id: obj.id as string,
    name: obj.name as string,
    version: obj.version as string,
    publisher: obj.publisher as string,
    lifecycle: obj.lifecycle as ModuleLifecycle,
    compatibility: { jarv1s: (compatibility as { jarv1s: string }).jarv1s },
    ...(typeof obj.description === "string" ? { description: obj.description } : {}),
    ...(obj.auth !== undefined ? { auth: obj.auth as readonly ModuleAuthDeclaration[] } : {}),
    ...(obj.storage !== undefined
      ? { storage: obj.storage as readonly ModuleStorageDeclaration[] }
      : {}),
    ...(obj.web !== undefined ? { web: obj.web as ModuleWebDeclaration } : {}),
    ...(obj.runtime !== undefined
      ? { runtime: obj.runtime as JsonJarvisModuleManifest["runtime"] }
      : {}),
    ...(obj.assistantTools !== undefined
      ? { assistantTools: obj.assistantTools as readonly ExternalModuleAssistantToolDeclaration[] }
      : {})
  };
  return { ok: true, manifest };
}
