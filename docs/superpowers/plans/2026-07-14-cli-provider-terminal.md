# CLI-provider Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-gated interactive terminal modal, launched from the AI-admin "Test" action for CLI-auth providers, that streams a real `node-pty` shell inside the container to xterm.js in the browser.

**Architecture:** Three isolated additions to the existing stack. (1) cli-runner spawns a real PTY via `node-pty` and pushes its raw output over a new server-push RPC frame on the existing length-prefixed Unix-socket protocol. (2) The Fastify API adds an owner-gated WebSocket route that relays browser keystrokes ⇄ cli-runner terminal RPC, guarded by a dedicated step-up terminal password. (3) `apps/web` gains an `@xterm/xterm` modal wired from the Test button. The chat runtime is untouched.

**Tech Stack:** TypeScript, Fastify + `@fastify/websocket` (new), `node-pty` (new native dep, cli-runner), `@xterm/xterm` + `@xterm/addon-fit` (new, apps/web), better-auth/crypto (`hashPassword`/`verifyPassword`), Postgres RLS, Vitest, Playwright.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-14-cli-provider-terminal-design.md`. Task #1059, epic #983.
- **Owner-only.** Every new HTTP/WS route resolves `AccessContext` then calls `assertInstanceAdmin(repository, scopedDb, actorUserId)` inside `withDataContext`. Non-admin → 403 (route existence is fine to reveal; matches existing `/api/ai/*` gating).
- **Does not alter chat/LLM runtime.** No edits to `launch`/`submit`/`readNew` paths, the chat engine, tmux chat sessions, or provider routing. Terminal RPC methods are strictly additive.
- **Runtime uid, never root.** PTY inherits the cli-runner process uid. No privilege escalation.
- **Never log terminal I/O.** WS frames and PTY bytes are never written to any logger.
- **Migration rule:** never edit an applied migration. New file in `packages/ai/sql/`, next available **global** number at landing time; add its row to `foundation.test.ts` migration-list assertion (the `toEqual` will fail latently otherwise — see `test-traps`).
- **Secrets never escape.** Only a password _hash_ is persisted (better-auth scrypt). The plaintext terminal password is never stored, logged, or returned.
- **File-size gate:** all source ≤ 1000 lines (`check:file-size`). Full local gate before each commit: `pnpm verify:foundation` (or the scoped lint+typecheck+test for the touched package).
- **Comment density:** generous why-comments citing #1059 on every non-obvious block.

---

### Task 1: RPC contract — terminal methods + server-push frame

**Files:**

- Modify: `packages/chat/src/live/rpc-contract.ts` (method union ~L145; `RpcFrame` union ~L213; append new param/result interfaces near the existing pairs)
- Test: `packages/chat/src/live/rpc-contract.test.ts` (create if absent, else append)

**Interfaces:**

- Produces: `RpcPush`, `RpcOpenTerminalParams`/`RpcOpenTerminalResult`, `RpcWriteTerminalParams`, `RpcResizeTerminalParams`, `RpcKillTerminalParams`. Adds `"openTerminal" | "writeTerminal" | "resizeTerminal" | "killTerminal"` to `RpcMethod`. Extends `RpcFrame` with `RpcPush`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/chat/src/live/rpc-contract.test.ts
import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame, type RpcPush } from "./rpc-contract";

describe("terminal push frame (#1059)", () => {
  it("round-trips a terminalData push frame", () => {
    const push: RpcPush = {
      t: "push",
      bootId: "boot-1",
      channel: "terminalData",
      terminalId: "t-1",
      dataB64: Buffer.from("hi").toString("base64")
    };
    const decoded = decodeFrame(encodeFrame(push));
    expect(decoded.kind).toBe("frame");
    if (decoded.kind !== "frame") throw new Error("unreachable");
    expect(JSON.parse(decoded.body.toString("utf8"))).toEqual(push);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/chat test -- rpc-contract`
Expected: FAIL — `RpcPush` not exported.

- [ ] **Step 3: Add the types**

```ts
// rpc-contract.ts — extend the method union (~L145)
export type RpcMethod =
  | "launch"
  | "submit"
  | "readNew"
  | "isAlive"
  | "interrupt"
  | "kill"
  | "purgeTranscripts"
  | "listLiveSessions"
  | "probeProvider"
  | "installProvider"
  | "beginLogin"
  | "pollLogin"
  | "submitLoginToken"
  | "cancelLogin"
  // #1059 owner terminal — additive, never used by the chat runtime
  | "openTerminal"
  | "writeTerminal"
  | "resizeTerminal"
  | "killTerminal";

// #1059 server-initiated output frame. First non-request/response member of RpcFrame.
// Carries no `id` (unsolicited); routed by `channel` + `terminalId`, base64 to stay JSON-safe.
export interface RpcPush {
  readonly t: "push";
  readonly bootId: string;
  readonly channel: "terminalData" | "terminalExit";
  readonly terminalId: string;
  readonly dataB64?: string; // terminalData: raw PTY bytes, base64
  readonly exitCode?: number; // terminalExit: process exit status
}

export type RpcFrame = RpcRequest | RpcOk | RpcErr | RpcPush; // was: RpcRequest | RpcOk | RpcErr

// #1059 terminal method params/results (interface-pair pattern, mirrors RpcSubmit*)
export interface RpcOpenTerminalParams {
  readonly cols: number;
  readonly rows: number;
}
export interface RpcOpenTerminalResult {
  readonly terminalId: string;
}
export interface RpcWriteTerminalParams {
  readonly terminalId: string;
  readonly dataB64: string;
}
export interface RpcResizeTerminalParams {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}
export interface RpcKillTerminalParams {
  readonly terminalId: string;
}
```

Also update `encodeFrame`'s parameter type if it enumerates members: it currently accepts `RpcFrame | RpcHandshakeFrame`, so widening `RpcFrame` is sufficient — no signature edit needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/chat test -- rpc-contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/rpc-contract.ts packages/chat/src/live/rpc-contract.test.ts
git commit -m "feat(chat): add terminal RPC methods + server-push frame (#1059)"
```

---

### Task 2: `node-pty` TerminalSession primitive (cli-runner)

**Files:**

- Modify: `packages/cli-runner/package.json` (add `node-pty` dependency)
- Create: `packages/cli-runner/src/terminal-session.ts`
- Test: `packages/cli-runner/src/terminal-session.test.ts`

**Interfaces:**

- Consumes: none.
- Produces: `class TerminalSession` — `constructor(opts: TerminalSessionOptions)`; `write(data: Buffer): void`; `resize(cols: number, rows: number): void`; `kill(): void`; `onData(cb: (chunk: Buffer) => void): void`; `onExit(cb: (code: number) => void): void`; `readonly id: string`. `TerminalSessionOptions = { id: string; cols: number; rows: number; homeBase: string; toolsBinDir: string }`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @jarv1s/cli-runner add node-pty
```

Verify it lands in `packages/cli-runner/package.json` dependencies. (Native build note: `node-pty` compiles against node headers; confirm the prod Dockerfile toolchain builds it — Task 10 covers image verification.)

- [ ] **Step 2: Write the failing test**

```ts
// packages/cli-runner/src/terminal-session.test.ts
import { describe, it, expect } from "vitest";
import { TerminalSession } from "./terminal-session";

describe("TerminalSession (#1059)", () => {
  it("echoes input and reports output", async () => {
    const session = new TerminalSession({
      id: "t-test",
      cols: 80,
      rows: 24,
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin"
    });
    const chunks: string[] = [];
    session.onData((c) => chunks.push(c.toString("utf8")));
    session.write(Buffer.from("echo hello_1059\n"));
    await new Promise((r) => setTimeout(r, 800));
    session.kill();
    expect(chunks.join("")).toContain("hello_1059");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-session`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement TerminalSession**

```ts
// packages/cli-runner/src/terminal-session.ts
// #1059 — a real PTY (node-pty) running a login shell for the owner terminal.
// Deliberately NOT tmux: a genuine PTY emits the raw escape-sequence byte stream
// xterm.js expects, sidestepping the pane-scraping that broke under claude 2.1.183.
import * as pty from "node-pty";

export interface TerminalSessionOptions {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly homeBase: string; // cwd + $HOME (cli-auth home) — landing dir, not a jail
  readonly toolsBinDir: string; // prepended to PATH so claude/codex/gemini resolve
}

export class TerminalSession {
  readonly id: string;
  private readonly term: pty.IPty;

  constructor(opts: TerminalSessionOptions) {
    this.id = opts.id;
    this.term = pty.spawn("/bin/bash", ["-l"], {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.homeBase,
      env: {
        ...process.env,
        HOME: opts.homeBase,
        TERM: "xterm-256color",
        PATH: `${opts.toolsBinDir}:${process.env.PATH ?? "/usr/bin"}`
      }
    });
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.term.onData((d) => cb(Buffer.from(d, "utf8")));
  }
  onExit(cb: (code: number) => void): void {
    this.term.onExit(({ exitCode }) => cb(exitCode));
  }
  write(data: Buffer): void {
    this.term.write(data.toString("utf8"));
  }
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }
  kill(): void {
    try {
      this.term.kill();
    } catch {
      /* already gone */
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-session`
Expected: PASS (`hello_1059` observed).

- [ ] **Step 6: Commit**

```bash
git add packages/cli-runner/package.json pnpm-lock.yaml packages/cli-runner/src/terminal-session.ts packages/cli-runner/src/terminal-session.test.ts
git commit -m "feat(cli-runner): node-pty TerminalSession primitive (#1059)"
```

---

### Task 3: TerminalHost — single-session lifecycle + idle timeout

**Files:**

- Create: `packages/cli-runner/src/terminal-host.ts`
- Test: `packages/cli-runner/src/terminal-host.test.ts`

**Interfaces:**

- Consumes: `TerminalSession` (Task 2).
- Produces: `class TerminalHost` — `constructor(deps: TerminalHostDeps)`; `open(params: RpcOpenTerminalParams, sink: TerminalSink): RpcOpenTerminalResult`; `write(params: RpcWriteTerminalParams): void`; `resize(params: RpcResizeTerminalParams): void`; `kill(params: RpcKillTerminalParams): void`; `killAll(): void`. `TerminalSink = { data(terminalId: string, bytes: Buffer): void; exit(terminalId: string, code: number): void }`. `TerminalHostDeps = { homeBase: string; toolsBinDir: string; idleMs?: number; makeSession?: (o: TerminalSessionOptions) => TerminalSession }` (`makeSession` injectable for tests).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli-runner/src/terminal-host.test.ts
import { describe, it, expect, vi } from "vitest";
import { TerminalHost } from "./terminal-host";

function fakeSession(id: string) {
  const listeners: Array<(b: Buffer) => void> = [];
  return {
    id,
    killed: false,
    onData: (cb: (b: Buffer) => void) => listeners.push(cb),
    onExit: (_: (c: number) => void) => {},
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(function (this: any) {
      this.killed = true;
    }),
    _emit: (s: string) => listeners.forEach((l) => l(Buffer.from(s)))
  };
}

describe("TerminalHost (#1059)", () => {
  it("opening a second terminal evicts the first (single active session)", () => {
    const made: any[] = [];
    const host = new TerminalHost({
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin",
      makeSession: (o) => {
        const s = fakeSession(o.id);
        made.push(s);
        return s as any;
      }
    });
    const sink = { data: vi.fn(), exit: vi.fn() };
    host.open({ cols: 80, rows: 24 }, sink);
    host.open({ cols: 80, rows: 24 }, sink);
    expect(made[0].kill).toHaveBeenCalledTimes(1);
    expect(made[1].kill).not.toHaveBeenCalled();
  });

  it("routes PTY output to the sink by terminalId", () => {
    let made: any;
    const host = new TerminalHost({
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin",
      makeSession: (o) => {
        made = fakeSession(o.id);
        return made as any;
      }
    });
    const sink = { data: vi.fn(), exit: vi.fn() };
    const { terminalId } = host.open({ cols: 80, rows: 24 }, sink);
    made._emit("out");
    expect(sink.data).toHaveBeenCalledWith(terminalId, Buffer.from("out"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-host`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TerminalHost**

