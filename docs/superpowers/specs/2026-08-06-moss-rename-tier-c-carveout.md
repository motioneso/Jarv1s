# Moss rename Tier C (#1443): carve-out list and coverage gaps

Companion to `docs/superpowers/specs/2026-08-05-moss-rename-design.md` §3/§3.1. That spec commits
to an explicit, per-variable carve-out list rather than renaming all `JARVIS_*` names uniformly;
this document is that list, plus the small number of genuinely unreachable reads found while
building it. `packages/db/src/env.ts`'s own doc comment points here, and its `CARVE_OUT` set must
stay in sync with the "Carve-out" table below.

## Method

Every `JARVIS_*` name in the repository was classified into exactly one of four buckets:

1. **Shimmed** — read via `resolveMossEnv(env, "JARVIS_X")` in TypeScript. Prefers `MOSS_X`, falls
   back to `JARVIS_X` with a one-time warning.
2. **Carved out** — read by something the TypeScript shim cannot reach: Docker Compose host-side
   `${JARVIS_X}` interpolation in `infra/docker-compose*.yml`, or one of the seven shell scripts
   that read `$JARVIS_X` directly. Renaming these requires the host env file and the reader to
   change in the same step (Tier D/PR4 cutover), so this PR leaves them as plain
   `env[jarvisName]` passthroughs — `resolveMossEnv` special-cases every carved-out name to do
   nothing.
3. **Deliberately deferred (documented gap)** — read by code that exists but is outside the
   TypeScript module graph, so the shim is structurally unreachable there even though the same
   name is correctly shimmed at its real production call site. Listed below rather than silently
   dropped.
4. **Not an environment variable** — a false positive of grepping for `JARVIS_[A-Z0-9_]+`: a local
   constant name, a regex, a doc placeholder, or `__JARVIS_MODULE_RUNTIME__` (a `window`/
   `globalThis` property, never read from `process.env`). Excluded from every count in this
   document.

## Count reconciliation

- Issue #1443 claims **197** distinct names.
- A naive `grep -roh 'JARVIS_[A-Z0-9_]+'` against `main` finds **167**.
- Neither figure is the real count. Grepping for the bare pattern over-counts: template-literal
  prefixes like `` `JARVIS_RL_${key}` `` match as the fragment `JARVIS_RL_`; local identifiers like
  `JARVIS_TOOL_PREFIX` (a hardcoded MCP tool-name prefix string, not an env var) and
  `JARVIS_VERSION_RE` (a regex variable) match the same pattern as real config knobs; and
  historical doc/plan files under `docs/` reference names that were renamed or removed long ago.
- The verified figure, built by classifying every match per the method above: **118 real,
  distinct `JARVIS_*` environment variable names**, made up of:
  - **41 carved out** (table below)
  - **70 shimmed** (wrapped in `resolveMossEnv` at their production read site — verified by
    extracting every literal second argument to `resolveMossEnv(...)` across `**/*.ts`)
  - **7 in the deliberately-deferred gap** (below)
- `__JARVIS_MODULE_RUNTIME__` is excluded entirely — it is a `window`/`globalThis` property set by
  the module runtime host, never a `process.env` name, despite matching the grep pattern.

## Carve-out (41 names)

Read by Docker Compose host-side interpolation, a named shell script, or both. `resolveMossEnv`
passes these straight through with no `MOSS_` lookup and no warning.

| Variable                         | Carved out because                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JARVIS_ALLOW_STALE`             | `scripts/check-tree-fresh.sh` reads `${JARVIS_ALLOW_STALE:-}` directly                                                                                                                                                                         |
| `JARVIS_API_PORT`                | compose interpolation (`infra/docker-compose.prod.yml`)                                                                                                                                                                                        |
| `JARVIS_BACKUP_DAILY_KEEP`       | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_BACKUP_DIR`              | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_BACKUP_OFFHOST_CMD`      | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_BACKUP_PG_CONTAINER`     | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_BACKUP_WEEKLY_KEEP`      | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_CLI_PER_USER_UID`        | must be both-set-or-both-unset with the RPC secret pair below; also compose                                                                                                                                                                    |
| `JARVIS_CLI_RUNNER_RPC_SECRET`   | compose `:?`-required interpolation; must stay in lockstep with `JARVIS_CLI_RUNNER_SOCKET` (both-set-or-both-unset trap)                                                                                                                       |
| `JARVIS_CLI_RUNNER_SINGLE_USER`  | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_CLI_RUNNER_SOCKET`       | compose interpolation; lockstep pair with the RPC secret                                                                                                                                                                                       |
| `JARVIS_CLI_TOOLS_PREFIX`        | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_DEV_EMAIL`               | `scripts/redeploy-external-module.sh`                                                                                                                                                                                                          |
| `JARVIS_DEV_PASSWORD`            | `scripts/redeploy-external-module.sh`                                                                                                                                                                                                          |
| `JARVIS_DOCKER_SUBNET`           | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_EMBED_MODEL`             | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_EMBED_PROVIDER`          | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_ENV_FILE`                | compose `--env-file` selection, host-side only                                                                                                                                                                                                 |
| `JARVIS_ENV_FILE_ABS`            | derived host-side sibling of `JARVIS_ENV_FILE`                                                                                                                                                                                                 |
| `JARVIS_GATE_DIR`                | `scripts/run-gate.sh`                                                                                                                                                                                                                          |
| `JARVIS_GATE_STALE_SECS`         | `scripts/run-gate.sh`                                                                                                                                                                                                                          |
| `JARVIS_HOST_GID`                | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_HOST_UID`                | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_IMAGE_TAG`               | compose `:?`-required interpolation                                                                                                                                                                                                            |
| `JARVIS_MCP_SERVER_URL`          | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_NOTES_VAULT_HOST_PATH`   | compose interpolation                                                                                                                                                                                                                          |
| `JARVIS_PG_CONTAINER`            | `scripts/run-gate.sh`                                                                                                                                                                                                                          |
| `JARVIS_PGDATABASE`              | `scripts/run-gate.sh`, `scripts/verify-reboot-survival.sh`                                                                                                                                                                                     |
| `JARVIS_SMOKE_APP_CONTAINER`     | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_BASE_URL`          | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_DB_CONTAINER`      | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_DB_NAME`           | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_SURFACE`           | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_TIMEOUT_MS`        | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_SMOKE_USER_EMAIL`        | `scripts/smoke-chat-prod.sh`                                                                                                                                                                                                                   |
| `JARVIS_UAT_REAL_CHAT_ENV_FILE`  | compose `seed` service env_file selection, host-side only                                                                                                                                                                                      |
| `JARVIS_UAT_SEED_CONFIRM`        | `packages/module-registry/src/index.ts` reads it directly as a second-intent confirmation gate for the UAT news-preview override (already commented there as a Tier C carve-out); also compose-interpolated in `infra/docker-compose.prod.yml` |
| `JARVIS_UAT_SEED_EXCLUDE_CHUNKS` | compose `seed` service env, consumed only inside the container before Node's `MOSS_`-aware code would run                                                                                                                                      |
| `JARVIS_UAT_SEED_LEVEL`          | same as above                                                                                                                                                                                                                                  |
| `JARVIS_VAULT_DIR`               | `scripts/backup-full.sh`                                                                                                                                                                                                                       |
| `JARVIS_WEB_PORT`                | compose `:?`-required interpolation                                                                                                                                                                                                            |

