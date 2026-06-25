import { describe, expect, it } from "vitest";

import type { FastifyBaseLogger } from "fastify";

import { createModuleLogger } from "../../packages/module-sdk/src/logger.js";

/**
 * Unit test for createModuleLogger (observability spec — structured-logging
 * convention). Verifies the child carries the `module` binding and forwards
 * level calls to the base logger. Uses a fake FastifyBaseLogger (no Fastify
 * instance needed): the contract is `base.child(bindings)` returns a child that
 * logs through the same level methods, with the bindings attached.
 */
function makeFakeBaseLogger(): FastifyBaseLogger & {
  childBindings: Record<string, unknown>[];
  calls: { level: string; binding: unknown; msg: string }[];
} {
  const calls: { level: string; binding: unknown; msg: string }[] = [];
  const childBindings: Record<string, unknown>[] = [];
  // Pino allows two call shapes: logger(level, msg) and logger(level, obj, msg).
  // The single-arg form is logger(msg:string) — binding is undefined then.
  const makeLevel = (level: string) => (a: unknown, b?: string) => {
    if (b === undefined) {
      calls.push({ level, binding: undefined, msg: String(a) });
    } else {
      calls.push({ level, binding: a, msg: b });
    }
  };
  const base = {
    child: (bindings: Record<string, unknown>) => {
      childBindings.push(bindings);
      const child = {
        error: makeLevel("error"),
        warn: makeLevel("warn"),
        info: makeLevel("info"),
        debug: makeLevel("debug"),
        fatal: makeLevel("fatal"),
        trace: makeLevel("trace"),
        child: (more: Record<string, unknown>) => {
          childBindings.push(more);
          return child;
        }
      };
      return child;
    },
    error: makeLevel("error"),
    warn: makeLevel("warn"),
    info: makeLevel("info"),
    debug: makeLevel("debug"),
    fatal: makeLevel("fatal"),
    trace: makeLevel("trace")
  };
  return Object.assign(base as FastifyBaseLogger, { childBindings, calls });
}

describe("createModuleLogger", () => {
  it("creates a child logger tagged with the module binding", () => {
    const base = makeFakeBaseLogger();
    const logger = createModuleLogger(base, "briefings");
    logger.info({ event: "boot" }, "module initialized");

    expect(base.childBindings).toContainEqual({ module: "briefings" });
    expect(base.calls).toEqual([
      { level: "info", binding: { event: "boot" }, msg: "module initialized" }
    ]);
  });

  it("forwards each level to the underlying base logger", () => {
    const base = makeFakeBaseLogger();
    const logger = createModuleLogger(base, "chat");
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");

    expect(base.calls.map((c) => c.level)).toEqual(["error", "warn", "info", "debug"]);
    expect(base.calls.map((c) => c.msg)).toEqual(["e", "w", "i", "d"]);
  });

  it("supports distinct module tags per child", () => {
    const base = makeFakeBaseLogger();
    createModuleLogger(base, "connectors");
    createModuleLogger(base, "auth");

    expect(base.childBindings).toEqual([{ module: "connectors" }, { module: "auth" }]);
  });
});