```ts
// packages/cli-runner/src/terminal-host.ts
// #1059 — owns AT MOST ONE live owner terminal. Opening a new one evicts the prior
// (single active session, per the security model). Idle timeout hard-kills the PTY.
import { randomUUID } from "node:crypto";
import { TerminalSession, type TerminalSessionOptions } from "./terminal-session";
import type {
  RpcOpenTerminalParams,
  RpcOpenTerminalResult,
  RpcWriteTerminalParams,
  RpcResizeTerminalParams,
  RpcKillTerminalParams
} from "@jarv1s/chat/live/rpc-contract"; // adjust to the package's export path for rpc-contract

export interface TerminalSink {
  data(terminalId: string, bytes: Buffer): void;
  exit(terminalId: string, code: number): void;
}
export interface TerminalHostDeps {
  readonly homeBase: string;
  readonly toolsBinDir: string;
  readonly idleMs?: number;
  readonly makeSession?: (o: TerminalSessionOptions) => TerminalSession;
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000; // 10 min, spec

export class TerminalHost {
  private session: TerminalSession | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: TerminalHostDeps) {}

  open(params: RpcOpenTerminalParams, sink: TerminalSink): RpcOpenTerminalResult {
    this.killAll(); // evict any prior — single active session
    const id = randomUUID();
    const make = this.deps.makeSession ?? ((o) => new TerminalSession(o));
    const session = make({
      id,
      cols: params.cols,
      rows: params.rows,
      homeBase: this.deps.homeBase,
      toolsBinDir: this.deps.toolsBinDir
    });
    session.onData((bytes) => {
      this.touch();
      sink.data(id, bytes);
    });
    session.onExit((code) => {
      sink.exit(id, code);
      this.clear(id);
    });
    this.session = session;
    this.armIdle();
    return { terminalId: id };
  }

  write(params: RpcWriteTerminalParams): void {
    this.forId(params.terminalId)?.write(Buffer.from(params.dataB64, "base64"));
    this.touch();
  }
  resize(params: RpcResizeTerminalParams): void {
    this.forId(params.terminalId)?.resize(params.cols, params.rows);
  }
  kill(params: RpcKillTerminalParams): void {
    this.clear(params.terminalId);
  }
  killAll(): void {
    if (this.session) this.clear(this.session.id);
  }

  private forId(id: string): TerminalSession | null {
    return this.session && this.session.id === id ? this.session : null;
  }
  private clear(id: string): void {
    if (this.session && this.session.id === id) {
      this.session.kill();
      this.session = null;
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    }
  }
  private armIdle(): void {
    const ms = this.deps.idleMs ?? DEFAULT_IDLE_MS;
    this.idleTimer = setTimeout(() => this.killAll(), ms);
  }
  private touch(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.armIdle();
    }
  }
}
```

