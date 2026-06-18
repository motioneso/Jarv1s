import type { FastifyReply } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";

/**
 * Shared settings-route error handler. Wraps the module-sdk handler with a mapper that
 * surfaces account-state errors (pending approval / deactivated) as 403s. Extracted from
 * locale-routes / persona-routes / source-behavior-routes, which were byte-identical (#299).
 */
export function handleSettingsRouteError(error: unknown, reply: FastifyReply) {
  return handleRouteError(error, reply, {
    mappers: [
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
