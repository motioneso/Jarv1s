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
  getOnboardingStatusRouteSchema,
  getRegistrationSettingsRouteSchema,
  listAdminAuditEventsRouteSchema,
  listAdminModulesRouteSchema,
  listAuthProviderStatusesRouteSchema,
  listInstanceSettingsRouteSchema,
  listMyModulesRouteSchema,
  listUsersRouteSchema,
  meRouteSchema,
  onboardingCompleteRouteSchema,
  onboardingSkipRouteSchema,
  patchModuleEnablementRouteSchema,
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

import { deleteUserData, LastActiveAdminError } from "../../../scripts/delete-user-data.js";
import { BootstrapHelper } from "./bootstrap.js";
import { HttpRepositoryError, SettingsRepository } from "./repository.js";

export interface SettingsRoutesDependencies {
  // Documented Kysely< exemption: rootDb exists ONLY to construct BootstrapHelper
  // (countUsers — runs before any session/actor exists, so withDataContext cannot be used).
  // See the SOLE-exemption comment in packages/settings/src/bootstrap.ts.
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders?: () => readonly AuthProviderStatusDto[];
  readonly listModuleManifests?: () => readonly JarvisModuleManifest[];
  readonly repository?: SettingsRepository;
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  readonly bootstrapConnectionString?: string;
  /** Boot-time availability snapshot, injected by the composition root (apply-on-restart). */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
  /**
   * Onboarding probes (Phase 2). Injected so packages/settings keeps no @jarv1s/ai /
   * @jarv1s/connectors PACKAGE dependency (module isolation); wired in packages/module-registry.
   * REQUIRED on any server that mounts the onboarding routes — when absent the routes fail
   * closed (500 + logged) rather than silently reporting all-not-done (Codex R1 masking finding).
   * Each function below is BOUNDED (timeout → false) and called OUTSIDE the DB transaction.
   */
  readonly onboardingProbes?: {
    /** Multiplexer usability (herdr accounts for the root-pane requirement). Bounded live probe. */
    readonly multiplexerUsable: (kind: "tmux" | "herdr") => Promise<boolean>;
    /** Provider CLI presence (presence-only). Bounded live probe. */
    readonly cliPresent: (kind: "anthropic" | "openai-compatible" | "google") => Promise<boolean>;
    /** Connector-account existence — a scoped read (needs the request's RLS scope). */
    readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
  };
}

interface SettingParams {
  readonly key: string;
}