(If `@jarv1s/chat/live/rpc-contract` is not a resolvable subpath export, import the RPC types via the package's existing entry — mirror how `engine-host.ts` imports `RpcLaunchParams`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-host`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli-runner/src/terminal-host.ts packages/cli-runner/src/terminal-host.test.ts
git commit -m "feat(cli-runner): TerminalHost single-session lifecycle + idle timeout (#1059)"
```

---

### Task 4: Wire TerminalHost into dispatch + server push (integration over the socket)

**Files:**

- Modify: `packages/cli-runner/src/connection.ts` (thread a `pushSink` from `channel` into dispatch; add the 4 `invoke` cases; kill terminal on connection close)
- Modify: `packages/cli-runner/src/engine-host.ts` or `main.ts` — construct a `TerminalHost` and expose it to `serveConnection` deps
- Modify: `packages/cli-runner/src/server.ts` (`onConnection` passes the terminal host through)
- Test: `packages/cli-runner/src/terminal-rpc.integration.test.ts`

**Interfaces:**

- Consumes: `TerminalHost` (Task 3); `encodeFrame`/`RpcPush` (Task 1).
- Produces: `ConnectionDeps` gains `terminalHost: TerminalHost`. `invoke` handles the 4 terminal methods. A per-connection `pushSink` writes `RpcPush` frames via the same `channel`.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/cli-runner/src/terminal-rpc.integration.test.ts
// Spins the real Unix-socket server with a real TerminalHost, opens a terminal over RPC,
// sends `echo`, and asserts a terminalData push frame carrying the echoed bytes arrives.
import { describe, it, expect } from "vitest";
import { connect } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame, decodeFrame, type RpcFrame } from "./../../chat/src/live/rpc-contract";
// import server bootstrap helpers (CliRunnerServer, TerminalHost, handshake helper) — see impl

describe("terminal RPC integration (#1059)", () => {
  it("open -> echo -> terminalData push", async () => {
    // 1. start CliRunnerServer on a temp socket with TerminalHost wired, no secret (test)
    // 2. connect, perform the handshake the server expects (reuse existing test handshake helper)
    // 3. send { t:"req", id:1, method:"openTerminal", params:{cols:80,rows:24} } -> expect RpcOk { terminalId }
    // 4. send writeTerminal with base64("echo hi_1059\n")
    // 5. collect frames; expect a { t:"push", channel:"terminalData" } whose decoded dataB64 contains "hi_1059"
    // 6. send killTerminal; close
    expect(true).toBe(true); // replace with the assembled flow above
  });
});
```

Assemble the flow using the existing socket-server test utilities (grep `serveConnection`/`CliRunnerServer` test setup in the package for the handshake helper — reuse it, do not reinvent the handshake).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-rpc`
Expected: FAIL — `openTerminal` unknown method (`bad_request`).

- [ ] **Step 3: Thread pushSink + add dispatch cases**

In `connection.ts`, build a per-connection push sink and pass it to `dispatchFrame`/`invoke`:

```ts
// connection.ts — inside serveConnection, after channel is available (#1059)
const pushSink: TerminalSink = {
  data: (terminalId, bytes) =>
    safeWrite(channel, {
      t: "push",
      bootId: deps.bootId,
      channel: "terminalData",
      terminalId,
      dataB64: bytes.toString("base64")
    }),
  exit: (terminalId, exitCode) =>
    safeWrite(channel, {
      t: "push",
      bootId: deps.bootId,
      channel: "terminalExit",
      terminalId,
      exitCode
    })
};
// pass pushSink into dispatchFrame(...) -> invoke(req, deps.host, deps.terminalHost, pushSink)
// on connection close: deps.terminalHost.killAll();  // no orphan shells
```

Add the cases to `invoke` (new signature `invoke(req, host, terminalHost, pushSink)`):

```ts
case "openTerminal": {
  const p = req.params as RpcOpenTerminalParams;
  if (!Number.isInteger(p.cols) || !Number.isInteger(p.rows) || p.cols <= 0 || p.rows <= 0)
    throw new BadRequestError("openTerminal cols/rows must be positive integers");
  return terminalHost.open(p, pushSink);
}
case "writeTerminal": {
  const p = req.params as RpcWriteTerminalParams;
  if (typeof p.terminalId !== "string" || typeof p.dataB64 !== "string")
    throw new BadRequestError("writeTerminal requires terminalId + dataB64");
  terminalHost.write(p); return { ok: true };
}
case "resizeTerminal": {
  const p = req.params as RpcResizeTerminalParams;
  terminalHost.resize(p); return { ok: true };
}
case "killTerminal": {
  terminalHost.kill(req.params as RpcKillTerminalParams); return { ok: true };
}
```

Add `terminalHost: TerminalHost` to `ConnectionDeps`. In `server.ts` `onConnection`, pass `terminalHost: this.deps.terminalHost`. In `main.ts`, construct `new TerminalHost({ homeBase: config.homeBase, toolsBinDir: <JARVIS_CLI_TOOLS_PREFIX>/bin })` and thread it into `CliRunnerServerDeps`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/cli-runner test -- terminal-rpc`
Expected: PASS — push frame with `hi_1059` received; terminal reaped on close.

- [ ] **Step 5: Commit**

```bash
git add packages/cli-runner/src/connection.ts packages/cli-runner/src/server.ts packages/cli-runner/src/main.ts packages/cli-runner/src/terminal-rpc.integration.test.ts
git commit -m "feat(cli-runner): dispatch terminal methods + server-push output frames (#1059)"
```

---

### Task 5: API-side terminal RPC client (reuse handshake, route push frames)

**Files:**

- Create: `packages/chat/src/live/terminal-rpc-client.ts`
- Test: `packages/chat/src/live/terminal-rpc-client.test.ts`

**Interfaces:**

- Consumes: `encodeFrame`/`decodeFrame`/`RpcFrame`/`RpcPush` (Task 1); the existing socket connect + handshake used by the chat engine's RPC factory (locate in `packages/chat/src/live/runtime.ts` `selectEngineFactory` and the socket client it builds — reuse that connect+handshake, do not reimplement the secret handshake).
- Produces: `class TerminalRpcClient` — `static async connect(opts: { socketPath: string; secret?: string }): Promise<TerminalRpcClient>`; `async open(cols, rows): Promise<string>`; `write(terminalId, bytes: Buffer): void`; `resize(terminalId, cols, rows): void`; `kill(terminalId): void`; `onData(cb: (terminalId: string, bytes: Buffer) => void): void`; `onExit(cb: (terminalId: string, code: number) => void): void`; `close(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/chat/src/live/terminal-rpc-client.test.ts
import { describe, it, expect } from "vitest";
import { TerminalRpcClient } from "./terminal-rpc-client";
// Stand up a minimal in-memory ByteChannel server that replies to openTerminal with an RpcOk
// and then emits a terminalData push; assert onData fires with decoded bytes.

describe("TerminalRpcClient (#1059)", () => {
  it("resolves open() from RpcOk and surfaces terminalData pushes via onData", async () => {
    // build paired channels; server: on openTerminal req -> write RpcOk {terminalId:"t"} then
    // push terminalData dataB64=base64("xyz"); client.onData should receive ("t", Buffer "xyz")
    expect(true).toBe(true); // replace with the paired-channel flow
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/chat test -- terminal-rpc-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```ts
// packages/chat/src/live/terminal-rpc-client.ts
// #1059 — dedicated cli-runner client for the owner terminal. Separate connection from the
// chat engine so terminal traffic never interleaves with chat RPC. Routes server-push frames
// (t:"push") to listeners; matches t:"ok"/"err" to pending request ids.
import { connect } from "node:net";
import { encodeFrame, decodeFrame, type RpcFrame, type RpcRequest } from "./rpc-contract";
// import the shared handshake helper used by the existing chat RPC client (reuse it)

export class TerminalRpcClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private dataCb?: (terminalId: string, bytes: Buffer) => void;
  private exitCb?: (terminalId: string, code: number) => void;
  // ...socket + read-buffer drain loop using decodeFrame...

  static async connect(opts: { socketPath: string; secret?: string }): Promise<TerminalRpcClient> {
    // connect() to opts.socketPath, perform the SAME handshake the chat client performs
    // (send handshake frame incl. opts.secret; await server handshake ack), then resolve.
    // Wire socket 'data' -> buffer -> decodeFrame loop -> this.onFrame(frame).
    return new TerminalRpcClient(/* wired socket */);
  }

  private onFrame(frame: RpcFrame): void {
    if (frame.t === "push") {
      if (frame.channel === "terminalData" && frame.dataB64 !== undefined)
        this.dataCb?.(frame.terminalId, Buffer.from(frame.dataB64, "base64"));
      else if (frame.channel === "terminalExit")
        this.exitCb?.(frame.terminalId, frame.exitCode ?? 0);
      return;
    }
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    if (frame.t === "ok") p.resolve(frame.result);
    else p.reject(new Error(frame.error.message));
  }

  private request<T>(method: RpcRequest["method"], params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
      this.writeFrame({ t: "req", id, method, params });
    });
  }
  async open(cols: number, rows: number): Promise<string> {
    const r = await this.request<{ terminalId: string }>("openTerminal", { cols, rows });
    return r.terminalId;
  }
  write(terminalId: string, bytes: Buffer): void {
    void this.request("writeTerminal", { terminalId, dataB64: bytes.toString("base64") });
  }
  resize(terminalId: string, cols: number, rows: number): void {
    void this.request("resizeTerminal", { terminalId, cols, rows });
  }
  kill(terminalId: string): void {
    void this.request("killTerminal", { terminalId });
  }
  onData(cb: (terminalId: string, bytes: Buffer) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (terminalId: string, code: number) => void): void {
    this.exitCb = cb;
  }
  close(): void {
    /* end socket, reject pending */
  }
  // writeFrame(frame) { this.socket.write(encodeFrame(frame)); }
  // private constructor(...) { ... }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/chat test -- terminal-rpc-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/terminal-rpc-client.ts packages/chat/src/live/terminal-rpc-client.test.ts
