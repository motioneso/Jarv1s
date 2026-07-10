// Pure, browser-safe validation of an external module's jarvis.module.json (#917).
// Slice 1 accepts METADATA ONLY: identity + compatibility. Any executable or
// surface-contributing field is rejected so an external module can never inject
// nav/routes/tools/SQL before the slices that safely host those land. No node:*
// imports here — this is re-exported from @jarv1s/module-registry's browser entry.
import type { JsonJarvisModuleManifest, ModuleLifecycle } from "@jarv1s/module-sdk";
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
// Slice-1 rejection (metadata-only). `auth`/`storage` are declaration-only but still
// out of scope this slice.
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
  "assistantTools",
  "sourceBehaviors",
  "focusSignal",
  "proactiveMonitor",
  "personContextProvider",
  "dataLifecycle",
  "externalSources",
  "auth",
  "storage"
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
    ...(typeof obj.description === "string" ? { description: obj.description } : {})
  };
  return { ok: true, manifest };
}
