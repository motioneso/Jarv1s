# Phase 2 — Deployable Containerized Stack + CI Publish + Supervision + Reboot-Survival (Design Spec)

**Status:** approved-pending-user-review · **Date:** 2026-06-12 · **Author:** Ben + Claude
**Phase:** 2 (epic #47, milestone #11 "Portable, Deployable & Multi-user")
**Implements:** epic #47 exit criterion #5 — _"Deployable Docker image (not the dev compose) + CI image build/publish + supervision/auto-restart + reboot-survival"_
**Decisions honored:** ADR 0007 (house tenancy), ADR 0008 (portable chat engine — host-provisioned, not image-baked)
**Grounded on:** `a898533` (local `main` == `origin/main`)
**Hard dependency:** the Portable CLI Chat Adapter slice (`docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md`) — it adds the `TmuxIo.run` env/cwd seam and the `transcriptGlobDir(provider, cwd, homeBase)` parameter this spec relies on (§5.2 / AC#5 of that spec). Those seams do **not** exist in code today; see §Components → "Host-multiplexer bridge".

---

## Goal

Ship the **final** containerized production topology for Jarv1s — not a bare-metal stopgap — so the
DEPLOY CHECKPOINT in epic #47 can be met: a fully containerized app (api / worker / migrate + a
static-web image + Postgres) orchestrated by a dedicated production Compose file, built and published
to GHCR by CI on git tags, supervised so a crashed container self-heals, and surviving a host reboot
unattended. The one behavior that cannot be image-baked — CLI chat, which needs the host
multiplexer (tmux/herdr) and the host CLI binaries with their personal auth (ADR 0008 §2 forbids
bundling them) — is reached from the container via a **bind-mounted host socket + host HOME**, an
explicit, documented single-operator-household tradeoff that is forward-compatible with the future
API-key adapter (which needs none of these mounts).

Today there is **no** Dockerfile and **no** production Compose anywhere in the repo
(`find … -iname Dockerfile*` and `-iname '*.prod.yml'` both empty); the only Compose is
`infra/docker-compose.yml`, a **dev/smoke** file that bind-mounts the whole source tree
(`x-workspace-volumes: ..:/workspace`), runs `pnpm install` + `tsx` at container start, and uses dev
credentials inline. That file is the **pattern donor**, not the deploy artifact — it must not be
repurposed.

---

## Architecture

**Three images, one Compose, one systemd unit.** A single **multi-stage app image**
(`ghcr.io/motioneso/jarv1s-api`) is built once and reused for three runtime roles — `api`, `worker`,
and the one-shot `migrate` — selected by the container **command**, exactly mirroring how the dev
Compose runs `pnpm start:api` / `pnpm start:worker` / `pnpm db:migrate` from one `node:24-bookworm-slim`
base (`infra/docker-compose.yml:72,118,55`). A separate **static-web image**
(`ghcr.io/motioneso/jarv1s-web`) is an nginx container serving the Vite SPA bundle and
reverse-proxying `/api` and `/health` to the api container — replacing the dev-only Vite dev server
(`apps/web/package.json` `dev: vite --host`, which is not a production server). Postgres stays
`pgvector/pgvector:pg17` (Hard Invariant; `infra/docker-compose.yml:26`). A new
`infra/docker-compose.prod.yml` wires these with **pinned image tags, named volumes, no bind mounts
of source, `restart: unless-stopped`**, and the same dependency gating the dev file already uses.

**Build-time vs run-time split.** The dev file pays a per-start `pnpm install` + runs TypeScript
through `tsx` (a **dev-only** root devDependency — `package.json:74`; the app `start` scripts are
`tsx src/server.ts` / `tsx src/worker.ts`, `apps/api/package.json` / `apps/worker/package.json`). The
production image instead **compiles** api+worker to `dist/` at build time and runs plain
`node dist/...` — no `tsx`, no install, no source mount at runtime. New `build:api` / `build:worker`
scripts produce the `dist/` output; the existing `build:web` (`package.json:30`) already emits the
SPA bundle to `apps/web/dist`.

**Deploy-time ordering.** Migrations run as a **one-shot prod container** (the app image with the
`migrate` command, i.e. `node dist/migrate.js` equivalent of today's `scripts/migrate.ts`) before
`api`/`worker` start. The prod Compose reuses the dev file's proven gate:
`depends_on: { migrate: { condition: service_completed_successfully } }`
(`infra/docker-compose.yml:88-90,120-122`) and `postgres: { condition: service_healthy }`
(`:56-58`). `scripts/migrate.ts` is idempotent (bootstrap → app/module SQL → pg-boss → grants;
`scripts/migrate.ts:21-46`) and hash-checks applied files, so re-running it on every deploy is safe
(Hard Invariant: never edit applied migrations — this design only **runs** the runner, never edits a
file).

**The CLI-chat exception.** Live chat drives `claude`/`codex`/`gemini` through a multiplexer on the
host under the operator's personal auth (`cli-chat-engine.ts`; ADR 0008 §Context). ADR 0008 §2 is
explicit: **do not containerize or bundle the CLI binaries**; portability is host-provisioned at
onboarding. So the api/worker container does not run the CLIs — it **steers the host's** multiplexer
through a **bind-mounted socket**, and reads the host's transcript files through a **bind-mounted
host HOME**. The engine's existing seams (the multiplexer-neutral engine, `TmuxIo.run` env/cwd, and
`transcriptGlobDir`'s `homeBase`, all added by the CLI-adapter slice) are pointed at the mounted host
paths. This is the only place the container reaches outside its own filesystem, and it is **opt-in**
per the chosen adapter: the future API-key adapter (ADR 0008 §1b) talks HTTP to a provider and needs
**none** of these mounts.

---

## Components

### 1. App image — `Dockerfile` (multi-stage, `ghcr.io/motioneso/jarv1s-api`)

**What it does.** One image for `api`, `worker`, and `migrate`. Multi-stage:

- **deps stage** — `node:24-bookworm-slim`, `corepack enable`, `pnpm install --frozen-lockfile` for
  the whole workspace (matches CI pin `pnpm@10.6.2`, `package.json:6`; node 24, `ci.yml:30`). Honors
  `pnpm-workspace.yaml` `onlyBuiltDependencies` (`onnxruntime-node`, `sharp`) so the embedding
  native binaries are present (the worker needs them — see §3).
- **build stage** — runs `pnpm build:api` and `pnpm build:worker` (new scripts) compiling
  `apps/api/src/server.ts` and `apps/worker/src/worker.ts` plus their `workspace:*` deps
  (`@jarv1s/db`, `@jarv1s/auth`, `@jarv1s/jobs`, `@jarv1s/module-registry`, `@jarv1s/memory`, …, per
  the app `package.json` dependency lists) to `dist/`, and compiles `scripts/migrate.ts` to a
  `dist/` migrate entrypoint. esbuild (bundle the workspace graph into one file per entrypoint) is
  preferred over raw `tsc` because the repo links packages by **source-path tsconfig aliases**
  (`tsconfig.json` `paths`) and `workspace:*` symlinks, which `tsc --build` project-references are not
  set up for; bundling sidesteps a runtime module-resolution rebuild. (Implementation may choose
  `tsc` + a path-rewrite + `pnpm deploy --prod` prune instead — the **contract** is "plain
  `node dist/...` at runtime, no `tsx`, no per-start install".)
- **runtime stage** — slim base, copy only `dist/` + the pruned production `node_modules` (including
  the `onnxruntime-node`/`sharp` native binaries), a **non-root** `node` user, no source tree,
  no dev deps. `ENTRYPOINT`/`CMD` default to the api; `worker` and `migrate` override `command` in
  Compose.

**How it's used.** `infra/docker-compose.prod.yml` references it by pinned tag
(`ghcr.io/motioneso/jarv1s-api:<tag>`) for all three services; the `command` selects the role —
`node dist/server.js` (api), `node dist/worker.js` (worker), `node dist/migrate.js` (migrate
one-shot).

**Depends on.** The build scripts (§2); the GHCR publish job (§7); a new `.dockerignore` excluding
`node_modules`, `.git`, `tests/`, `spikes/`, `docs/`, `backups/`, `exports/`, `**/dist`,
`.codegraph/` so build context stays small and no host artifacts leak into the image.

### 2. Build scripts — `build:api`, `build:worker` (+ migrate entry)

**What they do.** Compile the TypeScript app entrypoints + their workspace deps to `dist/`. Added to
root `package.json` `scripts` (which today has `build:web` but no api/worker build —
`package.json:30`). The migrate entrypoint is compiled too so deploy-time migration runs as
`node dist/...` rather than `tsx scripts/migrate.ts` (`package.json:18`).

**How it's used.** By the app image build stage and by CI (a `pnpm build:api && pnpm build:worker`
step can join the existing `verify` job's `Build web`, `ci.yml:48-49`).

**Depends on.** esbuild (or `tsc`/`pnpm deploy`) added as a root devDependency; the existing
`tsconfig.json` for type settings.

### 3. Worker runtime + embedding model cache

**What it does.** The worker (`apps/worker/src/worker.ts`) constructs the embedding provider on
startup (`createEmbeddingProvider(getEmbeddingProviderConfig())`, `worker.ts:49`). The default is
`LocalEmbeddingProvider` (`embedding-provider-config.ts:30` default `"local"`), which lazily calls
`@huggingface/transformers` `pipeline("feature-extraction", "nomic-ai/nomic-embed-text-v1.5")`
(`local-embedding-provider.ts:5,34`) — at first use this **downloads model weights** and needs
`onnxruntime-node` + `sharp` native binaries.

**How it's used.** The image must (a) include the native binaries (handled by `onlyBuiltDependencies`
in the deps stage), and (b) give the model a **persistent cache volume** so weights aren't re-fetched
on every container restart. The prod Compose mounts a named volume at the transformers cache dir
(set `HF_HOME`/`TRANSFORMERS_CACHE` to a path under that volume) for the worker. Operators who want
zero model download at runtime may set `JARVIS_EMBED_PROVIDER=stub` (`embedding-provider-config.ts`),
but `local` is the production default and must work containerized.

**Depends on.** Named volume `jarv1s-model-cache`; env `HF_HOME` (or equivalent) added to
`env.production.example`.

### 4. Static-web image — `apps/web/Dockerfile` + `infra/nginx/jarv1s-web.conf` (`ghcr.io/motioneso/jarv1s-web`)

**What it does.** Multi-stage: a build stage runs `pnpm build:web` (→ `apps/web/dist`,
`apps/web/package.json` `build: tsc --noEmit && vite build`); a runtime stage is `nginx` serving that
static bundle and reverse-proxying `/api` and `/health` to the api container. This replaces the dev
Vite proxy (`apps/web/vite.config.ts` `server.proxy` — dev-only). The nginx config mirrors the dev
proxy targets: `/api` and `/health` → `http://api:3000` (the dev file uses
`JARVIS_API_PROXY_TARGET: http://api:3000`, `infra/docker-compose.yml:100`), with SPA history
fallback (`try_files … /index.html`) for client-side routes (react-router,
`apps/web/package.json`).

**Why nginx and not Fastify-serves-static.** The api is intentionally **JSON-only with a maximally
restrictive `default-src 'none'` CSP** (`apps/api/src/server.ts:63-74`). Serving the HTML/JS SPA from
that origin would force loosening that CSP. Keeping the SPA on a separate nginx origin preserves the
api's locked CSP posture (Hard Invariant: secrets/headers; the CSP comment at `server.ts:62-67`).
nginx sets the SPA's own relaxed-but-scoped CSP for the document; the api keeps `default-src 'none'`.

**How it's used.** A `web` service in the prod Compose, pinned tag, `restart: unless-stopped`,
publishes the LAN/Tailscale port (e.g. `${JARVIS_WEB_PORT:-5173}`), `depends_on` api healthy.

**Depends on.** `pnpm build:web` (exists); a new `infra/nginx/jarv1s-web.conf`; the api service name
on the Compose network.

### 5. Production Compose — `infra/docker-compose.prod.yml` (new)

**What it does.** The deploy artifact. Services: `postgres` (pgvector/pgvector:pg17, named data
volume, healthcheck — copy `infra/docker-compose.yml:25-42`), `migrate` (app image, migrate command,
one-shot, `depends_on postgres: service_healthy`), `api` (app image, `node dist/server.js`,
`restart: unless-stopped`, the existing `/health` Docker `HEALTHCHECK` lifted from
`infra/docker-compose.yml:74-85`, `depends_on migrate: service_completed_successfully`), `worker`
(app image, `node dist/worker.js`, `restart: unless-stopped`, `depends_on migrate:
service_completed_successfully` — copy `:111-124`), `web` (web image, `restart: unless-stopped`,
`depends_on api: service_healthy`).

**How it differs from the dev file (the whole point).**

- **Pinned image tags** (`image: ghcr.io/motioneso/jarv1s-{api,web}:<tag>`) instead of
  `node:24-bookworm-slim` + runtime `pnpm install` + `tsx`.
- **No source bind mounts.** The `x-workspace-volumes` anchor (`infra/docker-compose.yml:1-22`)
  and `..:/workspace` are **deleted** in prod. The only bind mounts are the host-multiplexer socket
  and host HOME for CLI chat (§6) — and even those only on `api`/`worker`.
- **Named volumes** for Postgres data (`jarv1s-postgres-data`), the **vault**
  (`jarv1s-vault-data` → `/data/vaults`, the `getVaultBaseDir()` default,
  `packages/vault/src/vault-config.ts:1`), and the model cache (`jarv1s-model-cache`, §3). No
  product data on bind mounts (Hard Invariant: `VaultContext` for vault I/O — the volume is the
  persistence target, not a code change).
- **Secrets via runtime env injection**, never baked into the image: `env_file:` pointing at the
  operator-managed file derived from `infra/env.production.example` (extended — §8). The example
  already carries `BETTER_AUTH_SECRET`, `JARVIS_CONNECTOR_SECRET_KEY`, `JARVIS_AI_SECRET_KEY`, and
  per-role DB URLs (`infra/env.production.example:21-23,14-18`).

**Depends on.** All three images published (§1, §4, §7); the extended env example (§8).

### 6. Host-multiplexer bridge (the key CLI-chat-from-container design)

**What it does.** Lets the api/worker container **steer the host's** tmux/herdr server and **read the
host's** CLI transcripts, without bundling any CLI (ADR 0008 §2). Three mounts on `api` + `worker`
only:

1. **Multiplexer socket.**
   - tmux: bind-mount the host per-uid socket dir `/tmp/tmux-<host-uid>` into the container at the
     **same path** (tmux derives its socket from `/tmp/tmux-$(id -u)`; the §8 limitation in the
     CLI-adapter spec notes this dir is mode `0700` per-uid). The container's runtime user must map
     to the host operator uid (see UID mapping below) so it can open that socket.
   - herdr: bind-mount the host herdr socket `~/.config/herdr/herdr.sock` (env
     `HERDR_SOCKET_PATH`) into the container at a stable path, and set `HERDR_SOCKET_PATH` in the
     container env to that path.
   The tmux/herdr **server runs on the host**, so the `claude`/`codex`/`gemini` processes execute on
   the host with the host's CLI auth — exactly ADR 0008's host-provisioned model. The container only
   sends multiplexer verbs over the socket.

2. **Host CLI config / transcript dirs.** Bind-mount the host operator's `~/.claude`, `~/.codex`,
   `~/.gemini` (read access is required so `readNew()` can parse the JSONL transcripts —
   `cli-chat-engine.ts:148-151`, `transcriptGlobDir` resolves `~/.claude/projects/<enc>/…`,
   `~/.codex/sessions/…`, `~/.gemini/tmp/…`, `tmux-bridge.ts:75-97`). Mount them under a single
   container HOME base, e.g. host `/home/<op>` → container `/host-home` containing `.claude`,
   `.codex`, `.gemini`.

3. **Neutral/persona dir alignment.** The engine writes the per-session persona/neutral dir
   (`persona.ts:87` `join(resolveBaseDir(baseDir), userId)`, `mkdir … 0700`) and `cd`s the CLI into
   it (`buildClaudeCommand` `cd <neutralDir>`, `cli-chat-engine.ts:208`). Because the CLI runs on the
   **host** (under the host tmux/herdr server) but the path is computed by the **container**, the
   neutral-dir base must resolve to a path that is **identical on host and container** — achieved by
   mounting the host neutral-dir base into the container at the same absolute path (or pointing
   `JARVIS_VAULT_ROOT`/the persona base at the shared vault volume that is also visible to the host).

**The env/home wiring.** Set `homeBase` = the mounted host HOME path (`/host-home`) so
`transcriptGlobDir(provider, cwd, homeBase)` (the CLI-adapter slice's new 3rd param,
`cli-chat-adapter-design §5.2`) resolves transcript paths under the **host** HOME, not the
container's. Thread the same via the new `TmuxIo.run` env/cwd seam (same slice, §5.2 / AC#5) so the
spawned multiplexer commands carry the right `HOME`/`HERDR_SOCKET_PATH`. **These seams are why this
spec hard-depends on that slice** (they are default-noop today and absent before it lands).

**UID / permissions mapping.** The container runtime user must be able to open the host socket
(mode `0700`, owned by the host operator uid) and read the host HOME mounts. Options, in
preference order: (a) run the api/worker container with `user: "<host-uid>:<host-gid>"` in the prod
Compose so file/socket ownership lines up; (b) if a fixed image `node` uid is required, ensure it
equals the host operator uid at build, or relax the socket dir group. Document the chosen mapping in
`dev-environment.md` and reference `JARVIS_HOST_UID`/`JARVIS_HOST_GID` env in the env example.

**Security tradeoff (must ship documented).** Mounting the host CLI auth (`~/.claude` et al.) and the
multiplexer socket into the container means a compromise of the container can reach the operator's
personal CLI credentials and steer host sessions. This is **accepted under the single-operator
household model** (ADR 0007) — the same trust boundary the CLI-adapter slice already documents as the
shared-uid soft boundary (`cli-chat-adapter-design §8`). It is **opt-in**: only present when the
CLI-subscription adapter is the chosen path. The **API-key adapter needs none of these mounts** — it
is HTTP-only — so an instance that picks API keys runs with a strictly smaller attack surface. This
section must appear in `dev-environment.md` and be linked from the epic #47 exit criterion.

**Depends on.** The Portable CLI Chat Adapter slice (multiplexer-neutral engine + `homeBase` +
`TmuxIo.run` env/cwd). Without it this bridge cannot point at the host HOME and would read the
container's empty HOME.

### 7. CI publish job — `.github/workflows/ci.yml` (new job)

**What it does.** A new `publish` job builds and pushes both images to GHCR. Modeled on the existing
`compose-smoke` job (`ci.yml:61-92`) for checkout/pnpm/node setup, but adds
`permissions: packages: write` (the workflow default is `contents: read`, `ci.yml:9-10`), logs in via
`docker/login-action` to `ghcr.io`, and uses `docker/build-push-action` to build + push
`ghcr.io/motioneso/jarv1s-api` and `ghcr.io/motioneso/jarv1s-web`.

**Tag policy.** On **git tags** (`on: push: tags: ['v*']`) push the **version tag** (e.g.
`:v1.2.3`); optionally on **main** push `:edge` for a rolling pre-release image. The prod Compose
references the **pinned version tag**, never `:edge`/`:latest`, so a deploy is reproducible.

**Gating.** Publish runs only after `verify` and `compose-smoke` pass (`needs: [verify,
compose-smoke]`) so no broken image is ever published.

**Depends on.** The Dockerfiles (§1, §4); repo GHCR package permissions for `motioneso`.

### 8. Supervision + reboot survival

**Per-container recovery.** Every long-running service in the prod Compose carries
`restart: unless-stopped` (the dev file already proves this for api/web/worker —
`infra/docker-compose.yml:73,102,119`; release-hardening.md notes "a crash-exit self-heals without
manual intervention", `release-hardening.md:157-160`). The api also keeps the `/health` Docker
`HEALTHCHECK` (`infra/docker-compose.yml:74-85`).

**Boot survival — `infra/systemd/jarv1s-stack.service` (new).** A systemd unit mirroring
`infra/systemd/jarv1s-backup.service` (`Type`, `User=ben`, `WorkingDirectory`, `After/Requires
docker.service`) that runs `docker compose -f infra/docker-compose.prod.yml up -d` on boot. Unlike
the backup unit (`Type=oneshot` + a `.timer`, `WantedBy=timers.target`), the stack unit is
**`WantedBy=multi-user.target`** so it starts at every boot. (Docker's own `restart: unless-stopped`
restores containers that were running, but the systemd unit guarantees first-boot start and a clean
`up -d` after a Docker daemon reset.) `EnvironmentFile=-…` points at the operator env file for
`JARVIS_*` substitution in the Compose.

**Reboot-survival verification.** A documented/scripted check (runbook in `dev-environment.md`,
optionally a `scripts/verify-reboot-survival.sh`): reboot the host → after boot,
`/health/ready` returns `{ ok:true, db:"ok", pgboss:"ok" }` (`server.ts:121-144`; the readiness probe
the smoke script already asserts, `smoke-compose.ts:33,134`) **and** a chat session can launch
against the host multiplexer (a minimal `tmux has-session`/herdr liveness check on the bridged
socket). This is the concrete "stack healthy + a chat session can launch" criterion.

### 9. Graceful shutdown for the api — `apps/api/src/server.ts`

**What it does.** Add `SIGTERM`/`SIGINT` handlers to the api entrypoint that call `server.close()`
(which already runs the `onClose` hook tearing down boss/auth/db,
`apps/api/src/server.ts:168-174`) and then `process.exit(0)`, racing a bounded timeout — mirroring
the worker, which already does this (`apps/worker/src/worker.ts:151-157`
`process.once("SIGINT"/"SIGTERM", … handle.shutdown().then(()=>process.exit(0)))`). Today the api only
has crash handlers (`unhandledRejection`/`uncaughtException` → `handleCrash`, `server.ts:199-204`)
and **no** signal handling, so under `docker stop`/Compose shutdown it is killed by the SIGKILL
fallback after the grace period instead of draining cleanly.

**How it's used.** Required for clean container stop/restart/redeploy (rolling tag bump). The
`onClose` hook already stops pg-boss `{ graceful: false }`, closes the auth runtime, and destroys the
app DB pool when owned (`server.ts:169-173`) — the signal handler just invokes the existing path.

**Depends on.** Nothing new; it reuses `createApiServer().close()` and the existing `onClose` hook.

---

## Data flow

**Build/publish.** Git tag `vX.Y.Z` pushed → CI `verify` + `compose-smoke` pass →
`publish` job builds the app image (deps → build → runtime) and the web image →
`docker/build-push-action` pushes `ghcr.io/motioneso/jarv1s-{api,web}:vX.Y.Z`.

**Deploy.** Operator copies `infra/env.production.example` to an off-git env file, fills secrets/UIDs,
bumps the pinned tag in `docker-compose.prod.yml` → `docker compose -f docker-compose.prod.yml up -d`
(or systemd `start jarv1s-stack`). Order: `postgres` (healthcheck) → `migrate` one-shot
(`node dist/migrate.js`: bootstrap roles/extensions → app+module SQL → pg-boss → grants,
`scripts/migrate.ts:21-46`; exits 0) → `api`+`worker` start (gated on
`service_completed_successfully`) → `web` (gated on api healthy).

**Runtime — REST.** Browser → nginx `web` container → static SPA + proxied `/api`,`/health` →
`api:3000` → Postgres (app role) + pg-boss; `worker` consumes pg-boss queues, embeds via the local
model (cached on the named volume).

**Runtime — CLI chat.** User sends a chat turn → `api`/`worker` engine computes neutralDir + transcript
path with `homeBase=/host-home` → sends multiplexer verbs over the **bind-mounted host socket** →
host tmux/herdr server spawns `claude`/`codex`/`gemini` **on the host** under host CLI auth, `cd`'d
into the shared neutral dir → CLI writes JSONL transcript under the **host HOME** → engine
`readNew()` reads it through the bind-mounted `~/.claude`/`~/.codex`/`~/.gemini`
(`cli-chat-engine.ts:141-168`).

**Shutdown.** `docker stop` / redeploy → SIGTERM to api (new handler) and worker (existing) →
graceful drain (boss stop, db destroy) → exit 0 → Compose/systemd restart on the new tag.

---

## Error handling

- **Migration failure** → the `migrate` one-shot exits non-zero; `service_completed_successfully` is
  not satisfied, so `api`/`worker` **do not start** (fail-closed, same as dev,
  `infra/docker-compose.yml:88-90`). Operator sees the failure in `docker compose logs migrate`.
- **api/worker crash** → `restart: unless-stopped` restarts the container; the api `HEALTHCHECK`
  flips the container unhealthy until `/health` answers. Crash handlers
  (`server.ts:199-204`, `worker.ts:159-164`) attempt a bounded drain then `exit(1)`.
- **DB or pg-boss down** → `/health/ready` returns 503 (`server.ts:140-144`), so monitoring and the
  reboot-survival check fail loudly rather than reporting false-green (the smoke script asserts the
  component fields, `smoke-compose.ts:134`).
- **Host multiplexer/socket absent or unreadable** (wrong UID map, socket not mounted, CLI not
  installed) → engine multiplexer verbs fail; CLI chat surfaces an error. REST/web stay up
  (independent of the bridge). The reboot-survival check's chat-launch probe catches this. Operators
  on the API-key adapter are unaffected (no bridge).
- **Model download failure on first embed** → the worker's embed job fails and pg-boss retries;
  pre-warming the model cache volume (or `JARVIS_EMBED_PROVIDER=stub`) avoids it. The startup
  queue-existence guard (`worker.ts:61-77`) already fails fast if migrations didn't create queues.
- **Image build failure / publish denied** → CI `publish` job fails before any tag is pushed;
  `needs: [verify, compose-smoke]` prevents publishing an unverified image.

---

## Security & invariants

Cites the relevant `CLAUDE.md` **Hard Invariants** this slice touches:

- **pgvector image.** Prod Compose Postgres stays `pgvector/pgvector:pg17` — never reverted to
  `postgres:17-alpine` (`infra/docker-compose.yml:26`). The `vector` extension stays installed via
  the bootstrap SQL run by `migrate` (`infra/postgres/bootstrap/0001_extensions.sql`,
  `scripts/migrate.ts:21`).
- **Never edit applied migrations.** This slice only **runs** `scripts/migrate.ts` (hash-checked,
  idempotent) at deploy; it adds **no** SQL and edits no migration. Any future module SQL stays in
  the owning module's `sql/` dir (none here — this is infra/code only).
- **Secrets never escape / encrypted at rest.** Secrets (`BETTER_AUTH_SECRET`,
  `JARVIS_CONNECTOR_SECRET_KEY`, `JARVIS_AI_SECRET_KEY`, per-role DB passwords) are injected at
  **runtime via `env_file`**, never baked into the image layers; `.dockerignore` excludes
  `backups/`, `exports/`, any populated env file, `.git`. Connector/AI secrets remain AES-256-GCM at
  rest (unchanged). The image must never `COPY` an env file.
- **No admin private-data bypass / RLS for all actors.** Unchanged — runtime roles keep least
  privilege (`infra/env.production.example:14-18` distinct per-role passwords; `audit:release-hardening`
  still asserts no `BYPASSRLS`). The container topology does not alter role grants.
- **DataContextDb only / AccessContext shape.** No data-access code changes; repositories still take
  the branded handle and `AccessContext` stays `{ actorUserId, requestId }`.
- **Module isolation.** No module internals touched; the build bundles declared package entrypoints
  only.
- **ADR 0008 (host-provisioned CLI).** The image does **not** bundle `claude`/`codex`/`gemini` or a
  multiplexer; the host provides them. The bridge (§6) is the documented mechanism, with its tradeoff
  spelled out and its API-key-adapter-needs-nothing forward-compat noted.
- **api CSP unchanged.** The SPA moves to a separate nginx origin so the api keeps
  `default-src 'none'` (`server.ts:63-74`); the api never serves HTML.

---

## Testing strategy

- **`compose-smoke` extended to prod Compose.** Add a smoke that runs the same flow the dev smoke
  runs (`smoke-compose.ts` — `config --quiet` → `postgres --wait` → `run --rm migrate` →
  `up -d api web worker --wait` → poll `/health/ready` asserting `{ok,db,pgboss}`,
  `smoke-compose.ts:34-56,134`) but against `infra/docker-compose.prod.yml` using **locally built**
  images (build the images in CI, then smoke them). This proves the prod compose + pinned-image path
  end-to-end without a registry round-trip.
- **Image build in CI.** The `publish` job (or a pre-publish build step) building both Dockerfiles is
  itself the build test; on PRs build **without push** (`docker/build-push-action push:false`), push
  only on tags.
- **Graceful shutdown.** Unit-test the api signal handler the way the worker path is validated:
  assert that on SIGTERM the server's `close()`/`onClose` teardown runs and the process exits 0
  (mirror `worker.ts` lifecycle test). A Compose-level check: `docker stop` the api and assert it
  exits within the grace window (no SIGKILL).
- **Reboot-survival.** The scripted check (§8): a CI/manual run that brings the stack up, restarts
  the Docker daemon (CI proxy for reboot) or the host (manual), then asserts `/health/ready` green +
  a multiplexer liveness probe.
- **No new migration → no migration test churn.** `pnpm verify:foundation` stays the gate;
  `check:file-size` must stay green (the api signal-handler addition is small;
  `apps/api/src/server.ts` is ~440 lines, well under 1000).
- **CLI-bridge** is exercised by the existing chat integration tests with the **fake engine** injected
  via `engineFactory` (`runtime.ts` injectable factory) — the bridge mounts are an
  infra/deploy concern verified by the reboot-survival chat-launch probe, not by unit tests (no real
  CLI in CI, per ADR 0008).

---

## Acceptance criteria

1. A multi-stage **app Dockerfile** builds an image that runs `api`, `worker`, and `migrate` by
   command selection, with **no `tsx` and no per-start `pnpm install`** — runtime is plain
   `node dist/...`. New `build:api` and `build:worker` scripts exist in root `package.json` and
   produce the `dist/` output.
2. A separate **web Dockerfile** builds an nginx image serving `apps/web/dist` and reverse-proxying
   `/api` + `/health` to the api container (SPA history fallback present); the api retains its
   `default-src 'none'` CSP.
3. `infra/docker-compose.prod.yml` exists with **pinned `ghcr.io/motioneso/jarv1s-{api,web}` tags,
   named volumes (postgres data, vault `/data/vaults`, model cache), `restart: unless-stopped`, and
   NO source bind mounts**; Postgres is `pgvector/pgvector:pg17`; `migrate` runs one-shot before
   `api`/`worker` via `service_completed_successfully`, and `api` waits on `postgres: service_healthy`.
4. `pnpm smoke:compose` (or an added prod-compose smoke) brings the **prod** Compose up from locally
   built images and `/health/ready` returns `{ ok:true, db:"ok", pgboss:"ok" }`.
5. A CI **`publish`** job (new) builds both images and, on a `v*` git tag, pushes them to GHCR using
   `permissions: packages: write` + `docker/login-action` + `docker/build-push-action`; on PRs it
   builds without pushing; optional `:edge` on main. It runs only after `verify` and `compose-smoke`
   pass.
6. `apps/api/src/server.ts` handles **SIGTERM and SIGINT**, invoking `server.close()` (and thus the
   `onClose` teardown) and exiting 0 within a bounded timeout — verified by a test and a `docker stop`
   that exits without SIGKILL.
7. **CLI chat works from the container**: the prod Compose mounts the host multiplexer socket
   (tmux `/tmp/tmux-<uid>` and/or herdr `HERDR_SOCKET_PATH`) and the host CLI dirs
   (`~/.claude`/`~/.codex`/`~/.gemini`) into `api`+`worker`; `homeBase` and the `TmuxIo.run` env/cwd
   seam are pointed at the mounted host HOME; UID/permissions mapping is configured so the container
   user can open the host socket. A launched session writes/reads transcripts under the host HOME.
8. `infra/systemd/jarv1s-stack.service` exists (mirroring `jarv1s-backup.service`), runs
   `docker compose -f infra/docker-compose.prod.yml up -d` at boot, and is `WantedBy=multi-user.target`.
9. A documented/scripted **reboot-survival** check passes: after a reboot the stack is healthy
   (`/health/ready` green) **and** a chat session can launch against the host multiplexer.
10. `infra/env.production.example` is extended with the new vars (model cache `HF_HOME`, host
    UID/GID for the socket mount, multiplexer/herdr socket path, neutral-dir base) and documents the
    CLI-auth-mount security tradeoff (or links the doc that does); **no secret is baked into any
    image layer**.
11. `pnpm verify:foundation` green; `pnpm check:file-size` green; `pnpm audit:release-hardening`
    green; **no new SQL migration** added or edited.
12. The §6 host-mount tradeoff and the API-key-adapter-needs-nothing forward-compat are documented in
    `docs/operations/dev-environment.md` and linked from epic #47's exit criterion.

---

## Out of scope / deferred

- **API-key in-process adapter** — separate Phase 2 spec (ADR 0008 §1b; listed in
  `cli-chat-adapter-design §12`). This spec only ensures the topology is forward-compatible with it
  (no host mounts needed).
- **Onboarding wizard UI** (multiplexer install + CLI-auth/API-key entry) — separate Phase 2 spec
  (epic #47 exit criterion #6).
- **Module-enablement seam** (ADR 0009) — separate exit criterion #4.
- **uid-per-user OS isolation / privileged launcher / non-operator attach** — the deferred follow-on
  milestone (`cli-chat-adapter-design §10`). This spec's UID mapping is the shared-operator-uid model.
- **TLS termination / public ingress** — operators terminate TLS at a reverse proxy in front
  (the api already gates HSTS/XFF behind `JARVIS_TRUST_PROXY`, `server.ts:48-49,84-89`); not built
  here.
- **Multi-host / orchestrator (k8s) deploys, image signing, SBOM** — single-host Compose is the
  Phase 2 target (ADR 0007 household model).
- **Replacing the dev `infra/docker-compose.yml`** — it stays as the dev/smoke file; this slice adds
  the prod file alongside it.
- **Pre-baking the embedding model into the image** — kept as a runtime-downloaded cached artifact;
  pre-baking is an optional later optimization.

---

## Open risks

1. **CLI-adapter slice ordering.** This spec hard-depends on the `homeBase` param and `TmuxIo.run`
   env/cwd seam from `2026-06-12-p2-portable-cli-chat-adapter-design.md` (§5.2/AC#5), which are
   **absent in code today** (`transcriptGlobDir(provider, cwd)` is 2-arg and uses `homedir()`,
   `tmux-bridge.ts:75-97`; no herdr/homeBase refs anywhere). If that slice has not merged, the CLI
   bridge cannot point at the host HOME. **Mitigation:** sequence this after the CLI-adapter slice,
   or land the two seams (default-noop) as a tiny prerequisite PR.
2. **UID/permission fragility.** The host tmux socket dir is mode `0700` per-uid; if the container
   user's uid ≠ host operator uid the socket open fails. The chosen mapping (Compose `user:` =
   host uid, or matching image uid) must be documented and validated by the reboot-survival
   chat-launch probe, or CLI chat silently breaks while REST stays green.
3. **Workspace build resolution.** The repo links packages by tsconfig path aliases + `workspace:*`
   symlinks (`tsconfig.json` paths; `pnpm-workspace.yaml`); a naive `tsc --noEmit`-style build won't
   produce runnable `dist/`. esbuild bundling (or `tsc` + `pnpm deploy --prod` prune) must be proven
   to resolve `@jarv1s/*` at build time and the native `onnxruntime-node`/`sharp` binaries at runtime.
4. **Model size / cold start.** The local embedding model downloads on first use; without the cache
   volume pre-warmed, the first worker after a fresh deploy is slow and network-dependent. The cache
   volume mitigates restarts but not the very first pull.
5. **GHCR permissions.** The `publish` job needs `packages: write` and the `motioneso` GHCR package
   to allow the Actions token; a misconfigured package visibility/permission blocks publish (caught
   by a failing job, not a silent skip).
6. **Image size.** Bundling the `@huggingface/transformers` + `onnxruntime-node` + `sharp` deps into
   the worker image is large; if api and worker share one image, the api also carries the model deps.
   Acceptable for single-host household deploy; a split api/worker image is a possible later
   optimization (kept out of scope to preserve the "one app image, command-selected" simplicity).
7. **`docker compose` on the host at boot.** `jarv1s-stack.service` assumes Docker + the compose
   plugin are installed and the daemon is up (`Requires=docker.service`); a host without the compose
   plugin won't start the unit. Documented as a host prerequisite (consistent with ADR 0008's
   host-provisioning posture).