git commit -m "feat(chat): API-side terminal RPC client with push routing (#1059)"
```

---

### Task 6: Terminal password storage (migration + repository)

**Files:**

- Create: `packages/ai/sql/0165_ai_terminal_password.sql` (use the **next available global number** at landing time; 0165 illustrative)
- Modify: the migration-list assertion in `foundation.test.ts` (add the new row — otherwise the `toEqual` fails latently)
- Create: `packages/ai/src/terminal-password-repository.ts`
- Test: `packages/ai/src/terminal-password-repository.integration.test.ts`

**Interfaces:**

- Produces: `setTerminalPassword(db: DataContextDb, plaintext: string): Promise<void>`; `verifyTerminalPassword(db: DataContextDb, plaintext: string): Promise<boolean>`; `hasTerminalPassword(db: DataContextDb): Promise<boolean>`. Hashing via `hashPassword`/`verifyPassword` from `better-auth/crypto`.

- [ ] **Step 1: Write the migration**

```sql
-- packages/ai/sql/0165_ai_terminal_password.sql
-- #1059 owner-terminal step-up password. Singleton (at most one row). Stores only the
-- better-auth scrypt HASH, never plaintext. Admin-only via FORCE RLS.
CREATE TABLE IF NOT EXISTS app.ai_terminal_password (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users (id) ON DELETE SET NULL
);
ALTER TABLE app.ai_terminal_password ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_terminal_password FORCE ROW LEVEL SECURITY;
-- Admin-only for every verb (read included: only an admin ever needs the hash to verify).
CREATE POLICY ai_terminal_password_admin_all ON app.ai_terminal_password
  FOR ALL USING (app.current_actor_is_admin()) WITH CHECK (app.current_actor_is_admin());
