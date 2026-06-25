import type { FastifyBaseLogger } from "fastify";

/**
 * Create a child logger tagged with a `module` binding, for a module's setup-time
 * singleton. Modules receive the host Fastify base logger (e.g. `server.log` or a
 * request-scoped logger) and store the returned child as a module-level const; all
 * module logging routes through it. This is the structured-logging convention
 * (observability spec): no `console.*` in production code — every module logs
 * through a pino child created here.
 *
 * The binding is structural: `module` becomes a field on every subsequent log line
 * emitted by the child, so `docker compose logs api` can be filtered per module
 * without grepping message text.
 */
export function createModuleLogger(base: FastifyBaseLogger, module: string): FastifyBaseLogger {
  return base.child({ module });
}
