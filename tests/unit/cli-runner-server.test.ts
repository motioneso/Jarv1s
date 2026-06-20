/**
 * cli-runner engine-host tests (§4.1.0a single-active-user gate, §4.5 kill-by-mux-name,
 * §4.6 listLiveSessions-by-mux, §6.5 startup CLEAN-SLATE sweep).
 *
 * The gate is the HARD RUNTIME GATE that stands in for deferred UID separation (#347):
 * AT MOST ONE live session across all sessionKeys while JARVIS_CLI_RUNNER_SINGLE_USER
 * is ON (default). These tests drive a controllable fake TmuxIo that models the mux's
 * live-session set so the gate's liveKeys = (mux ∪ reservations) is exercised end to end.
 */
import { describe, expect, it, vi } from "vitest";

import type { TmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";
import { CliChatEngineHost } from "../../packages/cli-runner/src/engine-host.js";
import { CliChatUnavailableError } from "../../packages/chat/src/live/errors.js";
import { SESSION_PREFIX } from "../../packages/chat/src/live/cli-chat-engine.js";

const NEUTRAL_BASE = "/data/cli-auth/chat";

/**
 * A fake TmuxIo that models a live-session Set. `tmux new-session` adds a session;
 * `tmux list-sessions` reports them; `kill-session` removes one. A `readFile` returns a
 * transcript that is immediately complete so the server-side drain finishes at once.
 * A `newSessionGate` promise (if supplied) lets a test hold a launch mid-flight.
 */
function makeFakeIo(opts: { newSessionGate?: Promise<void> } = {}): {
  io: TmuxIo;
  live: Set<string>;
  removedDirs: string[];
  run: ReturnType<typeof vi.fn>;
} {
  const live = new Set<string>();
  const removedDirs: string[] = [];
  const completeTranscript = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }
  });

  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "tmux") {
      const verb = args[0];
      if (verb === "new-session") {
        if (opts.newSessionGate) await opts.newSessionGate;
        const name = args[args.indexOf("-s") + 1]!;
        live.add(name);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (verb === "list-sessions") {
        return { code: 0, stdout: [...live].join("\n"), stderr: "" };
      }
      if (verb === "kill-session") {
        const name = args[args.indexOf("-t") + 1]!;
        live.delete(name);
        return { code: 0, stdout: "", stderr: "" };
      }
      // send-keys, load-buffer, paste-buffer, has-session → ok
      if (verb === "has-session") {
        const name = args[args.indexOf("-t") + 1]!;
        return { code: live.has(name) ? 0 : 1, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "rm") {
      const target = args[args.length - 1]!;
      removedDirs.push(target);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "ls") {
      // Used by the startup sweep's clearNeutralBase and by Codex transcript globbing.
      return { code: 1, stdout: "", stderr: "" };
    }
    // mkdir / chmod → ok
    return { code: 0, stdout: "", stderr: "" };
  });

  const io: TmuxIo = {
    run: run as unknown as TmuxIo["run"],
    readFile: vi.fn().mockResolvedValue(completeTranscript),
    writeFile: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined)
  };
  return { io, live, removedDirs, run };
}

function makeHost(io: TmuxIo, singleUser = true): CliChatEngineHost {
  return new CliChatEngineHost({
    io,
    neutralBase: NEUTRAL_BASE,
    singleUser,
    cliPresent: async () => true,
    // The fake mux's open() is the default TmuxMultiplexer over `io`; no real tmux runs.
    launchTimeoutMs: 2_000
  });
}

const launchParams = (provider: "anthropic" = "anthropic") => ({
  provider,
  personaText: "You are Jarvis."
});

