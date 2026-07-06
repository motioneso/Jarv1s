/**
 * Public "./live" subpath (#802) — the slice of chat's CLI-engine protocol that
 * `@jarv1s/cli-runner` depends on: engine hosting (`cli-chat-engine`), RPC wire
 * framing (`rpc-contract`), provider install flow (`install-contract`), provider
 * login flow (`login-contract`), and the shared unavailable-engine error
 * (`errors`).
 *
 * These five modules were already de-facto public API — cli-runner reached into
 * them directly via `../../chat/src/live/*` relative imports before this
 * boundary was made honest. This barrel changes no behavior; it just gives that
 * existing surface a declared, package-boundary-respecting entry point.
 */
export * from "./cli-chat-engine.js";
export * from "./rpc-contract.js";
export * from "./login-contract.js";
export * from "./install-contract.js";
export * from "./errors.js";
