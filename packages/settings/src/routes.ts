import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import type {
  AccessContext,
  AdminAuditEvent,
  DataContextDb,
  DataContextRunner,
  InstanceSetting,
  JarvisDatabase,
  User
} from "@jarv1s/db";
import {
  adminDeleteUserRouteSchema,
  adminRejectUserRouteSchema,
  adminRevokeSessionsRouteSchema,
  adminUserActionRouteSchema,
  bootstrapStatusRouteSchema,
  getChatMultiplexerSettingsRouteSchema,
  getRegistrationSettingsRouteSchema,
  listAdminAuditEventsRouteSchema,
  listAdminModulesRouteSchema,
  listAuthProviderStatusesRouteSchema,
  listInstanceSettingsRouteSchema,
  listMyModulesRouteSchema,
  listUsersRouteSchema,
  meRouteSchema,
  patchModuleEnablementRouteSchema,
  patchMeProfileRouteSchema,
  putChatMultiplexerSettingsRouteSchema,
  putRegistrationSettingsRouteSchema,
  upsertInstanceSettingRouteSchema,
  type AdminAuditEventDto,
  type AdminModuleDto,
  type AuthProviderStatusDto,
  type ChatMultiplexerChoice,
  type InstanceSettingDto,
  type MyModuleDto,
  type UpsertInstanceSettingRequest,
  type UserDto
} from "@jarv1s/shared";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";

import type { PgBoss } from "@jarv1s/jobs";

import { deleteUserData, LastActiveAdminError } from "../../../scripts/delete-user-data.js";
import { BootstrapHelper } from "./bootstrap.js";
import { registerDataExportRoutes } from "./data-export-routes.js";
import { registerDataExportAsyncRoutes } from "./data-export-async-routes.js";
import type { HostDiagnosticsProvider } from "./host-diagnostics.js";
import { registerHostDiagnosticsRoutes } from "./host-diagnostics-routes.js";
import { registerLocaleRoutes } from "./locale-routes.js";
import { registerQuietHoursRoutes } from "./quiet-hours-routes.js";
import { registerWeatherLocationRoutes } from "./weather-location-routes.js";
import { registerThemeRoutes } from "./themes-routes.js";
import { registerNotesSourceRoutes, type ReconcileNotesScheduleFn } from "./notes-source-routes.js";
import {
  registerMeAccountRoutes,
  type HasPasswordCredentialPort,
  type VerifySelfPasswordPort
} from "./me-account-routes.js";
import { registerMeSessionsRoutes, type MeSessionsService } from "./me-sessions-routes.js";
import {
  registerOnboardingRoutes,
  type OnboardingInstallDependencies,
  type OnboardingLoginDependencies,
  type OnboardingProbes
} from "./onboarding-routes.js";
import { registerPersonaRoutes } from "./persona-routes.js";
import type { ProfilePreferencesPort, PersonaPreviewInput } from "./preferences-port.js";
import { HttpRepositoryError, SettingsRepository } from "./repository.js";
import { registerSourceBehaviorRoutes } from "./source-behavior-routes.js";
import {
  INSTANCE_SETTINGS_REGISTRY,
  KNOWN_INSTANCE_SETTING_KEYS,
  SECRET_INSTANCE_SETTING_KEYS
} from "./instance-settings-keys.js";