describe("§4.1.0a single-active-user gate", () => {
  it("rejects a 2nd launch for a DIFFERENT sessionKey while one is live; succeeds after kill", async () => {
    const { io } = makeFakeIo();
    const host = makeHost(io);

    const first = await host.launch("alice", launchParams());
    expect(first).toEqual({ offset: expect.any(Number) });

    // A second, different user is rejected with `unavailable` while alice is live.
    await expect(host.launch("bob", launchParams())).rejects.toBeInstanceOf(
      CliChatUnavailableError
    );

    // Re-launching the SAME live key is allowed (idempotent for that user).
    await expect(host.launch("alice", launchParams())).resolves.toBeDefined();

    // After alice is killed, bob can launch.
    await host.kill("alice");
    await expect(host.launch("bob", launchParams())).resolves.toBeDefined();
  });

  it("two CONCURRENT cross-key launches admit EXACTLY ONE (TOCTOU closed by the reservation)", async () => {
    // Hold both new-session calls behind a gate so both launches are in-flight at once.
    let openGate!: () => void;
    const gate = new Promise<void>((res) => {
      openGate = res;
    });
    const { io } = makeFakeIo({ newSessionGate: gate });
    const host = makeHost(io);

    const a = host.launch("alice", launchParams());
    const b = host.launch("bob", launchParams());
    // Attach the settle handler BEFORE the timing gap so the loser's rejection is never flagged as an
    // unhandled rejection while we wait out the admission tick (it rejects before allSettled is awaited).
    const settled = Promise.allSettled([a, b]);
    // Let both admissions run through the mutex, then release the mux-create.
    await new Promise((r) => setTimeout(r, 5));
    openGate();

    const results = await settled;
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CliChatUnavailableError);
  });

  it("with the gate OFF, concurrent distinct keys both launch", async () => {
    const { io } = makeFakeIo();
    const host = makeHost(io, /* singleUser */ false);
    await expect(host.launch("alice", launchParams())).resolves.toBeDefined();
    await expect(host.launch("bob", launchParams())).resolves.toBeDefined();
    expect(host.liveEngineCount()).toBe(2);
  });
});

describe("§4.5 kill-by-mux-name + §4.6 listLiveSessions", () => {
  it("listLiveSessions enumerates by mux (not the engine Map)", async () => {
    const { io, live } = makeFakeIo();
    const host = makeHost(io);
    await host.launch("alice", launchParams());
    expect(await host.listLiveSessions()).toEqual(["alice"]);
    // The mux session name carries the prefix.
    expect([...live]).toContain(`${SESSION_PREFIX}alice`);
  });

  it("kill works for an ORPHAN with no engine object (post-restart), by mux name", async () => {
    const { io, live, removedDirs } = makeFakeIo();
    const host = makeHost(io);
    // Simulate a post-restart orphan: a live mux session the host has no engine for.
    live.add(`${SESSION_PREFIX}ghost`);

    await host.kill("ghost"); // no engine in the Map — must kill by canonical name
    expect(live.has(`${SESSION_PREFIX}ghost`)).toBe(false);
    // And the neutral dir is removed (§6.5).
    expect(removedDirs).toContain(`${NEUTRAL_BASE}/ghost`);
  });

  it("kill is idempotent for an absent session", async () => {
    const { io } = makeFakeIo();
    const host = makeHost(io);
    await expect(host.kill("nobody")).resolves.toBeUndefined();
  });
});

describe("§6.5 startup CLEAN-SLATE sweep", () => {
  it("kills surviving mux sessions AND unconditionally clears the neutral base before launches", async () => {
    const { io, live, removedDirs } = makeFakeIo();
    // Two foreign token dirs persist on the volume; one survives as a mux session too.
    live.add(`${SESSION_PREFIX}stale`);

    // ls on the neutral base lists two persisted sessionKey dirs.
    (io.run as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string, args: readonly string[]) => {
        if (cmd === "tmux") {
          const verb = args[0];
          if (verb === "list-sessions")
            return { code: 0, stdout: [...live].join("\n"), stderr: "" };
          if (verb === "kill-session") {
            live.delete(args[args.indexOf("-t") + 1]!);
            return { code: 0, stdout: "", stderr: "" };
          }
          return { code: 0, stdout: "", stderr: "" };
        }
        if (cmd === "ls") {
          // -A on the neutral base → the persisted foreign dirs.
          return { code: 0, stdout: "stale\nother-user\n", stderr: "" };
        }
        if (cmd === "rm") {
          removedDirs.push(args[args.length - 1]!);
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
    );

    const host = makeHost(io);
    await host.startupSweep();

    // (a) the surviving mux session was killed.
    expect(live.has(`${SESSION_PREFIX}stale`)).toBe(false);
    // (b) EVERY persisted dir under the base was removed unconditionally (§6.5).
    expect(removedDirs).toContain(`${NEUTRAL_BASE}/stale`);
    expect(removedDirs).toContain(`${NEUTRAL_BASE}/other-user`);
  });

  it("after the sweep clears a foreign token dir, the gate's liveKeys start empty (a launch is admitted)", async () => {
    const { io, live } = makeFakeIo();
    // Pre-sweep: a foreign mux session exists (would otherwise block the gate).
    live.add(`${SESSION_PREFIX}foreign`);
    const host = makeHost(io);

    await host.startupSweep(); // kills the foreign mux session + clears dirs

    // Now a fresh user can launch — the liveKeys set is truthful/empty after the sweep.
    await expect(host.launch("newuser", launchParams())).resolves.toBeDefined();
  });
});
