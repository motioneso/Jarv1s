import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner, EmailMessage, PreferencesPort } from "@jarv1s/db";
import {
  EMAIL_TASK_MODE_PREF_KEY,
  getEmailBriefingSettingsRouteSchema,
  getEmailMessageRouteSchema,
  getEmailTaskCreationModeRouteSchema,
  listEmailMessagesRouteSchema,
  parseEmailTaskMode,
  type EmailMessageDto,
  type UpdateEmailBriefingSettingsRequest,
  type UpdateEmailTaskCreationModeRequest,
  updateEmailBriefingSettingsRouteSchema,
  updateEmailTaskCreationModeRouteSchema
} from "@jarv1s/shared";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { EmailRepository } from "./repository.js";

const EMAIL_SIGNAL_CREATE_TASKS_KEY = "email.signal_create_tasks";
const EMAIL_SIGNAL_SUGGEST_REPLIES_KEY = "email.signal_suggest_replies";
const EMAIL_SIGNAL_DRAFT_REPLIES_KEY = "email.signal_draft_replies";
const EMAIL_SIGNAL_AUTO_SEND_KEY = "email.signal_auto_send";

export interface EmailRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: EmailRepository;
  readonly preferencesRepository?: PreferencesPort;
}

interface EmailMessageParams {
  readonly id: string;
}

export function registerEmailRoutes(
  server: FastifyInstance,
  dependencies: EmailRoutesDependencies
): void {
  const repository = dependencies.repository ?? new EmailRepository();
  const preferencesRepository = dependencies.preferencesRepository ?? new PreferencesRepository();

  server.get(
    "/api/email/messages",
    { schema: listEmailMessagesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const messages = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listVisible(scopedDb)
        );

        return { messages: messages.map(serializeEmailMessage) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: EmailMessageParams }>(
    "/api/email/messages/:id",
    { schema: getEmailMessageRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const message = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getById(scopedDb, request.params.id)
        );

        if (!message) {
          return reply.code(404).send({ error: "Email message not found" });
        }

        return { message: serializeEmailMessage(message) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/email/briefing-settings",
    { schema: getEmailBriefingSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => readEmailBriefingSettings(scopedDb, preferencesRepository)
        );
        return { settings };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch(
    "/api/email/briefing-settings",
    { schema: updateEmailBriefingSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as UpdateEmailBriefingSettingsRequest;
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            if (body.createTasks !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                EMAIL_SIGNAL_CREATE_TASKS_KEY,
                body.createTasks
              );
            }
            if (body.suggestReplies !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                EMAIL_SIGNAL_SUGGEST_REPLIES_KEY,
                body.suggestReplies
              );
            }
            if (body.draftReplies !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                EMAIL_SIGNAL_DRAFT_REPLIES_KEY,
                body.draftReplies
              );
            }
            if (body.autoSend !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                EMAIL_SIGNAL_AUTO_SEND_KEY,
                body.autoSend
              );
            }
            return readEmailBriefingSettings(scopedDb, preferencesRepository);
          }
        );
        return { settings };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/email/task-creation-mode",
    { schema: getEmailTaskCreationModeRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const mode = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) =>
            parseEmailTaskMode(await preferencesRepository.get(scopedDb, EMAIL_TASK_MODE_PREF_KEY))
        );
        return { mode };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/email/task-creation-mode",
    { schema: updateEmailTaskCreationModeRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as UpdateEmailTaskCreationModeRequest;
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          preferencesRepository.upsert(scopedDb, EMAIL_TASK_MODE_PREF_KEY, body.mode)
        );
        return { mode: body.mode };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

export function serializeEmailMessage(message: EmailMessage): EmailMessageDto {
  return {
    id: message.id,
    ownerUserId: message.owner_user_id,
    sender: message.sender,
    recipients: message.recipients,
    subject: message.subject,
    snippet: message.snippet,
    bodyExcerpt: message.body_excerpt,
    summary: message.summary,
    signals: message.signals,
    receivedAt: toIsoString(message.received_at),
    externalId: message.external_id,
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function readEmailBriefingSettings(
  scopedDb: Parameters<PreferencesPort["get"]>[0],
  preferencesRepository: PreferencesPort
) {
  const [createTasks, suggestReplies, draftReplies, autoSend] = await Promise.all([
    preferencesRepository.get(scopedDb, EMAIL_SIGNAL_CREATE_TASKS_KEY),
    preferencesRepository.get(scopedDb, EMAIL_SIGNAL_SUGGEST_REPLIES_KEY),
    preferencesRepository.get(scopedDb, EMAIL_SIGNAL_DRAFT_REPLIES_KEY),
    preferencesRepository.get(scopedDb, EMAIL_SIGNAL_AUTO_SEND_KEY)
  ]);

  return {
    createTasks: createTasks === false ? false : true,
    suggestReplies: suggestReplies === false ? false : true,
    draftReplies: draftReplies === false ? false : true,
    autoSend: autoSend === true
  } as const;
}
