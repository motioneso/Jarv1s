/**
 * @jarv1s/cli-runner — the in-container CLI chat sidecar (#342). Hosts the provider
 * CLIs + multiplexer behind a private Unix-domain socket and drives them via the
 * frozen RPC contract (docs/superpowers/specs/2026-06-20-cli-runner-rpc-contract.md).
 */

export { CliRunnerServer, type CliRunnerServerDeps } from "./server.js";
export { CliChatEngineHost, NotLaunchedError, type EngineHostDeps } from "./engine-host.js";
export { serveConnection, type ByteChannel, type ConnectionDeps } from "./connection.js";
export {
  stepHelloServer,
  isHandshakeFrame,
  newNonce,
  type HelloServerState,
  type HelloStep
} from "./hello.js";
export { buildSanitizedCliEnv } from "./sanitized-env.js";
export { createSanitizedTmuxIo } from "./runner-io.js";
export { Mutex } from "./mutex.js";
export { readConfig, createCliRunner, main, type CliRunnerConfig } from "./main.js";