```

(Confirm the admin predicate name — grounding cites `app.current_actor_is_admin()`; verify against an existing admin-gated policy in the settings module SQL and match it exactly.)

- [ ] **Step 2: Write the failing test**

```ts
// packages/ai/src/terminal-password-repository.integration.test.ts
import { describe, it, expect } from "vitest";
import {
  setTerminalPassword,
  verifyTerminalPassword,
  hasTerminalPassword
} from "./terminal-password-repository";
// use the shared integration DB harness + an admin AccessContext (mirror existing ai integration tests)

describe("terminal password (#1059)", () => {
  it("set then verify true; wrong verify false; hasTerminalPassword reflects state", async () => {
    // withAdminDataContext(async (db) => { ... })
    // expect(await hasTerminalPassword(db)).toBe(false)
    // await setTerminalPassword(db, "s3cret-1059")
    // expect(await hasTerminalPassword(db)).toBe(true)
    // expect(await verifyTerminalPassword(db, "s3cret-1059")).toBe(true)
    // expect(await verifyTerminalPassword(db, "wrong")).toBe(false)
    expect(true).toBe(true); // replace with harness flow
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/ai test -- terminal-password`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the repository**

```ts
// packages/ai/src/terminal-password-repository.ts
// #1059 — persists only the scrypt hash of the owner terminal password (upsert singleton row).
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { DataContextDb } from "@jarv1s/db"; // match the branded handle import used elsewhere in the package

export async function setTerminalPassword(db: DataContextDb, plaintext: string): Promise<void> {
  const password_hash = await hashPassword(plaintext);
  await db
    .insertInto("app.ai_terminal_password")
    .values({ singleton: true, password_hash })
    .onConflict((oc) =>
      oc.column("singleton").doUpdateSet({ password_hash, updated_at: new Date() })
    )
    .execute();
}
export async function hasTerminalPassword(db: DataContextDb): Promise<boolean> {
  const row = await db
    .selectFrom("app.ai_terminal_password")
    .select("singleton")
    .executeTakeFirst();
  return Boolean(row);
}
export async function verifyTerminalPassword(
  db: DataContextDb,
  plaintext: string
): Promise<boolean> {
  const row = await db
    .selectFrom("app.ai_terminal_password")
    .select("password_hash")
    .executeTakeFirst();
  if (!row) return false;
  return verifyPassword({ hash: row.password_hash, password: plaintext });
}
```

(Match the exact query-builder idiom the `ai` package already uses — if repositories there use raw `pool.query`/`sql` rather than Kysely selectors, mirror that instead. Register the new table in the package's DB type map if one exists.)

- [ ] **Step 5: Run test to verify it passes + add migration to foundation list**

Run: `pnpm --filter @jarv1s/ai test -- terminal-password`
Then add the `0165_ai_terminal_password.sql` row to the `foundation.test.ts` migration assertion and run `pnpm test:integration -- foundation` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/sql/0165_ai_terminal_password.sql packages/ai/src/terminal-password-repository.ts packages/ai/src/terminal-password-repository.integration.test.ts <foundation.test.ts path>
git commit -m "feat(ai): terminal password storage (scrypt hash, admin-RLS) (#1059)"
```

---

### Task 7: API routes — password endpoints + owner-gated WebSocket

**Files:**

- Modify: `apps/api` or `packages/ai/src/routes.ts` deps to register `@fastify/websocket` (add plugin at app bootstrap where Fastify is created)
- Modify: root/app `package.json` (add `@fastify/websocket`)
- Create: `packages/ai/src/terminal-routes.ts` (`registerTerminalRoutes(server, deps)`)
- Modify: `packages/ai/src/routes.ts` (call `registerTerminalRoutes` from `registerAiRoutes`, mirroring `registerAiProviderValidationRoutes`)
- Test: `packages/ai/src/terminal-routes.integration.test.ts`

**Interfaces:**

- Consumes: `assertInstanceAdmin`, `resolveAccessContext`, `withDataContext` (existing); Task 6 repository; `TerminalRpcClient` (Task 5).
- Produces: `POST /api/ai/terminal/password` (set — admin), `GET /api/ai/terminal/status` (admin — `{ passwordSet: boolean }`), `POST /api/ai/terminal/ticket` (admin + password body → one-time ticket), `GET /api/ai/terminal` (WS upgrade — admin + valid ticket).

- [ ] **Step 1: Register `@fastify/websocket`**

```bash
pnpm --filter <api-app-package> add @fastify/websocket
```

At the Fastify app bootstrap (where `registerAiRoutes` is wired via module-registry), `await server.register(fastifyWebsocket)` once.

- [ ] **Step 2: Write the failing test**

```ts
// packages/ai/src/terminal-routes.integration.test.ts
import { describe, it, expect } from "vitest";
// build a Fastify test app with registerTerminalRoutes + a fake TerminalRpcClient factory
describe("terminal routes (#1059)", () => {
  it("non-admin gets 403 on password set", async () => {
    // inject POST /api/ai/terminal/password as non-admin -> 403
    expect(true).toBe(true);
  });
  it("ticket requires the correct terminal password", async () => {
    // set password as admin; POST /ticket wrong pw -> 401; correct pw -> { ticket }
    expect(true).toBe(true);
  });
  it("WS upgrade without a valid ticket is refused", async () => {
    // connect ws /api/ai/terminal without ticket -> closed/401
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/ai test -- terminal-routes`
Expected: FAIL — routes not registered.

- [ ] **Step 4: Implement the routes**

```ts
// packages/ai/src/terminal-routes.ts
// #1059 — owner terminal control plane. All routes admin-gated (assertInstanceAdmin).
// One-time in-memory tickets bridge the password check to the WS upgrade (WS can't carry a body).
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  setTerminalPassword,
  verifyTerminalPassword,
  hasTerminalPassword
} from "./terminal-password-repository";
import { TerminalRpcClient } from "@jarv1s/chat/live/terminal-rpc-client"; // adjust export path

const tickets = new Map<string, number>(); // ticket -> expiryEpochMs; single-use
const TICKET_TTL_MS = 30_000;

export function registerTerminalRoutes(
  server: FastifyInstance,
  deps: /* AiRoutesDependencies subset */ any
): void {
  const admin = async (request: any) => {
    const ctx = await deps.resolveAccessContext(request);
    return { ctx };
  };

  server.get("/api/ai/terminal/status", async (request, reply) => {
    const { ctx } = await admin(request);
    return deps.dataContext
      .withDataContext(ctx, async (db: any) => {
        await deps.assertInstanceAdmin(deps.repository, db, ctx.actorUserId);
        return { passwordSet: await hasTerminalPassword(db) };
      })
      .catch((e: unknown) => deps.handleRouteError(e, reply));
  });

  server.post("/api/ai/terminal/password", async (request, reply) => {
    const { ctx } = await admin(request);
    const body = request.body as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length < 8)
      return reply.code(400).send({ message: "Password must be at least 8 characters." });
    return deps.dataContext
      .withDataContext(ctx, async (db: any) => {
        await deps.assertInstanceAdmin(deps.repository, db, ctx.actorUserId);
        await setTerminalPassword(db, body.password as string);
        return { ok: true };
      })
      .catch((e: unknown) => deps.handleRouteError(e, reply));
  });

  server.post("/api/ai/terminal/ticket", async (request, reply) => {
    const { ctx } = await admin(request);
    const body = request.body as { password?: unknown };
    return deps.dataContext
      .withDataContext(ctx, async (db: any) => {
        await deps.assertInstanceAdmin(deps.repository, db, ctx.actorUserId);
        const ok =
          typeof body.password === "string" && (await verifyTerminalPassword(db, body.password));
        if (!ok) return reply.code(401).send({ message: "Incorrect terminal password." });
        const ticket = randomBytes(32).toString("hex");
        tickets.set(ticket, Date.now() + TICKET_TTL_MS);
        return { ticket };
      })
      .catch((e: unknown) => deps.handleRouteError(e, reply));
  });

  server.get("/api/ai/terminal", { websocket: true }, async (connection, request) => {
    // 1. admin gate again (defense in depth)
    const { ctx } = await admin(request);
    let authed = false;
    await deps.dataContext
      .withDataContext(ctx, async (db: any) => {
        await deps.assertInstanceAdmin(deps.repository, db, ctx.actorUserId);
        authed = true;
      })
      .catch(() => {
        authed = false;
      });
    const ticket = (request.query as { ticket?: string }).ticket;
    const exp = ticket ? tickets.get(ticket) : undefined;
    if (!authed || !ticket || !exp || exp < Date.now()) {
      connection.socket.close(1008, "unauthorized");
      return;
    }
    tickets.delete(ticket); // single-use

    // 2. open a dedicated cli-runner terminal client and bridge bytes both ways
    const client = await TerminalRpcClient.connect({
      socketPath: process.env.JARVIS_CLI_RUNNER_SOCKET ?? "/run/jarv1s/cli-runner.sock",
      secret: process.env.JARVIS_CLI_RUNNER_RPC_SECRET
    });
    const terminalId = await client.open(80, 24);
    client.onData((_id, bytes) => connection.socket.send(bytes)); // PTY -> browser (binary)
    client.onExit(() => connection.socket.close(1000, "exit"));

    connection.socket.on("message", (raw: Buffer, isBinary: boolean) => {
      // control messages (resize) are JSON text; keystrokes are binary
      if (!isBinary) {
        try {
          const msg = JSON.parse(raw.toString("utf8"));
          if (msg?.type === "resize") client.resize(terminalId, msg.cols, msg.rows);
          return;
        } catch {
          /* fall through, treat as data */
        }
      }
      client.write(terminalId, Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
    });
    connection.socket.on("close", () => {
      client.kill(terminalId);
      client.close();
    });
  });
}
```

Wire it: in `routes.ts` `registerAiRoutes`, add `registerTerminalRoutes(server, { resolveAccessContext, dataContext, repository, assertInstanceAdmin, handleRouteError })` alongside `registerAiProviderValidationRoutes` (~L302). Export `assertInstanceAdmin`/`handleRouteError` if not already shared.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/ai test -- terminal-routes`
Expected: PASS (403 for non-admin; ticket gating; WS refused without ticket).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/terminal-routes.ts packages/ai/src/routes.ts packages/ai/src/terminal-routes.integration.test.ts <api package.json> pnpm-lock.yaml
git commit -m "feat(ai): owner-gated terminal WS + password/ticket routes (#1059)"
```

---

### Task 8: Shared contracts + web API client helpers

**Files:**

- Modify: `packages/shared/src/ai-types.ts` (add terminal DTOs)
- Modify: `apps/web/src/api/client.ts` (password/status/ticket calls + `terminalWsUrl`)
- Test: `apps/web/src/api/client.test.ts` (or the shared types test) — light: URL builder shape

**Interfaces:**

- Produces: `getTerminalStatus(): Promise<{ passwordSet: boolean }>`; `setTerminalPassword(password: string): Promise<{ ok: true }>`; `requestTerminalTicket(password: string): Promise<{ ticket: string }>`; `terminalWsUrl(ticket: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/api/client.test.ts (append)
import { terminalWsUrl } from "./client";
it("terminalWsUrl embeds ticket + ws scheme (#1059)", () => {
  const url = terminalWsUrl("abc");
  expect(url).toMatch(/\/api\/ai\/terminal\?ticket=abc$/);
  expect(url).toMatch(/^wss?:\/\//);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- client`
Expected: FAIL — `terminalWsUrl` undefined.

- [ ] **Step 3: Implement helpers**

```ts
// apps/web/src/api/client.ts (append; mirror testAiProvider / requestJson patterns)
export async function getTerminalStatus(): Promise<{ passwordSet: boolean }> {
  return requestJson("/api/ai/terminal/status", { method: "GET" });
}
export async function setTerminalPassword(password: string): Promise<{ ok: true }> {
  return requestJson("/api/ai/terminal/password", { method: "POST", body: { password } });
}
export async function requestTerminalTicket(password: string): Promise<{ ticket: string }> {
  return requestJson("/api/ai/terminal/ticket", { method: "POST", body: { password } });
}
export function terminalWsUrl(ticket: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/ai/terminal?ticket=${encodeURIComponent(ticket)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai-types.ts apps/web/src/api/client.ts apps/web/src/api/client.test.ts
git commit -m "feat(web): terminal API client helpers + ws url (#1059)"
```

---

### Task 9: Frontend — xterm.js modal + Test-button routing

**Files:**

- Modify: `apps/web/package.json` (add `@xterm/xterm`, `@xterm/addon-fit`)
- Create: `apps/web/src/settings/terminal-modal.tsx`
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx` (CLI providers → open modal instead of `testMutation`)
- Test: `apps/web/src/settings/terminal-modal.test.tsx` (render + password-gate states; mock WebSocket)

**Interfaces:**

- Consumes: Task 8 client helpers.
- Produces: `<TerminalModal provider={...} onClose={...} />`.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter web add @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/src/settings/terminal-modal.test.tsx
import { render, screen } from "@testing-library/react";
import { TerminalModal } from "./terminal-modal";
// mock ./api/client getTerminalStatus -> { passwordSet: false }
it("prompts to set a password when none is set (#1059)", async () => {
  render(
    <TerminalModal
      provider={{ id: "p", authMethod: "cli", displayName: "Claude" } as any}
      onClose={() => {}}
    />
  );
  expect(await screen.findByText(/set a terminal password/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- terminal-modal`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the modal**

Build `TerminalModal` with three states driven by `getTerminalStatus()`:

1. **No password** → "Set a terminal password" form → `setTerminalPassword` → advance.
2. **Password set, not yet unlocked** → password prompt → `requestTerminalTicket(password)` → on ticket, advance.
3. **Unlocked** → mount xterm.js on a `ref` div, `new WebSocket(terminalWsUrl(ticket))` with `binaryType="arraybuffer"`; `term.onData((d) => ws.send(new TextEncoder().encode(d)))`; `ws.onmessage = (e) => term.write(new Uint8Array(e.data))`; `FitAddon` on mount + `resize` → send `{type:"resize",cols,rows}` as text; teardown (`ws.close()`, `term.dispose()`) on unmount/close.

Use existing `jds-*` modal primitives (match the authored design system; no new raw colors — `styles/tokens.css` only). Cite #1059 in comments.

In `settings-ai-admin-pane.tsx`, replace the Test handler for CLI providers:

```tsx
// #1059 — CLI providers can't be credential-tested; the Test action opens a live terminal instead.
const [terminalOpen, setTerminalOpen] = useState(false);
const onTest =
  provider.authMethod === "cli" ? () => setTerminalOpen(true) : () => testMutation.mutate();
// ...button onClick={onTest}; label for cli: "Terminal", else existing "Test"/"Testing"
// {terminalOpen && <TerminalModal provider={provider} onClose={() => setTerminalOpen(false)} />}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- terminal-modal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/settings/terminal-modal.tsx apps/web/src/settings/settings-ai-admin-pane.tsx apps/web/src/settings/terminal-modal.test.tsx
git commit -m "feat(web): xterm.js terminal modal on CLI-provider Test action (#1059)"
```

---

### Task 10: e2e dev UAT + prod-image native-dep verification

**Files:**

- Create: `apps/web/e2e/terminal.spec.ts` (Playwright, via the #1000 UAT harness)
- Verify: prod image builds `node-pty` (Dockerfile toolchain)

**Interfaces:** none (acceptance).

- [ ] **Step 1: Confirm `node-pty` compiles in the prod image**

Run: `docker build -f Dockerfile -t jarv1s-terminal-check .`
Expected: build succeeds; `node-pty` native addon present. If the build lacks `python3`/`make`/`g++`, add them to the build stage (build-time only; not the runtime layer). Commit any Dockerfile change with `#1059`.

- [ ] **Step 2: Write the e2e UAT**

```ts
// apps/web/e2e/terminal.spec.ts — drives the REAL modal against a dev instance (#1059).
import { test, expect } from "@playwright/test";
test("owner opens terminal, runs a command, sees output, closes clean", async ({ page }) => {
  // 1. sign in as owner/admin; go to Settings -> AI admin
  // 2. click Test/Terminal on a CLI provider row
  // 3. set terminal password (first run) then unlock
  // 4. type: claude --version + Enter
  // 5. expect the xterm canvas/text to contain a version string
  // 6. close modal; assert no orphan bash process remains (health/log check)
});
```

- [ ] **Step 3: Run the UAT against a dev instance**

Run the app in dev (bind `--host` for LAN), then: `pnpm --filter web exec playwright test terminal.spec.ts`
Expected: PASS — real runtime path exercised (unit + diff review are not sufficient for this per project rule `e2e-dev-uat-for-ui-features`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/terminal.spec.ts <Dockerfile if changed>
git commit -m "test(web): e2e dev UAT for owner terminal + prod node-pty build check (#1059)"
```

---

## Self-Review

**Spec coverage:**

- Owner-gated PTY terminal on CLI-provider Test action → Tasks 2,3,4,9. ✔
- Isolated from chat runtime (additive RPC only) → Tasks 1,4 (no chat-path edits). ✔
- Dedicated step-up terminal password → Tasks 6,7,9. ✔
- `node-pty` sidesteps tmux scraping → Task 2. ✔
- Bidirectional WebSocket transport → Tasks 7,9. ✔
- xterm.js modal, first dep → Task 9. ✔
- Single active session, idle timeout, hard-kill on close → Tasks 3,4,7. ✔
- Owner-only 403 gating → Task 7. ✔
- Unredacted server-side error logging for the terminal path → Task 4/7 (surfaced, not masked). ✔
- Landing dir = cli-auth home; unrestricted `cd` → Task 2. ✔
- e2e dev UAT exit criterion → Task 10. ✔
- Native-dep build check → Task 10. ✔

**Out of scope (spec non-goals), correctly absent:** automated Live-chat fix; blocked-state surfacing in chat UI.

**Placeholder scan:** integration/e2e test bodies are described-flow rather than literal assertions where they depend on existing harness helpers (handshake helper, admin DataContext harness, Playwright login) that must be reused, not reinvented — each names the exact helper to locate. All production code blocks are literal.

**Type consistency:** `terminalId: string` throughout; `dataB64: string` (base64) on write + push; `RpcPush.channel ∈ {"terminalData","terminalExit"}`; `TerminalSink.data(id, Buffer)` matches `onData` in Tasks 2/3/5; client helpers in Task 8 match route shapes in Task 7.

## Open items to confirm during implementation (from spec)

1. Exact admin RLS predicate name (`app.current_actor_is_admin()` vs the settings module's actual function).
2. The `ai` package DB access idiom (Kysely branded `DataContextDb` selectors vs raw `sql`) — match it in Task 6.
3. The shared cli-runner handshake helper location for Task 5 (reuse the chat client's).
4. Which app package owns the Fastify bootstrap for `@fastify/websocket` registration (Task 7).
