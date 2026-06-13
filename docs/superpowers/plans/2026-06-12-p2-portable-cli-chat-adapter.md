# Portable CLI Chat Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal-CLI chat engine portable by hiding the multiplexer behind a small `Multiplexer` seam (tmux + herdr backends), with the backend chosen by an **admin-configurable instance setting that auto-detects what is installed** — all while preserving the locked constrained-launch security posture exactly.

**Architecture:** Introduce a 5-verb `Multiplexer` interface in `@jarv1s/ai`. The engine delegates session lifecycle (open/submit/isAlive/kill) to an injected `Multiplexer` and stores the **opaque handle** that `open()` returns (tmux: a stable session name; herdr: a server-assigned pane id). The engine keeps owning file/transcript I/O via the existing `TmuxIo` seam. The backend is resolved **once at the composition root** (`@jarv1s/module-registry`) by a pure decision function: a `JARVIS_MULTIPLEXER` env override wins (deploy escape hatch, bypasses the probe); otherwise the admin `chat.multiplexer` instance setting (`auto`|`tmux`|`herdr`) is honored if that backend is **usable** (binary installed — and for herdr, a root pane resolvable from `HERDR_PANE_ID`/`JARVIS_HERDR_ROOT_PANE`); `auto` detects what is usable (tie-break: herdr when running inside herdr, else tmux, falling back to tmux if herdr has no root pane). The resolved `Multiplexer` is injected through the existing `chatEngineFactory` seam. Selection applies on restart. When neither multiplexer is installed, live chat is cleanly disabled (a factory that throws `CliChatUnavailableError` → HTTP 503), not a crash.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest (`describe/it/expect/vi`), pnpm workspaces, `execFile` (never shell) via `TmuxIo`, React Query (admin UI).

**Spec:** `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` (grounded on `5759b90`). The admin-selectable + auto-detect multiplexer (Tasks 11–14) is a **grill-locked extension** beyond the spec's §4.2 (which described env/PATH selection only) — see "Key decisions & tradeoffs".

**Execution note:** This plan will be executed via an Ultracode workflow (not a Codex handoff). Run `pnpm db:up` once before the gate task; the new unit tests need no DB, but the chat-multiplexer admin route is exercised by an integration test that does. Do **not** `git add -A` — there is an in-flight `docs/coordination/` edit in the tree; stage explicit paths only.

---

## File Structure

**New files**

- `packages/ai/src/adapters/multiplexer.ts` — `MuxHandle` type + `Multiplexer` interface (the seam).
- `packages/ai/src/adapters/tmux-multiplexer.ts` — `TmuxMultiplexer` backend (default).
- `packages/ai/src/adapters/herdr-multiplexer.ts` — `HerdrMultiplexer` backend (JSON-parsing `herdr pane …`).
- `packages/ai/src/adapters/binary-probe.ts` — `createBinaryProbe()`: PATH scan for tmux/herdr (no shell).
- `packages/ai/src/adapters/multiplexer-resolve.ts` — `decideMultiplexer()` (pure) + `resolveMultiplexer()` (io-binding).
- `packages/chat/src/live/errors.ts` — `CliChatUnavailableError` (dependency-free, shared by engine/runtime/routes; avoids an import cycle).
- `packages/module-registry/src/chat-multiplexer.ts` — composition-root glue: pre-auth `chat.multiplexer` read + probe + `resolveChatEngineFactory()`.
- `tests/unit/ai-tmux-multiplexer.test.ts`
- `tests/unit/ai-herdr-multiplexer.test.ts`
- `tests/unit/ai-binary-probe.test.ts`
- `tests/unit/ai-multiplexer-resolve.test.ts`
- `tests/integration/chat-multiplexer-admin.test.ts` — admin GET/PUT of `chat.multiplexer` (RLS: read permissive, write admin-only).

**Modified files**

- `packages/ai/src/adapters/tmux-bridge.ts` — add optional `env`/`cwd` to `RunOptions`; add optional `homeBase` to `transcriptGlobDir`.
- `packages/ai/src/index.ts` — barrel-export the new multiplexer/probe/resolve modules.
- `packages/chat/src/live/cli-chat-engine.ts` — delegate session verbs to `Multiplexer`; store handle; rename class; fix stale comments.
- `packages/chat/src/live/types.ts` — fix the stale "JWT" comment on `mcpToken`.
- `packages/chat/src/live/runtime.ts` — `createRealEngineFactory({ mux })` builder; `CliChatUnavailableError`; `unavailableEngineFactory`; rename import to the renamed class.
- `packages/chat/src/index.ts` — barrel-export `createRealEngineFactory`, `unavailableEngineFactory`, `CliChatUnavailableError`.
- `packages/chat/src/live-routes.ts` — map `CliChatUnavailableError` → HTTP 503 in `handleLiveRouteError` (the live launch path).
- `packages/chat/src/routes.ts` — map `CliChatUnavailableError` → HTTP 503 in `handleRouteError` (REST symmetry).
- `docs/DEVELOPMENT_STANDARDS.md` — record the bounded "pre-auth non-secret instance-config reads" exemption.
- `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` — mark the PreToolUse policy (§6) Deferred.
- `packages/chat/src/live/persona.ts` — create per-user neutral dir with mode `0700`.
- `packages/settings/src/repository.ts` — add `getChatMultiplexerSetting` / `setChatMultiplexerSetting` (mirror `getRegistrationSettings`).
- `packages/settings/src/routes.ts` — add `GET`/`PUT /api/admin/chat-multiplexer` (mirror the registration routes); read injected availability.
- `packages/shared/src/platform-api.ts` — `ChatMultiplexerChoice`, `ChatMultiplexerAvailability`, `ChatMultiplexerSettingsDto` + route schemas.
- `packages/module-registry/src/index.ts` — compute availability (sync probe), inject it into the shared route deps, late-bind the resolved chat factory in an `onReady` hook; add `chatMultiplexerAvailability` to `BuiltInRouteDependencies`.
- `packages/settings/src/routes.ts` (`SettingsRoutesDependencies`) — add optional `chatMultiplexerAvailability`.
- `apps/web/src/api/client.ts` — `getChatMultiplexerSettings` / `setChatMultiplexerSettings`.
- `apps/web/src/api/query-keys.ts` — add `settings.chatMultiplexer`.
- `apps/web/src/settings/admin-users-panel.tsx` — a "Live chat multiplexer" `<select>` + availability badges + restart note.
- `packages/chat/README.md` — shared-uid limitation + the **deferred** PreToolUse follow-up note.
- `tests/unit/cli-chat-engine.test.ts`, `tests/unit/chat-live-engine.test.ts` — update the import to the renamed class.
- `tests/unit/chat-live-persona.test.ts` — assert the `0700` mode.

**Flagged for the `/grill-me-codex` review (resolved during the grill — recorded for context):**

- **HerdrMultiplexer (Task 4):** herdr has no "new detached session" primitive — `open()` `pane split`s from a root pane and parses a **server-assigned, opaque** `pane_id` out of herdr's JSON output. Higher integration risk than tmux; unit-tested at the verb/JSON level only.
- **Q3 scope (Tasks 11–14):** the grill upgraded "env/PATH selection" to a persisted, admin-configurable, auto-detecting setting. This adds a setting, an admin route+contract, composition-root wiring, and a small UI — a deliberate, grill-locked scope increase.
- **PreToolUse policy: DEFERRED out of v1** (was a task in the pre-grill plan). The `!`-escape is already neutralized on the one programmatic path (`engine.submit` → `sanitizeInput`), and `--tools ""` / MCP-allowlist already deny native tools. The hook's only additive value is agent-path defense-in-depth; it is filed as a follow-up (see Task 16), not built now.

---

## Task 1: `Multiplexer` seam interface

**Files:**

- Create: `packages/ai/src/adapters/multiplexer.ts`

- [ ] **Step 1: Write the interface**

```ts
/**
 * Multiplexer seam — the portable abstraction over the terminal multiplexer that
 * hosts a live CLI chat session. Two backends implement it: TmuxMultiplexer
 * (default) and HerdrMultiplexer. The chat engine depends on this interface, not
 * on tmux/herdr verbs, so a deployed instance can drive whichever multiplexer the
 * host provides (ADR 0008).
 *
 * KEY ASYMMETRY: tmux session names are caller-chosen and stable; herdr pane ids
 * are server-assigned and opaque. So `open()` RETURNS the handle the engine must
 * STORE and pass back to submit/isAlive/kill. Callers must never reconstruct an
 * address from the `name` hint.
 */

/** Opaque, backend-assigned session handle. Callers store it; never parse it. */
export type MuxHandle = string;

export interface MuxOpenOpts {
  /** A human-readable name hint. tmux uses it as the handle; herdr ignores it. */
  readonly name: string;
  /** Terminal width in columns. (tmux honors it; herdr auto-sizes and ignores it.) */
  readonly cols: number;
  /** Terminal height in rows. (tmux honors it; herdr auto-sizes and ignores it.) */
  readonly rows: number;
  /** The single shell line to run in the session (e.g. `cd <dir> && claude ...`). */
  readonly launchLine: string;
}

export interface Multiplexer {
  readonly kind: "tmux" | "herdr";
  /** Launch a detached session running `launchLine`; return the handle to store. */
  open(opts: MuxOpenOpts): Promise<MuxHandle>;
  /** Paste `text` into the session and submit it (Enter). */
  submit(handle: MuxHandle, text: string): Promise<void>;
  /** Is the session still running? */
  isAlive(handle: MuxHandle): Promise<boolean>;
  /** Terminate the session. Idempotent — killing an absent session is not an error. */
  kill(handle: MuxHandle): Promise<void>;
  /** Human-runnable shell command to attach for steering. Display-only; never executed by us. */
  attachCommand(handle: MuxHandle): string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (interface-only; no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/adapters/multiplexer.ts
git commit -m "feat(ai): add Multiplexer seam interface (Phase 2 portable chat adapter)"
```

---

## Task 2: `TmuxIo` env/cwd + `transcriptGlobDir` homeBase seams

These additive options are no-ops today; they let the deferred uid-per-user milestone thread a per-user `HOME`/env without re-opening the seam (spec §5.2, §9).

**Files:**

- Modify: `packages/ai/src/adapters/tmux-bridge.ts`
- Test: `tests/unit/ai-tmux-bridge.test.ts`

- [ ] **Step 1: Read the current seam**

Read `packages/ai/src/adapters/tmux-bridge.ts:11-53` and `:75-97`. Confirm `TmuxIo.run(cmd, args)` and `transcriptGlobDir(provider, cwd)` signatures.

- [ ] **Step 2: Write failing tests**

Append to `tests/unit/ai-tmux-bridge.test.ts`:

```ts
import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("createRealTmuxIo — env/cwd passthrough", () => {
  it("run() accepts an optional opts arg without throwing (env/cwd are optional)", async () => {
    const io = createRealTmuxIo();
    // `true` is a real binary that ignores args; opts must be accepted by the type + at runtime.
    const res = await io.run("true", [], { env: { JARVIS_TEST: "1" }, cwd: "/tmp" });
    expect(res.code).toBe(0);
  });
});

describe("transcriptGlobDir — homeBase override", () => {
  it("uses the provided homeBase instead of the OS homedir", () => {
    const dir = transcriptGlobDir("anthropic", "/tmp/x", "/custom/home");
    expect(dir.startsWith("/custom/home/.claude/projects/")).toBe(true);
  });

  it("defaults to the OS homedir when homeBase is omitted (unchanged behavior)", () => {
    const dir = transcriptGlobDir("anthropic", "/home/ben/Jarv1s/apps/worker");
    expect(dir).toContain("/.claude/projects/-home-ben-Jarv1s-apps-worker");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts`
