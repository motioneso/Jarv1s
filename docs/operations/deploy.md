# Deploy Guide (containerized prod stack)

This is the operator-facing guide for deploying Jarv1s from the published images
(or a local build) with the **one-command launcher** `install.sh`. It covers
prereqs, the install flow, the Windows/WSL2 path, cutting a release, and
backup/restore. For the container architecture and the host-multiplexer bridge
internals, see [`dev-environment.md`](./dev-environment.md).

The deploy artifact is `infra/docker-compose.prod.yml` (the prod compose — NOT the
dev `infra/docker-compose.yml`). It runs one app image (`ghcr.io/motioneso/jarv1s-api`)
for api / worker / migrate and an nginx static-web image
(`ghcr.io/motioneso/jarv1s-web`) that serves the SPA and reverse-proxies
`/api` + `/health` to the api.

## Prerequisites

| Need                                                                | Why                                                                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Engine + compose v2**                                      | The whole stack runs in containers. `install.sh` fails fast if `docker` or the `docker compose` subcommand is missing.                                                             |
| **A terminal multiplexer** — `tmux` **or** `herdr`                  | The CLI chat bridge execs the host multiplexer from the container. `install.sh` warns (does not fail) if neither is found; the onboarding wizard then reports chat as unavailable. |
| **≥1 provider CLI** — `claude` / `codex` / `gemini` (+ its `login`) | Live AI chat drives your installed, logged-in CLI. Install at least one and run e.g. `claude login`. `install.sh` warns if none are on `PATH`.                                     |
| **A CLI subscription / quota**                                      | The provider CLI must have usage available (the wizard tests each connection live).                                                                                                |
| **An on-disk `HOME`**                                               | `install.sh` derives `~/.claude`, `~/.codex`, `~/.gemini`, and `~/.jarvis/chat` from `$HOME` and bind-mounts them into the container.                                              |

> The host does **not** need Node.js — `install.sh` is POSIX `sh` and generates
> secrets via the in-container `setup` service.

## The one-command flow (`./install.sh`)

`install.sh` lives at the repo root. In a single run it:

1. **Preflight** — verifies Docker + compose v2; checks for a multiplexer and a
   provider CLI (warn-only).
2. **Detects** the host — `uid`/`gid`, `$HOME`, the multiplexer (prefers a Herdr
   socket, else tmux), the three CLI dirs, and `~/.jarvis/chat`. Derives the
   per-uid tmux socket dir `/tmp/tmux-<uid>`.
3. **Generates secrets** — runs the in-container `setup` service, which writes
   `env.production.local` (mode `0600`) next to the compose with every boot
   secret: `BETTER_AUTH_SECRET`, `JARVIS_CONNECTOR_SECRET_KEY`,
   `JARVIS_AI_SECRET_KEY`, `POSTGRES_PASSWORD`, and four distinct per-role DB
   passwords (the superuser password equals the one embedded in
   `JARVIS_BOOTSTRAP_DATABASE_URL`).
4. **Records bridge paths** — appends the host CLI dirs, chat home, and tmux
   socket dir to `env.production.local` so the file is fully self-contained.
5. **Launches** the stack (`docker compose up -d`). If the image is absent and the
   repo source is present it builds locally; if a published image is present it
   reuses it.
6. **Waits for readiness** — polls `/health/ready` (cap 120s).
7. **Opens the onboarding URL** — `http://localhost:<web-port>` (headless-safe:
   it prints the URL if no GUI opener exists).

```sh
# From a clean deploy dir that has ONLY docker-compose.prod.yml + install.sh,
# pulling a published image:
JARVIS_IMAGE_TAG=v1.2.3 ./install.sh

# From the repo root, building locally (GHCR publish not yet available):
JARVIS_IMAGE_TAG=local JARVIS_API_PORT=3000 JARVIS_WEB_PORT=5173 ./install.sh
```

Environment overrides accepted by `install.sh`:

| Variable                | Default         | Purpose                                                                        |
| ----------------------- | --------------- | ------------------------------------------------------------------------------ |
| `JARVIS_IMAGE_TAG`      | `local`         | Image tag to deploy (pin a published version; never `:edge`/`:latest`).        |
| `JARVIS_PROJECT`        | `jarv1s-prod`   | Compose project name (use a distinct one to run a second deploy alongside).    |
| `JARVIS_API_PORT`       | `3000`          | Host port for the api.                                                         |
| `JARVIS_WEB_PORT`       | `5173`          | Host port for the web UI.                                                      |
| `JARVIS_DOCKER_SUBNET`  | `10.251.0.0/24` | Docker network subnet (override if it overlaps an existing host network).      |
| `JARVIS_EMBED_PROVIDER` | `local`         | `local` downloads the embedding model on first use; `stub` skips it.           |
| `JARVIS_BUILD`          | `auto`          | `auto` builds only if the image is absent; `1` forces `--build`; `0` skips it. |

### ⚠️ Back up `env.production.local`

