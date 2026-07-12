// Module-management route family (#917).
//
// Extracted verbatim from routes.ts to satisfy the 1000-line file-size gate: Task 9 added the
// external-module admin routes and pushed routes.ts over the cap. This is a PURE MOVE — the
// admin-modules, external-modules, and per-user-modules handlers keep the same order, the same
// admin authorization (assertAdminUser runs FIRST, before any 404/409 branch, so a non-admin
// can never distinguish unknown vs required vs feature-off), the same fail-closed 404/409 codes,
// and the same metadata-only writes. registerSettingsRoutes keeps its signature and just calls
// registerModuleRoutes(server, ctx). Nothing here changes the @jarv1s/settings public surface.
//
// `assertAdminUser` and `requireRequestId` are threaded via ctx (they live in routes.ts) rather
// than imported, to avoid an import cycle with routes.ts. Everything else is imported directly.
import type { FastifyInstance } from "fastify";

import type { AccessContext, DataContextDb, User } from "@jarv1s/db";
import {
  listAdminModulesRouteSchema,
  listExternalModulesRouteSchema,
  listMyModulesRouteSchema,
  patchModuleEnablementRouteSchema,
  setExternalModuleEnablementRouteSchema,
  type AdminModuleDto,
  type ExternalModuleDto
} from "@jarv1s/shared";
import { HttpError } from "@jarv1s/module-sdk";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import type { SettingsRepository } from "./repository.js";
import type { SettingsRoutesDependencies } from "./routes.js";
import { computeMyModuleDto, handleRouteError, toMyModuleDto } from "./routes-serializers.js";

// Only the fields the module routes consume; the composition root passes the full deps object.
export interface ModuleRoutesContext {
  readonly dependencies: SettingsRoutesDependencies;
  readonly repository: SettingsRepository;
  // Module-level helpers from routes.ts, passed in to avoid an import cycle (#917).
  readonly assertAdminUser: (
    repository: SettingsRepository,
    scopedDb: DataContextDb,
    userId: string
  ) => Promise<User>;
  readonly requireRequestId: (accessContext: AccessContext) => string;
}

/**
 * Register the admin/external/per-user module routes on `server` (#917). Called once by
 * registerSettingsRoutes; the handler bodies are unchanged from their previous inline home.
 */
