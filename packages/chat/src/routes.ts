import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractTimezone } from "./locale-utils.js";
import { sql, type Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import type {
  AccessContext,
  ChatMessage,
  ChatThread,
  DataContextDb,
  DataContextRunner,
  JarvisDatabase,
  PreferencesPort
} from "@jarv1s/db";
import {
  AI_MODEL_CAPABILITIES,
  CHAT_SETTINGS_PREFERENCE_KEY,
  getChatSettingsRouteSchema,
  listChatThreadMessagesRouteSchema,
  listChatThreadsRouteSchema,
  listMemoryCorrectionsRouteSchema,
  normalizeChatSettings,
  putChatSettingsRouteSchema,
  type AiModelCapability,
  type AnswerSourceSupportCard,
  type ChatActivityEventDto,
  type ChatMessageDto,
  type ChatSelectedToolMetadataDto,
  type ChatThreadDto,
  type FreshnessKind,
  type PutChatSettingsRequest,
  type SourceFreshnessEntry,
  type SourceFreshnessV1
} from "@jarv1s/shared";
import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type ActiveModulesResolver,
  type AssistantToolGatewayDependencies,
  type GatewaySessionRecord,
  type ProviderKind,
  type SessionNotifier
} from "@jarv1s/ai";
import { CalendarRepository, sendCalendarCacheEvictJob } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { getConnectorSyncAt, type ConnectorSecretCipher } from "@jarv1s/connectors";
import type {
  ConnectorsRepository,
  FeatureGrantService,
  GoogleApiClient,
  GoogleConnectionService,
  SourceContextService
} from "@jarv1s/connectors";
import { sendJob } from "@jarv1s/jobs";
import {
  ChatMemoryFactsRepository,
  ChatMemorySuppressionsRepository,
  createMemoryFactSignature
} from "@jarv1s/memory";
import { handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  NOTES_SYNC_QUEUE,
  type NotesSyncJobPayload,
  type NotesSyncToolService
} from "@jarv1s/notes";
import { TasksCompatibilityHelper } from "@jarv1s/tasks";

const YOLO_INSTANCE_SETTING_KEY = "yolo.instance_enabled";
const YOLO_ALLOWED_PREF_KEY = "yolo.allowed";
const YOLO_ENABLED_PREF_KEY = "yolo.enabled";

import { buildCalendarWriteService } from "./calendar-write-impl.js";
import { buildEmailWriteService } from "./email-write-impl.js";
import { ChatGatewayNotifier } from "./gateway-notifier.js";
import { registerChatLiveRoutes, type EveningInterviewSeed } from "./live-routes.js";
import { CliChatUnavailableError } from "./live/errors.js";
import { createCurrentViewReadService, type CurrentViewReadService } from "./live/current-view.js";
import { PageContextStore } from "./live/page-context-store.js";
import type { PassiveMemoryGraphRecallPort } from "./live/passive-retrieval.js";
import { createChatSessionRuntime, type ChatEngineFactory } from "./live/runtime.js";
import type {
  CreateChatSessionRuntimeDeps,
  PersonaPreferencesPort,
  RpcConnection
} from "./live/runtime.js";
import { ChatUserMemorySettingsRepository } from "./memory-settings-repository.js";
import {
  parsePagination,
  parseSettingsPatch,
  serializeCorrection,
  serializeFact,
  serializeSettings,
  toIsoString
} from "./memory-serializers.js";
import { readStoredProvenance, provenanceCards } from "./live/answer-provenance.js";
import { registerMcpTransportRoute, registerNativePermissionRoute } from "./mcp-transport.js";
import { VaultContextRunner, getVaultBaseDir } from "@jarv1s/vault";

import { registerChatAttachmentRoutes } from "./attachments-routes.js";
import { ChatAttachmentsService } from "./attachments-service.js";
import { ChatRepository } from "./repository.js";
import { registerChatSkillsRoutes } from "./skills/routes.js";
import { ChatSkillsRepository } from "./skills/repository.js";
import type { AppMapReadService } from "@jarv1s/settings";

const STALE_ACTION_GRACE_MS = 5 * 60_000;