export interface SettingsRoutesDependencies {
  // Kysely exemption: only BootstrapHelper uses rootDb before any actor/session exists.
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders?: () => readonly AuthProviderStatusDto[];
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly preferencesRepository?: ProfilePreferencesPort;
  readonly personaPreview?: (input: PersonaPreviewInput) => Promise<string>;
  readonly repository?: SettingsRepository;
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  /** Auth-owned current-user session list/revoke service (#237). */
  readonly meSessions?: MeSessionsService;
  /**
   * Auth-owned password re-verification for self-service account deletion (#239).
   * Absent in deployments without an auth runtime; the route fails closed for
   * password-bearing accounts when this is unset.
   */
  readonly verifySelfPassword?: VerifySelfPasswordPort;
  /**
   * Auth-owned existence probe (does the actor own a password credential?) for
   * GET /api/me and the self-delete dialog. Required behind an auth port because
   * migration 0045 revoked app_runtime SELECT on auth_accounts.
   */
  readonly hasPasswordCredential?: HasPasswordCredentialPort;
  readonly bootstrapConnectionString?: string;
  /** Boot-time availability snapshot, injected by the composition root (apply-on-restart). */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
  /** Onboarding probes; injected to preserve module isolation and fail closed if absent. */
  readonly onboardingProbes?: OnboardingProbes;
  /**
   * §A.5 install seam (#342 Phase 2): the catalog installability port, the cli-runner
   * `installProvider` RPC client, the admin-actor state store, and the §A.4.2 reconcile
   * port. Injected by the composition root (module isolation — settings never imports
   * @jarv1s/chat / cli-runner). Absent ⇒ the install route fails closed (500) and the
   * status route serves the Phase-1 presence-only surface.
   */
  readonly onboardingInstall?: OnboardingInstallDependencies;
  /**
   * §L.5 login seam (#342 Phase 3): the loginability port, the cli-runner login RPC client, and
   * the admin-actor login state store. Injected by the composition root (module isolation). Absent
   * ⇒ the login routes fail closed (500).
   */
  readonly onboardingLogin?: OnboardingLoginDependencies;
  /** Host diagnostics runtime-facts provider (#255); injected by the composition root. */
  readonly hostDiagnostics?: HostDiagnosticsProvider;
  /** pg-boss instance for enqueueing export.build jobs (#431). */
  readonly boss?: PgBoss;
  /**
   * #449: per-actor 15-min notes-sync heartbeat reconcile hook. Injected by the
   * composition root (lives in @jarv1s/notes; injected here to avoid a circular
   * import). Absent ⇒ no heartbeat (manual sync still works).
   */
  readonly reconcileNotesSchedule?: ReconcileNotesScheduleFn;
}

interface SettingParams {
  readonly key: string;
}