export function registerModuleRoutes(server: FastifyInstance, ctx: ModuleRoutesContext): void {
  const { dependencies, repository, assertAdminUser, requireRequestId } = ctx;

  function requireManifests(): readonly JarvisModuleManifest[] {
    return dependencies.listModuleManifests();
  }

  function findManifest(id: string): JarvisModuleManifest | undefined {
    return requireManifests().find((m) => m.id === id);
  }

  function isRequired(m: JarvisModuleManifest): boolean {
    return m.availability?.required === true;
  }

  function supportsUserDisable(m: JarvisModuleManifest): boolean {
    return m.availability?.supportsUserDisable !== false;
  }

  server.get(
    "/api/admin/modules",
    { schema: listAdminModulesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const instanceRows = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.listInstanceModuleDenyRows(scopedDb);
          }
        );
        const instanceDisabled = new Set(instanceRows.map((r) => r.module_id));
        const modules: AdminModuleDto[] = requireManifests().map((m) => ({
          id: m.id,
          name: m.name,
          version: m.version,
          lifecycle: m.lifecycle,
          required: isRequired(m),
          supportsUserDisable: supportsUserDisable(m),
          instanceDisabled: instanceDisabled.has(m.id)
        }));
        return { modules };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: { id: string } }>(
    "/api/admin/modules/:id",
    { schema: patchModuleEnablementRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const disabled = parseDisabledBody(request.body);
        // SECURITY: authorize FIRST, before any manifest lookup or required/unknown
        // check, so a non-admin can never distinguish unknown (404) vs required (409)
        // modules — they always get the admin 403. assertAdminUser must run before the
        // 404/409 branches. All checks live inside one withDataContext.
        const dto = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            const manifest = findManifest(request.params.id);
            if (!manifest) throw new HttpError(404, "Module not found");
            if (disabled && isRequired(manifest)) {
              throw new HttpError(409, "Required modules cannot be disabled");
            }
            await repository.setInstanceModuleDisabled(scopedDb, {
              moduleId: manifest.id,
              disabled,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
            return computeMyModuleDto(repository, scopedDb, manifest, accessContext.actorUserId);
          }
        );
        return { module: dto };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // #917: list discovered external modules with reconciled activation state. Admin-only.
  // This is the ONE path that PERSISTS drift auto-disables — it runs in an admin RLS
  // context, so autoDisableExternalModule's UPDATE passes current_actor_is_admin(). The
  // /api/modules provider (apps/api) reconciles in the ACTOR context and never persists.
  server.get(
    "/api/admin/external-modules",
    { schema: listExternalModulesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const ext = dependencies.externalModules;
        const body = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            // Authorize FIRST — a non-admin gets 403 regardless of feature state.
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            if (!ext || !ext.enabled) {
              // Feature off: still admin-gated, just an empty read-only surface.
              return {
                enabled: false,
                modules: [] as readonly ExternalModuleDto[],
                rejected: [] as readonly { id: string; reason: string }[]
              };
            }
            const states = await repository.listExternalModuleStates(scopedDb);
            // reconcile is injected by the composition root (apps/api). It closes over the
            // boot discovery snapshot; `modules` are already ExternalModuleDto-shaped.
            const { modules, driftDisable } = ext.reconcile(states);
            // Persist any drift auto-disables discovered this read (admin context only).
            for (const d of driftDisable) {
              await repository.autoDisableExternalModule(scopedDb, {
                id: d.id,
                reason: d.reason,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
            return {
              enabled: true,
              modules,
              rejected: ext.rejected.map((r) => ({ id: r.id, reason: r.reason }))
            };
          }
        );
        return body;
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // #917: admin enable/disable of a single external module. Enable captures the CURRENT
  // on-disk hashes as the trusted baseline; disable pins it off. 404 if the id is not a
  // current on-disk discovery; 409 if the feature is off.
  server.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/admin/external-modules/:id",
    { schema: setExternalModuleEnablementRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const ext = dependencies.externalModules;
        const enable = request.body.enabled;
        const dto = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            // Authorize FIRST (same non-leak discipline as /api/admin/modules).
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            if (!ext || !ext.enabled) {
              throw new HttpError(409, "External modules are not enabled on this instance");
            }
            const discovery = ext.discoveries.find((d) => d.id === request.params.id);
            if (!discovery) throw new HttpError(404, "External module not found");

            if (enable) {
              await repository.setExternalModuleEnabled(scopedDb, {
                id: discovery.id,
                manifestHash: discovery.manifestHash,
                packageHash: discovery.packageHash,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            } else {
              await repository.setExternalModuleDisabled(scopedDb, {
                id: discovery.id,
                reason: "disabled by admin",
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }

            // Recompute this module's reconciled DTO from fresh state.
            const states = await repository.listExternalModuleStates(scopedDb);
            const { modules } = ext.reconcile(states);
            const updated = modules.find((m) => m.id === discovery.id);
            if (!updated) throw new HttpError(404, "External module not found");
            return updated;
          }
        );
        try {
          await dependencies.reconcileExternalModuleJobs?.({
            kind: "module",
            moduleId: request.params.id
          });
        } catch (error) {
          request.log.warn(
            { moduleId: request.params.id, errorName: (error as Error).name },
            "external module job reconcile signal failed"
          );
        }
        return { module: dto };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get("/api/me/modules", { schema: listMyModulesRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const modules = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await repository.listModuleDenyRowsForActor(scopedDb);
          const instanceDisabled = new Set(
            rows.filter((r) => r.scope === "instance").map((r) => r.module_id)
          );
          const userDisabled = new Set(
            rows
              .filter((r) => r.scope === "user" && r.user_id === accessContext.actorUserId)
              .map((r) => r.module_id)
          );
          return requireManifests().map((m) =>
            toMyModuleDto(m, instanceDisabled.has(m.id), userDisabled.has(m.id))
          );
        }
      );
      return { modules };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch<{ Params: { id: string } }>(
    "/api/me/modules/:id",
    { schema: patchModuleEnablementRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const disabled = parseDisabledBody(request.body);
        const manifest = findManifest(request.params.id);
        if (!manifest) throw new HttpError(404, "Module not found");
        if (disabled && isRequired(manifest)) {
          throw new HttpError(409, "Required modules cannot be disabled");
        }
        if (disabled && !supportsUserDisable(manifest)) {
          throw new HttpError(422, "This module cannot be disabled per-user");
        }
        const dto = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await repository.setUserModuleDisabled(scopedDb, {
              moduleId: manifest.id,
              disabled,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
            return computeMyModuleDto(repository, scopedDb, manifest, accessContext.actorUserId);
          }
        );
        return { module: dto };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseDisabledBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected JSON object body");
  }
  const disabled = (body as Record<string, unknown>).disabled;
  if (typeof disabled !== "boolean") {
    throw new HttpError(400, "disabled must be a boolean");
  }
  return disabled;
}
