import type { FastifyInstance } from "fastify";
import type { JarvisActionPermissionTier } from "@jarv1s/module-sdk";
import { handleRouteError } from "@jarv1s/module-sdk";
import {
  getAiActionPoliciesResponseSchema,
  patchAiActionPolicyRequestSchema,
  patchAiActionPolicyResponseSchema
} from "@jarv1s/shared";

import type { AiRepository } from "./repository.js";
import type { AiRoutesDependencies } from "./routes.js";

interface PatchRequest {
  readonly Body: {
    readonly tier: JarvisActionPermissionTier;
  };
  readonly Params: {
    readonly moduleId: string;
    readonly actionFamilyId: string;
  };
}

export function registerActionPolicyRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository
): void {
  server.get(
    "/api/ai/action-policy",
    { schema: { response: { 200: getAiActionPoliciesResponseSchema } } },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const policies = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const list = await repository.listActionPolicies(scopedDb);

            if (dependencies.tasksCompatibility) {
              const tasksTier =
                await dependencies.tasksCompatibility.getResolvedTaskChangesPolicy(scopedDb);
              // Merge or override the tasks policy
              const existing = list.find(
                (p) => p.moduleId === "tasks" && p.actionFamilyId === "task_changes"
              );
              if (existing) {
                existing.tier = tasksTier;
              } else {
                list.push({ moduleId: "tasks", actionFamilyId: "task_changes", tier: tasksTier });
              }
            }
            return list;
          }
        );
        return { policies };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<PatchRequest>(
    "/api/ai/action-policy/:moduleId/:actionFamilyId",
    {
      schema: {
        body: patchAiActionPolicyRequestSchema,
        response: { 200: patchAiActionPolicyResponseSchema }
      }
    },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { moduleId, actionFamilyId } = request.params;
        const { tier } = request.body;

        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          if (
            moduleId === "tasks" &&
            actionFamilyId === "task_changes" &&
            dependencies.tasksCompatibility
          ) {
            await dependencies.tasksCompatibility.setTaskChangesPolicy(scopedDb, tier);
          } else {
            await repository.setActionPolicy(scopedDb, moduleId, actionFamilyId, tier);
          }
        });

        return reply.code(200).send({ moduleId, actionFamilyId, tier });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