export interface ChatRoutesDependencies {
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: ChatRepository;
  readonly skillsRepository?: ChatSkillsRepository;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
  readonly resolveActiveModules?: ActiveModulesResolver;
  readonly mcpServerUrl?: string;
  /** #1133 — override the attachment store (tests use a tmpdir vault base). */
  readonly attachmentsService?: ChatAttachmentsService;
  /** pg-boss for enqueueing embed/extract-facts jobs after each completed turn. */
  readonly boss?: PgBoss;
  readonly passiveMemoryRecall?: PassiveMemoryGraphRecallPort;
  readonly personaPreferences?: PersonaPreferencesPort;
  readonly chatPreferences?: PreferencesPort;
  readonly localePreferences?: PreferencesPort;
  readonly agencyPreferences?: PreferencesPort;
  /** Priority preferences port — forwarded to the chat runtime for cross-tool context ranking (#721). */
  readonly priorityPreferences?: PreferencesPort;
  /** Connector collaborators for the calendar focus-time write tool (composition host). */
  readonly googleConnectionService?: GoogleConnectionService;
  readonly googleApiClient?: GoogleApiClient;
  readonly connectorsRepository?: ConnectorsRepository;
  /** Injected by the composition root; gates email/calendar read tools to accounts with active grants. */
  readonly featureGrantService?: FeatureGrantService;
  /** Injected by the composition root; live-first email/calendar reads for the read tools (#729). */
  readonly sourceContextService?: SourceContextService;
  /** Injected by the composition root; app-map read tool (#1110). Never bucket under collaborators. */
  readonly appMapService?: AppMapReadService;
  /**
   * #342 (§3.5 boot-time fork) — when no explicit {@link chatEngineFactory} is supplied, hand this to
   * {@link createChatSessionRuntime} so the runtime selects the engine factory itself: the RPC client
   * over the cli-runner socket when `JARVIS_CLI_RUNNER_SOCKET` is set (else the in-process engine). The
   * runtime then owns the §5.3 reconciliation hook (which needs the manager) and the §5.5 idle reaper.
   * Forwarded by `registerBuiltInApiRoutes` only on the socket path; the host-dev path keeps passing a
   * resolved {@link chatEngineFactory} (admin `chat.multiplexer` setting + auto-detect) instead.
   */
  readonly engineSelection?: CreateChatSessionRuntimeDeps["engineSelection"];
  /**
   * #342 (§3.4) — composition seam: after the runtime builds its ONE RPC connection (socket path), the
   * chat routes publish it back to `registerBuiltInApiRoutes` so a single socket serves both chat and
   * the onboarding probes (§4.8) and gets the connect-on-boot / close-on-shutdown lifecycle. No-op on
   * the in-process path (the runtime exposes no connection).
   */
  readonly adoptChatRpcConnection?: (connection: RpcConnection) => void;
  /**
   * #1081 H2 — same late-bound "adopt" seam as {@link adoptChatRpcConnection}, but for the
   * chat session manager itself (built inside this function, AFTER the composition root
   * assembles the onboarding-install seam). Publishes `ChatSessionManager.dropSessionsForProvider`
   * back to `registerBuiltInApiRoutes`, which forwards a lazy-dereferencing wrapper into
   * `buildOnboardingInstall`'s `dropSessionsForProvider` dependency — so a binary-changing
   * reinstall (`/api/onboarding/provider-install`) can drop that provider's live sessions.
   * Unconditional (unlike the RPC connection, `runtime.manager` always exists).
   */
  readonly adoptDropSessionsForProvider?: (
    dropSessionsForProvider: (provider: ProviderKind) => Promise<void>
  ) => void;
  readonly resolveEveningInterviewSeed?: (
    actorUserId: string,
    briefingRunId?: string
  ) => Promise<EveningInterviewSeed>;
}

/**
 * Chat HTTP routes. The live drawer is the only chat surface: the in-process CLI
 * runtime (turn/clear/switch/stream) plus a read-only thread list for the drawer's
 * History. The legacy worker-backed thread/message CRUD was removed in the
 * retire-legacy-chat-model change.
 *
 * Phase 2: when resolveActiveModules + mcpServerUrl are supplied, also wires the
 * AssistantToolGateway (MCP transport + approve/deny endpoint).
 */
