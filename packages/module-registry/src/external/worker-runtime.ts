import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

import { MODULE_WORKER_CONTRACT_VERSION } from "@jarv1s/module-sdk";

import type { ExternalModuleDiscovery } from "./types.js";

type Rpc = (
  method: string,
  params: unknown,
  rememberSecret: (value: string) => void
) => Promise<unknown>;

interface Invocation {
  readonly rpc: Rpc;
  readonly secrets: Set<string>;
  stdout: string;
  stderr: string;
}

interface ProcessState {
  readonly child: ChildProcessWithoutNullStreams;
  readonly pending: Map<
    string | number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >;
  readonly ready: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
  buffer: string;
  current?: Invocation;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class ExternalModuleWorkerError extends Error {
  constructor(readonly code: "protocol" | "timeout" | "crash" | "handler_failed") {
    super(`External module worker ${code}`);
    this.name = "ExternalModuleWorkerError";
  }
}

export class ExternalModuleWorkerRuntime {
  private readonly states = new Map<string, ProcessState>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private nextId = 0;

  constructor(
    private readonly options: {
      readonly invocationTimeoutMs?: number;
      readonly idleTimeoutMs?: number;
      readonly logger?: { warn(data: Record<string, unknown>, message?: string): void };
    } = {}
  ) {}

  invoke(
    module: ExternalModuleDiscovery,
    handler: string,
    input: Record<string, unknown>,
    rpc: Rpc
  ): Promise<unknown> {
    const prior = this.queues.get(module.id) ?? Promise.resolve();
    const call = prior.catch(() => undefined).then(() => this.run(module, handler, input, rpc));
    this.queues.set(module.id, call);
    void call
      .finally(() => {
        if (this.queues.get(module.id) === call) this.queues.delete(module.id);
      })
      .catch(() => undefined);
    return call;
  }

  async close(): Promise<void> {
    const states = [...this.states.values()];
    this.states.clear();
    for (const state of states) this.stop(state, new ExternalModuleWorkerError("crash"));
    await Promise.allSettled(states.map((state) => this.waitForExit(state.child)));
  }

  private async run(
    module: ExternalModuleDiscovery,
    handler: string,
    input: Record<string, unknown>,
    rpc: Rpc
  ): Promise<unknown> {
    const state = this.states.get(module.id) ?? this.start(module);
    clearTimeout(state.idleTimer);
    const invocation: Invocation = { rpc, secrets: new Set(), stdout: "", stderr: "" };
    const timeout = setTimeout(() => {
      const error = new ExternalModuleWorkerError("timeout");
      this.states.delete(module.id);
      this.stop(state, error);
    }, this.options.invocationTimeoutMs ?? 30_000);
    try {
      await state.ready;
      state.current = invocation;
      const id = `host:${++this.nextId}`;
      const response = new Promise<unknown>((resolve, reject) =>
        state.pending.set(id, { resolve, reject })
      );
      state.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "module.invoke", params: { handler, input } })}\n`
      );
      return await response;
    } finally {
      clearTimeout(timeout);
      this.flushLogs(module.id, invocation);
      state.current = undefined;
      if (this.states.get(module.id) === state) {
        state.idleTimer = setTimeout(() => {
          this.states.delete(module.id);
          this.stop(state, new ExternalModuleWorkerError("crash"));
        }, this.options.idleTimeoutMs ?? 60_000);
      }
    }
  }

  private start(module: ExternalModuleDiscovery): ProcessState {
    const entrypoint = module.manifest.runtime?.workerEntrypoint;
    if (!entrypoint) throw new ExternalModuleWorkerError("protocol");
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["LANG", "LC_ALL", "TZ"] as const) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const child = spawn(process.execPath, [join(module.dir, entrypoint)], {
      cwd: module.dir,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const state: ProcessState = {
      child,
      pending: new Map(),
      ready,
      resolveReady,
      rejectReady,
      buffer: ""
    };
    this.states.set(module.id, state);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(module.id, state, chunk));
    child.stderr.on("data", (chunk: string) => this.capture(state, "stderr", chunk));
    child.once("error", () =>
      this.failProcess(module.id, state, new ExternalModuleWorkerError("crash"))
    );
    child.once("exit", () =>
      this.failProcess(module.id, state, new ExternalModuleWorkerError("crash"))
    );
    return state;
  }

  private onStdout(moduleId: string, state: ProcessState, chunk: string): void {
    state.buffer += chunk;
    if (state.buffer.length > 1_048_576) {
      this.failProcess(moduleId, state, new ExternalModuleWorkerError("protocol"));
      return;
    }
    for (;;) {
      const end = state.buffer.indexOf("\n");
      if (end < 0) return;
      const line = state.buffer.slice(0, end);
      state.buffer = state.buffer.slice(end + 1);
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.capture(state, "stdout", `${line}\n`);
        continue;
      }
      if (message.method === "worker.ready") {
        const version = (message.params as { version?: unknown } | undefined)?.version;
        if (version !== MODULE_WORKER_CONTRACT_VERSION) {
          this.failProcess(moduleId, state, new ExternalModuleWorkerError("protocol"));
        } else state.resolveReady();
        continue;
      }
      if (typeof message.method === "string" && message.id !== undefined) {
        const invocation = state.current;
        if (!invocation) {
          this.failProcess(moduleId, state, new ExternalModuleWorkerError("protocol"));
          continue;
        }
        if (containsSecret(message.params, invocation.secrets)) {
          state.child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "rpc_failed" } })}\n`
          );
          continue;
        }
        void invocation
          .rpc(message.method, message.params, (secret) => invocation.secrets.add(secret))
          .then(
            (result) =>
              state.child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`
              ),
            () =>
              state.child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "rpc_failed" } })}\n`
              )
          );
        continue;
      }
      const pending = state.pending.get(message.id as string | number);
      if (!pending) continue;
      state.pending.delete(message.id as string | number);
      if (message.error) pending.reject(new ExternalModuleWorkerError("handler_failed"));
      else if (containsSecret(message.result, state.current?.secrets)) {
        pending.reject(new ExternalModuleWorkerError("handler_failed"));
      } else pending.resolve(message.result);
    }
  }

  private capture(state: ProcessState, stream: "stdout" | "stderr", chunk: string): void {
    const invocation = state.current;
    if (!invocation) return;
    invocation[stream] = (invocation[stream] + chunk).slice(-16_384);
  }

  private flushLogs(moduleId: string, invocation: Invocation): void {
    for (const stream of ["stdout", "stderr"] as const) {
      let output = invocation[stream];
      if (!output) continue;
      for (const secret of [...invocation.secrets].sort((a, b) => b.length - a.length)) {
        if (secret) output = output.split(secret).join("[REDACTED]");
      }
      this.options.logger?.warn({ moduleId, stream, output }, "external module worker output");
    }
  }

  private failProcess(
    moduleId: string,
    state: ProcessState,
    error: ExternalModuleWorkerError
  ): void {
    if (this.states.get(moduleId) === state) this.states.delete(moduleId);
    this.stop(state, error);
  }

  private stop(state: ProcessState, error: ExternalModuleWorkerError): void {
    clearTimeout(state.idleTimer);
    state.rejectReady(error);
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
    if (!state.child.killed) state.child.kill();
  }

  private waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => child.once("exit", () => resolve()));
  }
}

function containsSecret(value: unknown, secrets: ReadonlySet<string> | undefined): boolean {
  if (!secrets?.size) return false;
  const encoded = JSON.stringify(value);
  return [...secrets].some((secret) => secret.length > 0 && encoded.includes(secret));
}
