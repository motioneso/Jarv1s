import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import {
  getOnboardingStatusRouteSchema,
  onboardingCompleteRouteSchema,
  onboardingProviderCheckRouteSchema,
  onboardingSkipRouteSchema,
  type OnboardingProviderCheckRequest,
  type OnboardingProviderCheckResponse,
  type OnboardingProviderKind
} from "@jarv1s/shared";

import type { SettingsRepository } from "./repository.js";

export interface OnboardingProbes {
  /** Bounded live probe; herdr accounts for the root-pane requirement. */
  readonly multiplexerUsable: (kind: "tmux" | "herdr") => Promise<boolean>;
  /** Provider CLI presence (presence-only). Bounded live probe. */
  readonly cliPresent: (kind: OnboardingProviderKind) => Promise<boolean>;
  /** Explicit provider auth/connection check. Bounded live probe; never run by status. */
  readonly testProviderConnection: (
    kind: OnboardingProviderKind
  ) => Promise<OnboardingProviderCheckResponse>;
  /** Connector-account existence — a scoped read (needs the request's RLS scope). */
  readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
}

export interface OnboardingRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly onboardingProbes?: OnboardingProbes;
  readonly repository: SettingsRepository;
  readonly requireKnownUser: (scopedDb: DataContextDb, userId: string) => Promise<User>;
  readonly assertBootstrapOwnerAdminUser: (
    scopedDb: DataContextDb,
    userId: string
  ) => Promise<User>;
  readonly requireRequestId: (accessContext: AccessContext) => string;
  readonly handleRouteError: (error: unknown, reply: FastifyReply) => unknown;
}

export function registerOnboardingRoutes(
  server: FastifyInstance,
  dependencies: OnboardingRoutesDependencies
): void {
  const repository = dependencies.repository;

  server.get(
    "/api/onboarding/status",
    { schema: getOnboardingStatusRouteSchema },
    async (request, reply) => {
      try {
        const probes = dependencies.onboardingProbes;
        if (!probes) {
          request.log.error("onboarding routes mounted without onboardingProbes — failing closed");
          throw new HttpError(500, "onboarding probes not configured");
        }
        const accessContext = await dependencies.resolveAccessContext(request);

        const memberStatus = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const user = await dependencies.requireKnownUser(scopedDb, accessContext.actorUserId);
            if (user.is_bootstrap_owner) {
              return null;
            }
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

        const dbPart = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await dependencies.assertBootstrapOwnerAdminUser(scopedDb, accessContext.actorUserId);
            const [state, selected, connectorAccountExists] = await Promise.all([
              repository.readOnboardingState(scopedDb),
              repository.readChatMultiplexerChoiceOrNull(scopedDb),
              probes.connectorAccountExists(scopedDb)
            ]);
            return { state, selected, connectorAccountExists };
          }
        );

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
          availability: { tmuxUsable, herdrUsable },
          cliPresentByKind: { anthropic, "openai-compatible": openaiCompatible, google },
          connectorAccountExists: dbPart.connectorAccountExists
        });
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/onboarding/provider-check",
    { schema: onboardingProviderCheckRouteSchema },
    async (request, reply) => {
      try {
        const probes = dependencies.onboardingProbes;
        if (!probes) {
          request.log.error("onboarding provider-check route mounted without onboardingProbes");
          throw new HttpError(500, "onboarding probes not configured");
        }

        const body = parseOnboardingProviderCheckBody(request.body);
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await dependencies.assertBootstrapOwnerAdminUser(scopedDb, accessContext.actorUserId);
        });

        return await probes.testProviderConnection(body.providerKind);
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
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
              const user = await dependencies.requireKnownUser(scopedDb, accessContext.actorUserId);
              if (user.is_bootstrap_owner) {
                await dependencies.assertBootstrapOwnerAdminUser(
                  scopedDb,
                  accessContext.actorUserId
                );
                const newState = await repository.setOnboardingState(scopedDb, {
                  state,
                  actorUserId: accessContext.actorUserId,
                  requestId: dependencies.requireRequestId(accessContext)
                });
                return { state: newState };
              }
              const memberState = await repository.setMemberOnboardingComplete(scopedDb, {
                actorUserId: accessContext.actorUserId,
                requestId: dependencies.requireRequestId(accessContext)
              });
              return { completed: memberState.completedAt !== null };
            }
          );
          return result;
        } catch (error) {
          return dependencies.handleRouteError(error, reply);
        }
      }
    );

  onboardingStateAction("complete", "completed");
  onboardingStateAction("skip", "skipped");
}

function parseOnboardingProviderCheckBody(body: unknown): OnboardingProviderCheckRequest {
  const value = requireObject(body);
  const providerKind = value.providerKind;
  if (
    providerKind !== "anthropic" &&
    providerKind !== "openai-compatible" &&
    providerKind !== "google"
  ) {
    throw new HttpError(400, "providerKind must be anthropic, openai-compatible, or google");
  }
  return { providerKind };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}