Expected: FAIL — `run()` 3rd arg is not in the type / `transcriptGlobDir` ignores the 3rd arg.

- [ ] **Step 4: Implement the seams**

In `packages/ai/src/adapters/tmux-bridge.ts`, extend the `TmuxIo.run` signature and `createRealTmuxIo`. Add a `RunOptions` type and thread it into `execFileAsync`:

```ts
export interface RunOptions {
  /** Extra environment variables, merged over process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Working directory for the child process. */
  readonly cwd?: string;
}
```

Update the `TmuxIo` interface `run` member to:

```ts
  run(cmd: string, args: readonly string[], opts?: RunOptions): Promise<{ code: number; stdout: string; stderr?: string }>;
```

In `createRealTmuxIo()`, pass options through to `execFileAsync`:

```ts
    run: async (cmd, args, opts) => {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [...args], {
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          cwd: opts?.cwd
        });
        return { code: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr };
      }
    },
```

> Preserve the existing error-shaping behavior (non-zero `code`, captured stdout/stderr). Match the current implementation's exact return shape — only the `opts` passthrough is new.

Update `transcriptGlobDir`:

```ts
export function transcriptGlobDir(provider: ProviderKind, cwd: string, homeBase: string = homedir()): string {
```

Replace the three internal `homedir()` uses (anthropic, codex, google branches) with `homeBase`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts`
Expected: PASS (new + all pre-existing cases).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/adapters/tmux-bridge.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat(ai): add optional env/cwd to TmuxIo.run and homeBase to transcriptGlobDir"
```

---

## Task 3: `TmuxMultiplexer` backend (default)

Reproduces today's exact tmux verb sequence so it is a behavior-preserving extraction.

**Files:**

- Create: `packages/ai/src/adapters/tmux-multiplexer.ts`
- Test: `tests/unit/ai-tmux-multiplexer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { TmuxMultiplexer } from "../../packages/ai/src/adapters/tmux-multiplexer.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

function calls(io: ReturnType<typeof makeIo>) {
  return io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
}

describe("TmuxMultiplexer", () => {
  it("open() creates a detached session and sends the launch line, returning the name as handle", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    const handle = await mux.open({
      name: "jarv1s-live-x",
      cols: 220,
      rows: 50,
      launchLine: "cd '/n' && claude --tools \"\""
    });

    expect(handle).toBe("jarv1s-live-x");
    const flat = calls(io);
    expect(
      flat.some((c) => c.startsWith("tmux new-session -d -s jarv1s-live-x -x 220 -y 50"))
    ).toBe(true);
    expect(
      flat.some((c) => c.startsWith("tmux send-keys -t jarv1s-live-x") && c.endsWith("Enter"))
    ).toBe(true);
  });

  it("submit() loads+pastes a buffer then sends Enter as a separate step", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    await mux.submit("jarv1s-live-x", "hello");

    const flat = calls(io);
    const pasteIdx = flat.findIndex((c) => c.includes("paste-buffer"));
    const enterIdx = flat.findIndex((c) => c.includes("send-keys") && c.includes("Enter"));
    expect(pasteIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(pasteIdx);
    expect(io.writeFile).toHaveBeenCalledTimes(1); // prompt written to a temp file before paste
  });

  it("isAlive() maps has-session exit code to a boolean", async () => {
    const io = makeIo();
    io.run.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const mux = new TmuxMultiplexer(io);
    expect(await mux.isAlive("jarv1s-live-x")).toBe(true);

    io.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    expect(await mux.isAlive("jarv1s-live-x")).toBe(false);
  });

  it("kill() kills the session", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    await mux.kill("jarv1s-live-x");
    expect(calls(io).some((c) => c.startsWith("tmux kill-session -t jarv1s-live-x"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable tmux attach line", () => {
    const mux = new TmuxMultiplexer(makeIo());
    expect(mux.attachCommand("jarv1s-live-x")).toBe("tmux attach -t jarv1s-live-x");
  });

  it("open() throws when new-session exits non-zero (e.g. binary missing / name clash)", async () => {
    const io = makeIo();
    io.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "duplicate session" });
    const mux = new TmuxMultiplexer(io);
    await expect(
      mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" })
    ).rejects.toThrow(/new-session failed/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-tmux-multiplexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * TmuxMultiplexer — the default Multiplexer backend. Reproduces the exact tmux
 * verb sequence the chat engine used inline before the seam was introduced, so it
 * is a behavior-preserving extraction. tmux session names are stable, so the
 * handle IS the session name (the `name` hint passed to open()).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";

export interface TmuxMultiplexerOpts {
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
}

export class TmuxMultiplexer implements Multiplexer {
  readonly kind = "tmux" as const;
  private readonly submitMs: number;

  constructor(
    private readonly io: TmuxIo,
    opts: TmuxMultiplexerOpts = {}
  ) {
    this.submitMs = opts.submitMs ?? 600;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const created = await this.io.run("tmux", [
      "new-session",
      "-d",
      "-s",
      opts.name,
      "-x",
      String(opts.cols),
      "-y",
      String(opts.rows)
    ]);
    if (created.code !== 0) {
      throw new Error(
        `TmuxMultiplexer.open: tmux new-session failed (code ${created.code}): ${created.stderr ?? ""}`
      );
    }
    const sent = await this.io.run("tmux", [
      "send-keys",
      "-t",
      opts.name,
      opts.launchLine,
      "Enter"
    ]);
    if (sent.code !== 0) {
      throw new Error(
        `TmuxMultiplexer.open: tmux send-keys failed (code ${sent.code}): ${sent.stderr ?? ""}`
      );
    }
    return opts.name;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    const promptFile = join(tmpdir(), `jarv1s-live-prompt-${handle}.txt`);
    const bufferName = handle;
    await this.io.writeFile(promptFile, text);
    await this.runChecked(["load-buffer", "-b", bufferName, promptFile]);
    await this.runChecked(["paste-buffer", "-b", bufferName, "-t", handle]);
    await this.io.sleep(this.submitMs);
    await this.runChecked(["send-keys", "-t", handle, "Enter"]);
  }

  private async runChecked(args: readonly string[]): Promise<void> {
    const { code, stderr } = await this.io.run("tmux", args);
    if (code !== 0) {
      throw new Error(
        `TmuxMultiplexer: \`tmux ${args[0]}\` failed (code ${code}): ${stderr ?? ""}`
      );
    }
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("tmux", ["has-session", "-t", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    await this.io.run("tmux", ["kill-session", "-t", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    return `tmux attach -t ${handle}`;
  }
}
```

> Note: the prompt temp file moves here from the engine. The buffer name stays `= handle` so the verb shape matches the engine's pre-refactor `bufferName = jarv1s-live-${threadKey}` (the handle is that same string). `submitMs` default 600 matches the engine's old default.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-tmux-multiplexer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/tmux-multiplexer.ts tests/unit/ai-tmux-multiplexer.test.ts
git commit -m "feat(ai): add TmuxMultiplexer backend (behavior-preserving tmux extraction)"
```

---

## Task 4: `HerdrMultiplexer` backend

> **Integration risk (grill-flagged + Codex-hardened):** herdr has no "new detached session" verb. `open()` splits a pane from a **deliberately chosen** root pane and parses the server-assigned, opaque `pane_id` from herdr's **JSON** output (herdr v0.6.8 emits JSON by default — there is no `--json` flag; envelope `{"id":"cli:pane:X","result":{...},"type":"..."}`). `pane get` checks liveness; `pane close` kills. Launch is symmetric with tmux: `send-text <launchLine>` then `send-keys Enter` (we deliberately avoid `pane run`, whose shell-quoting semantics are unspecified). **Root pane is NEVER "the first pane in `pane list`"** — a real herdr server lists unrelated operator/Codex/Claude panes, so splitting from an arbitrary one is unsafe (Codex finding #4). Resolution is: `opts.rootPane` → `JARVIS_HERDR_ROOT_PANE` → `HERDR_PANE_ID` (the server's _own_ pane, set by herdr when the API runs inside a pane) → hard error. Every `herdr` command's exit code is checked; a non-zero exit throws (Codex findings #3/#5). **Build this before Task 6 — the resolver imports it.**

**Files:**

- Create: `packages/ai/src/adapters/herdr-multiplexer.ts`
- Test: `tests/unit/ai-herdr-multiplexer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { HerdrMultiplexer } from "../../packages/ai/src/adapters/herdr-multiplexer.js";

function makeIo(overrides: Record<string, { code: number; stdout: string }> = {}) {
  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    const key = [cmd, ...args].join(" ");
    for (const prefix of Object.keys(overrides)) {
      if (key.startsWith(prefix))
        return { code: overrides[prefix].code, stdout: overrides[prefix].stdout, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  return {
    run,
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

// Realistic herdr v0.6.8 envelopes; pane ids look like "p_51" (server/workspace-assigned).
const SPLIT_JSON =
  '{"id":"cli:pane:split","result":{"pane":{"pane_id":"p_77"}},"type":"pane_info"}';

describe("HerdrMultiplexer", () => {
  it("open() splits from the explicit root pane, parses the new pane id, types the launch line, and returns the id", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: SPLIT_JSON } });
    const mux = new HerdrMultiplexer(io, { rootPane: "p_51" });
    const handle = await mux.open({
      name: "jarv1s-live-x",
      cols: 220,
      rows: 50,
      launchLine: "cd '/n' && claude"
    });

    expect(handle).toBe("p_77");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(
      flat.some((c) => c.startsWith("herdr pane split p_51 --direction down --no-focus"))
    ).toBe(true);
    const textIdx = flat.findIndex((c) => c.startsWith("herdr pane send-text p_77"));
    const enterIdx = flat.findIndex(
      (c) => c.startsWith("herdr pane send-keys p_77") && c.includes("Enter")
    );
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(textIdx);
  });

  it("open() resolves the root pane from HERDR_PANE_ID when no override is given (NOT from `pane list`)", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: SPLIT_JSON } });
    const mux = new HerdrMultiplexer(io, { env: { HERDR_PANE_ID: "p_51" } });
    await mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" });
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane list"))).toBe(false); // never enumerates other operators' panes
    expect(flat.some((c) => c.startsWith("herdr pane split p_51"))).toBe(true);
  });

  it("open() throws when no root pane can be resolved (no override, no env)", async () => {
    const mux = new HerdrMultiplexer(makeIo(), { env: {} });
    await expect(mux.open({ name: "x", cols: 1, rows: 1, launchLine: "c" })).rejects.toThrow(
      /root pane/i
    );
  });

  it("open() throws a clear error when herdr returns non-JSON", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: "not json" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/herdr/i);
  });

  it("open() throws when `pane split` exits non-zero", async () => {
    const io = makeIo({ "herdr pane split": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/split failed/i);
  });

  it("open() throws when send-text after split exits non-zero", async () => {
    const io = makeIo({
      "herdr pane split": { code: 0, stdout: SPLIT_JSON },
      "herdr pane send-text": { code: 1, stdout: "" }
    });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/send-text failed/i);
  });

  it("submit() sends text then Enter to the pane handle, checking exit codes", async () => {
    const io = makeIo();
    const mux = new HerdrMultiplexer(io, { rootPane: "p_51" });
    await mux.submit("p_77", "hello");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    const textIdx = flat.findIndex((c) => c.startsWith("herdr pane send-text p_77"));
    const enterIdx = flat.findIndex(
      (c) => c.startsWith("herdr pane send-keys p_77") && c.includes("Enter")
    );
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(textIdx);
  });

  it("submit() throws when send-text exits non-zero", async () => {
    const io = makeIo({ "herdr pane send-text": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).submit("p_77", "hi")
    ).rejects.toThrow(/send-text failed/i);
  });

  it("isAlive() maps `pane get` exit code to a boolean", async () => {
    const ioAlive = makeIo({ "herdr pane get p_77": { code: 0, stdout: "{}" } });
    expect(await new HerdrMultiplexer(ioAlive, { rootPane: "p_51" }).isAlive("p_77")).toBe(true);
    const ioDead = makeIo({ "herdr pane get p_77": { code: 1, stdout: "" } });
    expect(await new HerdrMultiplexer(ioDead, { rootPane: "p_51" }).isAlive("p_77")).toBe(false);
  });

  it("kill() closes the pane and ignores the exit code (idempotent)", async () => {
    const io = makeIo({ "herdr pane close p_77": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).kill("p_77")
    ).resolves.toBeUndefined();
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane close p_77"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable herdr attach hint", () => {
    const mux = new HerdrMultiplexer(makeIo(), { rootPane: "p_51" });
    expect(mux.attachCommand("p_77")).toContain("herdr");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-herdr-multiplexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * HerdrMultiplexer — Multiplexer backend over the herdr terminal workspace
 * manager (`herdr pane …` socket API, v0.6.8). herdr emits JSON by default
 * (no --json flag): envelope { id, result, type }. Unlike tmux, herdr has no
 * "new detached session" verb: a pane is split from a root pane and the server
 * assigns an OPAQUE pane id. open() therefore returns that id as the handle; the
 * engine stores it and never reconstructs it (the Multiplexer asymmetry).
 * cols/rows and the `name` hint are tmux-specific and intentionally unused here —
 * herdr auto-sizes and assigns its own id.
 *
 * Root pane resolution (NO "first pane in `pane list`" default — that could split
 * from an unrelated operator/agent pane on a shared herdr server, Codex #4):
 *   opts.rootPane → env.JARVIS_HERDR_ROOT_PANE → env.HERDR_PANE_ID (the server's
 *   own pane, set by herdr when the API process runs inside a pane) → hard error.
 *
 * Every herdr command's exit code is checked; a non-zero exit throws (so a missing
 * binary via the JARVIS_MULTIPLEXER override, or a transient socket failure, fails
 * loudly instead of returning a dead handle — Codex #3/#5). kill() is the sole
 * exception: it ignores the exit code (idempotent per the Multiplexer contract).
 */
import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";

export interface HerdrMultiplexerOpts {
  /** Parent pane to split from; else JARVIS_HERDR_ROOT_PANE; else HERDR_PANE_ID. */
  readonly rootPane?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class HerdrMultiplexer implements Multiplexer {
  readonly kind = "herdr" as const;
  private readonly rootPaneOverride?: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly io: TmuxIo,
    opts: HerdrMultiplexerOpts = {}
  ) {
    this.rootPaneOverride = opts.rootPane;
    this.env = opts.env ?? process.env;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const root = this.resolveRootPane();
    const split = await this.io.run("herdr", [
      "pane",
      "split",
      root,
      "--direction",
      "down",
      "--no-focus"
    ]);
    if (split.code !== 0) {
      throw new Error(
        `HerdrMultiplexer.open: \`herdr pane split\` failed (code ${split.code}): ${split.stderr ?? ""}`
      );
    }
    const paneId = paneIdFromInfo(split.stdout);
    if (!paneId) {
      throw new Error(
        "HerdrMultiplexer.open: could not parse pane_id from `herdr pane split` JSON"
      );
    }
    // Launch symmetrically with tmux: type the launch line, then submit Enter.
    await this.runChecked(["pane", "send-text", paneId, opts.launchLine], "send-text");
    await this.runChecked(["pane", "send-keys", paneId, "Enter"], "send-keys");
    return paneId;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    await this.runChecked(["pane", "send-text", handle, text], "send-text");
    await this.runChecked(["pane", "send-keys", handle, "Enter"], "send-keys");
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("herdr", ["pane", "get", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    // Idempotent per the Multiplexer contract: closing an absent pane is not an error.
    await this.io.run("herdr", ["pane", "close", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    return `herdr   # then focus pane ${handle}`;
  }

  private resolveRootPane(): string {
    const root =
      this.rootPaneOverride?.trim() ||
      this.env.JARVIS_HERDR_ROOT_PANE?.trim() ||
      this.env.HERDR_PANE_ID?.trim();
    if (!root) {
      throw new Error(
        "HerdrMultiplexer: no root pane (set JARVIS_HERDR_ROOT_PANE, or run the API inside a herdr pane so HERDR_PANE_ID is set)"
      );
    }
    return root;
  }

  private async runChecked(args: readonly string[], label: string): Promise<void> {
    const { code, stderr } = await this.io.run("herdr", args);
    if (code !== 0) {
      throw new Error(
        `HerdrMultiplexer: \`herdr ${label}\` failed (code ${code}): ${stderr ?? ""}`
      );
    }
  }
}

interface HerdrEnvelope {
  result?: { pane?: { pane_id?: unknown } };
}

function parseHerdr(stdout: string): HerdrEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as HerdrEnvelope;
  } catch {
    throw new Error(`HerdrMultiplexer: expected JSON from herdr, got: ${trimmed.slice(0, 120)}`);
  }
}