export function registerChatRoutes(
  server: FastifyInstance,
  dependencies: ChatRoutesDependencies
): void {
  // #1109 — one store for the process; shared by the PUT route below and Task 4's
  // chat.getCurrentView tool so both read/write the same actor-keyed views.
  const pageContextStore = new PageContextStore({ now: () => Date.now(), ttlMs: 300_000 });
  // #1109 Task 4 — only wired when the #1110 app-map service is available; that's the
  // sole source of the build-stamp facts the tool must report.
  const currentViewService: CurrentViewReadService | undefined = dependencies.appMapService
    ? createCurrentViewReadService({
        store: pageContextStore,
        getModelCapabilities: async (scopedDb) => {
          const model = await new AiRepository().selectChatModelForUser(scopedDb);
          return (model?.capabilities ?? []).filter((c): c is AiModelCapability =>
            AI_MODEL_CAPABILITIES.includes(c as AiModelCapability)
          );
        },
        getBuildInfo: () => dependencies.appMapService!.getBuildInfo()
      })
    : undefined;

  const repository = dependencies.repository ?? new ChatRepository();
  const skillsRepository = dependencies.skillsRepository ?? new ChatSkillsRepository();
  // #1133 — attachment bytes live in the actor's vault, so the service needs only the
  // vault base dir; shared by the upload route, turn wiring, and chat.readAttachment.
  const attachmentsService =
    dependencies.attachmentsService ??
    new ChatAttachmentsService(new VaultContextRunner(getVaultBaseDir()));
  registerChatAttachmentRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    attachmentsService
  });
  const chatSettingsRepo = new PreferencesRepository();
  const memorySettingsRepo = new ChatUserMemorySettingsRepository();
  const factsRepo = new ChatMemoryFactsRepository();
  const suppressionsRepo = new ChatMemorySuppressionsRepository();

  // Phase 2: proxy notifier — created before gateway so the gateway has a notifier
  // reference; real target is set after the manager is created.
  const notifierProxy: SessionNotifier = {
    emit(chatSessionId: string, record: GatewaySessionRecord) {
      realNotifier?.emit(chatSessionId, record);
    }
  };
  let realNotifier: ChatGatewayNotifier | null = null;

  const resolveActiveModules = dependencies.resolveActiveModules;
  const mcpServerUrl = dependencies.mcpServerUrl;
  const wiring =
    resolveActiveModules && mcpServerUrl
      ? (() => {
          const tokens = new SessionTokenRegistry();
          const confirmations = new ConfirmationRegistry();
          const aiRepository = new AiRepository();

          const gateway = new AssistantToolGateway(
            buildChatGatewayDependencies({
              resolveActiveModules,
              repository: aiRepository,
              runner: dependencies.dataContext,
              tokens,
              confirmations,
              notifier: notifierProxy,
              collaborators: {
                googleConnectionService: dependencies.googleConnectionService,
                googleApiClient: dependencies.googleApiClient,
                connectorsRepository: dependencies.connectorsRepository,
                boss: dependencies.boss,
                featureGrantService: dependencies.featureGrantService,
                sourceContextService: dependencies.sourceContextService,
                currentViewService
              },
              appMapService: dependencies.appMapService,
              agencyPreferences: dependencies.agencyPreferences,
              localePreferences: dependencies.localePreferences
            })
          );

          return { tokens, gateway, mcpServerUrl, aiRepository };
        })()
      : null;

  const runtime = createChatSessionRuntime({
    rootDb: dependencies.rootDb,
    dataContext: dependencies.dataContext,
    engineFactory: dependencies.chatEngineFactory,
    // #342 (§3.5): only select the engine ourselves when no explicit factory was injected (tests/host
    // pass a resolved factory). `selectEngineFactory` inside the runtime picks the RPC client when
    // JARVIS_CLI_RUNNER_SOCKET is set (and fail-fasts on a missing §6.6 secret), else the in-process
    // engine. An explicit chatEngineFactory always wins inside the runtime, so passing both is safe.
    engineSelection: dependencies.chatEngineFactory ? undefined : dependencies.engineSelection,
    boss: dependencies.boss,
    connectorSyncAt: dependencies.connectorsRepository
      ? async (scopedDb, kind) =>
          getConnectorSyncAt(dependencies.connectorsRepository!, scopedDb, kind)
      : undefined,
    passiveMemoryRecall: dependencies.passiveMemoryRecall,
    personaPreferences: dependencies.personaPreferences,
    chatPreferences: dependencies.chatPreferences,
    localePreferences: dependencies.localePreferences,
    priorityPreferences: dependencies.priorityPreferences,
    mcpTokenLifecycle: wiring
      ? {
          mint: async (actorUserId: string) => {
            // Capture the actor's current executable tool set as the per-session allowlist.
            // Bare tool names (e.g. "example.read") — same format as tools/list and tools/call params.name.
            // The mcp__jarvis__<name> prefix is a client-side CLI convention that never reaches the server.
            const allowedToolNames = new Set(
              (await wiring.gateway.listToolsForActor(actorUserId)).map((tool) => tool.name)
            );
            return {
              token: wiring.tokens.mint({
                actorUserId,
                chatSessionId: actorUserId,
                allowedToolNames
              }),
              mcpServerUrl: wiring.mcpServerUrl
            };
          },
          revoke: (chatSessionId: string) => wiring.tokens.revokeBySessionId(chatSessionId),
          touch: (chatSessionId: string) => wiring.tokens.touchBySessionId(chatSessionId),
          // #342 (§5.3 steps 2/4) — orphan-token reconciliation + the source-of-truth session-id list.
          // Forwarded to the manager (reconcileMcpTokens / listMcpTokenSessionIds) so a (re)connect or
          // bootId change revokes tokens for sessions the cli-runner no longer holds — even after an api
          // restart wipes the `sessions` Map (the registry, not the Map, is the orphan-token source).
          reconcile: (liveSessionIds: Set<string>) => wiring.tokens.reconcile(liveSessionIds),
          listSessionIds: () => wiring.tokens.listSessionIds()
        }
      : undefined
  });

  // #342 (§3.4): publish the ONE RPC connection the runtime owns (socket path only) back to the
  // composition root so a single socket serves both chat and the onboarding probes, and gets the
  // connect-on-boot / close-on-shutdown lifecycle. No-op on the in-process path (connection undefined).
  if (runtime.connection) {
    dependencies.adoptChatRpcConnection?.(runtime.connection);
  }

  // #1081 H2: publish the session manager's drop-by-provider method back to the composition
  // root (same "adopt" seam as above), unconditionally — unlike the RPC connection,
  // `runtime.manager` always exists on every runtime path.
  dependencies.adoptDropSessionsForProvider?.((provider) =>
    runtime.manager.dropSessionsForProvider(provider)
  );

  // Wire real notifier now that manager is available.
  realNotifier = new ChatGatewayNotifier(runtime.manager);

  // #342 (§5.5): tear down runtime-owned background resources on server close — stop the idle reaper
  // and close the RPC connection. Idempotent (the composition root also closes the adopted connection;
  // both `shutdown()` and `connection.close()` guard re-entry). A no-op on the in-process path (no
  // reaper, no connection).
  server.addHook("onClose", async () => {
    runtime.shutdown();
  });

  server.addHook("onReady", async () => {
    if (!wiring) return;
    try {
      const count = await wiring.aiRepository.cancelStalePendingAssistantActions(
        dependencies.rootDb,
        { olderThan: new Date(Date.now() - STALE_ACTION_GRACE_MS) }
      );
      if (count > 0) {
        server.log.info({ count }, "cancelled stale assistant action requests");
      }
    } catch (err) {
      server.log.warn({ err }, "stale assistant action cleanup failed");
    }
  });

  if (wiring) {
    registerMcpTransportRoute(server, { gateway: wiring.gateway, tokens: wiring.tokens });
    registerNativePermissionRoute(server, { gateway: wiring.gateway, tokens: wiring.tokens });

    server.post<{ Params: { id: string }; Body: { status: string } }>(
      "/api/chat/action-requests/:id/resolve",
      async (request, reply) => {
        let access: AccessContext;
        try {
          access = await dependencies.resolveAccessContext(request);
        } catch {
          return reply.code(401).send({ error: "Session is missing or expired" });
        }

        const { id } = request.params;
        const rawStatus = (request.body as { status?: unknown }).status;
        if (rawStatus !== "confirmed" && rawStatus !== "rejected" && rawStatus !== "cancelled") {
          return reply
            .code(400)
            .send({ error: "status must be confirmed, rejected, or cancelled" });
        }

        try {
          await wiring.gateway.resolveActionRequest(access.actorUserId, id, rawStatus);
          return reply.code(204).send();
        } catch {
          return reply.code(400).send({ error: "Could not resolve action request" });
        }
      }
    );
  }

  registerChatLiveRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    runtime: {
      ...runtime,
      resolveEveningInterviewSeed: dependencies.resolveEveningInterviewSeed
    },
    pageContextStore
  });

  registerChatSkillsRoutes(
    server,
    {
      resolveAccessContext: dependencies.resolveAccessContext,
      dataContext: dependencies.dataContext
    },
    skillsRepository
  );

  server.get(
    "/api/chat/threads",
    { schema: listChatThreadsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const threads = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listThreads(scopedDb)
        );
        return { threads: threads.map(serializeThread) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/chat/threads/:id/messages",
    { schema: listChatThreadMessagesRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const messages = await dependencies.dataContext.withDataContext(
          access,
          async (scopedDb) => {
            const thread = await repository.getThreadById(scopedDb, request.params.id);
            if (thread?.owner_user_id !== access.actorUserId) return null;
            if (!thread) return null;
            return repository.listMessages(scopedDb, thread.id);
          }
        );
        if (!messages) return reply.code(404).send({ error: "Chat thread not found" });
        return { messages: messages.map(serializeMessage) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // ── Chat settings ──────────────────────────────────────────────────────────

  server.get(
    "/api/chat/settings",
    { schema: getChatSettingsRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          chatSettingsRepo.get(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY)
        );
        return { chat: normalizeChatSettings(raw) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/chat/settings",
    { schema: putChatSettingsRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const body = request.body as PutChatSettingsRequest;
        const chat = normalizeChatSettings(body.chat);
        await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          chatSettingsRepo.upsert(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY, chat)
        );
        return { chat };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // ── Memory settings ────────────────────────────────────────────────────────

  server.get("/api/chat/memory/settings", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const settings = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        memorySettingsRepo.getOrCreate(scopedDb, access.actorUserId)
      );
      return serializeSettings(settings);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch("/api/chat/memory/settings", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const patch = parseSettingsPatch(request.body);
      const settings = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        memorySettingsRepo.update(scopedDb, access.actorUserId, patch)
      );
      return serializeSettings(settings);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  // ── Memory facts ───────────────────────────────────────────────────────────

  server.get("/api/chat/memory/facts", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const facts = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        factsRepo.listActiveFacts(scopedDb, access.actorUserId)
      );
      return { facts: facts.map(serializeFact) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/chat/memory/corrections",
    { schema: listMemoryCorrectionsRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const { limit, offset } = parsePagination(request.query);
        const corrections = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          suppressionsRepo.listCorrections(scopedDb, access.actorUserId, { limit, offset })
        );
        return { corrections: corrections.map(serializeCorrection) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/api/chat/memory/facts/:id",
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const deleted = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          factsRepo.deleteFact(scopedDb, request.params.id)
        );
        if (!deleted) return reply.code(404).send({ error: "Memory fact not found" });
        return reply.code(204).send();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/chat/memory/facts/:id/confirm",
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const confirmed = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          factsRepo.confirmFact(scopedDb, request.params.id)
        );
        if (!confirmed) return reply.code(404).send({ error: "Memory fact not found" });
        return reply.code(204).send();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/chat/memory/facts/:id/reject",
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const rejected = await dependencies.dataContext.withDataContext(
          access,
          async (scopedDb) => {
            const fact = await factsRepo.getActiveFact(scopedDb, request.params.id);
            if (!fact || fact.provenance !== "inferred") return false;

            await suppressionsRepo.insertSuppression(scopedDb, access.actorUserId, {
              signature: createMemoryFactSignature(fact.category, fact.content),
              category: fact.category,
              content: fact.content,
              reason: "rejected"
            });
            await factsRepo.deleteFact(scopedDb, fact.id);
            return true;
          }
        );
        if (!rejected) return reply.code(404).send({ error: "Memory fact not found" });
        return reply.code(204).send();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: { id: string } }>("/api/chat/memory/facts/:id", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const importance = (request.body as Record<string, unknown>).importance;
      if (typeof importance !== "number" || importance < 0 || importance > 1) {
        return reply.code(400).send({ error: "importance must be a number between 0 and 1" });
      }
      const updated = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        factsRepo.updateFactImportance(scopedDb, request.params.id, importance)
      );
      if (!updated) return reply.code(404).send({ error: "Memory fact not found" });
      return reply.code(204).send();
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  // ── Answer provenance ──────────────────────────────────────────────────────

  server.get<{ Params: { messageId: string } }>(
    "/api/chat/messages/:messageId/provenance",
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const message = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.getMessageById(scopedDb, request.params.messageId)
        );
        if (!message || message.owner_user_id !== access.actorUserId) {
          return reply.code(404).send({ error: "Message not found" });
        }
        const toolMetadata = asRecord(message.tool_metadata);
        const stored = readStoredProvenance(toolMetadata);
        const cards: AnswerSourceSupportCard[] = stored != null ? provenanceCards(stored) : [];
        return { cards };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: { messageId: string; supportId: string } }>(
    "/api/chat/messages/:messageId/provenance/:supportId/dereference",
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const message = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.getMessageById(scopedDb, request.params.messageId)
        );
        if (!message || message.owner_user_id !== access.actorUserId) {
          return reply.code(404).send({ error: "Message not found" });
        }
        const toolMetadata = asRecord(message.tool_metadata);
        const stored = readStoredProvenance(toolMetadata);
        if (!stored) return reply.code(404).send({ error: "No provenance for this message" });

        const supportItem = stored.supportItems.find(
          (item) => item.supportId === request.params.supportId
        );
        if (!supportItem) return reply.code(404).send({ error: "Support item not found" });

        // V1: no providers registered yet — return unavailable
        return {
          unavailableReason: "source_unavailable" as const,
          sourceLabel: supportItem.sourceLabel,
          title: supportItem.title
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

/**
 * Builds the gateway toolServices map from optional collaborators. Missing service collaborators
 * simply omit that service, so the gateway fail-closed filter hides unsatisfiable tools.
 */
export function buildChatToolServices(deps: {
  googleConnectionService?: GoogleConnectionService;
  googleApiClient?: GoogleApiClient;
  connectorsRepository?: ConnectorsRepository;
  cipher?: ConnectorSecretCipher;
  boss?: PgBoss;
  featureGrantService?: FeatureGrantService;
}): Record<string, unknown> {
  const services: Record<string, unknown> = {};
  if (deps.googleConnectionService && deps.googleApiClient && deps.connectorsRepository) {
    services.calendarWrite = buildCalendarWriteService({
      googleService: deps.googleConnectionService,
      googleApiClient: deps.googleApiClient,
      connectorsRepository: deps.connectorsRepository,
      calendarRepository: new CalendarRepository(),
      enqueueCacheEvict: deps.boss
        ? (eventId, actorUserId) =>
            sendCalendarCacheEvictJob(deps.boss!, { targetItemId: eventId, actorUserId })
        : undefined
    });
    services.emailWrite = buildEmailWriteService({
      emailRepository: new EmailRepository(),
      connectorsRepository: deps.connectorsRepository,
      googleService: deps.googleConnectionService,
      googleApiClient: deps.googleApiClient,
      cipher: deps.cipher!,
      preferencesRepository: new PreferencesRepository()
    });
  }
  if (deps.boss) {
    const boss = deps.boss;
    services.notesSync = {
      enqueue: (actorUserId, sourcePath) =>
        sendJob(boss, NOTES_SYNC_QUEUE, { actorUserId, sourcePath } satisfies NotesSyncJobPayload, {
          singletonKey: `notes-sync:${actorUserId}`
        })
    } satisfies NotesSyncToolService;
  }
  if (deps.featureGrantService) {
    services.featureGrants = deps.featureGrantService;
  }
  return services;
}

/**
 * Assembles the AssistantToolGatewayDependencies registerChatRoutes uses, INCLUDING toolServices from
 * buildChatToolServices. Exported so a test can assert the real construction path carries toolServices
 * (i.e. that registerChatRoutes does not forget to pass it) — closing the "factory exists but isn't
 * wired" gap. registerChatRoutes calls THIS, then `new AssistantToolGateway(deps)`.
 */
export function buildChatGatewayDependencies(args: {
  resolveActiveModules: ActiveModulesResolver;
  repository: AiRepository;
  runner: DataContextRunner;
  tokens: SessionTokenRegistry;
  confirmations: ConfirmationRegistry;
  notifier: SessionNotifier;
  agencyPreferences?: PreferencesPort;
  localePreferences?: PreferencesPort;
  appMapService?: AppMapReadService;
  collaborators: {
    googleConnectionService?: GoogleConnectionService;
    googleApiClient?: GoogleApiClient;
    connectorsRepository?: ConnectorsRepository;
    boss?: PgBoss;
    featureGrantService?: FeatureGrantService;
    sourceContextService?: SourceContextService;
    currentViewService?: CurrentViewReadService;
  };
}): AssistantToolGatewayDependencies {
  return {
    resolveActiveModules: args.resolveActiveModules,
    repository: args.repository,
    runner: args.runner,
    tokens: args.tokens,
    confirmations: args.confirmations,
    notifier: args.notifier,
    confirmTimeoutMs: 150_000,
    agencyPrefs: buildAgencyPrefs({
      runner: args.runner,
      preferences: args.agencyPreferences
    }),
    actionPolicy: buildActionPolicy({
      runner: args.runner,
      repository: args.repository,
      preferences: args.agencyPreferences,
      resolveActiveModules: args.resolveActiveModules
    }),
    yoloMode: (ctx) =>
      args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        resolveYoloMode
      ),
    toolServices: buildChatToolServices(args.collaborators),
    readToolServices:
      args.collaborators.featureGrantService ||
      args.collaborators.sourceContextService ||
      args.collaborators.currentViewService ||
      args.appMapService
        ? {
            ...(args.collaborators.featureGrantService
              ? { featureGrants: args.collaborators.featureGrantService }
              : {}),
            ...(args.collaborators.sourceContextService
              ? { sourceContext: args.collaborators.sourceContextService }
              : {}),
            ...(args.collaborators.currentViewService
              ? { currentView: args.collaborators.currentViewService }
              : {}),
            ...(args.appMapService ? { appMap: args.appMapService } : {})
          }
        : undefined,
    resolveLocalTimezone: args.localePreferences
      ? (actorUserId) =>
          args.runner.withDataContext(
            { actorUserId, requestId: "gateway:resolve-locale-tz" },
            async (scopedDb) => {
              const raw = await args.localePreferences!.get(scopedDb, "locale");
              return extractTimezone(raw);
            }
          )
      : undefined
  };
}

export async function resolveYoloMode(scopedDb: DataContextDb): Promise<boolean> {
  const master = await scopedDb.db
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", YOLO_INSTANCE_SETTING_KEY)
    .executeTakeFirst();
  if ((master?.value as { enabled?: boolean } | undefined)?.enabled !== true) return false;

  const prefs = await scopedDb.db
    .selectFrom("app.preferences")
    .select(["key", "value_json"])
    .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
    .where("key", "in", [YOLO_ALLOWED_PREF_KEY, YOLO_ENABLED_PREF_KEY])
    .execute();
  const values = new Map(prefs.map((row) => [row.key, (row.value_json as unknown) === true]));
  return values.get(YOLO_ALLOWED_PREF_KEY) === true && values.get(YOLO_ENABLED_PREF_KEY) === true;
}

function buildActionPolicy(args: {
  runner: DataContextRunner;
  repository: AiRepository;
  preferences?: PreferencesPort;
  resolveActiveModules: ActiveModulesResolver;
}): AssistantToolGatewayDependencies["actionPolicy"] {
  return (ctx) => ({
    getFamilyTier: async (moduleId: string, familyId: string) => {
      return args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        async (scopedDb) => {
          if (moduleId === "tasks" && familyId === "task_changes" && args.preferences) {
            const compat = new TasksCompatibilityHelper(args.preferences);
            return compat.getResolvedTaskChangesPolicy(scopedDb);
          }
          const policies = await args.repository.listActionPolicies(scopedDb);
          const policy = policies.find(
            (p) => p.moduleId === moduleId && p.actionFamilyId === familyId
          );
          return policy?.tier ?? null;
        }
      );
    },
    getFamilyManifest: async (moduleId: string, familyId: string) => {
      const activeModules = await args.resolveActiveModules(ctx.actorUserId);
      const manifest = activeModules.find((m) => m.id === moduleId);
      if (!manifest || !manifest.assistantActionFamilies) return null;
      return manifest.assistantActionFamilies.find((f) => f.id === familyId) ?? null;
    }
  });
}

function buildAgencyPrefs(args: {
  runner: DataContextRunner;
  preferences?: PreferencesPort;
}): AssistantToolGatewayDependencies["agencyPrefs"] {
  if (!args.preferences) return undefined;
  return (ctx) => ({
    get: (key: string) =>
      args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        (scopedDb) => args.preferences!.get(scopedDb, key)
      ),
    upsert: (key: string, value: unknown) =>
      args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        (scopedDb) => args.preferences!.upsert(scopedDb, key, value)
      )
  });
}

function serializeThread(thread: ChatThread): ChatThreadDto {
  return {
    id: thread.id,
    ownerUserId: thread.owner_user_id,
    title: thread.title,
    incognito: thread.incognito,
    createdAt: toIsoString(thread.created_at),
    updatedAt: toIsoString(thread.updated_at)
  };
}

function serializeMessage(message: ChatMessage): ChatMessageDto {
  const toolMetadata = asRecord(message.tool_metadata);
  const storedProvenance = readStoredProvenance(toolMetadata);
  const answerProvenance =
    storedProvenance != null && storedProvenance.supportItems.length > 0
      ? provenanceCards(storedProvenance)
      : undefined;
  const answerProvenanceCitedIds =
    storedProvenance != null && storedProvenance.citedSupportIds.length > 0
      ? [...storedProvenance.citedSupportIds]
      : undefined;
  return {
    id: message.id,
    threadId: message.thread_id,
    ownerUserId: message.owner_user_id,
    role: message.role,
    status: message.status,
    body: message.body,
    modelRoute: null,
    tools: readTools(toolMetadata.selectedTools),
    activity: readActivity(toolMetadata.activity),
    sourceFreshness: readSourceFreshness(toolMetadata.sourceFreshness),
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at),
    answerProvenance,
    answerProvenanceCitedIds
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readActivity(value: unknown): ChatActivityEventDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return typeof record.kind === "string" && typeof record.text === "string"
      ? [{ kind: record.kind, text: record.text }]
      : [];
  });
}

