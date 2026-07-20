// Pure, browser-safe validation of an external module's jarvis.module.json (#917).
// Slice 1 accepts METADATA ONLY: identity + compatibility, plus a small allow-listed set
// of surfaces (auth/storage/web/database/navigation) each validated positively below.
// Any OTHER executable or surface-contributing field is rejected so an external module
// can never inject routes/tools/SQL before the slices that safely host those land. No
// node:* imports here — this is re-exported from @jarv1s/module-registry's browser entry.
import type {
  JsonJarvisModuleManifest,
  ExternalModuleAssistantToolDeclaration,
  ExternalModuleDatabaseDeclaration,
  ExternalModuleNavigationEntry,
  ExternalModuleWorkerDeclaration,
  ModuleAssistantOnboardingManifest,
  ModuleAuthDeclaration,
  ModuleLifecycle,
  ModuleStorageDeclaration,
  ModuleWebDeclaration
} from "@jarv1s/module-sdk";
import { assertValidFetchHosts } from "@jarv1s/host-fetch/policy";
import { isValidModuleParamsSchema, matchesModuleParamsSchema } from "@jarv1s/module-sdk";
import { satisfiesCoreVersion } from "@jarv1s/module-sdk/core-version";

export type ExternalModuleValidation =
  | { readonly ok: true; readonly manifest: JsonJarvisModuleManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Module ids are lowercase kebab slugs; the id also names the package directory. */
export const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// #964: owned-table names. Qualified app-schema, lowercase snake, and HARD-PREFIXED by
// the module's own slug (id with hyphens→underscores) so no downloadable module can
// declare — and later purge — another module's (or core's) tables. Name part capped at
// Postgres's 63-char identifier limit.
export const MODULE_OWNED_TABLE_RE = /^app\.[a-z][a-z0-9_]{0,62}$/;
export const ASSISTANT_ONBOARDING_GUIDANCE_MAX_BYTES = 8 * 1024;

const LIFECYCLES: readonly ModuleLifecycle[] = [
  "required",
  "optional",
  "user-toggleable",
  "workspace-toggleable"
];

// Every field of the compiled JarvisModuleManifest that carries executable behavior
// or a UI/data surface. Presence of ANY of these in an external manifest is a
// rejection. `auth`/`storage`/`web` are first-class as of #918 Slice 2, `database` as
// of #964, and `navigation` as of #1019 (each validated positively below) and are
// deliberately absent from this list.
const FORBIDDEN_FIELDS: readonly string[] = [
  "availability",
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

function hasDeadLetterCycle(queues: readonly Record<string, unknown>[]): boolean {
  const edges = new Map(
    queues
      .filter(
        (queue) => typeof queue.name === "string" && typeof queue.deadLetterQueue === "string"
      )
      .map((queue) => [queue.name as string, queue.deadLetterQueue as string])
  );
  for (const start of edges.keys()) {
    const seen = new Set<string>();
    for (let current: string | undefined = start; current; current = edges.get(current)) {
      if (seen.has(current)) return true;
      seen.add(current);
    }
  }
  return false;
}

function validateWorker(
  raw: unknown,
  moduleId: string,
  errors: string[],
  reservedQueueNames: ReadonlySet<string>
): ExternalModuleWorkerDeclaration | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("worker must be an object");
    return undefined;
  }
  const worker = raw as Record<string, unknown>;
  if (worker.queues !== undefined && !Array.isArray(worker.queues)) {
    errors.push("worker.queues must be an array");
  }
  if (worker.schedules !== undefined && !Array.isArray(worker.schedules)) {
    errors.push("worker.schedules must be an array");
  }
  const queues = Array.isArray(worker.queues) ? worker.queues : [];
  if (queues.length > 16) errors.push("worker declares more than 16 queues");
  const queueNames = new Set<string>();
  const normalizedQueues: Record<string, unknown>[] = [];
  for (const entry of queues) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("worker queue entries must be objects");
      continue;
    }
    const queue = entry as Record<string, unknown>;
    if (typeof queue.name !== "string" || !queue.name.startsWith(`${moduleId}.`)) {
      errors.push(`worker queue names must be prefixed with "${moduleId}."`);
    } else if (reservedQueueNames.has(queue.name)) {
      errors.push(`worker queue "${queue.name}" collides with an existing queue`);
    } else if (queueNames.has(queue.name)) {
      errors.push("worker queue names must be unique");
    } else queueNames.add(queue.name);
    if (!isNonEmptyString(queue.handler)) errors.push("worker queue handler is required");
    if (queue.paramsSchema !== undefined && !isValidModuleParamsSchema(queue.paramsSchema)) {
      errors.push("worker queue paramsSchema is invalid");
    }
    if (
      queue.retryLimit !== undefined &&
      (!Number.isInteger(queue.retryLimit) || (queue.retryLimit as number) < 0)
    ) {
      errors.push("worker queue retryLimit must be a non-negative integer");
    }
    normalizedQueues.push({
      ...queue,
      ...(typeof queue.retryLimit === "number"
        ? { retryLimit: Math.min(queue.retryLimit, 10) }
        : {})
    });
  }
  for (const queue of queues as Record<string, unknown>[]) {
    if (typeof queue.deadLetterQueue === "string" && !queueNames.has(queue.deadLetterQueue)) {
      errors.push("worker queue deadLetterQueue must reference a declared queue");
    }
  }
  if (hasDeadLetterCycle(queues as Record<string, unknown>[])) {
    errors.push("worker dead-letter graph contains a cycle");
  }
  const schedules = Array.isArray(worker.schedules) ? worker.schedules : [];
  if (schedules.length > 32) errors.push("worker declares more than 32 schedules");
  const scheduleIds = new Set<string>();
  for (const entry of schedules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("worker schedule entries must be objects");
      continue;
    }
    const schedule = entry as Record<string, unknown>;
    if (typeof schedule.id !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(schedule.id)) {
      errors.push("worker schedule id must be a bounded identifier");
    } else if (scheduleIds.has(schedule.id)) {
      errors.push("worker schedule ids must be unique");
    } else scheduleIds.add(schedule.id);
    if (
      typeof schedule.cron !== "string" ||
      schedule.cron.trim().split(/\s+/).length !== 5 ||
      !/^[\d*/?,\-\s]+$/.test(schedule.cron)
    ) {
      errors.push("worker schedule cron must be a standard 5-field expression");
    }
    if (schedule.scope !== "user") errors.push('worker schedule scope must be "user"');
    if (
      typeof schedule.jobKind !== "string" ||
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(schedule.jobKind)
    ) {
      errors.push("worker schedule jobKind must be a bounded identifier");
    }
    if (typeof schedule.queue !== "string" || !queueNames.has(schedule.queue)) {
      errors.push("worker schedule queue must reference a declared queue");
    }
    if (schedule.tz !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: String(schedule.tz) }).format();
      } catch {
        errors.push("worker schedule time zone is invalid");
      }
    }
    const queue = normalizedQueues.find((candidate) => candidate.name === schedule.queue);
    if (schedule.params !== undefined) {
      const encoded = JSON.stringify(schedule.params);
      if (
        !isValidModuleParamsSchema(queue?.paramsSchema) ||
        encoded.length > 2_048 ||
        !matchesModuleParamsSchema(queue.paramsSchema, schedule.params)
      ) {
        errors.push("worker schedule params do not match the queue paramsSchema");
      }
    }
  }
  // #1166 (F6-D4): reconcileJobs are a one-shot-per-active-user enqueue on every reconcile
  // (backfill/repair), distinct from the recurring cron `schedules` above. Mirrors the
  // schedules block's validation style: bounded count, bounded id, must reference a
  // declared queue, unknown keys rejected outright, duplicate ids rejected.
  if (worker.reconcileJobs !== undefined && !Array.isArray(worker.reconcileJobs)) {
    errors.push("worker.reconcileJobs must be an array");
  }
  const reconcileJobs = Array.isArray(worker.reconcileJobs) ? worker.reconcileJobs : [];
  if (reconcileJobs.length > 8) errors.push("worker declares more than 8 reconcileJobs");
  const reconcileJobIds = new Set<string>();
  for (const entry of reconcileJobs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("worker reconcileJob entries must be objects");
      continue;
    }
    const job = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(job).filter((key) => !["id", "queue", "jobKind"].includes(key));
    if (unknownKeys.length > 0) {
      errors.push(`worker reconcileJob contains unknown fields: ${unknownKeys.join(", ")}`);
    }
    if (typeof job.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(job.id)) {
      errors.push("worker reconcileJob id must be a bounded lowercase kebab identifier");
    } else if (reconcileJobIds.has(job.id)) {
      errors.push("worker reconcileJob ids must be unique");
    } else reconcileJobIds.add(job.id);
    if (typeof job.queue !== "string" || !queueNames.has(job.queue)) {
      errors.push("worker reconcileJob queue must reference a declared queue");
    }
    if (
      typeof job.jobKind !== "string" ||
      job.jobKind.trim().length === 0 ||
      job.jobKind.length > 128
    ) {
      errors.push("worker reconcileJob jobKind must be a non-empty string (max 128 chars)");
    }
  }
  return {
    ...(worker.queues !== undefined
      ? { queues: normalizedQueues as unknown as ExternalModuleWorkerDeclaration["queues"] }
      : {}),
    ...(worker.schedules !== undefined
      ? { schedules: schedules as ExternalModuleWorkerDeclaration["schedules"] }
      : {}),
    ...(worker.reconcileJobs !== undefined
      ? {
          reconcileJobs: reconcileJobs as ExternalModuleWorkerDeclaration["reconcileJobs"]
        }
      : {})
  };
}

