# Manual-install smoke — in-container CLI chat (#342 foundation)

**What this proves.** That the **merged #342 foundation** (Phases 0/1/1.5, `main` @ `e900009`)
actually works on a live Docker stack: the `cli-runner` sidecar boots, forks its own tmux, binds
its private `0600` socket, the api selects the RPC engine, and a chat message typed in the web UI
routes **api → socket → cli-runner → a real provider CLI → back**. The unit/integration gate cannot
cover this (it needs a running stack); this runbook is that real-world validation.

**Why "manual".** Phase 2 (on-demand installer — the `installProvider` RPC verb that installs a
provider CLI for you) is **not merged yet**. So here you install the CLI into the tools volume **by
hand**, log it in inside the sidecar, then chat. That hand-install is the temporary stand-in for what
Phase 2 will automate.

**Scope / invariants this run must respect.**
- **Single active user only.** `JARVIS_CLI_RUNNER_SINGLE_USER=1` is set by `setup-prod.ts` (the
  #347 gate). Do **not** try to drive two concurrent chat sessions for different users — that path is
  intentionally blocked until UID separation (issue #347) lands.
- **`agy` (Antigravity) is N/A.** Install **`claude`** (recommended) or **`codex`**. `agy` has no
  pinnable artifact yet and is out of scope for this smoke.
- Grounded on **`e900009`** (= `origin/main`, merged via #350). **Get exactly that commit before you
  start** — a local `main` may be behind `origin/main` (it currently is: `13f9d0a`), and checking out
  a stale `main` runs *different code* than this smoke was grounded on (the project's #1 trap):

  ```sh
  git fetch origin && git checkout e900009     # detached at the grounded commit
  git rev-parse HEAD                            # must print e900009...
  # (equivalently: git checkout main && git pull --ff-only — once origin/main == e900009)
  ```

> Expect first-live-deploy friction (volume ownership/UID, socket perms, the `--env-file`
> interpolation gotcha, the `HOME`/`PATH` gotchas in `exec`, and provider login). The
> [Troubleshooting](#troubleshooting) table at the end covers each. **Capture logs** as you go
> (`docker compose ... logs`) — anything that bites here is a real bug to file against #342.

---

## 0. Prerequisites

| Need | Why |
| --- | --- |
| **Docker Engine + compose v2** | The whole stack is containerized. (`docker compose version` must work.) |
| **A checkout at `e900009`** | Source is needed to build the images locally (GHCR publish may be off). **Check out the exact commit (`git checkout e900009`) — a stale local `main` is the #1 trap.** Run all commands **from the repo root**. |
| **A provider account you can log into** | The smoke logs a real CLI in. For `claude`: an Anthropic account (Claude Pro/Max or API). For `codex`: an OpenAI/ChatGPT account. The login is interactive (OAuth URL → paste back a code), so have a browser handy. |

You do **not** need Node, tmux, or any provider CLI installed *on the host* — they all run inside the
`cli-runner` sidecar. (`install.sh` warns about missing host CLIs/multiplexer; for this in-container
smoke those host warnings are harmless and can be ignored.)

Two shorthands used throughout (set them once in your shell so every command is copy-paste-able):

```sh
# From the repo root. NOTE: --env-file is baked into $DC because EVERY compose
# subcommand that parses this file (up, exec, logs, ps, down, config) evaluates the
# ${POSTGRES_PASSWORD:?} / ${JARVIS_CLI_RUNNER_RPC_SECRET:?} fail-closed gates at load
# time and errors if they're unset. The ONE exception is the `setup` run in step 1
# (Path B), which runs BEFORE this file exists — that command is written out in full.
export ENVFILE="infra/env.production.local"
export DC="docker compose -p jarv1s-prod -f infra/docker-compose.prod.yml --env-file $ENVFILE"
```

(So set `$ENVFILE`/`$DC` *after* step 1 has created `infra/env.production.local`, or just
re-`export` them once it exists — a `$DC` call before the file exists will error with
"env file not found".)

---

## 1. Generate boot secrets + bring the stack up

You have two equivalent paths. **Path A (recommended)** uses the product's real one-command launcher.
**Path B** runs the explicit compose commands (use it if you want to watch each step or Path A hides a
failure).

> **Skip the embedding-model download for the smoke.** By default the api downloads a local embedding
> model on first boot — the single most common cause of a slow/failed `/health/ready`. For this smoke
> you don't need it: set **`JARVIS_EMBED_PROVIDER=stub`** *up front* (it's baked into the env file at
> setup time and can't be cleanly changed afterward — `setup` refuses to overwrite). Path A:
> `JARVIS_EMBED_PROVIDER=stub JARVIS_BUILD=1 ./install.sh`. Path B: prefix the step-1 `setup` command
> with `JARVIS_EMBED_PROVIDER=stub`.

### Path A — `./install.sh` (the real flow)

From the repo root:

```sh
JARVIS_BUILD=1 ./install.sh
```

This: preflights Docker → detects host uid/gid → runs the in-container `setup` service (generates
`infra/env.production.local`, mode `0600`, with **all** boot secrets incl. the new
`JARVIS_CLI_RUNNER_RPC_SECRET` and `JARVIS_CLI_RUNNER_SINGLE_USER=1`) → **builds** the api + web
images (`JARVIS_BUILD=1` forces a local build instead of trying to pull from GHCR) → `up -d` → waits
for `/health/ready` (cap 120s) → prints the web URL.

> `JARVIS_BUILD=1` is the important flag for a source checkout with no published image. Without it,
> `install.sh` is in `auto` mode and will try to `docker pull ghcr.io/motioneso/jarv1s-*` first, which
> fails if GHCR publish is disabled. Forcing the build avoids that.

When it finishes you should see `>> Jarv1s is up: http://localhost:5173` and `api ready`. If `api did
not report /health/ready within 120s`, jump to [Troubleshooting](#troubleshooting) before continuing.

### Path B — explicit compose (manual control)

```sh
# 1. Generate the env file (one-shot; REFUSES to overwrite an existing one). This command is written
#    in FULL (not via $DC) because infra/env.production.local does NOT exist yet, so it can't pass
#    --env-file. The POSTGRES_PASSWORD=setup / JARVIS_CLI_RUNNER_RPC_SECRET=setup throwaways only satisfy
#    Compose's parse-time ${VAR:?} gates — setup ignores them and writes the REAL generated values.
JARVIS_IMAGE_TAG=local POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup \
  docker compose -p jarv1s-prod -f infra/docker-compose.prod.yml --profile setup run --rm setup

# 2. Now that infra/env.production.local exists, $DC (which includes --env-file) works.
#    Bring the stack up, BUILDING locally (--build).
$DC up -d --build

# 3. Wait for readiness.
curl -fsS http://localhost:3000/health/ready && echo "  <- api ready"
```

> **Build ordering.** Step 1 runs `setup` before any image build. The `setup` service references
> `ghcr.io/...:local` but carries a `build:` block, so compose v2 **auto-builds** the absent image on
> `run`. If your (older) compose tries to *pull* `ghcr.io/…:local` instead and 404s, pre-build first —
> mirroring what `install.sh` does:
> ```sh
> JARVIS_IMAGE_TAG=local POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup \
>   docker compose -p jarv1s-prod -f infra/docker-compose.prod.yml build api web
> ```

> **`--env-file` gotcha.** `$DC` bakes in `--env-file "$ENVFILE"` for exactly this reason: **every**
> compose subcommand that parses this file — `up`, `exec`, `logs`, `ps`, `down`, `config` — evaluates
> the `${POSTGRES_PASSWORD:?}` / `${JARVIS_CLI_RUNNER_RPC_SECRET:?}` gates at load time and errors
> ("required variable … is missing a value") if they're unset (Compose's `env_file:` does **not** feed
> `${...}` interpolation — that's the fail-closed secret gate, not a bug). The only command that omits
> `--env-file` is the `setup` run above, which must run before the file exists.

---

## 2. Verify the foundation booted clean (watch these)

Before touching a CLI, confirm the sidecar topology came up correctly. Run each check and compare to
the expected result.

**(a) The init one-shot chowned the volumes + created the socket dir.**

```sh
$DC logs init
```
Expect: `init: chowned volumes + created /run/jarv1s (0700) for <uid>:<gid>`. The `<uid>:<gid>` must
match your host (`id -u`/`id -g` on Linux; on macOS Docker Desktop the in-VM uid is what `setup`
recorded — what matters is that api and cli-runner run as that same uid).

**(b) The cli-runner bound its private socket and forked tmux.**

```sh
$DC logs cli-runner
```
Expect a clean start of the RPC server (a "listening" / socket-bound line, no stack trace, no
crash-loop). Then check the socket perms directly:

```sh
$DC exec cli-runner ls -la /run/jarv1s
```
Expect the dir `0700` and `cli-runner.sock` a `srw-------` (`0600`) socket, both owned by the runtime
uid. (This is the isolation boundary — wrong perms here are a finding.)

**(c) The api selected the RPC engine (not the in-process one) and is healthy.**

```sh
$DC logs api | grep -iE 'rpc|cli-runner|socket|reconcile' | head
curl -fsS http://localhost:3000/health/ready && echo "  <- ready"
```
The grep may surface little on a clean api boot (the RPC connection logger is debug-only, and there's
no explicit "RPC engine selected" line) — the authoritative socket-bind proof is the cli-runner
`listening on …/cli-runner.sock` line from step (b). What **must** hold here: `/health/ready` returns
200, and there is **no** `JARVIS_CLI_RUNNER_RPC_SECRET` fail-fast in `$DC logs api` (that fail-fast
crashes the api at boot — a wiring error).

**(d) The volumes are owned by the runtime uid (so installs/auth will be writable).**

```sh
$DC exec cli-runner sh -c 'id; ls -ld /data/cli-tools /data/cli-auth'
```
Expect both dirs owned by the same uid the process runs as. If they're `root`-owned, the init chown
didn't take — stop and fix (see Troubleshooting) before installing, or the npm install / login will
fail with `EACCES`.

---

## 3. Install a provider CLI into the tools volume (the manual Phase-2 stand-in)

Install **claude** (recommended). The `cli-runner` service env sets `NPM_CONFIG_PREFIX=/data/cli-tools`,
so a global npm install lands in the tools volume at `/data/cli-tools/bin/<binary>` — exactly where the
chat-launched CLI looks.

```sh
$DC exec cli-runner npm install -g @anthropic-ai/claude-code
```

Verify the binary landed (note the **full path** — see the PATH gotcha below):

```sh
$DC exec cli-runner /data/cli-tools/bin/claude --version
```

> **PATH gotcha (important).** A plain `$DC exec cli-runner claude ...` will say **`claude: not
> found`**. The entrypoint only adds `/data/cli-tools/bin` to `PATH` for the *RPC server process it
> launches*; a fresh `exec` shell gets the image's default PATH. So in `exec` always call the binary by
> its **full path** `/data/cli-tools/bin/claude` (or `export PATH="$PATH:/data/cli-tools/bin"` first).
> The chat-launched CLI is fine — it runs under the entrypoint's PATH.

<details>
<summary>Alternative: codex instead of claude</summary>

```sh
$DC exec cli-runner npm install -g @openai/codex
$DC exec cli-runner /data/cli-tools/bin/codex --version
# Login (step 4) is then: ... codex login   (HOME gotcha is identical)
```
</details>

---

## 4. Log the CLI in **inside the sidecar** (the friction point)

This is where the most common mistake happens. The chat-launched CLI runs with **`HOME=/data/cli-auth`**
(the entrypoint sets it; it survives the §7.2 env allowlist). So the login **must** write credentials to
`/data/cli-auth/.claude` — which means you must run the login with `HOME=/data/cli-auth`. A login run in
a default `exec` shell would write to the image's default HOME and the chat session would **not** see it.

Run the interactive login with the HOME override and a TTY (`-it`):

```sh
$DC exec -e HOME=/data/cli-auth -it cli-runner /data/cli-tools/bin/claude
```

`claude` starts its first-run/login flow. **The exact UX varies by CLI version:** you may get a theme
prompt then a login menu, or a REPL where you authenticate by typing the **`/login`** slash command
(some versions also support a non-interactive `claude setup-token`). However it prompts, authenticate
(open the OAuth URL it prints, paste the code back), then exit (`Ctrl-C` / `/exit`). The end-state to
verify — credentials under `/data/cli-auth/.claude` — is the same regardless of the menu path.

Confirm the credentials landed where chat will read them:

```sh
$DC exec cli-runner ls -la /data/cli-auth/.claude
```
Expect a `.claude` dir to exist (typically containing `.credentials.json`) owned by the runtime uid. If
`.claude` only exists somewhere else (e.g. `/root/.claude` or `/home/node/.claude`), you logged in
**without** the HOME override — redo the login with `-e HOME=/data/cli-auth`. (On rare keychain-only
setups a plain creds file may not appear at all — in that case rely on the §5 provider check, which runs
`claude auth status` under `HOME=/data/cli-auth` over the socket, reporting claude ready.)

> **codex variant:** `$DC exec -e HOME=/data/cli-auth -it cli-runner /data/cli-tools/bin/codex login`,
> then check `/data/cli-auth/.codex`. Same HOME rule.

---

## 5. Web onboarding — create the primary user

Open the web UI:

```
http://localhost:5173
```

Sign up to create the **primary (single) user**, then walk the onboarding wizard. The provider-check
step probes the sidecar over the socket; since you installed + logged in `claude` in steps 3–4, it
should report **claude available**. (If you ran onboarding *before* installing, just re-run the
provider check / refresh — there's no need to recreate the user.)

> If the provider check still shows nothing after install+login, capture `$DC logs api` and
> `$DC logs cli-runner` around the check and note it as a finding (the in-container code is an RPC
> `probeProvider` call to the cli-runner over the socket — the cli-runner checks `/data/cli-tools/bin` —
> not a host PATH probe) — but it does **not** block the chat smoke below; chat launches the CLI directly.

---

## 6. The chat smoke — send a message end to end

In the web UI, open the chat (the Jarv1s chat drawer/surface), make sure the provider is **claude**,
and send a simple message, e.g.:

```
Say hello and tell me what model you are.
```

**Expected:** a streamed reply from the real `claude` CLI appears in the web chat within a few seconds.
That round-trip is the whole proof: the message went **api → `0600` socket → cli-runner → tmux →
`claude` (HOME=/data/cli-auth, cwd a per-session neutral dir) → transcript → readNew → back to the web
UI**.

Watch it happen live in a second terminal while you send the message:

```sh
$DC logs -f cli-runner    # launch/submit/readNew activity, a jarv1s-live-* tmux session
# and, separately:
$DC logs -f api           # the RPC launch + reconcile path
```

You can also confirm a live tmux session exists during the chat:

```sh
$DC exec cli-runner tmux ls
```
(tmux is installed in the image at `/usr/bin/tmux`, on the default PATH — no PATH tweak needed, unlike
the npm-installed `claude`.) Expect a `jarv1s-live-<sessionKey>` session while the chat is active; it's
cleaned up on kill / idle reap.

**Single-user gate check (optional, confirms #347 posture).** While one chat session is live, the
sidecar must refuse a *second, different* user's launch. You can't easily drive a second user from the
single-user UI — so just confirm in `$DC logs cli-runner` that you only ever see one live session, and
that the gate flag is on:

```sh
$DC exec cli-runner sh -c 'echo SINGLE_USER=$JARVIS_CLI_RUNNER_SINGLE_USER'   # expect 1
```

If you get a reply in the web chat: **the foundation works live.** 🎉

---

## 7. Teardown

```sh
# Stop + remove containers and the network, KEEP the data volumes (so a re-run reuses your login):
$DC down

# ⚠️ DESTRUCTIVE / irreversible — full reset: ALSO deletes Postgres (your primary user + all data) and
#    the CLI tools/auth volumes (your provider login). Only run -v if you want a clean slate.
$DC down -v
```

To re-run later without regenerating secrets, keep `infra/env.production.local` (it's `0600` and holds
all your keys — **back it up**, never commit it) and `up -d` again.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Any `$DC` command fails: `required variable POSTGRES_PASSWORD/JARVIS_CLI_RUNNER_RPC_SECRET is missing a value` | `--env-file` not in effect (you redefined `$DC` without it, or ran before the env file existed). Compose evaluates the `${VAR:?}` gates at load for **every** subcommand (`up`/`exec`/`logs`/`ps`/`down`) — `env_file:` does **not** feed `${...}` interpolation. | Ensure `$DC` includes `--env-file "$ENVFILE"` and that `infra/env.production.local` exists (step 1). Only the `setup` run legitimately omits it. |
| `setup` says it **refuses to overwrite** `env.production.local` | A prior run already generated it (idempotent — regenerating would orphan secrets). | Reuse the existing file, or (data loss) back it up, `rm` it, re-run `setup`. |
| `init` log shows wrong uid, or `/data/*` is `root`-owned | The chown didn't match the runtime uid, or you're on a host where Docker maps uids differently. | Confirm `JARVIS_HOST_UID/GID` in `$ENVFILE` match the uid api/cli-runner run as; re-run `$DC ... up -d` so `init` re-chowns. On a fresh volume set, `down -v` then back up. |
| `cli-runner.sock` missing or not `0600`, or api can't connect | init didn't create `/run/jarv1s` (0700), or a stale socket, or the api/cli-runner uid mismatch. | Check `$DC logs init` + `$DC logs cli-runner`; the server unlinks a stale socket on boot. Ensure both services share `JARVIS_HOST_UID`. |
| api **crash-loops at boot** | `JARVIS_CLI_RUNNER_RPC_SECRET` unset/empty (fail-fast wiring) or a bad DB URL. | Confirm the secret is in `$ENVFILE` and passed via `--env-file`; check `$DC logs api`. |
| `claude: not found` in `exec` | `/data/cli-tools/bin` isn't on a fresh `exec` shell's PATH. | Call the binary by full path `/data/cli-tools/bin/claude`, or `export PATH="$PATH:/data/cli-tools/bin"`. |
| npm install fails with `EACCES` | Tools volume not owned by the runtime uid (init chown issue). | Fix volume ownership (row above), then retry the install. |
| Logged in, but chat says provider not authed / no reply | Login wrote to the wrong HOME — credentials aren't under `/data/cli-auth/.claude`. | Redo step 4 **with** `-e HOME=/data/cli-auth`; verify `$DC exec cli-runner ls -la /data/cli-auth/.claude`. |
| Chat message sent, spinner forever, no reply | Provider not logged in, the CLI errored at launch, or a tmux/launch failure. | `$DC logs -f cli-runner` while sending; look for the launch/submit lines and any CLI stderr. Confirm `/data/cli-tools/bin/claude --version` works *and* it's logged in. |
| `/health/ready` never green within 120s | migrate failed, Postgres unhealthy, or (most common) the embedding model is still downloading on first boot. | `$DC logs migrate`, `$DC logs postgres`, `$DC logs api`. If it's the model download: best to have set `JARVIS_EMBED_PROVIDER=stub` up front (§1). After the fact, `setup` won't regenerate the env file — edit `JARVIS_EMBED_PROVIDER=stub` in `infra/env.production.local`, then `$DC up -d` to recreate api+worker; or just give the download longer. |
| `up` fails: subnet/pool overlaps | `10.251.0.0/24` already used by another Docker network on the host (e.g. the dev compose). | Re-run `setup` with `JARVIS_DOCKER_SUBNET=10.252.0.0/24` (or any free /24), or `down` the other stack. |

### What to file as a finding

Anything in this list that you hit and the "Fix" doesn't resolve, **or** any crash/stack trace in
`init` / `cli-runner` / `api` / `migrate` logs, is a real defect in the merged foundation — capture the
exact command + the relevant `$DC logs <service>` output and file it against **#342** (note "manual
smoke, `main` @ `e900009`"). This run exists precisely to surface what the offline gate could not.