`env.production.local` is the **only** copy of your auth/encryption keys and the
Postgres superuser password. The `setup` service **refuses to overwrite** an
existing file (re-running `install.sh` keeps your existing config) — regenerating
it would orphan every session and all encrypted connector/AI data, and a new
`POSTGRES_PASSWORD` is silently ignored by an already-initialized data volume.

**Copy it somewhere safe immediately after the first install.** Losing it is
unrecoverable data loss. See [Backup / restore](#backup--restore) below.

## Windows users (WSL2)

Native Windows is **not** supported for the multiplexer bridge (the container
drives a Linux tmux socket). Use **WSL2**:

1. Install **Docker Desktop** with the **WSL2 backend** enabled.
2. Inside your WSL2 distro (Ubuntu recommended), install the prereqs:
   ```sh
   sudo apt update && sudo apt install -y tmux   # the bridge multiplexer
   # install a provider CLI (e.g. the Claude CLI) and run `claude login` inside WSL2
   ```
3. From WSL2, deploy exactly as above — `install.sh` detects the WSL2 `$HOME`
   (`/home/<user>` inside the distro) and the per-uid tmux socket dir. The CLI
   auth dirs it mounts live inside WSL2's filesystem, so run `claude login` (and
   any provider login) **inside WSL2**, not on Windows.

## Cutting a release (`scripts/publish-images.sh`)

A maintainer publishes multi-arch (`linux/amd64,linux/arm64`) images to GHCR so an
operator on any OS can `docker compose pull`. **One-time per machine:**

```sh
docker buildx create --use --name jarv1s-builder              # multi-arch builder
echo "<PAT>" | docker login ghcr.io -u <github-user> --password-stdin   # PAT needs write:packages
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes   # cross-arch emulation
```

Then, from the repo root:

```sh
./scripts/publish-images.sh v1.2.3      # tag optional; defaults to `git describe --tags`
```

This pushes `ghcr.io/motioneso/jarv1s-api:<tag>` (+ `:latest`) and
`ghcr.io/motioneso/jarv1s-web:<tag>` (+ `:latest`). It fails clearly if buildx is
unavailable or you are not logged in to GHCR. Operators then deploy with
`JARVIS_IMAGE_TAG=<tag> ./install.sh`.

When GitHub Actions publishing is re-enabled, the `publish` job in
`.github/workflows/ci.yml` already builds **both** `linux/amd64,linux/arm64` (the
`platforms:` key), so CI tags and this script produce the same multi-arch images.

## Manual alternative (no `install.sh`)

If you already maintain an env file or want to hand-edit every value, copy
`infra/env.production.example` to an off-git file, fill it, and bring the stack up
directly (passing `--env-file` so Compose **interpolation** vars resolve — a
service `env_file:` only feeds container runtime env, not `${...}` substitution):

```sh
cp infra/env.production.example infra/env.production.local   # edit: secrets, UID/GID, tag
docker compose -p jarv1s-prod -f infra/docker-compose.prod.yml \
  --env-file infra/env.production.local up -d
```

## Backup / restore

Two things must survive a host failure: **`env.production.local`** (your keys) and
the **Postgres data volume**. Back up both.

### `env.production.local`

It is off-git by design (`.dockerignore` and `.gitignore` exclude it). Copy it to
your off-host backup target immediately after the first install and after any
manual edit:

```sh
# Back up (mode preserved):
cp -p env.production.local /mnt/backup/jarv1s-env.production.local
# Restore: drop it next to the compose file BEFORE the first `install.sh`/`up` —
# the setup service then refuses to overwrite it (idempotent), preserving keys.
```

### Postgres volume + vault

The automated daily backup (Postgres dump + Obsidian vault) is documented in
[`backup.md`](./backup.md). For the containerized prod stack the data lives in the
named volume `<project>_jarv1s-postgres-data` (default project `jarv1s-prod` →
`jarv1s-prod_jarv1s-postgres-data`) and the vault in
`<project>_jarv1s-vault-data`. A raw volume snapshot:

```sh
# Back up the data volume (stop the stack first to get a consistent snapshot):
docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file ./env.production.local down
docker run --rm -v jarv1s-prod_jarv1s-postgres-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/jarv1s-postgres-$(date +%F).tar.gz -C /data .

# Restore:
docker volume create jarv1s-prod_jarv1s-postgres-data
docker run --rm -v jarv1s-prod_jarv1s-postgres-data:/data -v "$PWD":/backup \
  alpine tar xzf /backup/jarv1s-postgres-<date>.tar.gz -C /data
```

For a logical DB dump/restore drill (recommended monthly), follow the procedure in
[`backup.md`](./backup.md) → "Monthly restore drill".

## Teardown

```sh
docker compose -p jarv1s-prod -f docker-compose.prod.yml \
  --env-file ./env.production.local down -v     # -v ALSO removes the data volumes
```

Omit `-v` to keep the Postgres/vault/model-cache volumes (so a subsequent `up`
resumes with your data). `down -v` is irreversible — back up first.