export function registerSettingsRoutes(
  server: FastifyInstance,
  dependencies: SettingsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new SettingsRepository();
  const bootstrapHelper = new BootstrapHelper(dependencies.rootDb);

  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    // Return only the boolean the client needs. The raw user count is an instance-wide
    // metric exposed on an UNAUTHENTICATED route — do not leak it (OTNR-P4 #122).
    const userCount = await bootstrapHelper.countUsers();

    return {
      needsBootstrap: userCount === 0
    };
  });

  server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const user = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        requireKnownUser(repository, scopedDb, accessContext.actorUserId)
      );

      return {
        user: serializeUser(user)
      };
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

        return { settings: settings.map(serializeInstanceSetting) };
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

  server.get(
    "/api/onboarding/status",
    { schema: getOnboardingStatusRouteSchema },
    async (request, reply) => {
      try {
        const probes = dependencies.onboardingProbes;
        if (!probes) {
          request.log.error("onboarding routes mounted without onboardingProbes — failing closed");
          // Fail CLOSED (500) rather than silently reporting all-not-done (Codex R1 masking).
          // Throw so the shared error handler maps it — the typed per-route reply only
          // declares 200/401/403, and a misconfiguration is a generic internal error.
          throw new HttpError(500, "onboarding probes not configured");
        }
        const accessContext = await dependencies.resolveAccessContext(request);

        // Phase 4: status is no longer founder-only. We relax the gate to requireKnownUser
        // (any active authenticated user — pending/deactivated never reach here, as
        // resolveAccessContext throws first) and branch on the SERVER-READ is_bootstrap_owner.
        // A member must read its OWN per-user onboarding status; role is taken from the
        // server-side user row, never from the client.
        //
        // The member branch is cheap (one self-row read of app.member_onboarding) and does
        // NOT run the founder's host probes, so we resolve the role first and only run the
        // expensive probe path for the founder.
        const memberStatus = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const user = await requireKnownUser(repository, scopedDb, accessContext.actorUserId);
            if (user.is_bootstrap_owner) {
              return null; // founder — fall through to the instance-global probe path below.
            }
            // Member branch — per-user completion from the member's OWN row (GUC-scoped;
            // no id argument — RLS + the GUC pick the row). apiKeyOptOut.done +
            // connectors.done are DERIVED CLIENT-SIDE (module isolation); the server returns
            // neutral false defaults here.
            const state = await repository.getMemberOnboardingState(scopedDb);
            return {
              role: "member" as const,
              completed: state.completedAt !== null,
              steps: {
                apiKeyOptOut: { done: false },
                connectors: { done: false }
              }
            };
          }
        );
        if (memberStatus) {
          return memberStatus;
        }

        // Founder branch — unchanged Phase-2 instance-global shape. DB reads + bootstrap-owner
        // admin check + connector-exists share ONE transaction (slice-D). The owner admin
        // check stays as defense-in-depth: only the bootstrap owner ever reaches this path.
        const dbPart = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertBootstrapOwnerAdminUser(repository, scopedDb, accessContext.actorUserId);
            const [state, selected, connectorAccountExists] = await Promise.all([
              repository.readOnboardingState(scopedDb),
              repository.readChatMultiplexerChoiceOrNull(scopedDb),
              probes.connectorAccountExists(scopedDb)
            ]);
            return { state, selected, connectorAccountExists };
          }
        );

        // Bounded host probes OUTSIDE the transaction (each is timeout-capped → false in
        // the injected impl, so this Promise.all resolves quickly even on a slow host).
        const [tmuxUsable, herdrUsable, anthropic, openaiCompatible, google] = await Promise.all([
          probes.multiplexerUsable("tmux"),
          probes.multiplexerUsable("herdr"),
          probes.cliPresent("anthropic"),
          probes.cliPresent("openai-compatible"),
          probes.cliPresent("google")
        ]);

        return repository.assembleOnboardingStatus({
          state: dbPart.state,
          selected: dbPart.selected,
          availability: { tmuxUsable, herdrUsable }, // herdrUsable is root-pane-aware (Task 6)
          cliPresentByKind: { anthropic, "openai-compatible": openaiCompatible, google },
          connectorAccountExists: dbPart.connectorAccountExists
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  const onboardingStateAction = (verb: "complete" | "skip", state: "completed" | "skipped") =>
    server.post(
      `/api/onboarding/${verb}`,
      { schema: verb === "complete" ? onboardingCompleteRouteSchema : onboardingSkipRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const result = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              const user = await requireKnownUser(repository, scopedDb, accessContext.actorUserId);
              if (user.is_bootstrap_owner) {
                // Founder: unchanged Phase-2 instance-global lifecycle (bootstrap-owner
                // admin-gated). Returns the { state } shape.
                await assertBootstrapOwnerAdminUser(
                  repository,
                  scopedDb,
                  accessContext.actorUserId
                );
                const newState = await repository.setOnboardingState(scopedDb, {
                  state,
                  actorUserId: accessContext.actorUserId,
                  requestId: requireRequestId(accessContext)
                });
                return { state: newState };
              }
              // Member: both complete AND skip stamp the same terminal "onboarded" row on the
              // member's OWN app.member_onboarding row (skip == complete for members — no
              // separate skipped lifecycle). GUC-scoped UPSERT (no caller-supplied target id);
              // the self-row INSERT/UPDATE policies authorize only user_id = current actor.
              // Returns the { completed } shape.
              const memberState = await repository.setMemberOnboardingComplete(scopedDb, {
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
              return { completed: memberState.completedAt !== null };
            }
          );
          return result;
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  onboardingStateAction("complete", "completed");
  onboardingStateAction("skip", "skipped");

  function requireManifests(): readonly JarvisModuleManifest[] {
    return dependencies.listModuleManifests?.() ?? [];
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
async function assertAdminUser(
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
