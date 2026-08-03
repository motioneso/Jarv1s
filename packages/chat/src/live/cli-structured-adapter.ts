import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  GenerateStructuredProviderInput,
  ProviderKind,
  StructuredProviderAdapter,
  StructuredProviderResult,
  StructuredRunPriority,
  StructuredTelemetryEvent
} from "@jarv1s/ai";

import { CliChatUnavailableError } from "./errors.js";
import { selectEngineFactory, type ChatEngineFactory } from "./runtime.js";

const CLI_STRUCTURED_TIMEOUT_MS = 120_000;
const CLI_STRUCTURED_POLL_MS = 100;
let activeCliStructuredRuns = 0;
type CliStructuredWaiter = {
  readonly priority: StructuredRunPriority;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
};
const cliStructuredWaiters: Record<StructuredRunPriority, CliStructuredWaiter[]> = {
  foreground: [],
  background: []
};

function releaseCliStructuredSlot(): void {
  const next = cliStructuredWaiters.foreground.shift() ?? cliStructuredWaiters.background.shift();
  if (!next) {
    activeCliStructuredRuns -= 1;
    return;
  }
  next.signal?.removeEventListener("abort", next.abort!);
  activeCliStructuredRuns = 1;
  next.resolve(releaseCliStructuredSlot);
}