/** `herdr pane split` → { result: { pane: { pane_id } }, type: "pane_info" }. */
function paneIdFromInfo(stdout: string): string | null {
  const id = parseHerdr(stdout)?.result?.pane?.pane_id;
  return typeof id === "string" && id ? id : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-herdr-multiplexer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/herdr-multiplexer.ts tests/unit/ai-herdr-multiplexer.test.ts
git commit -m "feat(ai): add HerdrMultiplexer backend (pane split → opaque handle, JSON-parsed)"
```

---

## Task 5: `createBinaryProbe` — PATH availability scan

Detects whether `tmux` / `herdr` are installed, with no shell and no `execFile` (a pure PATH scan over an injectable fs seam, so it is fully unit-testable).

**Files:**

- Create: `packages/ai/src/adapters/binary-probe.ts`
- Test: `tests/unit/ai-binary-probe.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { createBinaryProbe } from "../../packages/ai/src/adapters/binary-probe.js";

function fakeIo(installed: string[]) {
  return { isExecutable: (p: string) => installed.includes(p) };
}

describe("createBinaryProbe", () => {
  it("detects a binary present on PATH", () => {
    const probe = createBinaryProbe({ PATH: "/a:/b" }, fakeIo(["/b/tmux"]));
    expect(probe.has("tmux")).toBe(true);
    expect(probe.has("herdr")).toBe(false);
  });

  it("reports both absent when PATH is empty", () => {
    const probe = createBinaryProbe({ PATH: "" }, fakeIo([]));
    expect(probe.has("tmux")).toBe(false);
    expect(probe.has("herdr")).toBe(false);
  });

  it("detects herdr across multiple PATH dirs", () => {
    const probe = createBinaryProbe({ PATH: "/x:/y:/z" }, fakeIo(["/z/herdr"]));
    expect(probe.has("herdr")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-binary-probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * createBinaryProbe — eagerly scans PATH once for the multiplexer binaries and
 * caches the result. No shell, no execFile: it stats `${dir}/${bin}` for each PATH
 * entry through an injectable fs seam, so it is deterministic and unit-testable.
 */
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface BinaryProbe {
  has(bin: "tmux" | "herdr"): boolean;
}

export interface BinaryProbeIo {
  /** True if `path` exists and is executable by this process. */
  isExecutable(path: string): boolean;
}

export function createRealBinaryProbeIo(): BinaryProbeIo {
  return {
    isExecutable(path: string): boolean {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function createBinaryProbe(
  env: NodeJS.ProcessEnv = process.env,
  io: BinaryProbeIo = createRealBinaryProbeIo()
): BinaryProbe {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const found = (bin: string): boolean => dirs.some((d) => io.isExecutable(join(d, bin)));
  const cache = { tmux: found("tmux"), herdr: found("herdr") };
  return { has: (bin) => cache[bin] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-binary-probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/binary-probe.ts tests/unit/ai-binary-probe.test.ts
git commit -m "feat(ai): add createBinaryProbe (PATH scan for tmux/herdr)"
```

---

## Task 6: `decideMultiplexer` (pure) + `resolveMultiplexer` (io-binding)

The selection logic, split into a **pure decision** (no io — used by both the boot resolver and any future "what would auto pick?" surface) and a thin **io-binding wrapper** that instantiates the chosen backend.

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (the single source of truth for the choice union)
- Create: `packages/ai/src/adapters/multiplexer-resolve.ts`
- Test: `tests/unit/ai-multiplexer-resolve.test.ts`

- [ ] **Step 0: Define the choice union ONCE in `@jarv1s/shared`**

To prevent type drift across `@jarv1s/ai`, `@jarv1s/settings`, and `@jarv1s/shared` (Codex finding #8), the union lives only in shared; ai and settings consume it. Add to `packages/shared/src/platform-api.ts` (`@jarv1s/ai` already depends on `@jarv1s/shared`):

```ts
/** The admin-selectable multiplexer choice. Single source of truth — ai/settings import this. */
export type ChatMultiplexerChoice = "auto" | "tmux" | "herdr";
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  decideMultiplexer,
  resolveMultiplexer
} from "../../packages/ai/src/adapters/multiplexer-resolve.js";

const both = () => true;
const none = () => false;
const only = (k: string) => (b: string) => b === k;
const ROOT = { HERDR_PANE_ID: "p_51" }; // makes herdr "usable" (a root pane is resolvable)
const io = {
  run: async () => ({ code: 0, stdout: "" }),
  sleep: async () => {},
  readFile: async () => "",
  writeFile: async () => {}
} as never;

describe("decideMultiplexer", () => {
  it("env override wins and bypasses the install probe", () => {
    expect(
      decideMultiplexer({
        env: { JARVIS_MULTIPLEXER: "herdr" },
        configured: "auto",
        isInstalled: none
      })
    ).toEqual({ ok: true, kind: "herdr", source: "env" });
  });
  it("throws on an invalid env override", () => {
    expect(() =>
      decideMultiplexer({
        env: { JARVIS_MULTIPLEXER: "screen" },
        configured: "auto",
        isInstalled: both
      })
    ).toThrow(/JARVIS_MULTIPLEXER/);
  });
  it("honors an explicit herdr admin setting when installed AND a root pane is resolvable", () => {
    expect(
      decideMultiplexer({ env: ROOT, configured: "herdr", isInstalled: only("herdr") })
    ).toEqual({ ok: true, kind: "herdr", source: "configured" });
  });
  it("fails when herdr is selected and installed but NO root pane is resolvable", () => {
    const d = decideMultiplexer({ env: {}, configured: "herdr", isInstalled: only("herdr") });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.reason).toMatch(/root pane/i);
  });
  it("fails when the explicit admin setting is not installed", () => {
    expect(decideMultiplexer({ env: {}, configured: "tmux", isInstalled: only("herdr") }).ok).toBe(
      false
    );
  });
  it("auto prefers tmux when both usable and not inside herdr", () => {
    expect(decideMultiplexer({ env: ROOT, configured: "auto", isInstalled: both })).toMatchObject({
      ok: true,
      kind: "tmux",
      source: "auto"
    });
  });
  it("auto prefers herdr when inside herdr (HERDR_ENV=1) and herdr is usable", () => {
    expect(
      decideMultiplexer({ env: { ...ROOT, HERDR_ENV: "1" }, configured: "auto", isInstalled: both })
    ).toMatchObject({ ok: true, kind: "herdr" });
  });
  it("auto FALLS BACK TO TMUX when herdr is installed but has no root pane (the R2-#1 fix)", () => {
    // herdr binary present, but no HERDR_PANE_ID/JARVIS_HERDR_ROOT_PANE → herdr not usable.
    expect(
      decideMultiplexer({ env: { HERDR_ENV: "1" }, configured: "auto", isInstalled: both })
    ).toMatchObject({ ok: true, kind: "tmux" });
  });
  it("auto falls back to herdr when only herdr is usable", () => {
    expect(
      decideMultiplexer({ env: ROOT, configured: "auto", isInstalled: only("herdr") })
    ).toMatchObject({ ok: true, kind: "herdr" });
  });
  it("auto fails when neither is usable", () => {
    expect(decideMultiplexer({ env: {}, configured: "auto", isInstalled: none }).ok).toBe(false);
  });
});

describe("resolveMultiplexer", () => {
  it("returns a Multiplexer of the decided kind", () => {
    const r = resolveMultiplexer({ io, env: {}, configured: "auto", isInstalled: only("tmux") });
    expect(r.ok && r.mux.kind).toBe("tmux");
  });
  it("propagates the unavailable reason", () => {
    expect(resolveMultiplexer({ io, env: {}, configured: "auto", isInstalled: none }).ok).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-multiplexer-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Multiplexer selection. Precedence (grill-locked):
 *   1. JARVIS_MULTIPLEXER env override — wins, BYPASSES the install probe (a deploy
 *      escape hatch; an invalid value is a fail-fast config error).
 *   2. Explicit admin setting (chat.multiplexer = tmux|herdr) — honored only if
 *      that binary is actually installed; otherwise unavailable.
 *   3. auto — detect what is installed; tie-break herdr when running inside herdr
 *      (HERDR_ENV=1), else tmux, else the other, else unavailable.
 * decideMultiplexer is pure (no io); resolveMultiplexer binds the chosen backend.
 */
import type { ChatMultiplexerChoice } from "@jarv1s/shared";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer } from "./multiplexer.js";
import { TmuxMultiplexer } from "./tmux-multiplexer.js";
import { HerdrMultiplexer } from "./herdr-multiplexer.js";

export type MultiplexerKind = "tmux" | "herdr";
export type MultiplexerSource = "env" | "configured" | "auto";

export interface MultiplexerDecisionInput {
  readonly env: NodeJS.ProcessEnv;
  readonly configured: ChatMultiplexerChoice;
  readonly isInstalled: (bin: MultiplexerKind) => boolean;
}

export type MultiplexerDecision =
  | { readonly ok: true; readonly kind: MultiplexerKind; readonly source: MultiplexerSource }
  | { readonly ok: false; readonly reason: string };

export function decideMultiplexer(input: MultiplexerDecisionInput): MultiplexerDecision {
  const { env, configured, isInstalled } = input;

  // herdr is only USABLE if its binary is present AND a root pane can be resolved
  // (explicit JARVIS_HERDR_ROOT_PANE, or the server's own HERDR_PANE_ID). Without
  // a root pane, picking herdr would boot a backend that only fails at launch — so
  // it must not count as available for `auto`/`configured` resolution (Codex R2 #1).
  const herdrRootAvailable = Boolean(
    env.JARVIS_HERDR_ROOT_PANE?.trim() || env.HERDR_PANE_ID?.trim()
  );
  const herdrUsable = isInstalled("herdr") && herdrRootAvailable;
  const tmuxUsable = isInstalled("tmux");

  // 1. Env override wins, BYPASSES the probe (deploy escape hatch). The operator owns
  //    correctness; a missing binary or root pane fails loudly at launch (→ 503).
  const override = env.JARVIS_MULTIPLEXER?.trim().toLowerCase();
  if (override === "tmux" || override === "herdr") {
    return { ok: true, kind: override, source: "env" };
  }
  if (override !== undefined && override !== "") {
    throw new Error(`JARVIS_MULTIPLEXER must be "tmux" or "herdr"; got "${override}"`);
  }

  // 2. Explicit admin setting — honored only if actually usable.
  if (configured === "tmux") {
    return tmuxUsable
      ? { ok: true, kind: "tmux", source: "configured" }
      : {
          ok: false,
          reason: `multiplexer "tmux" is selected in admin settings but is not installed on this host`
        };
  }
  if (configured === "herdr") {
    if (herdrUsable) return { ok: true, kind: "herdr", source: "configured" };
    return {
      ok: false,
      reason: isInstalled("herdr")
        ? `multiplexer "herdr" is selected but no root pane is available (set JARVIS_HERDR_ROOT_PANE or run the API inside a herdr pane)`
        : `multiplexer "herdr" is selected in admin settings but is not installed on this host`
    };
  }

  // 3. auto — tie-break herdr when inside herdr AND herdr is usable; else tmux; else herdr; else none.
  if (env.HERDR_ENV === "1" && herdrUsable) return { ok: true, kind: "herdr", source: "auto" };
  if (tmuxUsable) return { ok: true, kind: "tmux", source: "auto" };
  if (herdrUsable) return { ok: true, kind: "herdr", source: "auto" };
  return {
    ok: false,
    reason:
      "no usable terminal multiplexer found (install tmux, or install herdr and set a root pane)"
  };
}

export interface MultiplexerResolutionInput extends MultiplexerDecisionInput {
  readonly io: TmuxIo;
}

export type MultiplexerResolution =
  | { readonly ok: true; readonly mux: Multiplexer; readonly source: MultiplexerSource }
  | { readonly ok: false; readonly reason: string };

export function resolveMultiplexer(input: MultiplexerResolutionInput): MultiplexerResolution {
  const decision = decideMultiplexer(input);
  if (!decision.ok) return decision;
  // Pass the SAME env the decision used, so the backend resolves the same root pane
  // it was judged usable with (Codex R2 #5 — don't let it fall back to process.env).
  const mux =
    decision.kind === "herdr"
      ? new HerdrMultiplexer(input.io, { env: input.env })
      : new TmuxMultiplexer(input.io);
  return { ok: true, mux, source: decision.source };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-multiplexer-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/platform-api.ts packages/ai/src/adapters/multiplexer-resolve.ts tests/unit/ai-multiplexer-resolve.test.ts
git commit -m "feat(ai): add ChatMultiplexerChoice (shared) + decideMultiplexer/resolveMultiplexer (env override, admin setting, root-pane-aware auto-detect)"
```

---

## Task 7: Barrel-export the new `@jarv1s/ai` modules

**Files:**

- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Add exports**

After the existing `export * from "./adapters/tmux-bridge.js";` line, add:

```ts
export * from "./adapters/multiplexer.js";
export * from "./adapters/tmux-multiplexer.js";
export * from "./adapters/herdr-multiplexer.js";
export * from "./adapters/binary-probe.js";
export * from "./adapters/multiplexer-resolve.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/index.ts
git commit -m "feat(ai): export multiplexer seam, backends, probe, and resolver from the package barrel"
```

---

## Task 8: Refactor the engine to delegate to `Multiplexer`

The core engine change. The engine stops issuing tmux verbs inline and instead calls an injected `Multiplexer`, storing the handle `open()` returns. The default mux is `TmuxMultiplexer(io)`, so the external `io.run` call sequence is unchanged → all existing engine tests pass without edits (other than the rename import in Task 9).

**Files:**

- Create: `packages/chat/src/live/errors.ts`
- Modify: `packages/chat/src/live/cli-chat-engine.ts`
- Modify: `packages/chat/src/live/types.ts`

- [ ] **Step 0: Create the dependency-free error module**

The engine throws this on launch failure, and `runtime.ts`/routes map it to 503. It lives in its own module (imported by nothing) so the engine can throw it without importing `runtime.ts` — which imports the engine, a cycle. Create `packages/chat/src/live/errors.ts`:

```ts
/**
 * Thrown when a live CLI session cannot be hosted: no terminal multiplexer
 * (tmux/herdr) is available/configured, OR the chosen multiplexer failed to launch
 * the session. Both map to HTTP 503. `cause` carries the underlying error for
 * server-side logging; the message is operator-safe (no secrets/stderr leakage).
 */
export class CliChatUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliChatUnavailableError";
  }
}
```

- [ ] **Step 1: Fix the `types.ts` stale comment**

In `packages/chat/src/live/types.ts:25`, change the `mcpToken` comment from "per-session JWT" to:

```ts
  /** Opaque per-session MCP bearer token (jst_<uuid>), minted at launch. */
  readonly mcpToken?: string;
```

- [ ] **Step 2: Rewrite the engine header + class**

In `packages/chat/src/live/cli-chat-engine.ts`:

Replace the header comment (`:1-22`) — drop the stale `TmuxBridgeAdapter` reference; describe the multiplexer-neutral engine. Keep the SECURITY-CRITICAL flags block verbatim (lines documenting `--permission-mode default`, `--tools ""`, etc.).

Add imports:

```ts
import { TmuxMultiplexer, type Multiplexer, type MuxHandle } from "@jarv1s/ai";
import { CliChatUnavailableError } from "./errors.js";
```

Rename `interface TmuxCliChatEngineOpts` → `CliChatEngineOpts` and add `mux`:

```ts
export interface CliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter (passed to the default tmux backend). */
  readonly submitMs?: number;
  /** Multiplexer backend; defaults to a TmuxMultiplexer over the same io (preserves legacy behavior). */
  readonly mux?: Multiplexer;
}
```

Rename `class TmuxCliChatEngine` → `class CliChatEngineImpl`. Update the constructor:

```ts
export class CliChatEngineImpl implements CliChatEngine {
  private readonly launchMs: number;
  private readonly mux: Multiplexer;
  /** The opaque session handle returned by mux.open() at launch. */
  private handle: MuxHandle | null = null;

  /** Set at launch: the exact JSONL transcript path (session-id pinned). */
  private storedTranscriptPath: string | null = null;

  constructor(
    public readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: CliChatEngineOpts = {}
  ) {
    this.launchMs = opts.launchMs ?? 3_000;
    this.mux = opts.mux ?? new TmuxMultiplexer(io, { submitMs: opts.submitMs ?? 600 });
  }
```

> Removed fields: `sessionName`, `submitMs`, `promptFile` (the buffer/temp-file lives in TmuxMultiplexer now). `SESSION_PREFIX` stays — it builds the `name` hint.

- [ ] **Step 3: Rewrite `launch()` to use the seam**

Keep `randomUUID()`, the google `.gemini/settings.json` special-case, and `storedTranscriptPath` derivation **verbatim**. Replace the two inline tmux calls (`new-session` + `send-keys`) with `mux.open`, store the handle, then sleep:

```ts
  async launch(opts: EngineLaunchOpts): Promise<void> {
    const sessionId = randomUUID();

    if (this.provider === "google" && opts.mcpToken && opts.mcpServerUrl) {
      // ... unchanged .gemini/settings.json block ...
    }

    this.storedTranscriptPath = join(
      transcriptGlobDir(this.provider, opts.neutralDir),
      `${sessionId}.jsonl`
    );

    const launchLine = this.buildLaunchCommand(opts, sessionId);
    try {
      this.handle = await this.mux.open({
        name: `${SESSION_PREFIX}${this.threadKey}`,
        cols: 220,
        rows: 50,
        launchLine
      });
    } catch (err) {
      // A backend exit-code failure (missing binary via JARVIS_MULTIPLEXER override,
      // herdr socket failure, unresolvable root pane, tmux new-session failure) throws
      // a plain Error from mux.open(). Convert it to the 503-mapped error with a
      // sanitized message; the raw cause is logged server-side by the route handler
      // (Codex R2 #2). Never surface raw stderr to the client.
      throw new CliChatUnavailableError("could not start the live chat session", { cause: err });
    }

    await this.io.sleep(this.launchMs);
  }
```

- [ ] **Step 4: Rewrite `submit()`, `isAlive()`, `kill()` to delegate**

```ts
  async submit(text: string): Promise<void> {
    const sanitized = sanitizeInput(text);
    await this.mux.submit(this.requireHandle(), sanitized);
  }

  async isAlive(): Promise<boolean> {
    if (this.handle === null) return false;
    return this.mux.isAlive(this.handle);
  }

  async kill(): Promise<void> {
    if (this.handle === null) return;
    await this.mux.kill(this.handle);
  }
```

Add a private guard near the other helpers:

```ts
  private requireHandle(): MuxHandle {
    if (this.handle === null) {
      throw new Error("CliChatEngineImpl.submit called before launch()");
    }
    return this.handle;
  }
```

> `sanitizeInput` stays in the engine — it is applied on the one programmatic input path before delegating to the backend (spec §5.1). `readNew()` and `transcriptPath()` are unchanged except for the error-message class name (`CliChatEngineImpl.…`).

- [ ] **Step 5: Fix the stale Codex comment**

In `buildCodexCommand`, replace the comment at the old `:238-240` ("accepted tradeoff for a local single-user session…") with:

```ts
// Codex reads the Bearer token via bearer_token_env_var; there is no file-based injection
// equivalent, so the token appears in the launch line and ps output. Under the household
// model this is a shared-uid soft boundary (see the chat module README "Known security
// limitation"); the token is short-lived, process-scoped, and RLS-scoped server-side.
```

Do **not** change any flag in `buildClaudeCommand` / `buildCodexCommand` / `buildGeminiCommand`.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL only in `runtime.ts` + the two test files that still import `TmuxCliChatEngine` (fixed in Tasks 9 & 10). The engine module itself must typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/live/errors.ts packages/chat/src/live/cli-chat-engine.ts packages/chat/src/live/types.ts
git commit -m "refactor(chat): engine delegates session verbs to Multiplexer; store opaque handle"
```

---

## Task 9: Update engine tests to the renamed class (no behavior change)

**Files:**

- Modify: `tests/unit/cli-chat-engine.test.ts`
- Modify: `tests/unit/chat-live-engine.test.ts`

- [ ] **Step 1: Update imports + describe labels**

In both files, change:

```ts
import { TmuxCliChatEngine } from "../../packages/chat/src/live/cli-chat-engine.js";
```

to:

```ts
import { CliChatEngineImpl } from "../../packages/chat/src/live/cli-chat-engine.js";
```

Replace every `new TmuxCliChatEngine(` with `new CliChatEngineImpl(`. The `{ launchMs: 0, submitMs: 0 }` opts calls stay valid (4th positional arg is still `opts`). Update `describe("TmuxCliChatEngine` labels to `CliChatEngineImpl` for clarity (cosmetic).

- [ ] **Step 2: Run both engine test files**

Run: `pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts`
Expected: PASS — the default `TmuxMultiplexer(io)` reproduces the exact `io.run` tmux verb sequence (`new-session`, `send-keys ... Enter`, `load-buffer`/`paste-buffer`, `has-session`, `kill-session`) and the prompt `writeFile`, so every existing assertion holds.

- [ ] **Step 3: Lock the remaining launch-flag posture with explicit assertions**

The security posture must be guarded by tests, not just by the verbatim-preserve instruction (Codex finding #6). The existing tests already assert Claude `--allowedTools mcp__jarvis__*` / `--tools ""` fallback / `mcp-config`, Codex `shell_tool=false` / `apply_patch_tool=false` / `sandbox read-only`, and Gemini `--allowed-mcp-server-names jarvis`. Add the **three currently-unasserted** flags to the relevant existing cases in `tests/unit/cli-chat-engine.test.ts`:

```ts
// In the Claude launch-line cases (both the --allowedTools and --tools "" paths):
expect(launchLine).toContain("--permission-mode default");
expect(launchLine).toContain("--strict-mcp-config");

// In the Codex launch-line case:
expect(launchLine).toContain("-a never");
```

> If any of these assertions fails, that is a real posture regression, not a test bug — stop and confirm `buildClaudeCommand`/`buildCodexCommand` still emit them before adjusting anything. Do not weaken the assertion to make it pass.

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts
git add tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts
git commit -m "test(chat): rename engine refs to CliChatEngineImpl + lock full launch-flag posture"
```

---

## Task 10: Chat runtime — injectable factory builder + unavailable state

Turn the single hardcoded `realEngineFactory` into a builder that accepts the resolved `Multiplexer`, and add the typed "no multiplexer" state. The resolution itself happens at the composition root (Task 13).

**Files:**

- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/chat/src/index.ts`
- Modify: `packages/chat/src/live-routes.ts` (503 mapping on the live launch path)
- Modify: `packages/chat/src/routes.ts`

- [ ] **Step 1: Write a failing test**

Append to `tests/unit/chat-live-manager.test.ts` (or create `tests/unit/chat-runtime-factory.test.ts` if cleaner):

```ts
import { describe, expect, it } from "vitest";
import {
  createRealEngineFactory,
  unavailableEngineFactory,
  CliChatUnavailableError
} from "../../packages/chat/src/live/runtime.js";

describe("createRealEngineFactory", () => {
  it("builds an engine using the injected multiplexer kind", () => {
    const mux = {
      kind: "herdr" as const,
      open: async () => "h",
      submit: async () => {},
      isAlive: async () => true,
      kill: async () => {},
      attachCommand: () => "herdr"
    };
    const engine = createRealEngineFactory({ mux })("anthropic", "thread-1");
    expect(engine).toBeDefined();
  });
});

describe("unavailableEngineFactory", () => {
  it("throws CliChatUnavailableError when invoked", () => {
    const factory = unavailableEngineFactory("no multiplexer");
    expect(() => factory("anthropic", "t")).toThrow(CliChatUnavailableError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/chat-live-manager.test.ts`
Expected: FAIL — exports do not exist.

> Note: `packages/chat/src/live/errors.ts` (the `CliChatUnavailableError` class) was already created in **Task 8 Step 0** — `runtime.ts` only imports and re-exports it here. No new file in this task.

- [ ] **Step 3: Implement in `runtime.ts`**

Change the import (`:18`) to the renamed class and add `Multiplexer` to the `@jarv1s/ai` import (`:12`); import + re-export the error:

```ts
import { AiRepository, createRealTmuxIo, type Multiplexer, type ProviderKind } from "@jarv1s/ai";
import { CliChatEngineImpl } from "./cli-chat-engine.js";
import { CliChatUnavailableError } from "./errors.js";
export { CliChatUnavailableError } from "./errors.js";
```

Replace `realEngineFactory` (`:44-45`) with the builder + unavailable state:

```ts
/**
 * Builds the production engine factory. The multiplexer is resolved ONCE at the
 * composition root (module-registry) and injected here, so every session shares
 * one stateless backend. With no mux it defaults to tmux (preserves legacy
 * single-host behavior for tests and standalone embedders).
 */
export function createRealEngineFactory(opts: { mux?: Multiplexer } = {}): ChatEngineFactory {
  return (provider, sessionKey) =>
    new CliChatEngineImpl(provider, sessionKey, createRealTmuxIo(), { mux: opts.mux });
}

/** A factory that refuses to launch: used when the host has no multiplexer installed. */
export function unavailableEngineFactory(reason: string): ChatEngineFactory {
  return () => {
    throw new CliChatUnavailableError(reason);
  };
}

/** Back-compat default: tmux over a fresh io (unchanged behavior). */
export const realEngineFactory: ChatEngineFactory = createRealEngineFactory();
```

- [ ] **Step 4: Export from the chat barrel**

In `packages/chat/src/index.ts`, ensure these are re-exported (add to the existing runtime re-export, or add a line):

```ts
export {
  createRealEngineFactory,
  unavailableEngineFactory,
  CliChatUnavailableError,
  realEngineFactory,
  type ChatEngineFactory
} from "./live/runtime.js";
```

- [ ] **Step 5: Map `CliChatUnavailableError` → HTTP 503 on the LIVE path**

The live-session launch flows through `handleLiveRouteError` in `packages/chat/src/live-routes.ts` (the function near `:164`), whose fallback turns any unrecognized error into a generic **500**. The engine factory throws `CliChatUnavailableError` synchronously when no multiplexer is installed, so without an explicit branch a no-multiplexer host returns a misleading 500 (Codex finding #2). Add the branch **before** the generic-500 fallback:

```ts
import { CliChatUnavailableError } from "./live/errors.js";
// ...inside handleLiveRouteError, before the final reply.code(500):
if (error instanceof CliChatUnavailableError) {
  // Log the underlying cause server-side; send a fixed, sanitized message (the
  // error covers both "no multiplexer configured" and "launch failed").
  reply.log?.warn?.(
    { err: error, cause: (error as { cause?: unknown }).cause },
    "live chat unavailable"
  );
  return reply.code(503).send({ error: "Live chat is currently unavailable on this host." });
}
```

Also add the same branch to `handleRouteError` in `packages/chat/src/routes.ts` (`:281`) for the REST chat routes, for symmetry:

```ts
import { CliChatUnavailableError } from "./live/errors.js";
// ...inside handleRouteError, before the generic fallback:
if (error instanceof CliChatUnavailableError) {
  reply.log?.warn?.({ err: error }, "live chat unavailable");
  return reply.code(503).send({ error: "Live chat is currently unavailable on this host." });
}
```

- [ ] **Step 6: Add a route-level test for the 503**

In the live-routes test suite (find it: `grep -rl "live-routes\|registerChatLiveRoutes\|/api/chat/live" tests/`), add a case where the injected `engineFactory` throws `CliChatUnavailableError` and assert the launch endpoint responds **503** (not 500):

```ts
it("returns 503 when no multiplexer is available", async () => {
  const factory = () => {
    throw new CliChatUnavailableError("no terminal multiplexer (tmux/herdr) installed");
  };
  // build the live routes with { engineFactory: factory } via the suite's existing harness, then:
  const res = await app.inject({
    method: "POST",
    url: "<the live launch route>",
    headers: authHeaders,
    payload: {
      /* minimal valid launch body */
    }
  });
  expect(res.statusCode).toBe(503);
});
```

> Use the suite's existing app/auth harness and the real launch route path + body shape — mirror an existing passing live-route test in that file.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/unit/chat-live-manager.test.ts && pnpm db:up && pnpm vitest run tests/integration/chat-live-api.test.ts`
Expected: PASS (the new 503 case included).

- [ ] **Step 8: Commit**

```bash
git add packages/chat/src/live/runtime.ts packages/chat/src/index.ts packages/chat/src/routes.ts packages/chat/src/live-routes.ts tests/unit/chat-live-manager.test.ts tests/integration/chat-live-api.test.ts
git commit -m "feat(chat): injectable engine-factory builder + CliChatUnavailableError → 503 (live + REST)"
```

---

## Task 11: `chat.multiplexer` instance setting (settings repository)

Add typed read/write of the `chat.multiplexer` setting, mirroring `getRegistrationSettings`/`setRegistrationSettings`. Stored under key `chat.multiplexer` as `{ value: "auto"|"tmux"|"herdr" }`.

**Files:**

- Modify: `packages/settings/src/repository.ts`
- Test: `tests/integration/chat-multiplexer-admin.test.ts` (read/write round-trip; full route test is Task 13's gate)

- [ ] **Step 1: Write a failing test**

Create `tests/integration/chat-multiplexer-admin.test.ts` (model it on the existing registration-settings integration test — find it with `grep -rl "getRegistrationSettings\|registration.enabled" tests/integration`). Cover: default is `"auto"` when unset; `setChatMultiplexerSetting` then `getChatMultiplexerSetting` round-trips a value; a non-admin actor's write is rejected by RLS (`WITH CHECK current_actor_is_admin()`).

```ts
// Shape (mirror the registration-settings integration test's harness exactly):
it("defaults to auto and round-trips an admin write", async () => {
  await dataContext.withDataContext(adminCtx, async (db) => {
    expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("auto");
    await repo.setChatMultiplexerSetting(db, {
      multiplexer: "herdr",
      actorUserId: adminCtx.actorUserId,
      requestId: adminCtx.requestId
    });
    expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("herdr");
  });
});

it("rejects a non-admin write (RLS WITH CHECK)", async () => {
  await expect(
    dataContext.withDataContext(memberCtx, async (db) =>
      repo.setChatMultiplexerSetting(db, {
        multiplexer: "tmux",
        actorUserId: memberCtx.actorUserId,
        requestId: memberCtx.requestId
      })
    )
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm db:up && pnpm vitest run tests/integration/chat-multiplexer-admin.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Implement in `repository.ts`**

Import the choice type from shared (do **not** redefine it — single source of truth, Task 6 Step 0), then add two methods (place them right after `setRegistrationSettings`):

```ts
import type { ChatMultiplexerChoice } from "@jarv1s/shared";

async getChatMultiplexerSetting(scopedDb: DataContextDb): Promise<{ multiplexer: ChatMultiplexerChoice }> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", "chat.multiplexer")
    .executeTakeFirst();
  const raw = (row?.value as { value?: unknown } | undefined)?.value;
  return { multiplexer: raw === "tmux" || raw === "herdr" ? raw : "auto" };
}

async setChatMultiplexerSetting(
  scopedDb: DataContextDb,
  input: { multiplexer: ChatMultiplexerChoice; actorUserId: string; requestId: string }
): Promise<{ multiplexer: ChatMultiplexerChoice }> {
  assertDataContextDb(scopedDb);
  await this.upsertInstanceSetting(scopedDb, {
    key: "chat.multiplexer",
    value: { value: input.multiplexer },
    updatedByUserId: input.actorUserId,
    requestId: input.requestId
  });
  return { multiplexer: input.multiplexer };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/integration/chat-multiplexer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/repository.ts tests/integration/chat-multiplexer-admin.test.ts
git commit -m "feat(settings): add chat.multiplexer instance-setting read/write (admin-gated)"
```

---

## Task 12: Shared contract + admin route (`/api/admin/chat-multiplexer`)

Add the DTOs/schemas and the `GET`/`PUT` admin routes, mirroring `/api/admin/registration`. The route returns the stored choice plus the boot-time availability snapshot injected by the composition root (Task 13).

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Modify: `packages/settings/src/routes.ts`

- [ ] **Step 1: Add the shared contract**

In `packages/shared/src/platform-api.ts`, near the registration schemas (`:345`, `:449`), add (the `ChatMultiplexerChoice` union was already added in Task 6 Step 0 — do **not** redefine it):

```ts
export interface ChatMultiplexerAvailability {
  readonly tmux: boolean;
  readonly herdr: boolean;
}

export interface ChatMultiplexerSettingsDto {
  readonly multiplexer: ChatMultiplexerChoice;
  readonly available: ChatMultiplexerAvailability;
}

export const chatMultiplexerSettingsSchema = {
  type: "object",
  required: ["multiplexer", "available"],
  additionalProperties: false,
  properties: {
    multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] },
    available: {
      type: "object",
      required: ["tmux", "herdr"],
      additionalProperties: false,
      properties: { tmux: { type: "boolean" }, herdr: { type: "boolean" } }
    }
  }
} as const;

export const getChatMultiplexerSettingsRouteSchema = {
  response: {
    200: chatMultiplexerSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putChatMultiplexerSettingsRouteSchema = {
  body: {
    type: "object",
    required: ["multiplexer"],
    additionalProperties: false,
    properties: { multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] } }
  },
  response: {
    200: chatMultiplexerSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Add the routes in `settings/routes.ts`**

Add `chatMultiplexerAvailability` to `SettingsRoutesDependencies`:

```ts
  /** Boot-time availability snapshot, injected by the composition root (apply-on-restart). */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
```

Import the two new route schemas + `ChatMultiplexerChoice` from `@jarv1s/shared`. Register the routes (model them exactly on the existing `/api/admin/registration` GET/PUT handlers — same `resolveAccessContext` → `withDataContext` → `assertAdminUser` → `requireRequestId` shape):

```ts
server.get(
  "/api/admin/chat-multiplexer",
  { schema: getChatMultiplexerSettingsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        const { multiplexer } = await repository.getChatMultiplexerSetting(scopedDb);
        return {
          multiplexer,
          available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false }
        };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

server.put(
  "/api/admin/chat-multiplexer",
  { schema: putChatMultiplexerSettingsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as { multiplexer: ChatMultiplexerChoice };
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        const { multiplexer } = await repository.setChatMultiplexerSetting(scopedDb, {
          multiplexer: body.multiplexer,
          actorUserId: accessContext.actorUserId,
          requestId: requireRequestId(accessContext)
        });
        return {
          multiplexer,
          available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false }
        };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

> `assertAdminUser`, `requireRequestId`, and `handleRouteError` are the same helpers the registration routes use in this file — reuse them, do not re-declare.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL only at the module-registry call site (it must now provide `chatMultiplexerAvailability` — Task 13). The shared + settings packages typecheck.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/platform-api.ts packages/settings/src/routes.ts
git commit -m "feat(settings): add /api/admin/chat-multiplexer GET/PUT + shared contract"
```

---

## Task 13: Composition-root wiring (module-registry)

Resolve the multiplexer once at boot and inject it. This is where the pieces meet: a **pre-auth read** of `chat.multiplexer` (mirroring the auth registration gate's raw `readBooleanSetting`), a **sync PATH probe** for the admin UI's availability hint, the **pure resolver**, a **late-bound** chat factory populated in `onReady`, and the disabled-state fallback.

**Files:**

- Create: `packages/module-registry/src/chat-multiplexer.ts`
- Modify: `packages/module-registry/src/index.ts`

- [ ] **Step 1: Write the glue module**

Create `packages/module-registry/src/chat-multiplexer.ts`:

```ts
import type { Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import type { ChatMultiplexerChoice } from "@jarv1s/shared";
import { createBinaryProbe, createRealTmuxIo, resolveMultiplexer } from "@jarv1s/ai";
import {
  createRealEngineFactory,
  unavailableEngineFactory,
  type ChatEngineFactory
} from "@jarv1s/chat";

export interface ChatMultiplexerAvailability {
  readonly tmux: boolean;
  readonly herdr: boolean;
}

/**
 * Allowlist of NON-SECRET instance-config keys readable pre-auth via the raw appDb
 * handle. This bounds the documented exemption (Codex finding #1): only these keys
 * may be read this way, and they must never hold secrets (secrets live in the
 * AES-256-GCM credential store, never in instance_settings).
 */
const PREAUTH_READABLE_SETTING_KEYS = new Set<string>(["chat.multiplexer"]);

/** Sync PATH probe for the admin UI hint (apply-on-restart, so a boot snapshot is correct). */
export function probeChatMultiplexerAvailability(
  env: NodeJS.ProcessEnv = process.env
): ChatMultiplexerAvailability {
  const probe = createBinaryProbe(env);
  return { tmux: probe.has("tmux"), herdr: probe.has("herdr") };
}

/**
 * Pre-auth read of the non-secret `chat.multiplexer` instance setting. This is the
 * SAME sanctioned class of access already used by the auth registration gate
 * (packages/auth/src/index.ts `readBooleanSetting` for `registration.enabled`): a
 * raw read as jarvis_app_runtime with NO actor GUC. The instance_settings SELECT
 * policy is USING (true) precisely so boot/pre-auth config reads work (migration
 * 0059_admin_tables_rls.sql), while WRITES stay admin-gated
 * (current_actor_is_admin()). It works on a fresh install with zero users (no actor
 * exists yet), and reads only allowlisted non-secret keys.
 *
 * This is a documented, bounded exception to "DataContextDb only" — see
 * docs/DEVELOPMENT_STANDARDS.md "Pre-auth non-secret instance-config reads" (added
 * by this slice). The admin GET/PUT routes (Task 12) still go through DataContextDb
 * + assertAdminUser; only this boot read bypasses it, and only for the allowlist.
 */
async function readMultiplexerChoice(
  appDb: Kysely<JarvisDatabase>
): Promise<ChatMultiplexerChoice> {
  const key = "chat.multiplexer";
  if (!PREAUTH_READABLE_SETTING_KEYS.has(key)) {
    throw new Error(`pre-auth instance-setting read not allowed for key "${key}"`);
  }
  const row = await appDb
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  const raw = (row?.value as { value?: unknown } | undefined)?.value;
  return raw === "tmux" || raw === "herdr" ? raw : "auto";
}

/**
 * Resolve the production chat engine factory at boot: env override > admin setting >
 * auto-detect. On success returns a factory bound to the one shared Multiplexer; if
 * no multiplexer is installed, returns a factory that throws CliChatUnavailableError
 * (→ HTTP 503), and logs a clear warning. Never throws — live chat is disabled, not
 * crashed.
 */
export async function resolveChatEngineFactory(deps: {
  appDb: Kysely<JarvisDatabase>;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}): Promise<ChatEngineFactory> {
  const env = deps.env ?? process.env;
  const io = createRealTmuxIo();
  const probe = createBinaryProbe(env);
  const configured = await readMultiplexerChoice(deps.appDb);

  let resolution;
  try {
    resolution = resolveMultiplexer({ io, env, configured, isInstalled: (b) => probe.has(b) });
  } catch (err) {
    // Only thrown for an invalid JARVIS_MULTIPLEXER value — a deploy config error.
    const reason = err instanceof Error ? err.message : String(err);
    deps.log?.(`[chat] live CLI chat disabled — ${reason}`);
    return unavailableEngineFactory(reason);
  }

  if (!resolution.ok) {
    deps.log?.(`[chat] live CLI chat disabled — ${resolution.reason}`);
    return unavailableEngineFactory(resolution.reason);
  }
  deps.log?.(
    `[chat] live CLI chat multiplexer: ${resolution.mux.kind} (source: ${resolution.source})`
  );
  return createRealEngineFactory({ mux: resolution.mux });
}
```

- [ ] **Step 1b: Record the exemption in the security contract**

The raw pre-auth read widens a documented invariant, so the contract must say so (Codex finding #1). In `docs/DEVELOPMENT_STANDARDS.md`, near the "DataContextDb only" rule, add a short subsection:

```markdown
### Pre-auth non-secret instance-config reads (bounded exemption)

A small allowlist of NON-SECRET `app.instance_settings` keys may be read with the raw
app Kysely handle (no `DataContextDb`, no actor GUC) when a value is needed before any
actor exists — at boot, or on a pre-auth route. This is sanctioned because the
`instance_settings` SELECT policy is `USING (true)` (migration 0059) and these keys hold
only non-secret configuration; secrets live in the AES-256-GCM credential store. Current
allowlist: `registration.enabled`, `registration.requires_approval` (auth registration
gate), `chat.multiplexer` (composition-root multiplexer resolution). WRITES remain
admin-gated (`current_actor_is_admin()`). Do **not** extend the allowlist to any key that
could carry user data or secrets, and never use this path for per-user tables.
```

Then update the two now-stale "this is the ONLY exemption" comments so reviewers don't see contradictory invariants (Codex R2 #3):

- `packages/module-registry/src/index.ts:66-69` ("the ONLY root-handle escape hatch in the route layer") — append: "…plus the bounded pre-auth non-secret instance-config reads documented in DEVELOPMENT_STANDARDS.md (registration gate + `chat.multiplexer` boot resolution)."
- `packages/settings/src/bootstrap.ts:13` ("SOLE documented exemption") — same clarifying cross-reference.

- [ ] **Step 2: Wire it in `registerBuiltInApiRoutes`**

In `packages/module-registry/src/index.ts`:

Add `chatMultiplexerAvailability` to `BuiltInRouteDependencies`:

```ts
  /** Boot-time multiplexer availability snapshot for the admin settings UI. */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
```

Import the glue + the error:

```ts
import { probeChatMultiplexerAvailability, resolveChatEngineFactory } from "./chat-multiplexer.js";
import { CliChatUnavailableError, type ChatEngineFactory } from "@jarv1s/chat";
```

Rewrite `registerBuiltInApiRoutes` to compute availability (sync), late-bind the resolved factory, and inject both into the shared deps:

```ts
export function registerBuiltInApiRoutes(
  server: FastifyInstance,
  dependencies: BuiltInRouteDependencies
): void {
  const env = process.env;
  const availability = probeChatMultiplexerAvailability(env);

  // The factory is resolved asynchronously in onReady (a settings read), but routes
  // register synchronously. Bridge with a late-bound wrapper: it is only ever invoked
  // when a chat session launches, which is strictly after onReady. Tests/embedders
  // that pass an explicit chatEngineFactory bypass resolution entirely.
  let resolvedChatFactory: ChatEngineFactory | null = null;
  const chatEngineFactory: ChatEngineFactory =
    dependencies.chatEngineFactory ??
    ((provider, key) => {
      if (!resolvedChatFactory) {
        throw new CliChatUnavailableError("chat engine factory is not resolved yet");
      }
      return resolvedChatFactory(provider, key);
    });

  const deps: BuiltInRouteDependencies = {
    ...dependencies,
    chatEngineFactory,
    chatMultiplexerAvailability: availability
  };

  for (const module of BUILT_IN_MODULES) {
    module.registerRoutes?.(server, deps);
  }

  if (!dependencies.chatEngineFactory) {
    server.addHook("onReady", async () => {
      resolvedChatFactory = await resolveChatEngineFactory({
        appDb: dependencies.rootDb,
        env,
        log: (msg) => server.log.info(msg)
      });
    });
  }
}
```

> `dependencies.rootDb` is the raw Kysely already forwarded for the settings BootstrapHelper (the documented Kysely exemption) — reuse it; do **not** add a new appDb dependency. No `apps/api` change is required.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages now (the settings call site receives `chatMultiplexerAvailability`).

- [ ] **Step 4: Run the affected unit + integration tests**

Run: `pnpm vitest run tests/unit/chat-live-manager.test.ts tests/integration/chat-live-api.test.ts tests/integration/chat-multiplexer-admin.test.ts`
Expected: PASS. (`chat-live-api` injects a fake `chatEngineFactory`, so it bypasses resolution; the admin route test exercises the real GET/PUT.)

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/chat-multiplexer.ts packages/module-registry/src/index.ts packages/settings/src/bootstrap.ts docs/DEVELOPMENT_STANDARDS.md
git commit -m "feat(module-registry): resolve chat multiplexer at boot (env > admin setting > auto-detect)"
```

---

## Task 14: Admin UI — multiplexer `<select>` + availability badges

Add a "Live chat multiplexer" control to the admin settings panel, mirroring the existing registration query/mutation. Shows the dropdown (auto/tmux/herdr), badges for what's detected, the auto-rule, and a restart note.

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/admin-users-panel.tsx`

- [ ] **Step 1: Add the client methods**

In `apps/web/src/api/client.ts`, import the DTO and add (mirroring `getRegistrationSettings`/`putRegistrationSettings`):

```ts
import type {
  /* …existing… */ ChatMultiplexerSettingsDto,
  ChatMultiplexerChoice
} from "@jarv1s/shared";

export async function getChatMultiplexerSettings(): Promise<ChatMultiplexerSettingsDto> {
  return requestJson<ChatMultiplexerSettingsDto>("/api/admin/chat-multiplexer");
}

export async function setChatMultiplexerSettings(
  multiplexer: ChatMultiplexerChoice
): Promise<ChatMultiplexerSettingsDto> {
  return requestJson<ChatMultiplexerSettingsDto>("/api/admin/chat-multiplexer", {
    method: "PUT",
    body: { multiplexer }
  });
}
```

- [ ] **Step 2: Add the query key**

In `apps/web/src/api/query-keys.ts`, under `settings`, add (mirroring `registrationSettings`):

```ts
    chatMultiplexer: ["settings", "chat-multiplexer"] as const,
```

- [ ] **Step 3: Add the UI section**

In `apps/web/src/settings/admin-users-panel.tsx`, mirror the registration query/mutation pattern:

```tsx
import { getChatMultiplexerSettings, setChatMultiplexerSettings } from "../api/client";
import type { ChatMultiplexerChoice } from "@jarv1s/shared";

// inside the component, beside regQuery / regMutation:
const muxQuery = useQuery({
  queryKey: queryKeys.settings.chatMultiplexer,
  queryFn: getChatMultiplexerSettings
});
const muxMutation = useMutation({
  mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
  onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.chatMultiplexer, data)
});
```

Add a section (place after the Registration `<section>`), guarding on `muxQuery.data`:

```tsx
{
  muxQuery.data && (
    <section className="panel" aria-labelledby="multiplexer-title">
      <header>
        <h2 id="multiplexer-title">Live chat multiplexer</h2>
        <p>
          Which terminal multiplexer hosts live CLI chat sessions. Changes apply on server restart.
        </p>
      </header>
      <dl>
        <dt>Backend</dt>
        <dd>
          <select
            value={muxQuery.data.multiplexer}
            disabled={muxMutation.isPending}
            onChange={(e) => muxMutation.mutate(e.target.value as ChatMultiplexerChoice)}
          >
            <option value="auto">Auto-detect</option>
            <option value="tmux">tmux</option>
            <option value="herdr">herdr</option>
          </select>
        </dd>
        <dt>Detected on this host</dt>
        <dd>
          <span>{`tmux: ${muxQuery.data.available.tmux ? "installed" : "not detected"}`}</span>
          {" · "}
          <span>{`herdr: ${muxQuery.data.available.herdr ? "installed" : "not detected"}`}</span>
        </dd>
      </dl>
      <p>
        Auto picks herdr when the server runs inside herdr, otherwise tmux. If the selected backend
        isn’t installed, live chat is disabled until you install it and restart.
      </p>
    </section>
  );
}
```

> Match the file's existing class names / markup conventions (it uses `<section className="panel">` + `<dl>` for registration). Adjust the JSX to the surrounding style if it differs.

- [ ] **Step 4: Typecheck the web app**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/admin-users-panel.tsx
git commit -m "feat(web): admin multiplexer selector with availability hints"
```

---

## Task 15: Create per-user neutral dir with mode `0700`

**Files:**

- Modify: `packages/chat/src/live/persona.ts`
- Test: `tests/unit/chat-live-persona.test.ts`

- [ ] **Step 1: Write a failing test**

The `PersonaFs.mkdir` seam takes only a path. Widen it to accept an optional mode and assert `renderPersona` requests `0700`. Append to `tests/unit/chat-live-persona.test.ts`:

```ts
it("creates the per-user neutral dir with mode 0700", async () => {
  const mkdirCalls: Array<{ path: string; mode?: number }> = [];
  const fs = {
    mkdir: async (path: string, mode?: number) => {
      mkdirCalls.push({ path, mode });
    },
    writeFile: async () => {}
  };
  await renderPersona(fs, {
    userId: "u1",
    userName: "Ben",
    provider: "anthropic",
    baseDir: "/tmp/base",
    persona: "hi"
  });
  expect(mkdirCalls).toHaveLength(1);
  expect(mkdirCalls[0]?.mode).toBe(0o700);
});
```

> Check the existing test file's imports/`PersonaFs` fakes; update any inline fake `mkdir` signatures to `(path, mode?)` so they still satisfy the widened interface.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/chat-live-persona.test.ts`
Expected: FAIL — mode is `undefined`.

- [ ] **Step 3: Implement**

In `packages/chat/src/live/persona.ts`, widen the `PersonaFs.mkdir` member:

```ts
  /** Create a directory and any missing parents (recursive), with an optional mode. */
  mkdir(path: string, mode?: number): Promise<void>;
```

In `renderPersona`, pass the mode:

```ts
await fs.mkdir(neutralDir, 0o700);
```

In `createRealPersonaFs`, honor it:

```ts
    mkdir: async (path: string, mode?: number) => {
      await mkdir(path, { recursive: true, mode });
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/chat-live-persona.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/persona.ts tests/unit/chat-live-persona.test.ts
git commit -m "feat(chat): create per-user neutral dir with mode 0700"
```

---

## Task 16: Document the shared-uid limitation + the deferred PreToolUse follow-up

**Files:**

- Create or modify: `packages/chat/README.md`

- [ ] **Step 1: Add the sections**

Add (creating the README if absent):

**"Known security limitation — shared-uid":** all live chat sessions run as one OS user; the agent path is contained (`--tools ""` / MCP-allowlist + `--strict-mcp-config` give an injected prompt no file/shell primitive); a **human who already holds a shell as the shared uid** can attach to any session and read any user's neutral dir / CLI auth; mitigations today (host-shell access is the operator's own, `0700` neutral dirs, secrets AES-256-GCM at rest and never in prompts/payloads); the real fix is the deferred uid-per-user milestone. Link to `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` §8.

**"Deferred — agent-path PreToolUse policy":** a Claude Code PreToolUse hook (deny any tool call that is not an allowlisted `mcp__jarvis__*` call), provisioned into the anthropic neutral dir, as defense-in-depth behind the already-locked `--tools ""` / `--allowedTools`. Deferred from v1 because the programmatic input path is already neutralized (`sanitizeInput` strips the `!`-escape) and native tools are already denied at launch flags; it is provider-specific (Claude only — Codex `--sandbox read-only` and Gemini `--allowed-mcp-server-names jarvis` already block at launch) and **fail-closed semantics + cross-engine scope need their own design**. Track as a follow-up issue under epic #47.

- [ ] **Step 2: Record the deferral in the SPEC (it currently lists PreToolUse in-scope)**

The approved spec marks the PreToolUse policy as in-scope (§6) and in its acceptance criteria, so the plan cannot silently treat it as documentation-only (Codex finding #7). In `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md`, edit §6 and the corresponding acceptance criterion to state that the PreToolUse policy is **deferred to a follow-up under epic #47** per the 2026-06-12 grill decision (with the rationale above), so spec and plan agree. Do not delete the section — mark it Deferred and link to the follow-up.

- [ ] **Step 3: Commit**

```bash
git add packages/chat/README.md docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md
git commit -m "docs(chat): document shared-uid boundary + defer PreToolUse in README and spec (Phase 2 §8/§6)"
```

---

## Task 17: Full gate + final verification

**Files:** none (verification only)

- [ ] **Step 1: Ensure Postgres is up**

Run: `pnpm db:up`
Expected: Postgres healthy (integration tests need it).

- [ ] **Step 2: Run the maintainability gate**

Run: `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck`
Expected: PASS. `check:file-size` confirms `cli-chat-engine.ts` is comfortably under 1000 lines (it shrank — verbs moved to backends).

- [ ] **Step 3: Run the affected unit + integration suites**

Run: `pnpm vitest run tests/unit/ tests/integration/chat-live-api.test.ts tests/integration/chat-multiplexer-admin.test.ts`
Expected: PASS. (Stop any `dev:worker` first — it steals pg-boss jobs.)

- [ ] **Step 4: Full foundation gate**

Run: `pnpm verify:foundation`
Expected: PASS (lint, format, file-size, typecheck, db:migrate, integration). No new migration was added — `chat.multiplexer` reuses the existing `app.instance_settings` table.

- [ ] **Step 5: Final commit (if any gate fixups were needed)**

```bash
git add <explicit paths touched by fixups>
git commit -m "chore(chat): gate fixups for portable CLI chat adapter"
```

---

## Key decisions & tradeoffs (grill-locked)

These are the contestable choices the grill resolved — named so the Codex review has something concrete to bite.

1. **Multiplexer is admin-selectable AND auto-detecting (Q3).** Not env-only. Precedence: `JARVIS_MULTIPLEXER` env override (wins, **bypasses** the probe — a deploy escape hatch) → admin `chat.multiplexer` setting (honored only if that backend is **usable**: installed, and for herdr a resolvable root pane) → `auto` (detect usability; tie-break herdr when `HERDR_ENV=1`, else tmux, else the other usable one). _Tradeoff:_ more surface (setting + route + UI + boot wiring) than a bare env var, accepted because hosts genuinely vary (the user may have neither tmux nor herdr).
2. **Selection applies on restart, not live (Q3-i).** The factory is resolved once in `onReady`. _Tradeoff:_ changing the admin setting needs a restart to take effect; in return the availability snapshot shown in the UI is honest (it's the boot snapshot) and there's no per-launch re-resolution cost or mid-flight backend swap.
3. **`auto` tie-break = herdr iff `HERDR_ENV=1` (Q3-ii).** Running inside herdr is a strong signal herdr is the intended host; otherwise tmux is the lower-surprise default.
4. **Boot read of `chat.multiplexer` is a pre-auth raw `appDb` read, not a DataContextDb read.** This is the _sanctioned_ exception — it mirrors the auth registration gate's `readBooleanSetting`, and migration 0059 keeps `instance_settings` SELECT `USING (true)` precisely so boot/pre-auth config reads work (WRITES stay admin-gated via `current_actor_is_admin()`). It works on a fresh install with zero users (no actor exists yet). It reads only non-secret config; secrets live in the AES-256-GCM store. **Not** a weakening of "DataContextDb only" — the admin GET/PUT routes still go through DataContextDb + `assertAdminUser`.
5. **One shared, stateless `Multiplexer` instance across all sessions.** The handle is per-session and passed per call; the backend holds only its stateless `io`. So resolving once at boot and sharing is correct and cheaper than per-session construction.
6. **No multiplexer installed → disabled, not crashed.** `resolveChatEngineFactory` never throws; it returns `unavailableEngineFactory(reason)`, logs a clear warning, and a launch attempt returns HTTP 503. The rest of the app boots normally.
7. **herdr launches via `send-text` + `send-keys Enter`, not `pane run`.** Symmetric with tmux and avoids `pane run`'s unspecified shell-quoting. herdr's JSON output is parsed for the opaque `pane_id`; non-JSON output throws a clear version-skew error.
8. **herdr root pane is never "the first pane in `pane list`."** A shared herdr server lists unrelated operator/agent panes; splitting from an arbitrary one is unsafe. Resolution is `opts.rootPane` → `JARVIS_HERDR_ROOT_PANE` → `HERDR_PANE_ID` (the server's own pane) → hard error (Codex #4).
9. **Backends check every command's exit code (kill excepted).** `open()`/`submit()` throw on a non-zero `tmux`/`herdr` exit, so a misconfigured `JARVIS_MULTIPLEXER` override (binary missing) or a transient socket failure fails loudly instead of returning a dead handle. This is the safety net that makes the grill-locked "env override bypasses the probe" decision acceptable (Codex #3/#5). `kill()` stays exit-code-agnostic (idempotent).
10. **The choice union lives once, in `@jarv1s/shared`.** `ChatMultiplexerChoice` is defined in shared; ai and settings import it — no per-package redefinition (Codex #8).
11. **The boot read is a bounded, documented exemption to "DataContextDb only."** It mirrors the existing auth registration gate (`readBooleanSetting`), is restricted to an allowlist of non-secret keys, and is recorded in `DEVELOPMENT_STANDARDS.md`. Admin GET/PUT still go through DataContextDb + `assertAdminUser` (Codex #1).
12. **PreToolUse policy deferred out of v1 — in both README and spec.** The one programmatic input path is already sanitized and native tools are already denied at launch flags, so the hook is pure defense-in-depth, Claude-only, and needs its own fail-closed/cross-engine design. The spec §6 is updated to mark it Deferred so spec and plan agree (Codex #7).
13. **Composition happens in `module-registry`, not `apps/api`.** `apps/api` doesn't depend on ai/chat/settings; `module-registry` already does and already forwards `rootDb`. Net `apps/api` change: zero (Codex confirmed this is mechanically sound).

## Risks / open questions

- **herdr JSON shape (v0.6.8) is an integration assumption.** Grounded against the live CLI, but a herdr upgrade could change the envelope. Mitigation: a single parse point that throws a clear error; the `auto` path still falls back to tmux on hosts where herdr isn't selected.
- **herdr root-pane resolution** now requires an explicit pane (`opts.rootPane` / `JARVIS_HERDR_ROOT_PANE` / `HERDR_PANE_ID`) and errors otherwise — no "first pane" guessing. Residual: if the operator runs the API _outside_ any herdr pane and sets no override, herdr selection is unavailable (it errors clearly, and `auto` falls back to tmux). Acceptable for v1.
- **Live 503 mapping** is wired into the actual live error path (`handleLiveRouteError` in `live-routes.ts:~164`) plus the REST `handleRouteError`, with a route-level test asserting 503 — not left to a generic 500.

## Out of scope

- Real uid-per-user isolation (deferred milestone; the `0700` dirs + env/homeBase seams are the forward-compat hooks).
- The PreToolUse agent-path policy (deferred follow-up — Task 16).
- Live (no-restart) re-selection of the multiplexer.
- A herdr/tmux install/onboarding flow (we detect and report; we don't install).

---

## Self-Review

**Spec coverage (spec §-by-§):**

- §4 Multiplexer seam → Tasks 1, 3, 4, 7 (barrel). ✓
- §4.1 opaque-handle return/store → Task 8 (`this.handle = await mux.open(...)`), Task 4 (herdr id). ✓
- §4.2 backend selection → **superseded by Q3** (grill): env override + admin setting + auto-detect → Tasks 5, 6, 11–14. ✓
- §5.1 engine refactor, stale comments, sanitizeInput retained → Task 8. ✓
- §5.2 TmuxIo env/cwd + transcriptGlobDir homeBase → Task 2. ✓
- §5.3 types.ts JWT comment → Task 8 Step 1. ✓
- §5.4 runtime factory → Tasks 10 (builder) + 13 (resolution). ✓
- §5.5 persona 0700 → Task 15. ✓
- §5.6 symmetric teardown unchanged → no code change; manager already calls kill+revoke (verified in spec). ✓
- §6 PreToolUse policy → **deferred** (Task 16 updates BOTH the chat README and the spec §6/acceptance criteria to mark it Deferred) per grill decision. ✓ (intentional cut, recorded in the spec — not a silent gap)
- §7 attach posture → `attachCommand` in Tasks 3 & 4. ✓
- §8 shared-uid limitation doc → Task 16. ✓
- §9 deferred-milestone seams → Tasks 2 (env/homeBase), 8 & 4 (opaque handle), 15 (0700). ✓
- §11 testing → every task is TDD; gate in Task 17. ✓
- §13 acceptance criteria 1–7 → all mapped (multiplexer selection now via Q3 chain). ✓

**Q3 (grill-locked) coverage:** instance setting + typed read/write → Task 11; shared contract + admin route → Task 12; binary probe → Task 5; pure decision + resolver → Task 6; boot resolution + late-bound injection + disabled state → Task 13; admin UI → Task 14. ✓

**Placeholder scan:** No TBD/TODO. The herdr JSON shape and root-pane resolution are explicitly scoped as integration assumptions with documented mitigations, not placeholders. The live-routes 503 mapping has a concrete grep-and-add instruction (Task 10 Step 5).

**Type consistency:** `Multiplexer`/`MuxHandle`/`MuxOpenOpts` (Task 1) used identically in Tasks 3, 4, 6, 8. `ChatMultiplexerChoice` is defined **once** in `@jarv1s/shared` (Task 6 Step 0) and imported by ai (Task 6), settings (Task 11), and the module-registry glue (Task 13); the schema `enum` (Task 12) and the `<select>` values (Task 14) use the same three literals `"auto"|"tmux"|"herdr"` — no per-package redefinition. Class renamed `TmuxCliChatEngine`→`CliChatEngineImpl` consistently across Tasks 8, 9, 10. `createRealEngineFactory({ mux })` (Task 10) is called identically in Task 13. `chatMultiplexerAvailability` shape `{ tmux, herdr }` is identical in `BuiltInRouteDependencies` (Task 13), `SettingsRoutesDependencies` (Task 12), and `ChatMultiplexerAvailability` (Task 12 shared). `TmuxIo.run` 3-arg signature (Task 2) is backward-compatible with all existing 2-arg callers. `PersonaFs.mkdir(path, mode?)` (Task 15) is backward-compatible.

**Execution-order note:** Task 4 (HerdrMultiplexer) is built **before** Task 6 (resolver imports it). Task 10 (chat barrel exports) is before Task 13 (module-registry imports them). Task 12 leaves a deliberate typecheck failure at the module-registry call site that Task 13 closes. All other tasks are in dependency order.
