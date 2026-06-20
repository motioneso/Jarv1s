/**
 * cli-runner entrypoint (§3/§7). Reads its env, builds the engine host (with the §7.2
 * sanitized-env TmuxIo so app secrets / the socket path / the RPC secret never reach a
 * CLI child), and starts the socket server (which runs the startup CLEAN-SLATE sweep
 * before accepting connections).
 *
 * The cli-runner SERVER process carries JARVIS_CLI_RUNNER_SOCKET +
 * JARVIS_CLI_RUNNER_RPC_SECRET + JARVIS_CLI_RUNNER_SINGLE_USER (it needs the first two
 * to bind + authenticate and the third to enforce the §4.1.0a gate); the §7.2 allowlist
 * governs the CLI SUBPROCESS env it builds, which drops all three.
 */

import { dirname } from "node:path";

import { cliAvailable, tmuxAvailable, type ProviderKind } from "@jarv1s/ai";

import { CliChatEngineHost } from "./engine-host.js";
import { createSanitizedTmuxIo } from "./runner-io.js";
import { CliRunnerServer } from "./server.js";

export interface CliRunnerConfig {
  readonly socketPath: string;
  readonly rpcSecret: string | undefined;
  readonly singleUser: boolean;
  readonly neutralBase: string;
  readonly homeBase: string;
}

const DEFAULT_SOCKET = "/run/jarv1s/cli-runner.sock";
const DEFAULT_NEUTRAL_BASE = "/data/cli-auth/chat";
const DEFAULT_HOME = "/data/cli-auth";

/** Read the cli-runner config from the (server) env, applying §7 defaults. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): CliRunnerConfig {
  const homeBase = env.JARVIS_CLI_HOME_BASE ?? env.JARVIS_CLI_HOME ?? DEFAULT_HOME;
  return {
    socketPath: env.JARVIS_CLI_RUNNER_SOCKET ?? DEFAULT_SOCKET,
    rpcSecret: env.JARVIS_CLI_RUNNER_RPC_SECRET,
    // Default ON (§4.1.0a). Only "0" turns it OFF (after #347 lands).
    singleUser: env.JARVIS_CLI_RUNNER_SINGLE_USER !== "0",
    neutralBase: env.JARVIS_CLI_NEUTRAL_BASE ?? DEFAULT_NEUTRAL_BASE,
    homeBase
  };
}

/** Construct the engine host + server from config (no I/O until `server.start()`). */
export function createCliRunner(
  config: CliRunnerConfig,
  log?: (msg: string) => void
): CliRunnerServer {
  // The §7.2 sanitized TmuxIo: every tmux/CLI child gets the allowlist env only.
  const io = createSanitizedTmuxIo();

  const host = new CliChatEngineHost({
    io,
    neutralBase: config.neutralBase,
    homeBase: config.homeBase,
    singleUser: config.singleUser,
    // Presence-only PATH probe INSIDE cli-runner (the tools volume is on PATH, §7.1).
    cliPresent: (provider: ProviderKind) => cliAvailable(provider),
    multiplexerUsable: () => tmuxAvailable()
  });

  return new CliRunnerServer({
    host,
    socketPath: config.socketPath,
    socketDir: dirname(config.socketPath),
    secret: config.rpcSecret,
    log
  });
}

/** Boot the cli-runner: read env, build, start. Logs and exits non-zero on a bind failure. */
export async function main(): Promise<void> {
  const config = readConfig();
  if (!config.rpcSecret) {
    // Without the secret EVERY hello closes (§3.6) — refuse to boot rather than run a
    // server that can authenticate nobody.
    console.error("[cli-runner] JARVIS_CLI_RUNNER_RPC_SECRET is unset — refusing to start");
    process.exitCode = 1;
    return;
  }
  const server = createCliRunner(config, (msg) => {
    console.log(msg);
  });
  await server.start();
}

// Run when invoked directly (tsx src/main.ts / node dist/main.js).
const isEntrypoint =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error("[cli-runner] fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