export function validateExternalModuleManifest(
  raw: unknown,
  expectedId: string,
  coreVersion?: string,
  reservedQueueNames: ReadonlySet<string> = new Set()
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
        // FIN-00 #1145: instance-write opt-in is only meaningful (and only
        // approved by the admin) for namespaces that actually have instance scope.
        const { instanceWritePolicy } = entry as Record<string, unknown>;
        if (instanceWritePolicy !== undefined) {
          if (instanceWritePolicy !== "admin" && instanceWritePolicy !== "module") {
            errors.push('storage instanceWritePolicy must be "admin" or "module"');
          } else if (!Array.isArray(scopes) || !scopes.includes("instance")) {
            errors.push('storage instanceWritePolicy requires "instance" in scopes');
          }
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

  let assistantOnboarding: ModuleAssistantOnboardingManifest | undefined;
  if (obj.assistantOnboarding !== undefined) {
    if (
      typeof obj.assistantOnboarding !== "object" ||
      obj.assistantOnboarding === null ||
      Array.isArray(obj.assistantOnboarding)
    ) {
      errors.push("assistantOnboarding must be an object");
    } else {
      const onboarding = obj.assistantOnboarding as Record<string, unknown>;
      const unknownKeys = Object.keys(onboarding).filter((key) => key !== "guidance");
      if (unknownKeys.length > 0) {
        errors.push(`assistantOnboarding contains unknown fields: ${unknownKeys.join(", ")}`);
      }
      if (
        !isNonEmptyString(onboarding.guidance) ||
        new TextEncoder().encode(onboarding.guidance as string).byteLength >
          ASSISTANT_ONBOARDING_GUIDANCE_MAX_BYTES ||
        // eslint-disable-next-line no-control-regex -- manifest guidance must be plain text.
        /[\u0000-\u001F\u007F]/.test(onboarding.guidance as string)
      ) {
        errors.push(
          `assistantOnboarding.guidance must be non-empty plain text (${ASSISTANT_ONBOARDING_GUIDANCE_MAX_BYTES} bytes max)`
        );
      } else if (unknownKeys.length === 0) {
        assistantOnboarding = { guidance: onboarding.guidance as string };
      }
    }
  }

  if ((obj.worker !== undefined || obj.fetchHosts !== undefined) && obj.runtime === undefined) {
    errors.push("runtime is required when worker or fetchHosts exist");
  }
  const worker =
    obj.worker === undefined
      ? undefined
      : validateWorker(obj.worker, expectedId, errors, reservedQueueNames);
  if (obj.fetchHosts !== undefined) {
    if (
      !Array.isArray(obj.fetchHosts) ||
      !obj.fetchHosts.every((host) => typeof host === "string")
    ) {
      errors.push("fetchHosts must be an array of hostnames");
    } else {
      try {
        assertValidFetchHosts(expectedId, obj.fetchHosts as string[]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "fetchHosts are invalid");
      }
    }
  }

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
      : {}),
    ...(worker !== undefined ? { worker } : {}),
    ...(obj.fetchHosts !== undefined ? { fetchHosts: obj.fetchHosts as readonly string[] } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(navigation !== undefined ? { navigation } : {}),
    ...(assistantOnboarding !== undefined ? { assistantOnboarding } : {})
  };
  return { ok: true, manifest };
}