export function registerSettingsRoutes(
  server: FastifyInstance,
  dependencies: SettingsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new SettingsRepository();
  const preferencesRepository: ProfilePreferencesPort = dependencies.preferencesRepository ?? {
    get: async () => null,
    getWithMetadata: async () => null,
    upsert: async () => undefined
  };
  const bootstrapHelper = new BootstrapHelper(dependencies.rootDb);
  registerLocaleRoutes(server, { ...dependencies, preferencesRepository });
  registerQuietHoursRoutes(server, { ...dependencies, preferencesRepository });
  registerWeatherLocationRoutes(server, { ...dependencies, preferencesRepository });
  registerThemeRoutes(server, { ...dependencies, preferencesRepository });
  registerNotesSourceRoutes(server, { ...dependencies, preferencesRepository });
  registerMeSessionsRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    meSessions: dependencies.meSessions
  });
  registerMeAccountRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    dataContext: dependencies.dataContext,
    repository,
    bootstrapConnectionString: dependencies.bootstrapConnectionString,
    verifySelfPassword: dependencies.verifySelfPassword,
    hasPasswordCredential: dependencies.hasPasswordCredential
  });
  registerPersonaRoutes(server, { ...dependencies, repository, preferencesRepository });
  registerSourceBehaviorRoutes(server, { ...dependencies, preferencesRepository });
  registerDataExportRoutes(server, {
    dataContext: dependencies.dataContext,
    resolveAccessContext: dependencies.resolveAccessContext,
    rootDb: dependencies.rootDb
  });
  if (dependencies.boss) {
    registerDataExportAsyncRoutes(server, {
      boss: dependencies.boss,
      dataContext: dependencies.dataContext,
      resolveAccessContext: dependencies.resolveAccessContext
    });
  }
  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    // Return only the boolean the client needs. User count and owner identity are
    // instance-wide data exposed on an UNAUTHENTICATED route — do not leak them
    // (OTNR-P4 #122).
    const ownerExists = await bootstrapHelper.bootstrapOwnerExists();

    return {
      needsBootstrap: !ownerExists
    };
  });

  server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { user, addressed } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => ({
          user: await requireKnownUser(repository, scopedDb, accessContext.actorUserId),
          addressed: await preferencesRepository.get(scopedDb, "profile.addressed")
        })
      );
      // Existence-only probe runs on the auth pool (app_runtime can't read
      // auth_accounts — migration 0045). Fall back to false when no auth runtime.
      const hasPasswordCredential = dependencies.hasPasswordCredential
        ? await dependencies.hasPasswordCredential(accessContext.actorUserId)
        : false;

      return {
        user: serializeUser(user),
        profilePrefs: { addressed: typeof addressed === "string" ? addressed : null },
        hasPasswordCredential
      };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch("/api/me/profile", { schema: patchMeProfileRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as { name: string; addressed: string };
      const name = body.name.trim();
      const addressed = body.addressed.trim();
      if (name.length === 0) throw new HttpError(400, "Display name is required");
      const user = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const updated = await repository.updateSelfName(scopedDb, {
            actorUserId: accessContext.actorUserId,
            name
          });
          await preferencesRepository.upsert(scopedDb, "profile.addressed", addressed);
          return updated;
        }
      );
      return { user: serializeUser(user), profilePrefs: { addressed } };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/admin/auth/providers",
    { schema: listAuthProviderStatusesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          assertAdminUser(repository, scopedDb, accessContext.actorUserId)
        );

        return {
          providers: dependencies.listConfiguredAuthProviders?.() ?? []
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get("/api/admin/users", { schema: listUsersRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const users = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.listUsers(scopedDb);
        }
      );

      return { users: users.map(serializeUser) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/admin/settings",
    { schema: listInstanceSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.listInstanceSettings(scopedDb);
          }
        );

        const registeredKeys = new Set(
          INSTANCE_SETTINGS_REGISTRY.filter((e) => !e.secret).map((e) => e.key)
        );
        return {
          settings: settings.filter((s) => registeredKeys.has(s.key)).map(serializeInstanceSetting)
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: SettingParams }>(
    "/api/admin/settings/:key",
    { schema: upsertInstanceSettingRouteSchema },
    async (request, reply) => {
      try {
        if (!KNOWN_INSTANCE_SETTING_KEYS.has(request.params.key)) {
          return reply.status(400).send({ error: "Unknown settings key" });
        }
        // Secret keys (e.g. the Brave Search API key) are write-only through their dedicated
        // encrypted routes — reject them here so a plaintext value can never be stored via the
        // generic jsonb upsert path.
        if (SECRET_INSTANCE_SETTING_KEYS.has(request.params.key)) {
          return reply.status(400).send({ error: "This setting is managed via a dedicated route" });
        }
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseInstanceSettingBody(request.body);
        const setting = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.upsertInstanceSetting(scopedDb, {
              key: request.params.key,
              value: body.value,
              updatedByUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
        );

        return { setting: serializeInstanceSetting(setting) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/admin/users/:id/approve",
    { schema: adminUserActionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const user = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            const existing = await repository.getUserById(scopedDb, id);
            if (!existing) throw new HttpError(404, "User not found");
            if (existing.status !== "pending")
              throw new HttpError(409, "Only pending accounts can be approved");
            return repository.setUserStatus(scopedDb, {
              targetUserId: id,
              status: "active",
              action: "user.approve",
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
        );
        return { user: serializeUser(user) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const lifecycleAction = (verb: string, status: "active" | "deactivated", action: string) =>
    server.post(
      `/api/admin/users/:id/${verb}`,
      { schema: adminUserActionRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const { id } = request.params as { id: string };
          const user = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              return repository.setUserStatus(scopedDb, {
                targetUserId: id,
                status,
                action,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
          );
          if (verb === "deactivate" && dependencies.revokeUserSessions) {
            await dependencies.revokeUserSessions(id);
          }
          return { user: serializeUser(user) };
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  lifecycleAction("reactivate", "active", "user.reactivate");
  lifecycleAction("deactivate", "deactivated", "user.deactivate");

  server.post(
    "/api/admin/users/:id/revoke-sessions",
    { schema: adminRevokeSessionsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        // Admin check + target existence check share ONE transaction (post-D pattern).
        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          const target = await repository.getUserById(scopedDb, id);
          if (!target) throw new HttpError(404, "User not found");
        });
        // revokeUserSessions runs on the auth pool (DELETE ... WHERE user_id = id) — outside
        // the data context. It targets the named user's sessions only, never the calling
        // admin's. The response carries the deleted-row count and nothing from the session row.
        const count = dependencies.revokeUserSessions
          ? await dependencies.revokeUserSessions(id)
          : 0;
        return { success: true, count };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const adminFlagAction = (verb: "promote" | "demote", isInstanceAdmin: boolean) =>
    server.post(
      `/api/admin/users/:id/${verb}`,
      { schema: adminUserActionRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const { id } = request.params as { id: string };
          const user = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              return repository.setUserAdmin(scopedDb, {
                targetUserId: id,
                isInstanceAdmin,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
          );
          return { user: serializeUser(user) };
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  adminFlagAction("promote", true);
  adminFlagAction("demote", false);

  async function tearDownAccount(
    request: FastifyRequest,
    id: string,
    requirePending: boolean
  ): Promise<string> {
    const accessContext = await dependencies.resolveAccessContext(request);
    await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
      // Guard order preserved from the original routes.ts (404 → pending-409 → self-422
      // → bootstrap-409 → last-admin-409). Do not reorder.
      await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
      const existing = await repository.getUserById(scopedDb, id);
      if (!existing) throw new HttpError(404, "User not found");
      if (requirePending && existing.status !== "pending") {
        throw new HttpError(409, "Only pending accounts can be rejected");
      }
      if (id === accessContext.actorUserId)
        throw new HttpError(422, "You cannot delete your own account");
      if (existing.is_bootstrap_owner)
        throw new HttpError(409, "The bootstrap owner cannot be deleted");
      if (existing.is_instance_admin) await repository.assertNotLastActiveAdmin(scopedDb, id);
    });
    // The pre-check above is a fast-path 409 for the common case; it commits and
    // releases its advisory lock before deleteUserData runs. deleteUserData
    // re-asserts the last-admin guard under the same lock inside its own
    // transaction, so it is the authoritative serialized check. Map its typed
    // failure back to a 409 if a concurrent removal won the race (#94).
    try {
      await deleteUserData({
        userId: id,
        confirmUserId: id,
        actorUserId: accessContext.actorUserId,
        requestId: requireRequestId(accessContext),
        bootstrapConnectionString: dependencies.bootstrapConnectionString,
        dryRun: false
      });
    } catch (error) {
      if (error instanceof LastActiveAdminError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
    return id;
  }

  server.post(
    "/api/admin/users/:id/reject",
    { schema: adminRejectUserRouteSchema },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const rejectedUserId = await tearDownAccount(request, id, true);
        return { rejectedUserId };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/admin/users/:id",
    { schema: adminDeleteUserRouteSchema },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const deletedUserId = await tearDownAccount(request, id, false);
        return { deletedUserId };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/registration",
    { schema: getRegistrationSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.getRegistrationSettings(scopedDb);
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/admin/registration",
    { schema: putRegistrationSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as { registrationEnabled: boolean; requiresApproval: boolean };
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.setRegistrationSettings(scopedDb, {
            registrationEnabled: body.registrationEnabled,
            requiresApproval: body.requiresApproval,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/chat-multiplexer",
    { schema: getChatMultiplexerSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          const { multiplexer } = await repository.getChatMultiplexerSetting(scopedDb);
          return {
            multiplexer,
            available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false }
          };
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/admin/chat-multiplexer",
    { schema: putChatMultiplexerSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as { multiplexer: ChatMultiplexerChoice };
        return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          const { multiplexer } = await repository.setChatMultiplexerSetting(scopedDb, {
            multiplexer: body.multiplexer,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
          return {
            multiplexer,
            available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false }
          };
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/admin/audit-events",
    { schema: listAdminAuditEventsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const auditEvents = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.listAdminAuditEvents(scopedDb);
          }
        );

        return { auditEvents: auditEvents.map(serializeAdminAuditEvent) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  registerOnboardingRoutes(server, {
    dataContext: dependencies.dataContext,
    resolveAccessContext: dependencies.resolveAccessContext,
    onboardingProbes: dependencies.onboardingProbes,
    onboardingInstall: dependencies.onboardingInstall,
    onboardingLogin: dependencies.onboardingLogin,
    repository,
    requireKnownUser: (scopedDb, userId) => requireKnownUser(repository, scopedDb, userId),
    assertBootstrapOwnerAdminUser: (scopedDb, userId) =>
      assertBootstrapOwnerAdminUser(repository, scopedDb, userId),
    requireRequestId,
    handleRouteError
  });

  registerHostDiagnosticsRoutes(server, {
    dataContext: dependencies.dataContext,
    resolveAccessContext: dependencies.resolveAccessContext,
    repository,
    chatMultiplexerAvailability: dependencies.chatMultiplexerAvailability,
    hostDiagnostics: dependencies.hostDiagnostics,
    assertAdminUser: (scopedDb, userId) => assertAdminUser(repository, scopedDb, userId),
    handleRouteError
  });

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

// The admin check happens INSIDE the route's withDataContext so the admin check and the
// actual operation share one transaction. assertAdminUser/requireKnownUser take scopedDb
// from that transaction — there is no nested withDataContext and no DB-holding helper.
export async function assertAdminUser(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<User> {
  const user = await requireKnownUser(repository, scopedDb, userId);
  if (!user.is_instance_admin) {
    throw new HttpError(403, "Instance admin permission is required");
  }
  return user;
}

// Onboarding is founder/instance provisioning and writes the SINGLE instance-scoped
// onboarding.state row, so it must be gated to the bootstrap owner — not merely any
// instance admin. A promoted non-owner admin must NOT be able to read the owner's
// onboarding status or complete/skip it out from under them (defense-in-depth at the
// route, not only at the app.tsx trigger). Requires is_instance_admin AND
// is_bootstrap_owner; same clean 403 as assertAdminUser for any other caller.
async function assertBootstrapOwnerAdminUser(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<User> {
  const user = await assertAdminUser(repository, scopedDb, userId);
  if (!user.is_bootstrap_owner) {
    throw new HttpError(403, "Bootstrap owner permission is required");
  }
  return user;
}

async function requireKnownUser(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<User> {
  const user = await repository.getUserById(scopedDb, userId);

  if (!user) {
    throw new HttpError(401, "Session is missing or expired");
  }

  return user;
}

function requireRequestId(accessContext: AccessContext): string {
  if (!accessContext.requestId) {
    throw new HttpError(500, "Request id is missing");
  }

  return accessContext.requestId;
}

function parseInstanceSettingBody(body: unknown): UpsertInstanceSettingRequest {
  const value = requireObject(body);
  const settingValue = value.value;

  if (!settingValue || typeof settingValue !== "object" || Array.isArray(settingValue)) {
    throw new HttpError(400, "value must be a JSON object");
  }

  return {
    value: settingValue as Record<string, unknown>
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
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

function toMyModuleDto(
  manifest: JarvisModuleManifest,
  instanceDisabled: boolean,
  userDisabled: boolean
): MyModuleDto {
  const required = manifest.availability?.required === true;
  const userDisableSupported = manifest.availability?.supportsUserDisable !== false;
  // Mirror the resolver's rule exactly so the UI and gateway never disagree.
  const active = required
    ? true
    : instanceDisabled
      ? false
      : userDisableSupported && userDisabled
        ? false
        : true;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    lifecycle: manifest.lifecycle,
    required,
    supportsUserDisable: userDisableSupported,
    instanceDisabled,
    userDisabled,
    active
  };
}

async function computeMyModuleDto(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  manifest: JarvisModuleManifest,
  actorUserId: string
): Promise<MyModuleDto> {
  const rows = await repository.listModuleDenyRowsForActor(scopedDb);
  const instanceDisabled = rows.some((r) => r.scope === "instance" && r.module_id === manifest.id);
  const userDisabled = rows.some(
    (r) => r.scope === "user" && r.module_id === manifest.id && r.user_id === actorUserId
  );
  return toMyModuleDto(manifest, instanceDisabled, userDisabled);
}

function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified,
    name: user.name,
    isInstanceAdmin: user.is_instance_admin,
    status: user.status,
    isBootstrapOwner: user.is_bootstrap_owner,
    createdAt: serializeDate(user.created_at),
    updatedAt: serializeDate(user.updated_at)
  };
}

function serializeInstanceSetting(setting: InstanceSetting): InstanceSettingDto {
  return {
    key: setting.key,
    value: setting.value,
    updatedByUserId: setting.updated_by_user_id,
    createdAt: serializeDate(setting.created_at),
    updatedAt: serializeDate(setting.updated_at)
  };
}

function serializeAdminAuditEvent(event: AdminAuditEvent): AdminAuditEventDto {
  return {
    id: event.id,
    actorUserId: event.actor_user_id,
    action: event.action,
    targetType: event.target_type,
    targetId: event.target_id,
    metadata: event.metadata,
    requestId: event.request_id,
    createdAt: serializeDate(event.created_at)
  };
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    mappers: [
      (e, r) =>
        e instanceof HttpRepositoryError
          ? r.code(e.statusCode).send({ error: e.message })
          : undefined,
      (e, r) => {
        if (e instanceof Error) {
          const code = (e as Error & { code?: string }).code;
          if (code === "account_pending_approval" || code === "account_deactivated") {
            return r.code(403).send({ error: e.message, code });
          }
        }
        return undefined;
      }
    ]
  });
}