function acquireCliStructuredSlot(
  priority: StructuredRunPriority,
  signal?: AbortSignal
): Promise<() => void> {
  if (signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  }
  if (activeCliStructuredRuns === 0 && cliStructuredWaiters.foreground.length === 0) {
    activeCliStructuredRuns = 1;
    return Promise.resolve(releaseCliStructuredSlot);
  }
  return new Promise((resolve, reject) => {
    const waiter: CliStructuredWaiter = { priority, resolve, reject, signal };
    waiter.abort = () => {
      const queue = cliStructuredWaiters[priority];
      const index = queue.indexOf(waiter);
      if (index >= 0) queue.splice(index, 1);
      signal?.removeEventListener("abort", waiter.abort!);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    cliStructuredWaiters[priority].push(waiter);
    signal?.addEventListener("abort", waiter.abort, { once: true });
  });
}

/**
 * #982/#869/#981: chat-owned implementation of ai's structured CLI port. It reuses the exact
 * one-shot engine factory selected for chat (tmux/herdr or authenticated cli-runner RPC), returns
 * raw assistant text, and leaves parsing/Ajv repair to `generateStructured`.
 */
export class CliStructuredAdapter implements StructuredProviderAdapter {
  constructor(
    private readonly provider: ProviderKind,
    private readonly engineFactory: ChatEngineFactory,
    private readonly timeoutMs = CLI_STRUCTURED_TIMEOUT_MS,
    private readonly pollMs = CLI_STRUCTURED_POLL_MS
  ) {}

  async generateStructured(
    input: GenerateStructuredProviderInput
  ): Promise<StructuredProviderResult> {
    const startedAt = Date.now();
    const priority = input.priority ?? "foreground";
    const emit = (event: StructuredTelemetryEvent) => input.telemetry?.emit({ ...event, priority });
    let exit: "complete" | "busy" | "timeout" | "no-reply" | "error" = "error";
    emit({ kind: "invoked" });
    if (activeCliStructuredRuns >= 1) emit({ kind: "busy", exit: "busy" });
    let release: (() => void) | undefined;
    try {
      release = await acquireCliStructuredSlot(priority, input.signal);
    } catch (error) {
      exit = input.signal?.aborted ? "timeout" : "error";
      emit({ kind: "exit", exit });
      emit({ kind: "elapsed", elapsedMs: Date.now() - startedAt });
      throw error;
    }

    let neutralDir: string | undefined;
    let engine: ReturnType<ChatEngineFactory> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    let timedOut = false;

    try {
      neutralDir = await mkdtemp(join(tmpdir(), "jarv1s-structured-"));
      const personaPath = join(neutralDir, "persona.md");
      await writeFile(personaPath, "You produce structured JSON only.\n", { mode: 0o600 });
      const activeEngine = this.engineFactory(this.provider, `structured-${randomUUID()}`, {
        executionMode: "non_interactive"
      });
      engine = activeEngine;
      const stopped = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          emit({ kind: "timeout" });
          void activeEngine.kill().catch(() => undefined);
          reject(new CliChatUnavailableError("CLI structured generation timed out"));
        }, this.timeoutMs);
        abort = () => {
          void activeEngine.interrupt().catch(() => undefined);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        input.signal?.addEventListener("abort", abort, { once: true });
      });
      const generated = this.run(activeEngine, neutralDir, personaPath, input);
      try {
        const rawText = await Promise.race([generated, stopped]);
        exit = "complete";
        return { rawText, usage: { inputTokens: 0, outputTokens: 0 } };
      } catch (error) {
        await activeEngine.kill().catch(() => undefined);
        const final = await activeEngine.readNew(0).catch(() => null);
        const reply = final?.records
          .slice()
          .reverse()
          .find((record) => record.kind === "reply")?.text;
        if (reply !== undefined) {
          emit({ kind: "late-read" });
          exit = timedOut ? "timeout" : "complete";
          return { rawText: reply, usage: { inputTokens: 0, outputTokens: 0 } };
        }
        exit = timedOut
          ? "timeout"
          : input.signal?.aborted
            ? "timeout"
            : error instanceof CliChatUnavailableError
              ? "no-reply"
              : "error";
        throw error;
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) input.signal?.removeEventListener("abort", abort);
      await engine?.kill().catch(() => undefined);
      // #981: structured prompts can contain private module data; unlike durable chat, this
      // one-shot surface has no transcript-retention purpose.
      await engine?.purgeTranscripts?.().catch(() => undefined);
      if (neutralDir) await rm(neutralDir, { recursive: true, force: true });
      release();
      emit({ kind: "exit", exit });
      emit({ kind: "elapsed", elapsedMs: Date.now() - startedAt });
    }
  }

  private async run(
    engine: ReturnType<ChatEngineFactory>,
    neutralDir: string,
    personaPath: string,
    input: GenerateStructuredProviderInput
  ): Promise<string> {
    let firstReadable = false;
    let offset = (
      await engine.launch({
        neutralDir,
        personaPath,
        personaText: "You produce structured JSON only.",
        model: input.model.provider_model_id
      })
    ).offset;
    await engine.submit(buildCliStructuredPrompt(input));

    for (;;) {
      const next = await engine.readNew(offset);
      offset = next.offset;
      const reply = [...next.records].reverse().find((record) => record.kind === "reply")?.text;
      if (reply !== undefined && !firstReadable) {
        firstReadable = true;
        input.telemetry?.emit({ kind: "first-readable", priority: input.priority ?? "foreground" });
      }
      if (next.complete) {
        if (reply !== undefined) return reply;
        throw new CliChatUnavailableError("CLI structured generation completed without a reply");
      }
      if (!(await engine.isAlive())) {
        throw new CliChatUnavailableError("CLI structured generation exited without a reply");
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }
}

/** #982 composition helper: resolve the transport once, then create provider-specific adapters. */
export function createCliStructuredAdapterFactory(
  engineFactory: ChatEngineFactory = selectEngineFactory().factory
): (kind: ProviderKind) => CliStructuredAdapter {
  return (kind) => new CliStructuredAdapter(kind, engineFactory);
}

function buildCliStructuredPrompt(input: GenerateStructuredProviderInput): string {
  const conversation = input.messages
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n");
  return [
    conversation,
    `JSON Schema:\n${JSON.stringify(input.schema)}`,
    "Respond with ONLY a JSON object matching this schema. No markdown or commentary."
  ].join("\n\n");
}