## Deliberately deferred (7 names — documented gap, not silently dropped)

These are real `JARVIS_*` config reads that the TypeScript shim cannot reach because the code that
reads them runs outside the module graph entirely — not via `import`, but as a standalone script
written to disk or copied into a container and invoked with a bare `node`. Where the same name is
also read at a normal, reachable call site, that call site **is** shimmed; only the isolated copy
is not.

- **`packages/chat/src/live/claude-permission-hook.ts`** builds a permission-hook script as a
  template-literal JS string, writes it to disk, and it runs as its own Node subprocess — it never
  goes through the module graph `@moss/db` lives in. Reads, unshimmed in that generated script:
  `JARVIS_PERM_DEADLINE_S`, `JARVIS_PERM_TOKEN_FILE`, `JARVIS_PERM_URL`, `JARVIS_SESSION_ROOT`.
  (`JARVIS_NOTES_ROOTS` is also read there, but is not counted again here — it's already covered by
  the shimmed call sites in `packages/chat/src/live/vault-allowlist.ts` and
  `packages/settings/src/notes-source-routes.ts`.)
- **`scripts/smoke-chat.mjs`** is `docker cp`'d into a running prod container by
  `scripts/smoke-chat-prod.sh` and run via a bare `node /tmp/smoke-chat.mjs` — no `node_modules`,
  no `@moss/db`, by design (it has to run inside the target container image as-is). Of the names it
  reads, `JARVIS_SMOKE_BASE_URL`, `JARVIS_SMOKE_SURFACE`, and `JARVIS_SMOKE_TIMEOUT_MS` are already
  carved out (the wrapping shell script reads them too). `JARVIS_SMOKE_TOKEN` and
  `JARVIS_SMOKE_PROMPT` are read only inside the `.mjs` file itself (passed through via `docker exec
-e`, never read by the shell script directly) — genuinely outside both the carve-out rule and the
  shim's reach.
- **`JARVIS_MCP_TOKEN`** is not a config value at all in the sense the shim handles — it's a fixed
  environment-variable _name_, hardcoded as a string constant
  (`packages/chat/src/live/cli-launch-commands.ts:116`, `packages/chat/src/live/codex-exec-session.ts:128`)
  that our code writes into a spawned CLI subprocess's environment so the subprocess's MCP client
  can read its own bearer token back out. Nothing in this repository ever does
  `process.env.JARVIS_MCP_TOKEN` — it is generated per-session and only ever appears as a write-side
  literal and in redaction patterns (`packages/ai/src/adapters/redact.ts`). Renaming the literal
  string would be cosmetic only; deferred as out of scope for the same reason.

None of these seven carries a deployment-config concern: the four permission-hook variables and the
two smoke-chat ones are process-internal plumbing regenerated fresh on every hook run or smoke run,
never read from `infra/env.production.local`, and `JARVIS_MCP_TOKEN` is a name, not a value.

## Also deliberately unfixed: UAT spec-file direct reads

Twenty `tests/uat/specs/*.uat.spec.ts` files read `process.env.JARVIS_UAT_BASE_URL` and/or
`process.env.JARVIS_UAT_PROJECT_NAME` directly, in addition to `tests/uat/playwright.uat.config.ts`
(which already resolves `JARVIS_UAT_BASE_URL` via `resolveMossEnv` into Playwright's own `baseURL`
config). These two names are not carve-outs and are not a coverage gap — they're already in the
70-name shimmed set. The twenty additional call sites are left as bare reads on purpose: the value
is generated fresh by `tests/uat/provisioner.ts` in the same process tree that spawns Playwright for
that one ephemeral run, is never set by a human or read from any deployment env file, and wrapping
twenty near-identical internal test-plumbing call sites would be exactly the "scattered fallback
logic at every call site" anti-pattern the shim design explicitly rejects in favor of centralizing
at the one seam that matters (the Playwright config). If this file set grows significantly, revisit
by threading the config's already-resolved `baseURL` through instead of re-reading `process.env`.
