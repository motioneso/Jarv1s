/**
 * §7.2 cli-runner sanitized-env ALLOWLIST. The cli-runner spawns the multiplexer (and
 * through it the provider CLIs) with a CLEAN, allowlisted environment — never the
 * cli-runner SERVER's env. Everything not on the allowlist (and especially every app
 * secret, the socket path, and the RPC secret) is EXCLUDED.
 *
 * This is layer (2) of the §7.2 defense-in-depth (layer (1) is the compose service
 * getting no app env_file, owned by Lane C). Process env-stripping alone is not enough
 * because mounts are container-level — hence the sidecar — but stripping the child env
 * is still required so a CLI never sees a secret that leaked into the server env.
 */

/** Exact env keys allowed into the CLI-subprocess env (§7.2). */
const ALLOWED_KEYS: readonly string[] = [
  "HOME",
  "PATH",
  "NPM_CONFIG_PREFIX",
  "JARVIS_CLI_TOOLS_PREFIX",
  "JARVIS_CLI_HOME",
  "JARVIS_CLI_HOME_BASE",
  "JARVIS_CLI_NEUTRAL_BASE",
  "JARVIS_HOST_UID",
  "JARVIS_HOST_GID",
  "TERM",
  "LANG",
  "TMPDIR"
];

/** Key prefixes allowed (locale basics — `LC_*`, §7.2). */
const ALLOWED_PREFIXES: readonly string[] = ["LC_"];

/**
 * Build the allowlisted CLI-subprocess env from a source env (defaults to
 * `process.env`). Only the §7.2 keys/prefixes survive; every secret — including
 * JARVIS_CLI_RUNNER_SOCKET, JARVIS_CLI_RUNNER_RPC_SECRET,
 * JARVIS_CLI_RUNNER_SINGLE_USER, BETTER_AUTH_SECRET, JARVIS_AI_SECRET_KEY,
 * JARVIS_CONNECTOR_SECRET_KEY, POSTGRES_PASSWORD, every *_DATABASE_URL /
 * role password, and any JARVIS_VAULT_* — is dropped.
 */
export function buildSanitizedCliEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ALLOWED_KEYS.includes(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  return out;
}
