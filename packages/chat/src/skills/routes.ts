import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, ChatSkill, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  createChatSkillRouteSchema,
  deleteChatSkillRouteSchema,
  getChatSkillRouteSchema,
  listChatSkillsRouteSchema,
  setChatSkillEnabledRouteSchema,
  updateChatSkillRouteSchema,
  type ChatSkillDto,
  type CreateChatSkillRequest,
  type SetChatSkillEnabledRequest,
  type UpdateChatSkillRequest
} from "@jarv1s/shared";

import { parseSkillFile } from "./frontmatter.js";
import { ChatSkillsRepository } from "./repository.js";

// Generous cap for a single hand-authored or downloaded skill file; stated explicitly in
// the 413 the Fastify default body-limit handler returns so operators/users see the number.
const MAX_SKILL_FILE_BYTES = 256 * 1024;

const SKILL_FILE_CONTENT_TYPE = /^text\/(markdown|plain)$/;

export interface ChatSkillsRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
}

export function registerChatSkillsRoutes(
  server: FastifyInstance,
  dependencies: ChatSkillsRoutesDependencies,
  repository: ChatSkillsRepository = new ChatSkillsRepository()
): void {
  // Scoped to text/markdown|text/plain only, mirroring transcription-routes.ts's audio/* parser:
  // a single raw blob upload, no other form fields, so no need for @fastify/multipart.
  server.addContentTypeParser(
    SKILL_FILE_CONTENT_TYPE,
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  server.get("/api/chat/skills", { schema: listChatSkillsRouteSchema }, async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const skills = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        repository.list(scopedDb)
      );
      return { skills: skills.map(serializeSkill) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get<{ Params: { id: string } }>(
    "/api/chat/skills/:id",
    { schema: getChatSkillRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const skill = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.get(scopedDb, request.params.id)
        );
        if (!skill) return reply.code(404).send({ error: "Skill not found" });
        return { skill: serializeSkill(skill) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/skills",
    { schema: createChatSkillRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const body = request.body as CreateChatSkillRequest;
        requireSkillText(body.name, "Skill name is required");
        requireSkillText(body.body, "Skill instructions are required");
        const skill = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.create(scopedDb, {
            name: body.name,
            description: body.description,
            frontmatter: body.frontmatter,
            body: body.body,
            source: "authored"
          })
        );
        return { skill: serializeSkill(skill) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: { id: string } }>(
    "/api/chat/skills/:id",
    { schema: updateChatSkillRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const body = request.body as UpdateChatSkillRequest;
        if (body.name !== undefined) requireSkillText(body.name, "Skill name is required");
        if (body.body !== undefined) requireSkillText(body.body, "Skill instructions are required");
        const skill = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.update(scopedDb, request.params.id, body)
        );
        if (!skill) return reply.code(404).send({ error: "Skill not found" });
        return { skill: serializeSkill(skill) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: { id: string } }>(
    "/api/chat/skills/:id/enabled",
    { schema: setChatSkillEnabledRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const body = request.body as SetChatSkillEnabledRequest;
        const skill = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.setEnabled(scopedDb, request.params.id, body.enabled)
        );
        if (!skill) return reply.code(404).send({ error: "Skill not found" });
        return { skill: serializeSkill(skill) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/api/chat/skills/:id",
    { schema: deleteChatSkillRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const deleted = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.delete(scopedDb, request.params.id)
        );
        if (!deleted) return reply.code(404).send({ error: "Skill not found" });
        return reply.code(204).send();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/skills/import",
    { bodyLimit: MAX_SKILL_FILE_BYTES },
    async (request, reply) => {
      try {
        const raw = requireSkillFileBody(request);
        const parsed = parseSkillFile(raw);
        requireSkillText(parsed.name, "Skill name is required");
        requireSkillText(parsed.body, "Skill instructions are required");
        const access = await dependencies.resolveAccessContext(request);
        const skill = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.create(scopedDb, {
            name: parsed.name,
            description: parsed.frontmatter["description"] ?? null,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            source: "uploaded"
          })
        );
        return { skill: serializeSkill(skill) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function requireSkillFileBody(request: FastifyRequest): string {
  const body = request.body;
  if (typeof body !== "string" || body.length === 0) {
    throw new HttpError(400, "Expected a non-empty text/markdown or text/plain request body");
  }
  return body;
}

function requireSkillText(value: string | undefined, message: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new HttpError(400, message);
}

function serializeSkill(skill: ChatSkill): ChatSkillDto {
  return {
    id: skill.id,
    ownerUserId: skill.owner_user_id,
    name: skill.name,
    description: skill.description,
    frontmatter: skill.frontmatter,
    body: skill.body,
    enabled: skill.enabled,
    source: skill.source,
    createdAt: toIsoString(skill.created_at),
    updatedAt: toIsoString(skill.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    invalidRequestMessage: "Skill request is invalid"
  });
}