function readTools(value: unknown): ChatSelectedToolMetadataDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const risk = record.risk;
    if (
      typeof record.moduleId !== "string" ||
      typeof record.moduleName !== "string" ||
      typeof record.name !== "string" ||
      typeof record.permissionId !== "string" ||
      (risk !== "read" && risk !== "write" && risk !== "destructive")
    ) {
      return [];
    }
    return [
      {
        moduleId: record.moduleId,
        moduleName: record.moduleName,
        name: record.name,
        permissionId: record.permissionId,
        risk
      }
    ];
  });
}

export function readSourceFreshness(value: unknown): SourceFreshnessV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1) return null;
  if (typeof rec.capturedAt !== "string") return null;
  const rawSources = Array.isArray(rec.sources) ? rec.sources : [];
  const sources: SourceFreshnessEntry[] = rawSources.flatMap((item) => {
    const r = asRecord(item);
    if (typeof r.source !== "string" || typeof r.freshnessKind !== "string") return [];
    const asOf = r.asOf === null ? null : typeof r.asOf === "string" ? r.asOf : null;
    return [{ source: r.source, freshnessKind: r.freshnessKind as FreshnessKind, asOf }];
  });
  return { version: 1, capturedAt: rec.capturedAt as string, sources };
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof CliChatUnavailableError) {
    reply.log?.warn?.({ err: error }, "live chat unavailable");
    return reply.code(503).send({ error: "Live chat is currently unavailable on this host." });
  }
  return handleModuleRouteError(error, reply, { invalidRequestMessage: "Chat request is invalid" });
}
