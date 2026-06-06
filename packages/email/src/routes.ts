import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner, EmailMessage } from "@jarv1s/db";
import {
  getEmailMessageRouteSchema,
  listEmailMessagesRouteSchema,
  type EmailMessageDto
} from "@jarv1s/shared";

import { EmailRepository } from "./repository.js";

export interface EmailRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: EmailRepository;
}

interface EmailMessageParams {
  readonly id: string;
}

export function registerEmailRoutes(
  server: FastifyInstance,
  dependencies: EmailRoutesDependencies
): void {
  const repository = dependencies.repository ?? new EmailRepository();

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
}

export function serializeEmailMessage(message: EmailMessage): EmailMessageDto {
  return {
    id: message.id,
    connectorAccountId: message.connector_account_id,
    ownerUserId: message.owner_user_id,
    workspaceId: message.workspace_id,
    visibility: message.visibility,
    sender: message.sender,
    recipients: message.recipients,
    subject: message.subject,
    snippet: message.snippet,
    bodyExcerpt: message.body_excerpt,
    receivedAt: toIsoString(message.received_at),
    externalId: message.external_id,
    externalMetadata: message.external_metadata,
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(_error: unknown, reply: FastifyReply) {
  return reply.code(401).send({ error: "Session is missing or expired" });
}
