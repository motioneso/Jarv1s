# Phase 2 Deployable Containerized Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final containerized production topology for Jarv1s — a multi-stage app image (api/worker/migrate), a static-web nginx image, a production Compose file, CI image publish to GHCR on git tags, per-container supervision, a systemd boot unit, graceful api shutdown, and a host-multiplexer bridge so CLI chat works from inside the container — meeting epic #47 DEPLOY CHECKPOINT exit criterion #5.

**Architecture:** One multi-stage app image (`ghcr.io/motioneso/jarv1s-api`) compiled to `dist/` with esbuild and run as plain `node dist/...` (no `tsx`, no per-start `pnpm install`); its runtime role (api / worker / migrate) is selected by the container `command`. The runtime image ALSO copies the SQL asset tree (`infra/postgres/{bootstrap,migrations,grants}` + every module `sql/` dir) and a minimal `tmux` client, because the migrate entrypoint reads SQL from disk and the CLI-chat engine execs the multiplexer client from inside the container (the AI CLIs `claude`/`codex`/`gemini` are NOT bundled — they run on the host via the host multiplexer SERVER per ADR 0008). A separate nginx image (`ghcr.io/motioneso/jarv1s-web`) serves the Vite SPA bundle and reverse-proxies `/api` + `/health` to the api so the api keeps its `default-src 'none'` CSP. A new `infra/docker-compose.prod.yml` wires these with pinned tags, named volumes, `restart: unless-stopped`, and NO source bind mounts — alongside (never replacing) the dev `infra/docker-compose.yml`. CLI chat reaches the host multiplexer and host CLI auth through bind-mounted host socket + host CLI-config dirs; the engine env/home seams (`transcriptGlobDir(provider, cwd, homeBase)` + `TmuxIo.RunOptions { env, cwd }`) ALREADY EXIST in the codebase — this plan only THREADS them from the runtime into the live engine.

**Tech Stack:** Node 24 (`node:24-bookworm-slim`), pnpm 10.6.2, esbuild (new root devDependency), Docker + Compose v2, nginx (stable image), GitHub Actions (`docker/login-action`, `docker/build-push-action`), systemd, Fastify, pg-boss, `@huggingface/transformers` (+ `onnxruntime-node`/`sharp` native binaries), Vitest.

---

## Grounding

- **Grounded on:** local `main` contains `origin/main` (`5759b90`) plus local doc-only commits; spec baseline `a898533` is in history. Tree is ahead, not behind — acceptable per Grounding Discipline. The autonomous worker MUST run `pnpm audit:preflight` and abort if it reports the tree is *behind* before starting.
- **Spec:** `docs/superpowers/specs/2026-06-12-p2-deployable-containerized-stack-design.md` (read in full; all §/AC references below point at it).
- **Dependency state VERIFIED in code today (corrected — the seams already exist):** `transcriptGlobDir(provider, cwd, homeBase = homedir())` is ALREADY 3-arg with a `homeBase` default (`packages/ai/src/adapters/tmux-bridge.ts:89-108`); `TmuxIo.run(cmd, args, opts?: RunOptions)` ALREADY accepts `{ env?, cwd? }` and the real impl merges `{ ...process.env, ...opts.env }` and forwards `cwd` (`tmux-bridge.ts:11-31, 40-67`); a full multiplexer abstraction ALSO exists (`multiplexer.ts`, `tmux-multiplexer.ts`, `herdr-multiplexer.ts`, `multiplexer-resolve.ts`, `binary-probe.ts`) with env-based selection (`JARVIS_MULTIPLEXER`, `HERDR_PANE_ID`, `JARVIS_HERDR_ROOT_PANE`). **What is genuinely MISSING:** the live engine `packages/chat/src/live/cli-chat-engine.ts` still calls `transcriptGlobDir(provider, cwd)` 2-arg (line 99) and `runtime.ts` does NOT read `JARVIS_CLI_HOME_BASE` (line 45). So the prerequisite seam work collapses to ONE task — **Task 3 threads `homeBase` through the engine + runtime** (Tasks 1–2 are DELETED as already-implemented; re-writing them would be a no-op that conflicts with shipped code). The container also needs the multiplexer CLIENT binary (`tmux`) present so the engine's `tmux ...` execs work (Task 7).
- **Architectural note (live engine drives a multiplexer; tmux is the default backend):** `cli-chat-engine.ts` is `CliChatEngineImpl`, already migrated onto the `Multiplexer` seam — it delegates session lifecycle to an injected `mux` (default `TmuxMultiplexer`), which execs `tmux new-session/send-keys/...` and the `claude`/`codex`/`gemini` launch line. So from inside the container the `tmux` CLIENT is execed against the host socket — the container MUST carry a `tmux` client (Task 7) for the default backend to function. Herdr-from-container is explicitly out of scope here (see Task 9 note); the default/supported containerized multiplexer is tmux (`JARVIS_MULTIPLEXER=tmux`).

## Hard Invariants honored (do not weaken)

- **pgvector image** — prod Compose Postgres stays `pgvector/pgvector:pg17` (Task 8).
- **Never edit applied migrations** — this slice adds NO SQL and edits no migration; it only *runs* the existing `scripts/migrate.ts` (as a `tsx` one-shot inside the prod image; NOT bundled — see Task 5).
- **Secrets never escape / encrypted at rest** — secrets injected at runtime via `env_file`, never `COPY`'d into image layers; `.dockerignore` excludes `backups/`, `exports/`, `.git`, `*.env` (Task 4).
- **No admin private-data bypass / RLS for all actors** — no role-grant changes; least-privilege per-role URLs unchanged.
- **DataContextDb only / AccessContext shape** — no data-access code touched; `AccessContext` stays `{ actorUserId, requestId }`.
- **Module isolation** — the build bundles declared package entrypoints only; no module internals imported.
- **ADR 0008 (host-provisioned CLI)** — the image does NOT bundle the AI CLIs (`claude`/`codex`/`gemini`) or a multiplexer SERVER; those run on the host. The image DOES include the thin `tmux` CLIENT needed to talk to the host tmux server from inside the container (Task 7) — a documented, narrow exception (a steering client, not the AI runtime). The bridge is the documented host-reach mechanism, opt-in, with the API-key adapter needing none of it.
- **api CSP unchanged** — the SPA moves to a separate nginx origin (Task 11); the api never serves HTML.

---

## File Structure

### New files

| Path | Responsibility |
| --- | --- |
| `Dockerfile` | Multi-stage app image (deps → build → runtime). Runs api/worker/migrate by command. |
| `apps/web/Dockerfile` | Multi-stage static-web image: `pnpm build:web` → nginx serving `apps/web/dist`. |
| `infra/nginx/jarv1s-web.conf` | nginx server block: SPA history fallback + `/api`,`/health` reverse proxy to `api:3000`; SPA CSP. |
| `.dockerignore` | Keep build context small; exclude `node_modules`, `.git`, `spikes/`, `docs/`, `backups/`, `exports/`, `**/dist`, `.codegraph/`, and ALL env files incl. `infra/env.production.local` (the `*.env`/`*.env.*` globs do NOT match a `foo.local` suffix — explicit lines are required). Must NOT exclude `infra/postgres/` (SQL assets the runtime image copies) — only `tests/` fixtures that aren't needed at build. |
| `scripts/build-app.ts` | esbuild bundler producing `dist/server.js`, `dist/worker.js` only (used by `build:api`/`build:worker`). Migrate is NOT bundled — it runs as `tsx scripts/migrate.ts` (Task 5). |
| `infra/docker-compose.prod.yml` | The deploy artifact: postgres + migrate + api + worker + web, pinned tags, named volumes, no source mounts. |
| `infra/systemd/jarv1s-stack.service` | systemd unit running `docker compose -f infra/docker-compose.prod.yml up -d` at boot (`WantedBy=multi-user.target`). |
| `scripts/verify-reboot-survival.sh` | Scripted reboot-survival check: stack up → `/health/ready` green + multiplexer liveness probe. |
| `tests/unit/api-signal-shutdown.test.ts` | Unit test for the api SIGTERM/SIGINT graceful-shutdown handler. |
| `tests/unit/prod-compose-plan.test.ts` | Unit test asserting the prod-compose smoke plan shape (composeFile, build step). |

> **Removed vs the first draft:** `tests/unit/transcript-home-base.test.ts` and `tests/unit/tmux-io-run-options.test.ts` are NOT created — the `homeBase` and `RunOptions` seams they would test already exist and are already covered (`packages/ai/src/adapters/tmux-bridge.ts`). Re-adding TDD tasks for shipped code would have a failing "verify it fails" step that actually passes. Task 3 (engine threading) is the only seam work left, and it carries its own test.

### Modified files

| Path | Change |
| --- | --- |
| `apps/api/src/server.ts` | Extract a `shutdownOnSignal()` helper + register `SIGTERM`/`SIGINT` in the entrypoint (graceful `server.close()` → `exit(0)` with bounded timeout). |
| `packages/chat/src/live/cli-chat-engine.ts` | Thread an optional `homeBase` through the engine into the EXISTING 3-arg `transcriptGlobDir`. (`tmux-bridge.ts` is NOT touched — the seam already exists there.) |
| `packages/chat/src/live/runtime.ts` | Read `JARVIS_CLI_HOME_BASE` and pass it to the engine factory. |
| `package.json` | Add `build:api`, `build:worker`, `smoke:compose:prod` scripts; add `esbuild` devDependency. |
| `scripts/smoke-compose.ts` | Add an esbuild-free prod-compose plan variant (build images locally, then smoke `infra/docker-compose.prod.yml`). |
| `.github/workflows/ci.yml` | Add a `publish` job (build both images; push to GHCR on `v*` tags; build-no-push on PRs; optional `:edge` on main) gated on `needs: [verify, compose-smoke]`. |
| `infra/env.production.example` | Add model-cache (`HF_HOME`), host UID/GID, multiplexer/herdr socket path, neutral-dir base, image tag vars; document the CLI-auth-mount tradeoff (or link the doc). |
| `docs/operations/dev-environment.md` | Document the prod stack, the §6 host-mount security tradeoff, the API-key-adapter-needs-nothing forward-compat, and the reboot-survival runbook. |

---

## Tasks

### Tasks 1 & 2 (DELETED — already implemented in the codebase)

> **Do NOT do these.** The first draft proposed adding a `homeBase` 3rd param to
> `transcriptGlobDir` and a `{ env?, cwd? }` options arg to `TmuxIo.run`. Both
> ALREADY EXIST on `origin/main`:
>
> - `transcriptGlobDir(provider, cwd, homeBase: string = homedir())` —
>   `packages/ai/src/adapters/tmux-bridge.ts:89-108` (the host-HOME seam, default-noop).
> - `TmuxIo.run(cmd, args, opts?: RunOptions)` where `RunOptions = { env?, cwd? }`, and
>   the real impl merges `{ ...process.env, ...opts.env }` and forwards `cwd` —
>   `tmux-bridge.ts:11-31, 40-67`.
>
> Re-authoring them would (a) be a no-op against shipped code and (b) have a broken
> TDD "Step 2: verify it fails" that actually passes. The only remaining seam gap is
> threading `homeBase` from the runtime into the live engine — that is **Task 3**.
> `packages/ai/src/adapters/tmux-bridge.ts` is therefore NOT modified by this plan.

<details><summary>Original Task 2 body (kept for the record, NOT to be executed)</summary>

Spec §6 "The env/home wiring" (`TmuxIo.run` env/cwd seam) + Open Risk #1. Add an optional 3rd `options?: { env?; cwd? }` argument to `TmuxIo.run`; the real impl forwards it to `execFile`. Omitted → identical behavior.

**Files:**
- Modify: `packages/ai/src/adapters/tmux-bridge.ts:11-53`
- Test: `tests/unit/tmux-io-run-options.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tmux-io-run-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("createRealTmuxIo run() env/cwd seam", () => {
  it("forwards a custom env so the child sees the injected variable", async () => {
    const io = createRealTmuxIo();
    const { code, stdout } = await io.run("node", ["-e", "process.stdout.write(process.env.JARV1S_PROBE ?? 'unset')"], {
      env: { ...process.env, JARV1S_PROBE: "from-seam" }
    });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("from-seam");
  });

  it("forwards a custom cwd so the child runs in the chosen directory", async () => {
    const io = createRealTmuxIo();
    const { code, stdout } = await io.run("node", ["-e", "process.stdout.write(process.cwd())"], {
      cwd: "/tmp"
    });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("/tmp");
  });

  it("runs with default env/cwd when no options are passed (behavior-preserving)", async () => {
    const io = createRealTmuxIo();
    const { code, stdout } = await io.run("node", ["-e", "process.stdout.write('ok')"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/tmux-io-run-options.test.ts`
Expected: FAIL — `run` ignores the 3rd argument, so the `env`/`cwd` cases do not take effect (the env case reads "unset", the cwd case reads the test runner's cwd).

- [ ] **Step 3: Write minimal implementation**

In `packages/ai/src/adapters/tmux-bridge.ts`, update the `TmuxIo` interface `run` signature (lines 11-20) and the `createRealTmuxIo` `run` impl (lines 30-42):

Replace the interface `run` line:

```ts
  /** Run an external command; resolve to { code, stdout }. */
  run(
    cmd: string,
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv; cwd?: string }
  ): Promise<{ code: number; stdout: string }>;
```

Replace the `createRealTmuxIo` `run` method:

```ts
    async run(
      cmd: string,
      args: readonly string[],
      options?: { env?: NodeJS.ProcessEnv; cwd?: string }
    ): Promise<{ code: number; stdout: string }> {
      // Use execFile (not exec) so arguments are passed directly to the process
      // without a shell re-parsing them. A shell join would mangle args containing
      // spaces, quotes, pipes, or redirects (e.g. the `bash -c "<pipeline>"` calls).
      // options.env/cwd let the container point spawned multiplexer commands at the
      // host HOME / herdr socket (Phase 2 deployable-stack §6); omitted → defaults.
      try {
        const { stdout } = await execFileAsync(cmd, [...args], {
          env: options?.env,
          cwd: options?.cwd
        });
        return { code: 0, stdout: stdout ?? "" };
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string };
        return { code: e.code ?? 1, stdout: e.stdout ?? "" };
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/tmux-io-run-options.test.ts tests/unit/cli-chat-engine.test.ts`
Expected: PASS (the new seam test and the existing engine unit suite stay green; the engine passes 2-arg `run` calls which still work).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/tmux-bridge.ts tests/unit/tmux-io-run-options.test.ts
git commit -m "feat(ai): add optional env/cwd options to TmuxIo.run for host-mount bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

</details>

---

### Task 3: Thread `homeBase` through the live chat engine + runtime

Spec §6: `homeBase` must reach the EXISTING 3-arg `transcriptGlobDir` from the engine. Add an optional `homeBase` to `CliChatEngineOpts`, use it in `launch()`, and have `createRealEngineFactory` read `JARVIS_CLI_HOME_BASE` and pass it through. Default-noop (no env → `homedir()` via `transcriptGlobDir`'s existing `homeBase = homedir()` default).

> **VERIFY CURRENT NAMES BEFORE EDITING (the engine was migrated to the multiplexer
> seam — the class is NOT `TmuxCliChatEngine`):** the live engine is
> `export class CliChatEngineImpl implements CliChatEngine` with
> `export interface CliChatEngineOpts { launchMs?; submitMs?; mux?: Multiplexer }`
> (`packages/chat/src/live/cli-chat-engine.ts:43-74`). `launch()` calls
> `transcriptGlobDir(this.provider, opts.neutralDir)` 2-arg at line 104 (a private
> `storedTranscriptPath` is set; there is no `promptFile` field anymore — submit() is
> delegated to `this.mux`). The factory is
> `export function createRealEngineFactory(opts: { mux?: Multiplexer } = {})` returning
> `new CliChatEngineImpl(provider, sessionKey, createRealTmuxIo(), { mux: opts.mux })`,
> and `export const realEngineFactory = createRealEngineFactory()`
> (`packages/chat/src/live/runtime.ts:51-64`). **Re-read these two files first** — if a
> concurrent build has already added `homeBase`, this task is a no-op; if names drifted
> again, adapt to the names in the tree, do not edit blindly.

**Files:**
- Modify: `packages/chat/src/live/cli-chat-engine.ts` (`CliChatEngineOpts` + field + `launch()` call)
- Modify: `packages/chat/src/live/runtime.ts` (`createRealEngineFactory`)
- Test: `tests/unit/cli-chat-engine.test.ts` (extend — uses `makeIo()` + `CliChatEngineImpl`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/cli-chat-engine.test.ts` (after the existing describe blocks; the file already imports the engine as `CliChatEngineImpl` and defines `makeIo()` — match its existing imports, do not re-import under a different name):

```ts
describe("CliChatEngineImpl — homeBase seam (#deployable-stack §6)", () => {
  it("resolves the transcript path under the provided homeBase", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "host-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath().startsWith("/host-home/.claude/projects/")).toBe(true);
  });

  it("falls back to the OS home when no homeBase is given", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "local-session", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath()).not.toContain("/host-home/");
    expect(engine.transcriptPath()).toContain("/.claude/projects/");
  });
});
```

> The default `mux` (TmuxMultiplexer over the fake `io`) makes `launch()` exercise
> `mux.open()` against the mocked `run`, so no real tmux is needed — the existing tests
> already rely on this. `transcriptPath()` is set before `mux.open()` in `launch()`, so
> it is populated even with the fake backend.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts`
Expected: FAIL — `CliChatEngineOpts` has no `homeBase`, so the option is ignored and the path never starts with `/host-home`.

- [ ] **Step 3: Write minimal implementation**

In `packages/chat/src/live/cli-chat-engine.ts`:

Add `homeBase` to `CliChatEngineOpts` (currently at lines 43-50):

```ts
export interface CliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter (passed to the default tmux backend). */
  readonly submitMs?: number;
  /** Multiplexer backend; defaults to a TmuxMultiplexer over the same io (preserves legacy behavior). */
  readonly mux?: Multiplexer;
  /**
   * Base dir whose `.claude`/`.codex`/`.gemini` hold the CLI transcripts.
   * Set to the bind-mounted host HOME base when running containerized
   * (deployable-stack §6); omitted → the OS home of the running process.
   */
  readonly homeBase?: string;
}
```

Add a private field and assign it in the constructor. After the `private handle: MuxHandle | null = null;` field, add:

```ts
  /** Optional host-HOME base for transcript resolution (containerized bridge). */
  private readonly homeBase?: string;
```

Inside the constructor body (after `this.mux = opts.mux ?? ...`), add:

```ts
    this.homeBase = opts.homeBase;
```

In `launch()`, pass `homeBase` to `transcriptGlobDir` (the 2-arg call at line ~104):

```ts
    this.storedTranscriptPath = join(
      transcriptGlobDir(this.provider, opts.neutralDir, this.homeBase),
      `${sessionId}.jsonl`
    );
```

In `packages/chat/src/live/runtime.ts`, update `createRealEngineFactory` (lines 51-54) to read the env seam and pass it through (keep the `mux` injection intact):

```ts
export function createRealEngineFactory(opts: { mux?: Multiplexer } = {}): ChatEngineFactory {
  // Containerized deploys (deployable-stack §6) point this at the bind-mounted host
  // CLI-dir base (/host-home) so transcripts written by the host CLI are read back
  // correctly. Unset on a host install → the engine uses the OS home (unchanged).
  const homeBase = process.env.JARVIS_CLI_HOME_BASE;
  return (provider, sessionKey) =>
    new CliChatEngineImpl(provider, sessionKey, createRealTmuxIo(), { mux: opts.mux, homeBase });
}
```

> **Note (env/cwd for the multiplexer execs):** the tmux backend execs `tmux` against
> `/tmp/tmux-<uid>`, which the prod Compose bind-mounts at the same path and runs as the
> host uid (Task 9) — so the default tmux socket resolution already targets the host
> server with NO extra env/cwd. The `TmuxIo.run` `RunOptions { env, cwd }` seam exists
> and the multiplexer backends accept it if a future slice needs an explicit socket path
> (e.g. `tmux -S`); threading it is NOT required for this slice and is out of scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (engine tests green) and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/cli-chat-engine.ts packages/chat/src/live/runtime.ts tests/unit/cli-chat-engine.test.ts
git commit -m "feat(chat): thread homeBase through CliChatEngineImpl + JARVIS_CLI_HOME_BASE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `.dockerignore`

Spec §1 "Depends on" + §Security. Keep the build context small and ensure no host artifacts (or env files) leak into the image.

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Write the file**

Create `.dockerignore`:

```gitignore
# Keep the Docker build context small and never leak host artifacts/secrets.
node_modules
**/node_modules
.git
.gitignore
.github
tests
spikes
docs
backups
exports
**/dist
.codegraph
.turbo
playwright-report
test-results
# Secrets: the *.env globs do NOT match a `foo.production.local` suffix, so list
# the operator env file EXPLICITLY (Task 11 creates it in the build context).
*.env
*.env.*
infra/env.production.local
**/env.production.local
**/*.local.env
.env*
!infra/env.production.example
.DS_Store
*.log
```

> **Why explicit env lines:** `*.env` matches `foo.env`, `*.env.*` matches `foo.env.bar`,
> but neither matches `env.production.local` (a `.local` SUFFIX, not a `.env` segment).
> Without the explicit `infra/env.production.local` / `**/env.production.local` lines, the
> Task-11 smoke secrets file would be swept into image layers by `COPY . .`. The
> `!infra/env.production.example` re-include is safe — the example holds only `<…>`
> placeholders. NOTE: do NOT add `infra/postgres` here — those SQL assets MUST reach the
> build (Task 7 copies them into the runtime image); and do NOT add a bare `tmux` exclude.

- [ ] **Step 2: Verify it excludes secrets but keeps the example**

Run: `grep -q '^infra/env.production.local$' .dockerignore && grep -q '^\*\.env$' .dockerignore && grep -q '^!infra/env.production.example$' .dockerignore && ! grep -qE '^infra/postgres' .dockerignore && echo OK`
Expected: prints `OK` — the operator secrets file is excluded by an EXPLICIT line (not just the `*.env` glob, which would miss the `.local` suffix), the committed `<…>`-placeholder example is re-included, and `infra/postgres/` (the SQL assets) is NOT excluded.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore for small, secret-free image context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: esbuild bundler script (`scripts/build-app.ts`) + migrate entrypoint

Spec §1 build stage + §2. Bundle the **long-running** entrypoints (`apps/api/src/server.ts`, `apps/worker/src/worker.ts`) into single `dist/*.js` files so the api/worker runtime is plain `node dist/...` — that is the spec's real "no tsx / no per-start install" goal for the resident services. esbuild is chosen over `tsc` because the repo links packages by tsconfig path aliases + `workspace:*` symlinks AND the workspace packages are SOURCE-ONLY (each `package.json` `exports` `./src/index.ts`, no compiled `dist/`) — so there is no compiled JS to mark `@jarv1s/*` external against. Native deps (`onnxruntime-node`, `sharp`) and `@huggingface/transformers` are marked external (they load native `.node` binaries at runtime and must come from the pruned `node_modules`, not be bundled).

> **CRITICAL — why migrate is NOT bundled (verified bundling hazard):** every module's
> SQL dir is computed at import time as `fileURLToPath(new URL("../sql", import.meta.url))`
> (e.g. `packages/tasks/src/manifest.ts:43`). If migrate were esbuild-bundled into one
> `dist/migrate.js`, ALL those `import.meta.url` values collapse to the bundle's own URL
> (`file:///app/dist/migrate.js`), so every module resolves its SQL to `/app/sql` —
> wrong AND colliding. The bootstrap/migrations/grants dirs in `scripts/migrate.ts`
> have the same hazard (`import.meta.url`-relative). esbuild does NOT inline `.sql`
> files (they are read via `runSqlFiles`/`loadMigrationFiles` at runtime). Therefore
> **migrate runs as a one-shot via `tsx scripts/migrate.ts` inside the prod image**, not
> as a bundled `dist/migrate.js`. This is a contained, honest exception: migrate is a
> short-lived one-shot (not a resident service), so "no tsx" — which exists to keep the
> api/worker startup fast and dependency-light — does not apply. `dist/migrate.js` is
> DELETED from the plan; the runtime image ships `tsx`, the migrate source, the SQL
> tree, and the workspace `src`+`sql` the migrate path imports. The in-image migrate
> smoke (Task 7 Step 3b + Task 11) PROVES SQL resolution so a wrong path fails the BUILD,
> never silently at deploy.

**Files:**
- Create: `scripts/build-app.ts` (bundles api + worker only)
- Modify: `package.json:30` (scripts) + devDependencies
- (No `scripts/migrate-entry.ts` — migrate is `tsx scripts/migrate.ts`, unchanged source.)

- [ ] **Step 1: Add esbuild + the build scripts to `package.json`**

In `package.json`, add to `devDependencies` (alphabetical, after `@types/pg`):

```json
    "esbuild": "^0.25.0",
```

Add to `scripts` (after the existing `"build:web"` line):

```json
    "build:api": "tsx scripts/build-app.ts api",
    "build:worker": "tsx scripts/build-app.ts worker",
    "smoke:compose:prod": "tsx scripts/smoke-compose.ts --compose-file infra/docker-compose.prod.yml --build",
```

Run: `pnpm install`
Expected: esbuild installed; lockfile updated.

- [ ] **Step 2: (migrate entrypoint) — NONE.**

Migrate is NOT bundled (see the CRITICAL note above). The prod image runs
`tsx scripts/migrate.ts` as a one-shot, identical to dev. Do not create
`scripts/migrate-entry.ts` and do not add a `build:migrate` script.

- [ ] **Step 3: Write the build script (api + worker bundles only)**

There is no unit test framework fit for "esbuild produced a runnable file"; assert it by running the build and checking the artifact exists and is plain JS (Step 4). Create `scripts/build-app.ts`:

```ts
/**
 * esbuild bundler for the production image's RESIDENT services (api, worker).
 * Produces a single runnable file per entrypoint under dist/, resolving the
 * @jarv1s/* SOURCE-ONLY workspace graph at build time so the api/worker runtime
 * is plain `node dist/...` (no tsx, no per-start pnpm install — deployable-stack §1/§2).
 *
 * migrate is intentionally NOT a target here: it runs as `tsx scripts/migrate.ts`
 * because module SQL dirs are resolved via `import.meta.url` and bundling would
 * collapse every module's URL to the bundle's, breaking SQL resolution.
 *
 * Native deps that load .node binaries (onnxruntime-node, sharp) and the
 * transformers wrapper are kept EXTERNAL — they must be required from the pruned
 * production node_modules at runtime, never inlined (Open Risk #3/#6).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Target = "api" | "worker";

const ENTRYPOINTS: Record<Target, { entry: string; outfile: string }> = {
  api: { entry: "apps/api/src/server.ts", outfile: "dist/server.js" },
  worker: { entry: "apps/worker/src/worker.ts", outfile: "dist/worker.js" }
};

// Packages that must NOT be bundled: they load native binaries or read files
// relative to their own package dir at runtime. Resolved from node_modules instead.
const EXTERNAL = [
  "@huggingface/transformers",
  "onnxruntime-node",
  "sharp",
  "pg-native"
];

async function buildTarget(target: Target): Promise<void> {
  const { entry, outfile } = ENTRYPOINTS[target];
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, outfile),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: true,
    // Resolve @jarv1s/* via the workspace symlinks in node_modules (preferred) or
    // fall back to the tsconfig path aliases; esbuild follows node resolution by
    // default through the symlinked workspace packages.
    external: EXTERNAL,
    // ESM bundle needs these shims for CJS-style globals used by deps.
    banner: {
      js: [
        "import { createRequire as __jarvisCreateRequire } from 'node:module';",
        "import { fileURLToPath as __jarvisFileURLToPath } from 'node:url';",
        "import { dirname as __jarvisDirname } from 'node:path';",
        "const require = __jarvisCreateRequire(import.meta.url);",
        "const __filename = __jarvisFileURLToPath(import.meta.url);",
        "const __dirname = __jarvisDirname(__filename);"
      ].join("\n")
    },
    logLevel: "info"
  });
  console.log(`built ${outfile}`);
}

async function main(): Promise<void> {
  const target = process.argv[2] as Target | undefined;
  if (target && target in ENTRYPOINTS) {
    await buildTarget(target);
    return;
  }
  // No/unknown arg -> build both resident entrypoints (api + worker).
  for (const t of Object.keys(ENTRYPOINTS) as Target[]) {
    await buildTarget(t);
  }
}

await main();
```

- [ ] **Step 4: Build both resident entrypoints and assert runnable artifacts**

Run:
```bash
pnpm build:api && pnpm build:worker && \
  node --check dist/server.js && node --check dist/worker.js && \
  ! grep -RIl "from \"tsx\"\|require('tsx')" dist/ && echo BUILD_OK
```
Expected: `built dist/server.js`, `built dist/worker.js`, then `BUILD_OK` — each artifact parses as valid Node ESM and contains no `tsx` import. (There is no `dist/migrate.js` — migrate runs via `tsx scripts/migrate.ts`; that path is proven by the in-image migrate smoke in Task 7 Step 3b / Task 11.)

> If esbuild reports an unresolved `@jarv1s/*` import, the workspace symlink path is the cause: add a matching `alias` map in `build-app.ts` mirroring `tsconfig.json` `paths` (e.g. `{ "@jarv1s/db": resolve(root, "packages/db/src/index.ts") }`) and re-run. Do not switch to `tsc` — bundling is the chosen contract for the resident services (spec §1).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/build-app.ts
git commit -m "build: esbuild bundler for api/worker dist entrypoints (migrate stays tsx one-shot)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Graceful shutdown for the api (`SIGTERM`/`SIGINT`)

Spec §9 + AC#6. The api entrypoint has only crash handlers and no signal handling, so `docker stop` kills it by SIGKILL after the grace period. Add signal handlers that invoke `server.close()` (which runs the existing `onClose` teardown) then `exit(0)`, racing a bounded timeout — mirroring the worker (`worker.ts:151-157`).

**Files:**
- Modify: `apps/api/src/server.ts:179-207`
- Test: `tests/unit/api-signal-shutdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-signal-shutdown.test.ts`:

```ts
/**
 * Unit test for the api graceful-shutdown helper (deployable-stack §9, AC#6).
 * Mirrors the worker lifecycle test idiom (tests/integration/worker-lifecycle.test.ts):
 * assert close() is invoked and the bounded-timeout race resolves before exit.
 */
import { describe, expect, it, vi } from "vitest";

import { shutdownOnSignal } from "../../apps/api/src/server.js";

describe("shutdownOnSignal (api graceful shutdown)", () => {
  it("calls server.close() then exits 0 when close resolves in time", async () => {
    const callOrder: string[] = [];
    const close = vi.fn((cb: (err?: Error) => void) => {
      callOrder.push("close");
      cb();
    });
    const exit = vi.fn((code: number) => {
      callOrder.push(`exit:${code}`);
    });

    await shutdownOnSignal(
      { close } as unknown as Parameters<typeof shutdownOnSignal>[0],
      { timeoutMs: 5_000, exit: exit as unknown as (code: number) => never }
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["close", "exit:0"]);
  });

  it("still exits 0 when close hangs past the bounded timeout", async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => {
      /* never calls the callback -> hangs */
    });
    const exit = vi.fn();

    const pending = shutdownOnSignal(
      { close } as unknown as Parameters<typeof shutdownOnSignal>[0],
      { timeoutMs: 1_000, exit: exit as unknown as (code: number) => never }
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/api-signal-shutdown.test.ts`
Expected: FAIL — `shutdownOnSignal` is not exported from `apps/api/src/server.ts`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/server.ts`, add an exported helper (place it just above the `if (import.meta.url === ...)` entrypoint block at line 179). Insert after the `createApiServer` function's closing `}` (after line 177):

```ts
/**
 * Graceful-shutdown helper for the api entrypoint (deployable-stack §9). On
 * SIGTERM/SIGINT we call server.close() — which runs the onClose hook tearing
 * down boss/auth/db — then exit 0, racing a bounded timeout so a hung close
 * still exits cleanly. Mirrors the worker's signal path (worker.ts:151-157).
 *
 * Exported (and parameterized with exit/timeout) so it is unit-testable without
 * spawning the real binary or sending a real signal.
 */
export async function shutdownOnSignal(
  server: { close(cb: (err?: Error) => void): void },
  opts: { timeoutMs?: number; exit?: (code: number) => never } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  await Promise.race([
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    })
  ]);
  exit(0);
}
```

Then, inside the entrypoint block, register the signal handlers. After the existing `process.on("uncaughtException", ...)` block (lines 202-204) and BEFORE `await server.listen(...)` (line 206), add:

```ts
  process.once("SIGTERM", () => {
    void shutdownOnSignal(server);
  });
  process.once("SIGINT", () => {
    void shutdownOnSignal(server);
  });
```

> Note: `server` here is the Fastify instance from `createApiServer()`; its `.close(cb)` callback form matches the `shutdownOnSignal` parameter shape. Fastify's `close` accepts a callback, so this compiles without changes to the structural type.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/api-signal-shutdown.test.ts && pnpm exec tsc --noEmit`
Expected: PASS and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts tests/unit/api-signal-shutdown.test.ts
git commit -m "feat(api): handle SIGTERM/SIGINT with bounded graceful shutdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Multi-stage app `Dockerfile`

Spec §1 + AC#1. One image, three roles by command. deps → build → runtime; non-root `node` user; runtime carries `dist/` + pruned production `node_modules` (incl. native binaries) **plus the SQL asset tree and a minimal `tmux` client** — both required at runtime:

- **SQL assets + source (Critical):** `scripts/migrate.ts` resolves `infra/postgres/{bootstrap,migrations,grants}` and every module `sql/` dir via `import.meta.url` at runtime (`scripts/migrate.ts:14-19, 23, 36`; each module manifest uses `new URL("../sql", import.meta.url)`). Because migrate runs as `tsx scripts/migrate.ts` (NOT bundled — Task 5), `import.meta.url` stays correct per-file, so SQL resolves to the real on-disk `packages/*/sql` and `infra/postgres/*` — PROVIDED those dirs + the workspace source + a self-consistent `node_modules` (tsx + symlinks) are present. The runtime stage is therefore `FROM build` (Step 1), which already carries all of that at its real repo-relative paths — NO cherry-picking of pnpm symlinks (that produces a broken tree — Codex R2). Without this, `tsx scripts/migrate.ts` fails with ENOENT (or, if bundled, resolves every module to `/app/sql`) and the whole stack never migrates. The in-image migrate smoke (Step 3b) is the gate.
- **`tmux` client (Critical):** the live engine (`cli-chat-engine.ts`) execs `tmux new-session/send-keys/load-buffer/...` from inside the container against the bind-mounted host socket. The tmux SERVER + the AI CLIs (`claude`/`codex`/`gemini`) run on the HOST (ADR 0008 — not bundled), but the tmux CLIENT binary must be present IN the container to issue those verbs. Install `tmux` via apt in the runtime stage. (Herdr-from-container is out of scope — see Task 9.)
- **UID/volume-write (High):** the image `chown`s `/app` to the image `node` uid (1000). The prod Compose overrides the runtime user to the host operator uid/gid (Task 9). If that uid ≠ 1000, the bind-mount socket opens fine BUT writes to the model-cache/vault named volumes can fail. Mitigation in Task 9 (volumes initialized writable for the host uid); the Dockerfile keeps `mkdir -p $HF_HOME` + a `chmod 0777` on the cache/vault mount points so an arbitrary runtime uid can still write.

Default `CMD` is the api; worker/migrate override `command` in Compose.

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Jarv1s app image (ghcr.io/motioneso/jarv1s-api) — deployable-stack §1.
# One multi-stage image runs api / worker / migrate, selected by the container
# command: api = node dist/server.js, worker = node dist/worker.js (bundled, no
# tsx, no per-start install), migrate = tsx scripts/migrate.ts (one-shot; NOT
# bundled because module SQL dirs resolve via import.meta.url — see Task 5).
# ---------------------------------------------------------------------------

# ---- deps: install the full workspace (incl. native binaries) -------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
# Copy manifests first for layer caching, then the workspace, then install.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY . .
# onlyBuiltDependencies (onnxruntime-node, sharp) in pnpm-workspace.yaml ensures
# the embedding native binaries are fetched (the worker needs them, §3).
RUN pnpm install --frozen-lockfile

# ---- build: compile resident entrypoints to dist/ -------------------------
FROM deps AS build
WORKDIR /app
RUN pnpm build:api && pnpm build:worker

# ---- runtime: FROM build (full, self-consistent deps incl. tsx + source) ---
# DECISION (Codex R2): we do NOT prune to prod-deps and we do NOT cherry-pick
# tsx/esbuild out of the pnpm store. pnpm lays node_modules out as symlinks into
# .pnpm with transitive deps; copying individual dirs (node_modules/tsx, etc.)
# produces a broken, non-self-consistent tree and `tsx scripts/migrate.ts` fails.
# Instead the runtime IS the build stage with: tmux client added, source pruned to
# what the three roles need, writable mount points, and a non-root user. This keeps
# ONE image for all three roles (api/worker bundled `node dist/...`; migrate
# `tsx scripts/migrate.ts`) with a fully consistent node_modules. The cost is a
# larger image (dev deps included) — an accepted tradeoff for correctness in a
# single-operator household deploy; the bundled dist/ still gives fast api/worker
# startup.
FROM build AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Default cache location for the embedding model weights (§3); the prod Compose
# mounts a named volume here so weights survive restarts.
ENV HF_HOME=/app/.cache/huggingface
# tmux CLIENT (Critical): the live chat engine execs tmux verbs from inside the
# container against the bind-mounted HOST tmux socket. The tmux SERVER and the AI
# CLIs run on the host (ADR 0008 — not bundled); only the thin tmux client lives
# here. --no-install-recommends keeps the layer small.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux \
  && rm -rf /var/lib/apt/lists/*
# The full workspace src + node_modules (tsx, esbuild, workspace symlinks) and the
# SQL tree (infra/postgres, packages/*/sql) are ALREADY present from the build
# stage at their real repo-relative paths, so `tsx scripts/migrate.ts` resolves the
# workspace and every module's import.meta.url-relative ../sql correctly. The
# .dockerignore must NOT exclude packages, apps, scripts, or infra/postgres (Task 4).
# Writable mount points for an arbitrary runtime uid (the prod Compose runs as the
# host operator uid, which may differ from the image node uid — High UID finding).
RUN mkdir -p "$HF_HOME" /data/vaults \
  && chown -R node:node /app /data \
  && chmod -R 0777 "$HF_HOME" /data/vaults
USER node
EXPOSE 3000
# Default role is the api; worker overrides `command:`; migrate uses tsx (Compose).
CMD ["node", "dist/server.js"]
```

> **Why FROM build (not a pruned runtime):** the migrate path is source-only
> (`@jarv1s/*` packages export `./src/index.ts`, no compiled `dist/`) and resolves SQL
> via `import.meta.url`, so it needs a complete, self-consistent node_modules (tsx +
> workspace symlinks) + the workspace source + the SQL tree. Cherry-picking tsx/esbuild
> out of a pnpm `.pnpm` store yields a broken tree (Codex R2). `FROM build` guarantees
> consistency for one image serving all three roles. The in-image migrate smoke (Step
> 3b) is the hard gate that proves SQL + workspace resolution before the image is ever
> published. (`deps` and `build` remain the cache-friendly earlier stages.)

- [ ] **Step 2: Build the image (this is the build test)**

Run: `docker build -t jarv1s-api:plan-test -f Dockerfile .`
Expected: build succeeds through all stages; final image tagged `jarv1s-api:plan-test`.

- [ ] **Step 3: Assert resident plain-node runtime, tmux client present, non-root**

Run:
```bash
docker run --rm jarv1s-api:plan-test sh -c 'node --check dist/server.js && node --check dist/worker.js && command -v tmux >/dev/null && test -f infra/postgres/bootstrap/0001_extensions.sql && id -u && echo RUNTIME_OK'
```
Expected: prints the non-root uid (not `0`) and `RUNTIME_OK` — the resident entrypoints parse as plain node ESM, the `tmux` CLIENT binary is present (the engine needs it), and the SQL asset tree is on disk for migrate. (There is intentionally no `dist/migrate.js`.)

- [ ] **Step 3b: In-image migrate smoke (Critical — proves SQL + workspace resolution)**

This turns the silent deploy-time ENOENT/wrong-SQL-path failure into a build-time gate. Stand up a throwaway Postgres and run the EXACT migrate command the prod Compose uses, from inside the freshly built image:

```bash
set -e
docker network create jarv1s-migsmoke 2>/dev/null || true
docker run -d --name pg-migsmoke --network jarv1s-migsmoke \
  -e POSTGRES_DB=jarv1s -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  pgvector/pgvector:pg17
# Always tear the throwaway PG + network down, but PRESERVE the migrate exit status
# (cleanup must NOT mask a failed migrate — Codex R2). trap fires on EXIT.
cleanup() { local s=$?; docker rm -f pg-migsmoke >/dev/null 2>&1 || true; docker network rm jarv1s-migsmoke >/dev/null 2>&1 || true; return "$s"; }
trap cleanup EXIT
# wait for readiness (bounded)
for _ in $(seq 1 60); do docker exec pg-migsmoke pg_isready -U postgres -d jarv1s >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network jarv1s-migsmoke \
  -e JARVIS_BOOTSTRAP_DATABASE_URL=postgres://postgres:postgres@pg-migsmoke:5432/jarv1s \
  -e JARVIS_MIGRATION_DATABASE_URL=postgres://jarvis_migration_owner:migration_password@pg-migsmoke:5432/jarv1s \
  -e JARVIS_APP_DATABASE_URL=postgres://jarvis_app_runtime:app_password@pg-migsmoke:5432/jarv1s \
  -e JARVIS_AUTH_DATABASE_URL=postgres://jarvis_auth_runtime:auth_password@pg-migsmoke:5432/jarv1s \
  -e JARVIS_WORKER_DATABASE_URL=postgres://jarvis_worker_runtime:worker_password@pg-migsmoke:5432/jarv1s \
  jarv1s-api:plan-test node_modules/.bin/tsx scripts/migrate.ts
# Reaching here means migrate exited 0 (set -e aborts on any non-zero above; the
# trap then tears down and returns migrate's status). Echo only on success.
echo MIGRATE_IN_IMAGE_OK
```
Expected: prints `MIGRATE_IN_IMAGE_OK` ONLY if `tsx scripts/migrate.ts` exited 0 — it resolved the workspace + every module's `import.meta.url`-relative SQL dir + the `infra/postgres/*` dirs from inside the image and applied the full chain (bootstrap → app+module SQL → pg-boss → grants). Because `set -e` + the `trap cleanup EXIT` preserve the migrate exit status, a failed migrate makes the whole step exit non-zero (cleanup never masks it). **If this fails with ENOENT or a wrong SQL path, do NOT proceed — the runtime stage is not self-consistent; fix the Dockerfile (it must be `FROM build`) and re-run.**

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: multi-stage app Dockerfile (api/worker bundled, migrate tsx one-shot, tmux client, SQL assets, non-root)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: nginx config + static-web `Dockerfile`

Spec §4 + AC#2. nginx serves `apps/web/dist` with SPA history fallback and reverse-proxies `/api` + `/health` to `api:3000`. The api keeps `default-src 'none'`; nginx sets the SPA's own scoped CSP for the document.

**Files:**
- Create: `infra/nginx/jarv1s-web.conf`
- Create: `apps/web/Dockerfile`

- [ ] **Step 1: Write the nginx config**

Create `infra/nginx/jarv1s-web.conf`:

```nginx
# Jarv1s static-web nginx config (deployable-stack §4).
# Serves the Vite SPA bundle and reverse-proxies /api + /health to the api
# container, preserving the api's locked default-src 'none' CSP (the SPA's own
# relaxed-but-scoped CSP is set HERE on the document, never on the api origin).

server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # SPA document CSP: scoped to self for scripts/styles/connect; no third-party.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;

    # API + health reverse proxy -> the api container on the Compose network.
    # Mirrors the dev Vite proxy target (infra/docker-compose.yml:100).
    location /api/ {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location = /health {
        proxy_pass http://api:3000/health;
        proxy_set_header Host $host;
    }

    location /health/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
    }

    # SPA history fallback: unknown paths return index.html for client routing.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Write the web Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Jarv1s static-web image (ghcr.io/motioneso/jarv1s-web) — deployable-stack §4.
# Build the Vite SPA bundle, then serve it from nginx with /api + /health proxy.
# Built from the repo root context (so the workspace + lockfile are available).
# ---------------------------------------------------------------------------

# ---- build: produce apps/web/dist -----------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:web

# ---- runtime: nginx serving the static bundle -----------------------------
FROM nginx:1.27-bookworm AS runtime
COPY infra/nginx/jarv1s-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: Build the web image + assert the bundle + nginx config**

Run:
```bash
docker build -t jarv1s-web:plan-test -f apps/web/Dockerfile . && \
  docker run --rm jarv1s-web:plan-test sh -c 'test -f /usr/share/nginx/html/index.html && nginx -t 2>&1 | grep -q "syntax is ok" && echo WEB_OK'
```
Expected: build succeeds; prints `WEB_OK` (the SPA `index.html` is present and the nginx config is syntactically valid).

- [ ] **Step 4: Commit**

```bash
git add infra/nginx/jarv1s-web.conf apps/web/Dockerfile
git commit -m "build: static-web nginx image with SPA fallback + api proxy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Production Compose file `infra/docker-compose.prod.yml`

Spec §5 + §6 + AC#3 + AC#7. The deploy artifact: postgres + migrate + api + worker + web, pinned tags, named volumes, `restart: unless-stopped`, NO source bind mounts. The api/worker carry the host-multiplexer bridge mounts (§6). Uses `env_file` for runtime secrets — never baked in.

> **Scope of the host bridge in THIS slice:**
> - **Multiplexer = tmux only, from the container.** The containerized engine execs the
>   `tmux` client (shipped in the image, Task 7) against the bind-mounted host tmux
>   socket dir. **Herdr-from-container is OUT OF SCOPE here** — the compose mounts no
>   herdr socket and sets no herdr root-pane env; an operator who wants herdr runs it on
>   the host and selects tmux for the container (`JARVIS_MULTIPLEXER=tmux`). The env
>   example documents `HERDR_SOCKET_PATH` as reserved/future, not wired. (Removing the
>   half-wired herdr claim avoids the "documented but not functional" trap.)
> - **Least-privilege host mount.** Only `~/.claude`, `~/.codex`, `~/.gemini` (read-only)
>   and the tmux socket dir are mounted — NOT the whole host HOME (which would expose
>   ssh keys, git/cloud creds, shell history). `JARVIS_CLI_HOME_BASE=/host-home` lines
>   the three RO mounts up under `/host-home/.claude|.codex|.gemini`.
> - **UID & writable volumes.** api/worker run as `JARVIS_HOST_UID:JARVIS_HOST_GID` so the
>   0700 host socket dir is openable. Because that uid may differ from the image `node`
>   uid, the Dockerfile makes the model-cache + vault mount points `0777` (Task 7) so the
>   arbitrary runtime uid can still write. The named volumes inherit that on first
>   creation. migrate runs as the default `node` user (it only needs Postgres).

**Files:**
- Create: `infra/docker-compose.prod.yml`

- [ ] **Step 1: Write the prod Compose file**

Create `infra/docker-compose.prod.yml`:

```yaml
# ---------------------------------------------------------------------------
# Jarv1s PRODUCTION Compose (deployable-stack §5). The DEPLOY artifact.
# This file is ALONGSIDE infra/docker-compose.yml (the dev/smoke file), never a
# replacement. Differences from dev (the whole point):
#   - pinned GHCR image tags (no node:24 + runtime pnpm install + tsx)
#   - NO source bind mounts (no ..:/workspace)
#   - named volumes for postgres data, vault /data/vaults, model cache
#   - restart: unless-stopped + the api /health HEALTHCHECK
#   - secrets injected at runtime via env_file (never in image layers)
#   - api/worker carry the host-multiplexer bridge mounts (§6)
#
# Operator: copy infra/env.production.example -> an off-git env file, fill it,
# set JARVIS_IMAGE_TAG to the published version tag, then:
#   docker compose -f infra/docker-compose.prod.yml --env-file <file> up -d
# ---------------------------------------------------------------------------

x-app-env-file: &app-env-file
  env_file:
    - ${JARVIS_ENV_FILE:-./infra/env.production.local}

services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: jarv1s-postgres-prod
    environment:
      POSTGRES_DB: jarv1s
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d jarv1s"]
      interval: 2s
      timeout: 3s
      retries: 30
    volumes:
      - jarv1s-postgres-data:/var/lib/postgresql/data
    networks:
      - jarv1s
    restart: unless-stopped

  migrate:
    image: ghcr.io/motioneso/jarv1s-api:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    <<: *app-env-file
    # Migrate is a one-shot run via tsx (NOT a bundled dist/migrate.js): module SQL
    # dirs resolve via import.meta.url, which bundling would collapse (Task 5). The
    # image ships tsx + the migrate source + the SQL tree for exactly this command.
    # Use the explicit bin path (node_modules/.bin is not guaranteed on PATH). Migrate
    # only touches Postgres (no host-bridge mounts, no host uid needed) — it runs as
    # the image's default node user.
    command: ["node_modules/.bin/tsx", "scripts/migrate.ts"]
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - jarv1s

  api:
    image: ghcr.io/motioneso/jarv1s-api:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    <<: *app-env-file
    command: ["node", "dist/server.js"]
    # Run as the host operator uid/gid so the bind-mounted host tmux socket
    # (mode 0700 per-uid) and host CLI dirs are openable (§6 UID mapping).
    user: "${JARVIS_HOST_UID:-1000}:${JARVIS_HOST_GID:-1000}"
    environment:
      PORT: "3000"
      HOST: 0.0.0.0
      # Point transcript resolution + spawned multiplexer commands at the host HOME (§6).
      JARVIS_CLI_HOME_BASE: /host-home
      HF_HOME: /app/.cache/huggingface
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 120s
    ports:
      - "${JARVIS_API_PORT:-3000}:3000"
    volumes:
      - jarv1s-vault-data:/data/vaults
      - jarv1s-model-cache:/app/.cache/huggingface
      # Host-multiplexer bridge (§6) — present only for the CLI-subscription
      # adapter. The API-key adapter needs NONE of these mounts.
      - ${JARVIS_TMUX_SOCKET_DIR:-/tmp/tmux-1000}:${JARVIS_TMUX_SOCKET_DIR:-/tmp/tmux-1000}
      # Host CLI auth/transcript dirs — mount ONLY the three CLI dirs, read-only, NOT
      # the whole host HOME (which would expose ~/.ssh, git creds, cloud configs,
      # shell history — far beyond CLI auth). JARVIS_CLI_HOME_BASE=/host-home, so the
      # engine's transcriptGlobDir finds /host-home/.claude|.codex|.gemini exactly.
      - ${JARVIS_HOST_CLAUDE_DIR:-~/Jarv1s/.claude}:/host-home/.claude:ro
      - ${JARVIS_HOST_CODEX_DIR:-~/Jarv1s/.codex}:/host-home/.codex:ro
      - ${JARVIS_HOST_GEMINI_DIR:-~/Jarv1s/.gemini}:/host-home/.gemini:ro
      # Shared neutral-dir base: identical absolute path on host + container so
      # the host-spawned CLI cd's into the same dir the container computed (§6.3).
      - ${JARVIS_CHAT_HOME:-~/Jarv1s/.jarvis/chat}:${JARVIS_CHAT_HOME:-~/Jarv1s/.jarvis/chat}
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks:
      - jarv1s

  worker:
    image: ghcr.io/motioneso/jarv1s-api:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    <<: *app-env-file
    command: ["node", "dist/worker.js"]
    user: "${JARVIS_HOST_UID:-1000}:${JARVIS_HOST_GID:-1000}"
    environment:
      JARVIS_CLI_HOME_BASE: /host-home
      HF_HOME: /app/.cache/huggingface
    restart: unless-stopped
    volumes:
      - jarv1s-vault-data:/data/vaults
      - jarv1s-model-cache:/app/.cache/huggingface
      - ${JARVIS_TMUX_SOCKET_DIR:-/tmp/tmux-1000}:${JARVIS_TMUX_SOCKET_DIR:-/tmp/tmux-1000}
      # Mount ONLY the three CLI dirs read-only (NOT the whole host HOME — see api).
      - ${JARVIS_HOST_CLAUDE_DIR:-~/Jarv1s/.claude}:/host-home/.claude:ro
      - ${JARVIS_HOST_CODEX_DIR:-~/Jarv1s/.codex}:/host-home/.codex:ro
      - ${JARVIS_HOST_GEMINI_DIR:-~/Jarv1s/.gemini}:/host-home/.gemini:ro
      - ${JARVIS_CHAT_HOME:-~/Jarv1s/.jarvis/chat}:${JARVIS_CHAT_HOME:-~/Jarv1s/.jarvis/chat}
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks:
      - jarv1s

  web:
    image: ghcr.io/motioneso/jarv1s-web:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    restart: unless-stopped
    ports:
      - "${JARVIS_WEB_PORT:-5173}:80"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - jarv1s

volumes:
  jarv1s-postgres-data:
  jarv1s-vault-data:
  jarv1s-model-cache:

networks:
  jarv1s:
    ipam:
      config:
        - subnet: ${JARVIS_DOCKER_SUBNET:-10.251.0.0/24}
```

- [ ] **Step 2: Validate the Compose config**

Run:
```bash
JARVIS_IMAGE_TAG=plan-test docker compose -f infra/docker-compose.prod.yml config --quiet && \
  echo "no-source-mount-check" && ! grep -q '\.\./workspace\|\.\.:/workspace' infra/docker-compose.prod.yml && \
  grep -q 'pgvector/pgvector:pg17' infra/docker-compose.prod.yml && \
  grep -q 'service_completed_successfully' infra/docker-compose.prod.yml && \
  grep -q 'restart: unless-stopped' infra/docker-compose.prod.yml && \
  grep -q 'node_modules/.bin/tsx' infra/docker-compose.prod.yml && \
  ! grep -qE ':/host-home:ro' infra/docker-compose.prod.yml && \
  grep -q '/host-home/.claude:ro' infra/docker-compose.prod.yml && echo PROD_COMPOSE_OK
```
Expected: `config --quiet` exits 0 (valid); prints `PROD_COMPOSE_OK` — no `..:/workspace` source mount, Postgres is pgvector, migrate gates api/worker via `service_completed_successfully`, `restart: unless-stopped` present, migrate uses the `tsx` one-shot command, the whole host HOME is NOT mounted (`:/host-home:ro` absent), and only the scoped `/host-home/.claude` (etc.) RO mounts are present.

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.prod.yml
git commit -m "build: production Compose (pinned tags, named volumes, host bridge, no source mounts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Prod-compose smoke plan variant (build + smoke locally)

Spec §Testing strategy + AC#4. Extend `smoke-compose.ts` so it can target `infra/docker-compose.prod.yml` and build the images locally first (so the prod compose path is proven end-to-end without a registry round-trip).

**Files:**
- Modify: `scripts/smoke-compose.ts:21-57,75-83`
- Test: `tests/unit/prod-compose-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/prod-compose-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createComposeSmokePlan } from "../../scripts/smoke-compose.js";

describe("createComposeSmokePlan — prod variant", () => {
  it("defaults to the dev compose file with no build step", () => {
    const plan = createComposeSmokePlan();
    // The compose-driven commands all target the dev compose file…
    const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
    expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.yml"))).toBe(true);
    // …and there is no `docker build` step.
    expect(plan.commands.some((c) => c.args[0] === "build")).toBe(false);
  });

  it("targets the prod compose file and prepends real docker build steps when build is set", () => {
    const plan = createComposeSmokePlan({
      composeFile: "infra/docker-compose.prod.yml",
      build: true
    });
    // Compose-driven commands target the prod compose file.
    const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
    expect(composeCmds.length).toBeGreaterThan(0);
    expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.prod.yml"))).toBe(true);
    // The first two commands are real `docker build` steps for the two Dockerfiles,
    // tagged to the GHCR refs the prod compose resolves (not a no-op `compose build`).
    const [first, second] = plan.commands;
    expect(first.args[0]).toBe("build");
    expect(first.args).toContain("Dockerfile");
    expect(first.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s-api:"))).toBe(true);
    expect(second.args[0]).toBe("build");
    expect(second.args).toContain("apps/web/Dockerfile");
    expect(second.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s-web:"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/prod-compose-plan.test.ts`
Expected: FAIL — `createComposeSmokePlan` has no `build` option, so no `docker build` steps are prepended.

- [ ] **Step 3: Write minimal implementation**

In `scripts/smoke-compose.ts`, extend `ComposeSmokePlanInput` (lines 5-8):

```ts
export interface ComposeSmokePlanInput {
  readonly apiPort?: string;
  readonly composeFile?: string;
  /** Build the compose images locally before bringing the stack up (prod variant). */
  readonly build?: boolean;
}
```

In `createComposeSmokePlan` (lines 21-57), add the build step to the front when `input.build` is set. Replace the `commands` array assembly:

```ts
export function createComposeSmokePlan(input: ComposeSmokePlanInput = {}): ComposeSmokePlan {
  const composeFile = input.composeFile ?? "infra/docker-compose.yml";
  const apiPort = input.apiPort ?? process.env.JARVIS_API_PORT ?? "3000";
  const composeArgs = ["compose", "-f", composeFile];

  // The prod compose has only `image:` refs (no `build:`), so `docker compose build`
  // would be a no-op. Build the two Dockerfiles DIRECTLY and tag them to the exact
  // GHCR refs the prod compose resolves (ghcr.io/motioneso/jarv1s-{api,web}:$TAG),
  // so the smoke proves the published topology with no registry round-trip and no
  // manual `docker tag` step (Codex R1: smoke-build contradiction).
  const imageTag = process.env.JARVIS_IMAGE_TAG ?? "smoke";
  const buildCommands: ComposeSmokeCommand[] = input.build
    ? [
        {
          command: "docker",
          args: ["build", "-t", `ghcr.io/motioneso/jarv1s-api:${imageTag}`, "-f", "Dockerfile", "."],
          description: "Build the app (api/worker/migrate) image locally and tag it to the prod GHCR ref"
        },
        {
          command: "docker",
          args: ["build", "-t", `ghcr.io/motioneso/jarv1s-web:${imageTag}`, "-f", "apps/web/Dockerfile", "."],
          description: "Build the static-web image locally and tag it to the prod GHCR ref"
        }
      ]
    : [];

  return {
    // Use the readiness probe, not the liveness `/health`. `/health` returns
    // `{ ok: true }` as soon as the process is listening — it says nothing about
    // whether Postgres or pg-boss are reachable, so a smoke that migrated the DB
    // could still pass against a server with a broken DB connection. `/health/ready`
    // runs `SELECT 1` and checks pg-boss, returning `{ ok, db, pgboss }` with a 503
    // until both are up, which is the post-migration invariant we want to assert (#171).
    healthUrl: `http://localhost:${apiPort}/health/ready`,
    commands: [
      ...buildCommands,
      {
        command: "docker",
        args: [...composeArgs, "config", "--quiet"],
        description: "Validate Docker Compose configuration"
      },
      {
        command: "docker",
        args: [...composeArgs, "up", "-d", "postgres", "--wait"],
        description: "Start Postgres and wait for readiness"
      },
      {
        command: "docker",
        args: [...composeArgs, "run", "--rm", "migrate"],
        description: "Run database migrations"
      },
      {
        command: "docker",
        args: [...composeArgs, "up", "-d", "api", "web", "worker", "--wait"],
        description: "Start API, web, and worker services"
      }
    ]
  };
}
```

In `parseArgs` (lines 75-83), add the `--build` flag:

```ts
function parseArgs(args: readonly string[]): {
  readonly apiPort?: string;
  readonly composeFile?: string;
  readonly build?: boolean;
} {
  return {
    apiPort: readFlag(args, "--api-port"),
    composeFile: readFlag(args, "--compose-file"),
    build: args.includes("--build")
  };
}
```

And thread `build` into the `main()` plan construction (lines 60-64):

```ts
  const plan = createComposeSmokePlan({
    apiPort: args.apiPort,
    composeFile: args.composeFile,
    build: args.build
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/prod-compose-plan.test.ts && pnpm exec tsc --noEmit`
Expected: PASS and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-compose.ts tests/unit/prod-compose-plan.test.ts
git commit -m "feat(smoke): prod-compose variant that builds images locally then smokes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end prod-compose smoke (build + up + /health/ready)

Spec §Testing strategy + AC#4. Run the new prod-compose smoke against locally built images and confirm `/health/ready` returns `{ ok:true, db:"ok", pgboss:"ok" }`. This is an executable verification, not a new test file.

**Files:**
- (No new files — verification of Tasks 7-10 working together.)

- [ ] **Step 1: Create a minimal local env file for the smoke**

Run (writes an off-git local env file referenced by the prod compose `env_file`; uses dev credentials only because this is a local smoke, never a real deploy):

```bash
cat > infra/env.production.local <<'EOF'
NODE_ENV=production
POSTGRES_PASSWORD=postgres
JARVIS_BOOTSTRAP_DATABASE_URL=postgres://postgres:postgres@postgres:5432/jarv1s
JARVIS_MIGRATION_DATABASE_URL=postgres://jarvis_migration_owner:migration_password@postgres:5432/jarv1s
JARVIS_APP_DATABASE_URL=postgres://jarvis_app_runtime:app_password@postgres:5432/jarv1s
JARVIS_AUTH_DATABASE_URL=postgres://jarvis_auth_runtime:auth_password@postgres:5432/jarv1s
JARVIS_WORKER_DATABASE_URL=postgres://jarvis_worker_runtime:worker_password@postgres:5432/jarv1s
BETTER_AUTH_SECRET=smoke-only-not-a-real-secret-0000000000
JARVIS_CONNECTOR_SECRET_KEY=00000000000000000000000000000000
JARVIS_AI_SECRET_KEY=11111111111111111111111111111111
JARVIS_EMBED_PROVIDER=stub
EOF
echo "env file written"
```

> `infra/env.production.local` is excluded from images by the EXPLICIT `.dockerignore`
> line added in Task 4 (the `*.env*` globs do NOT match the `.local` suffix), and must
> be in `.gitignore`. If `.gitignore` lacks it, add a line `infra/env.production.local`
> to `.gitignore` in this step and `git add .gitignore` in Step 4. The smoke uses
> `JARVIS_EMBED_PROVIDER=stub` so the worker does not download model weights during
> CI/smoke. The three host CLI dirs are bind-mounted RO; `mkdir -p` them first so the
> mounts don't fail on a CI host that lacks `~/.claude` etc.

- [ ] **Step 2: Run the prod-compose smoke on a non-default port**

The `--build` step now BUILDS both Dockerfiles and tags them to the GHCR refs the prod
compose resolves (Task 10), so no manual `docker tag` is needed. Provide the same
`JARVIS_IMAGE_TAG` to both the build (via env, read by the plan) and the compose.

Run:
```bash
mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini" "$HOME/.jarvis/chat"
JARVIS_IMAGE_TAG=plan-test \
JARVIS_ENV_FILE=./infra/env.production.local \
JARVIS_API_PORT=3098 JARVIS_WEB_PORT=5181 \
JARVIS_TMUX_SOCKET_DIR=/tmp/tmux-$(id -u) \
JARVIS_HOST_CLAUDE_DIR="$HOME/.claude" JARVIS_HOST_CODEX_DIR="$HOME/.codex" JARVIS_HOST_GEMINI_DIR="$HOME/.gemini" \
JARVIS_HOST_UID=$(id -u) JARVIS_HOST_GID=$(id -g) \
JARVIS_CHAT_HOME="$HOME/.jarvis/chat" \
pnpm smoke:compose:prod -- --api-port 3098
```
Expected: builds BOTH images locally (tagged `ghcr.io/motioneso/jarv1s-{api,web}:plan-test`), brings postgres → migrate (the `tsx scripts/migrate.ts` one-shot) → api/web/worker up, then prints `Compose smoke passed: http://localhost:3098/health/ready` (the readiness probe asserts `{ ok:true, db:"ok", pgboss:"ok" }`). The migrate one-shot succeeding here is ALSO the prod-path proof that bundling-free SQL resolution works end to end.

> NOTE: `/tmp/tmux-$(id -u)` may not exist on a CI host with no tmux server running.
> If the smoke fails opening that mount, start a throwaway host tmux server first
> (`tmux new-session -d -s smoke-probe; tmux kill-session -t smoke-probe || true` after),
> or skip the socket mount for the REST-only smoke by setting
> `JARVIS_TMUX_SOCKET_DIR` to a dir that exists. The REST smoke does not exercise CLI
> chat, so an empty/absent socket dir is acceptable for AC#4 (the bridge is proven by
> the reboot-survival probe, Task 14).

- [ ] **Step 3: Tear down the smoke stack**

Run:
```bash
JARVIS_IMAGE_TAG=plan-test JARVIS_ENV_FILE=./infra/env.production.local \
  docker compose -f infra/docker-compose.prod.yml down -v
echo "torn down"
```
Expected: stack + volumes removed.

- [ ] **Step 4: Commit the .gitignore guard (if changed)**

```bash
git add .gitignore
git commit -m "chore: gitignore the local prod-compose smoke env file

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> If `.gitignore` already excludes `*.env*` / `infra/env.production.local`, skip the commit. NEVER `git add infra/env.production.local` — it must never be committed.

---

### Task 12: CI `publish` job (build both images; push to GHCR on tags)

Spec §7 + AC#5. New `publish` job: build both images, push to GHCR on `v*` tags, build-without-push on PRs, optional `:edge` on main; `permissions: packages: write`; gated on `needs: [verify, compose-smoke]`. Also add the `v*` tag trigger.

**Files:**
- Modify: `.github/workflows/ci.yml:3-10` (triggers/permissions) + append the `publish` job

- [ ] **Step 1: Add the `v*` tag trigger**

In `.github/workflows/ci.yml`, replace the `on:` block (lines 3-7):

```yaml
on:
  push:
    branches:
      - main
    tags:
      - "v*"
  pull_request:
```

- [ ] **Step 2a: Append a `prod-compose-smoke` job (gates publish on the PROD topology)**

The existing `compose-smoke` job exercises the DEV compose (source bind mounts + tsx).
A tag must not publish images that never passed the PRODUCTION topology (Codex R1
Medium: publish gated on the wrong smoke). Append a job that builds both Dockerfiles,
runs the prod-compose smoke (which includes the in-image `tsx scripts/migrate.ts`
one-shot), and which `publish` then depends on:

```yaml

  prod-compose-smoke:
    name: Prod compose deployment smoke
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out repository
        uses: actions/checkout@v5
      - name: Set up pnpm
        uses: pnpm/action-setup@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Assert .dockerignore excludes the secrets env file (before it exists)
        run: |
          grep -q '^infra/env.production.local$' .dockerignore \
            || { echo "::error::.dockerignore must explicitly exclude infra/env.production.local before the smoke writes it"; exit 1; }
      - name: Write smoke env file
        run: |
          cat > infra/env.production.local <<'EOF'
          NODE_ENV=production
          POSTGRES_PASSWORD=postgres
          JARVIS_BOOTSTRAP_DATABASE_URL=postgres://postgres:postgres@postgres:5432/jarv1s
          JARVIS_MIGRATION_DATABASE_URL=postgres://jarvis_migration_owner:migration_password@postgres:5432/jarv1s
          JARVIS_APP_DATABASE_URL=postgres://jarvis_app_runtime:app_password@postgres:5432/jarv1s
          JARVIS_AUTH_DATABASE_URL=postgres://jarvis_auth_runtime:auth_password@postgres:5432/jarv1s
          JARVIS_WORKER_DATABASE_URL=postgres://jarvis_worker_runtime:worker_password@postgres:5432/jarv1s
          BETTER_AUTH_SECRET=smoke-only-not-a-real-secret-0000000000
          JARVIS_CONNECTOR_SECRET_KEY=00000000000000000000000000000000
          JARVIS_AI_SECRET_KEY=11111111111111111111111111111111
          JARVIS_EMBED_PROVIDER=stub
          EOF
      - name: Run prod compose smoke (builds images + in-image migrate)
        env:
          JARVIS_IMAGE_TAG: ci-${{ github.run_id }}
          JARVIS_ENV_FILE: ./infra/env.production.local
          # CI host has no CLI dirs / tmux server; create empty mount targets.
          JARVIS_HOST_CLAUDE_DIR: ${{ github.workspace }}/.ci-claude
          JARVIS_HOST_CODEX_DIR: ${{ github.workspace }}/.ci-codex
          JARVIS_HOST_GEMINI_DIR: ${{ github.workspace }}/.ci-gemini
          JARVIS_TMUX_SOCKET_DIR: ${{ github.workspace }}/.ci-tmux
          JARVIS_CHAT_HOME: ${{ github.workspace }}/.ci-chat
        run: |
          mkdir -p .ci-claude .ci-codex .ci-gemini .ci-tmux .ci-chat
          pnpm smoke:compose:prod
      - name: Stop prod compose stack
        if: always()
        run: JARVIS_IMAGE_TAG=ci-${{ github.run_id }} JARVIS_ENV_FILE=./infra/env.production.local docker compose -f infra/docker-compose.prod.yml down -v
```

- [ ] **Step 2b: Append the `publish` job**

Append to the end of `.github/workflows/ci.yml` (after the `prod-compose-smoke` job, keeping the top-level `permissions: contents: read` unchanged — the publish job sets its own job-scoped permissions):

```yaml

  publish:
    name: Build and publish images
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: [verify, compose-smoke, prod-compose-smoke]
    permissions:
      contents: read
      packages: write

    steps:
      - name: Check out repository
        uses: actions/checkout@v5

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: startsWith(github.ref, 'refs/tags/v') || github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute image tags
        id: tags
        run: |
          if [[ "${GITHUB_REF}" == refs/tags/v* ]]; then
            VERSION="${GITHUB_REF#refs/tags/}"
            echo "api_tags=ghcr.io/motioneso/jarv1s-api:${VERSION}" >> "$GITHUB_OUTPUT"
            echo "web_tags=ghcr.io/motioneso/jarv1s-web:${VERSION}" >> "$GITHUB_OUTPUT"
            echo "push=true" >> "$GITHUB_OUTPUT"
          elif [[ "${GITHUB_REF}" == refs/heads/main ]]; then
            echo "api_tags=ghcr.io/motioneso/jarv1s-api:edge" >> "$GITHUB_OUTPUT"
            echo "web_tags=ghcr.io/motioneso/jarv1s-web:edge" >> "$GITHUB_OUTPUT"
            echo "push=true" >> "$GITHUB_OUTPUT"
          else
            echo "api_tags=ghcr.io/motioneso/jarv1s-api:pr-${{ github.run_id }}" >> "$GITHUB_OUTPUT"
            echo "web_tags=ghcr.io/motioneso/jarv1s-web:pr-${{ github.run_id }}" >> "$GITHUB_OUTPUT"
            echo "push=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Build (and push on tag/main) app image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: ${{ steps.tags.outputs.push == 'true' }}
          tags: ${{ steps.tags.outputs.api_tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build (and push on tag/main) web image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./apps/web/Dockerfile
          push: ${{ steps.tags.outputs.push == 'true' }}
          tags: ${{ steps.tags.outputs.web_tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 3: Validate the workflow YAML**

Run:
```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); j=d['jobs']['publish']; assert set(j['needs'])=={'verify','compose-smoke','prod-compose-smoke'}, j['needs']; assert j['permissions']['packages']=='write'; assert 'prod-compose-smoke' in d['jobs']; print('CI_PUBLISH_OK')"
```
Expected: prints `CI_PUBLISH_OK` (valid YAML; the `publish` job is gated on `verify`, the dev `compose-smoke`, AND the new `prod-compose-smoke`, and has `packages: write` — so a tag can only publish images that passed the production topology).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GHCR publish job (build on PR, push on v* tag + edge on main)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: systemd boot unit `infra/systemd/jarv1s-stack.service`

Spec §8 + AC#8. Mirror `jarv1s-backup.service` (`User=REPLACE_WITH_INSTALL_USER`, `WorkingDirectory`, `After/Requires docker.service`) but run `docker compose up -d` and be `WantedBy=multi-user.target` so it starts at every boot.

**Files:**
- Create: `infra/systemd/jarv1s-stack.service`

- [ ] **Step 1: Write the unit**

Create `infra/systemd/jarv1s-stack.service`:

# NOTE: `User=REPLACE_WITH_INSTALL_USER` and the `~/Jarv1s` paths follow the EXISTING repo
# convention (`infra/systemd/jarv1s-backup.service` hardcodes the same) — this is a
# single-operator household deploy (ADR 0007), not a portable distro package. An
# operator on a different path/user edits these two lines (and the EnvironmentFile
# path) at install time. The committed file IS the canonical install for this host.
[Unit]
Description=Jarv1s production stack (docker compose)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=REPLACE_WITH_INSTALL_USER
WorkingDirectory=~/Jarv1s
# Operator env file: provides JARVIS_IMAGE_TAG (REQUIRED — the prod Compose errors
# without it), host UID/GID, socket paths, and secrets, exported into this service's
# environment so `docker compose` variable substitution resolves them. The leading
# "-" tolerates absence at parse time, but the stack will fail to START if the file
# is missing JARVIS_IMAGE_TAG — the operator MUST create it before `systemctl enable`.
EnvironmentFile=-~/Jarv1s/infra/env.production.local
ExecStart=/usr/bin/docker compose -f infra/docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f infra/docker-compose.prod.yml down
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Validate the unit shape**

Run:
```bash
grep -q 'WantedBy=multi-user.target' infra/systemd/jarv1s-stack.service && \
  grep -q 'docker compose -f infra/docker-compose.prod.yml up -d' infra/systemd/jarv1s-stack.service && \
  grep -q 'Requires=docker.service' infra/systemd/jarv1s-stack.service && echo STACK_UNIT_OK
# If systemd-analyze is available, verify the unit parses:
command -v systemd-analyze >/dev/null && systemd-analyze verify infra/systemd/jarv1s-stack.service 2>&1 | grep -v '^$' || true
```
Expected: prints `STACK_UNIT_OK`; `systemd-analyze verify` (if present) reports no fatal errors (warnings about the absolute exec path are acceptable).

- [ ] **Step 3: Commit**

```bash
git add infra/systemd/jarv1s-stack.service
git commit -m "ops: systemd boot unit running the prod compose stack at multi-user.target

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Reboot-survival check script

Spec §8 reboot-survival + AC#9. A scripted check: with the stack up, assert `/health/ready` is green AND a multiplexer liveness probe succeeds on the bridged socket. Used in the runbook and (optionally) CI (Docker-daemon restart as a reboot proxy).

**Files:**
- Create: `scripts/verify-reboot-survival.sh`

- [ ] **Step 1: Write the script**

Create `scripts/verify-reboot-survival.sh`:

```bash
#!/usr/bin/env bash
#
# Reboot-survival check (deployable-stack §8, AC#9). Run AFTER a reboot (or after
# `systemctl start jarv1s-stack`). Asserts two things:
#   1. The stack is healthy: /health/ready returns {ok:true, db:"ok", pgboss:"ok"}.
#   2. A chat session can launch against the host multiplexer: the bridged tmux
#      (or herdr) server is reachable.
#
# Exit 0 = survived; non-zero = a component is down (fail loudly, never false-green).
set -euo pipefail

API_PORT="${JARVIS_API_PORT:-3000}"
HEALTH_URL="http://localhost:${API_PORT}/health/ready"
DEADLINE=$(( $(date +%s) + 120 ))

echo "[reboot-survival] waiting for ${HEALTH_URL} ..."
while :; do
  body="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
  if printf '%s' "${body}" | grep -q '"ok":true' \
     && printf '%s' "${body}" | grep -q '"db":"ok"' \
     && printf '%s' "${body}" | grep -q '"pgboss":"ok"'; then
    echo "[reboot-survival] readiness OK: ${body}"
    break
  fi
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "[reboot-survival] FAIL: readiness not green within timeout (last: ${body:-none})" >&2
    exit 1
  fi
  sleep 2
done

# Multiplexer liveness: the host tmux/herdr server must be reachable so a chat
# session can launch (the bridge in §6). Prefer herdr if its socket is set.
echo "[reboot-survival] probing host multiplexer ..."
if [ -n "${HERDR_SOCKET_PATH:-}" ]; then
  if [ -S "${HERDR_SOCKET_PATH}" ]; then
    echo "[reboot-survival] herdr socket present: ${HERDR_SOCKET_PATH}"
  else
    echo "[reboot-survival] FAIL: HERDR_SOCKET_PATH set but no socket at ${HERDR_SOCKET_PATH}" >&2
    exit 1
  fi
else
  # tmux: `has-session` against any session returns 0 if the server is up; an
  # empty server returns non-zero with "no server running" — distinguish that.
  if tmux ls >/dev/null 2>&1; then
    echo "[reboot-survival] tmux server is live"
  else
    # `tmux ls` non-zero can mean "server up, no sessions" OR "no server". Start a
    # throwaway session to confirm the server can be created, then kill it.
    if tmux new-session -d -s jarv1s-reboot-probe 2>/dev/null; then
      tmux kill-session -t jarv1s-reboot-probe 2>/dev/null || true
      echo "[reboot-survival] tmux server can launch a session"
    else
      echo "[reboot-survival] FAIL: cannot reach or start a tmux server (CLI chat would break)" >&2
      exit 1
    fi
  fi
fi

echo "[reboot-survival] PASS: stack healthy + a chat session can launch"
```

- [ ] **Step 2: Make it executable + lint the shell**

Run:
```bash
chmod +x scripts/verify-reboot-survival.sh && bash -n scripts/verify-reboot-survival.sh && echo REBOOT_SCRIPT_OK
```
Expected: prints `REBOOT_SCRIPT_OK` (no shell syntax errors; the script is executable).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-reboot-survival.sh
git commit -m "ops: reboot-survival check (readiness green + multiplexer can launch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Extend `infra/env.production.example`

Spec §3, §5, §6, §8 + AC#10. Add the new vars (model cache `HF_HOME`, host UID/GID, tmux socket dir, the THREE scoped host CLI dirs `JARVIS_HOST_{CLAUDE,CODEX,GEMINI}_DIR`, `JARVIS_CLI_HOME_BASE`, neutral-dir base, image tag, env-file path, `JARVIS_MULTIPLEXER=tmux`) and document the CLI-auth-mount tradeoff (or link the doc). Herdr socket is RESERVED/commented (not wired this slice). No secret baked into any image — these are runtime env only.

**Files:**
- Modify: `infra/env.production.example` (append)

- [ ] **Step 1: Append the new section**

Append to `infra/env.production.example`:

```bash

# ---------------------------------------------------------------------------
# Deployable containerized stack (docker-compose.prod.yml) — Phase 2 §5/§6/§8.
# ---------------------------------------------------------------------------

# The published GHCR image version tag the prod Compose deploys. Pin a concrete
# version (e.g. v1.2.3); NEVER :edge or :latest (a deploy must be reproducible).
JARVIS_IMAGE_TAG=v0.0.0

# Path to THIS operator-managed env file (the prod Compose reads it via env_file).
JARVIS_ENV_FILE=./infra/env.production.local

# Postgres superuser password for the prod data volume (distinct from dev).
POSTGRES_PASSWORD=<bootstrap-password>

# Embedding model cache (§3). The prod Compose mounts a named volume here so the
# nomic-embed-text model weights survive container restarts (no re-download).
HF_HOME=/app/.cache/huggingface

# ---------------------------------------------------------------------------
# Host-multiplexer bridge (§6) — REQUIRED ONLY for the CLI-subscription chat
# adapter. The future API-key adapter (ADR 0008 §1b) is HTTP-only and needs
# NONE of these mounts — an API-key instance has a strictly smaller attack
# surface. Leave these at defaults / unset if you run API-key chat.
#
# SECURITY TRADEOFF (must be understood before enabling): mounting the host CLI
# auth (~/.claude, ~/.codex, ~/.gemini) and the multiplexer socket into the
# api/worker container means a compromise of the container can reach the
# operator's personal CLI credentials and steer host sessions. This is ACCEPTED
# under the single-operator household model (ADR 0007) — the same shared-uid soft
# boundary the CLI-adapter slice documents. See docs/operations/dev-environment.md
# → "Host-multiplexer bridge (CLI chat from the container)".
# ---------------------------------------------------------------------------

# The container runtime user must equal the host operator uid/gid so it can open
# the host tmux socket dir (mode 0700 per-uid) and read the host CLI dirs.
JARVIS_HOST_UID=1000
JARVIS_HOST_GID=1000

# Containerized multiplexer = tmux ONLY (the container ships the tmux client and
# execs it against the host socket). Herdr-from-container is NOT wired in this slice;
# if you run herdr on the host, select tmux for the container:
JARVIS_MULTIPLEXER=tmux

# Host per-uid tmux socket dir, bind-mounted at the same path in the container so
# tmux derives the same socket from /tmp/tmux-$(id -u).
JARVIS_TMUX_SOCKET_DIR=/tmp/tmux-1000

# RESERVED / NOT WIRED in this slice: herdr socket path. The prod Compose does not
# mount a herdr socket; this is a placeholder for a future herdr-from-container slice.
# HERDR_SOCKET_PATH=

# Host CLI-config dirs, each bind-mounted READ-ONLY under /host-home. ONLY these
# three dirs are mounted (NOT the whole host HOME — that would expose ~/.ssh, git
# creds, shell history). They line up under JARVIS_CLI_HOME_BASE so the engine's
# transcriptGlobDir finds /host-home/.claude|.codex|.gemini.
JARVIS_HOST_CLAUDE_DIR=~/Jarv1s/.claude
JARVIS_HOST_CODEX_DIR=~/Jarv1s/.codex
JARVIS_HOST_GEMINI_DIR=~/Jarv1s/.gemini

# Inside the container, transcript resolution uses this base (the mount point above).
# Keep it /host-home unless you remap the three mounts above.
JARVIS_CLI_HOME_BASE=/host-home

# Per-user neutral chat dir base. Mounted at the SAME absolute path on host and
# container so the host-spawned CLI cd's into the dir the container computed (§6.3).
JARVIS_CHAT_HOME=~/Jarv1s/.jarvis/chat

# Embedding provider. "local" downloads the model on first use (cached in HF_HOME);
# set "stub" to avoid any model download (tests / explicit opt-out).
JARVIS_EMBED_PROVIDER=local
```

- [ ] **Step 2: Verify no real secret value is present**

Run:
```bash
grep -nE '^(BETTER_AUTH_SECRET|JARVIS_CONNECTOR_SECRET_KEY|JARVIS_AI_SECRET_KEY|POSTGRES_PASSWORD)=' infra/env.production.example | grep -vqE '<.*>|generate' && echo "LEAK" || echo NO_SECRET_LEAK
```
Expected: prints `NO_SECRET_LEAK` (every secret var is a placeholder `<...>` / "generate" stub, never a real value).

- [ ] **Step 3: Commit**

```bash
git add infra/env.production.example
git commit -m "ops: extend env.production.example with stack + host-bridge vars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: Document the prod stack + host-mount tradeoff + reboot runbook

Spec §6 tradeoff + AC#12. Document the prod topology, the §6 host-mount security tradeoff, the API-key-adapter-needs-nothing forward-compat, and the reboot-survival runbook in `dev-environment.md`. (Linking from epic #47's exit criterion is a board action the human performs; this task ensures the doc exists to link.)

**Files:**
- Modify: `docs/operations/dev-environment.md` (append)

- [ ] **Step 1: Append the production section**

Append to `docs/operations/dev-environment.md`:

````markdown
## Production deploy (containerized stack)

The deploy artifact is `infra/docker-compose.prod.yml` (NOT the dev
`infra/docker-compose.yml`, which bind-mounts source and runs `tsx` for everything). It
runs two images: one app image (`ghcr.io/motioneso/jarv1s-api`) used for api / worker /
migrate by command selection, and an nginx static-web image (`ghcr.io/motioneso/jarv1s-web`)
that serves the SPA and reverse-proxies `/api` + `/health` to the api — so the api keeps
its `default-src 'none'` CSP and never serves HTML. The api/worker run as bundled plain
`node dist/server.js` / `node dist/worker.js` (no tsx, no per-start install). The migrate
one-shot runs `tsx scripts/migrate.ts` (NOT bundled — module SQL dirs resolve via
`import.meta.url`, which bundling would break); the image ships tsx + the SQL tree for it.

**Deploy steps:**

```txt
cp infra/env.production.example infra/env.production.local   # off-git; fill secrets/UIDs/tag
# set JARVIS_IMAGE_TAG to a published version tag (never :edge/:latest)
docker compose -f infra/docker-compose.prod.yml up -d
# or, at boot: systemctl enable --now jarv1s-stack
```

Order: postgres (healthcheck) → migrate one-shot (`tsx scripts/migrate.ts`: bootstrap →
app+module SQL → pg-boss → grants; exits 0) → api+worker (gated on
`service_completed_successfully`) → web (gated on api healthy). Every long-running
service is `restart: unless-stopped`; the api keeps a `/health` HEALTHCHECK.

**Host prerequisites:** Docker + the compose plugin installed and the daemon running
(`jarv1s-stack.service` has `Requires=docker.service`). The embedding model downloads on
first use into the `jarv1s-model-cache` named volume (`HF_HOME=/app/.cache/huggingface`);
set `JARVIS_EMBED_PROVIDER=stub` to skip it.

## Host-multiplexer bridge (CLI chat from the container)

Live CLI chat drives `claude`/`codex`/`gemini` through tmux under the operator's personal
auth. Per ADR 0008 §2 we do NOT bundle the AI CLIs (`claude`/`codex`/`gemini`) — they are
host-provisioned and run on the HOST. The tmux SERVER also runs on the host. What the
container carries is only the thin **tmux CLIENT** (apt-installed in the image): the
api/worker engine execs `tmux send-keys/...` from inside the container against the
bind-mounted host tmux socket, so the AI CLIs launch on the host with host auth. The
container **steers the host's** tmux and **reads the host's** transcripts through bind
mounts (only on api/worker):

1. **tmux socket** — the host per-uid tmux socket dir (`/tmp/tmux-<uid>`, mode 0700) is
   bind-mounted at the same path; the tmux server runs on the host. (Herdr-from-container
   is NOT wired in this slice — run herdr on the host and set `JARVIS_MULTIPLEXER=tmux`
   for the container.)
2. **Host CLI dirs (least-privilege)** — ONLY the three CLI-config dirs `~/.claude`,
   `~/.codex`, `~/.gemini` are bind-mounted READ-ONLY under `/host-home` (NOT the whole
   host HOME — that would expose `~/.ssh`, git/cloud creds, shell history). They line up
   under `JARVIS_CLI_HOME_BASE=/host-home` so the engine's `transcriptGlobDir` finds
   `/host-home/.claude|.codex|.gemini`.
3. **Neutral-dir alignment** — the per-user neutral dir base (`JARVIS_CHAT_HOME`) is
   mounted at the SAME absolute path on host and container so the host-spawned CLI `cd`s
   into the dir the container computed.

**UID mapping:** the container runs as `JARVIS_HOST_UID:JARVIS_HOST_GID` (the host operator
uid/gid) so it can open the 0700 socket and read the three RO CLI dirs. Because that uid
may differ from the image `node` uid, the writable named volumes (model cache, vault) are
made world-writable at build (Task 7). If the uid does not match the socket owner, CLI chat
silently breaks while REST stays green — the reboot-survival probe catches this.

**Security tradeoff (accepted, documented):** mounting the three host CLI-auth dirs + the
tmux socket means a container compromise can reach the operator's personal CLI credentials
and steer host tmux sessions. This is accepted under the **single-operator household model**
(ADR 0007) — the same shared-uid soft boundary the CLI-adapter slice documents. The mount
is scoped to the three CLI dirs (read-only), NOT the whole HOME, to bound the blast radius.
It is **opt-in**: present only when the CLI-subscription adapter is chosen. The **API-key
adapter needs NONE of these mounts** (it talks HTTP to a provider), so an API-key instance
runs with a strictly smaller attack surface.

## Reboot-survival check

After a host reboot (or `systemctl start jarv1s-stack`), confirm the stack survived:

```txt
JARVIS_API_PORT=3000 scripts/verify-reboot-survival.sh
```

It asserts (1) `/health/ready` returns `{ ok:true, db:"ok", pgboss:"ok" }` and (2) a chat
session can launch against the host multiplexer (tmux/herdr liveness on the bridged
socket). Non-zero exit means a component is down — it fails loudly, never false-green.
````

- [ ] **Step 2: Verify the doc renders the required anchors**

Run:
```bash
grep -q "Host-multiplexer bridge (CLI chat from the container)" docs/operations/dev-environment.md && \
  grep -q "API-key adapter" docs/operations/dev-environment.md && \
  grep -q "Reboot-survival check" docs/operations/dev-environment.md && echo DOC_OK
```
Expected: prints `DOC_OK` (the §6 tradeoff, the API-key forward-compat note, and the reboot runbook are all present).

- [ ] **Step 3: Commit**

```bash
git add docs/operations/dev-environment.md
git commit -m "docs: prod stack, host-mount tradeoff, reboot-survival runbook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 17: Self-Review (spec §-by-§ coverage, placeholder scan, type consistency)

This is a checklist the worker runs against the finished work before the final gate. Do not skip; fix any gap inline (add a task or correct a file) then proceed.

- [ ] **Step 1: Spec §-by-§ coverage** — confirm a task implements each spec section/AC:

  - §1 App image / AC#1 → Task 7 (Dockerfile: bundled api/worker `node dist/...`, tmux client, SQL assets, tsx-for-migrate), Task 5 (build scripts).
  - §2 Build scripts → Task 5 (`build:api`/`build:worker`, esbuild; migrate stays `tsx scripts/migrate.ts`).
  - §3 Worker runtime + model cache → Task 7 (`HF_HOME`, native binaries via `onlyBuiltDependencies`), Task 9 (`jarv1s-model-cache` volume), Task 15 (`HF_HOME` env).
  - §4 Static-web image / AC#2 → Task 8 (nginx Dockerfile + config, SPA fallback, api CSP preserved).
  - §5 Prod Compose / AC#3 → Task 9 (pinned tags, named volumes, restart, no source mounts, pgvector, migrate gating, scoped CLI mounts).
  - §6 Host-multiplexer bridge / AC#7 → Task 3 (engine `homeBase` threading — the `transcriptGlobDir`/`TmuxIo.run` seams ALREADY existed, Tasks 1-2 deleted), Task 7 (tmux client in image), Task 9 (scoped RO CLI mounts + tmux socket + UID mapping), Task 15 (env), Task 16 (doc).
  - §7 CI publish / AC#5 → Task 12 (`prod-compose-smoke` gate + publish job, tags, gating, packages: write).
  - §8 Supervision + reboot survival / AC#8, AC#9 → Task 9 (`restart: unless-stopped`, HEALTHCHECK), Task 13 (systemd unit), Task 14 (reboot script).
  - §9 Graceful shutdown / AC#6 → Task 6 (SIGTERM/SIGINT handler + test).
  - AC#4 prod smoke green → Tasks 10-11 (incl. the in-image migrate proof, Task 7 Step 3b).
  - AC#10 env example + no baked secret → Tasks 4, 15.
  - AC#11 verify:foundation / check:file-size / audit:release-hardening green, no new migration → Task 18.
  - AC#12 doc + epic link → Task 16 (doc; the epic-link is a human board action).

  List any gap. If found, add a task and implement it before Step 2.

  > **Removed/changed vs first draft (record):** Tasks 1-2 deleted (seams already shipped);
  > `dist/migrate.js` removed (migrate is `tsx scripts/migrate.ts`); host HOME mount narrowed
  > to three RO CLI dirs; herdr-from-container descoped; `prod-compose-smoke` CI gate added;
  > runtime image now copies SQL + ships tmux client.

- [ ] **Step 2: Placeholder scan** — search the changed files for red flags:

```bash
git diff --name-only origin/main...HEAD | grep -vE '\.md$' | xargs grep -nE 'TODO|FIXME|TBD|implement later|fill in|similar to above' 2>/dev/null || echo NO_PLACEHOLDERS
```
Expected: prints `NO_PLACEHOLDERS`. (Markdown plan/doc files are excluded — they legitimately discuss these words.)

- [ ] **Step 3: Type consistency** — confirm the names introduced earlier are used identically later:

  - `transcriptGlobDir(provider, cwd, homeBase?)` — EXISTING signature (`tmux-bridge.ts:89`) == Task 3 call site.
  - `TmuxIo.run(cmd, args, opts?: RunOptions)` — EXISTING interface (`tmux-bridge.ts:18-24`) == real impl.
  - `CliChatEngineOpts.homeBase` — Task 3 field name (on `CliChatEngineImpl`) == `JARVIS_CLI_HOME_BASE` env read in `createRealEngineFactory` (`runtime.ts`).
  - `shutdownOnSignal(server, { timeoutMs?, exit? })` — Task 6 export == test usage == entrypoint call.
  - `createComposeSmokePlan({ composeFile?, build? })` — Task 10 input == test == `main()` thread-through.
  - `JARVIS_IMAGE_TAG`, `JARVIS_CLI_HOME_BASE`, `JARVIS_HOST_UID/GID`, `JARVIS_TMUX_SOCKET_DIR`, `JARVIS_HOST_CLAUDE_DIR/CODEX_DIR/GEMINI_DIR`, `JARVIS_CHAT_HOME`, `JARVIS_MULTIPLEXER`, `HF_HOME` — same spelling in Task 9 Compose, Task 15 env example, Task 16 doc. NOTE: `JARVIS_HOST_HOME` is GONE (replaced by the three scoped dirs).

  Run:
```bash
grep -rn "JARVIS_CLI_HOME_BASE" infra/docker-compose.prod.yml infra/env.production.example packages/chat/src/live/runtime.ts && \
  grep -rn "JARVIS_IMAGE_TAG" infra/docker-compose.prod.yml infra/env.production.example && \
  grep -rn "JARVIS_HOST_CLAUDE_DIR" infra/docker-compose.prod.yml infra/env.production.example && \
  ! grep -rn "JARVIS_HOST_HOME" infra/docker-compose.prod.yml infra/env.production.example && echo NAMES_CONSISTENT
```
Expected: each name appears in every place listed, `JARVIS_HOST_HOME` is absent, and it prints `NAMES_CONSISTENT`.

- [ ] **Step 4: No commit** — this task makes no commit unless Step 1 surfaced a gap that required a fix (in which case commit that fix with its own message).

---

### Task 18: Final gate — `pnpm verify:foundation` + adjacent gates

Spec AC#11. The full gate must be green, file-size clean, release-hardening clean, and NO new SQL migration added or edited.

**Files:**
- (No new files — final verification.)

- [ ] **Step 1: Confirm no migration was added or edited**

Run:
```bash
git diff --name-only origin/main...HEAD | grep -E 'infra/postgres/migrations/|/sql/.*\.sql$' && echo "MIGRATION_TOUCHED" || echo NO_MIGRATION_CHANGE
```
Expected: prints `NO_MIGRATION_CHANGE` (this slice is infra/code only).

- [ ] **Step 2: File-size gate**

Run: `pnpm check:file-size`
Expected: exit 0 — no source file exceeds 1000 lines. (The api signal-handler addition is small; `apps/api/src/server.ts` stays well under 1000.)

- [ ] **Step 3: Start the DB and run the full foundation gate**

Run:
```bash
pnpm db:up && pnpm verify:foundation
```
Expected: exit 0 — lint, format:check, check:file-size, typecheck, test:unit (incl. the EXTENDED `cli-chat-engine` homeBase tests and the new `api-signal-shutdown`, `prod-compose-plan` tests — NOT `transcript-home-base`/`tmux-io-run-options`, which were deleted as already-covered), db:migrate, test:integration all pass. If `format:check` flags any new file, run `pnpm format`, re-stage, and amend the relevant commit.

- [ ] **Step 4: Release-hardening gate**

Run:
```bash
pnpm test:release-hardening && pnpm audit:release-hardening
```
Expected: both exit 0 — no `BYPASSRLS`, least-privilege roles intact, secrets posture unchanged (the topology does not alter role grants).

- [ ] **Step 5: Final commit (only if Step 3 required a format fix)**

```bash
git add -- <the specific reformatted files>
git commit -m "chore: prettier formatting for deployable-stack files

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> NEVER `git add -A` / `git add .` — another session may share this tree. Stage only the explicit paths you changed.

---

## Execution Notes for the Autonomous Worker

- **Tasks 1-2 are DELETED — do not implement them.** The `transcriptGlobDir` `homeBase`
  param and `TmuxIo.run` `RunOptions` already exist on `origin/main`. Start at Task 3.
- **Order matters.** Task 3 (engine `homeBase` threading) MUST land before Task 9's bridge
  mounts have anything to point at. Tasks 5/7/8 (build + images) MUST precede Tasks 10/11
  (smoke). The in-image migrate smoke (Task 7 Step 3b) MUST pass before Task 9/10/11/12 —
  it is the gate that proves the no-bundle migrate path works. Do not reorder.
- **Docker availability.** Tasks 7 (incl. Step 3b in-image migrate), 8, 11, 12 (validation), 13 need a working Docker daemon. If Docker is unavailable in the build environment, complete the file authoring + the non-Docker assertions (YAML/shell/`config --quiet` where possible) and leave a clear note in the task's commit body that the Docker build step was deferred — do NOT mark the build-test step PASS without running it. The in-image migrate smoke (Task 7 Step 3b) is NOT optional for a publishable image; if it cannot be run locally, it MUST be proven by the `prod-compose-smoke` CI job before any tag is published.
- **Shared tree discipline.** Stage only explicit paths per commit (every task already does this). Never `git add -A`. Never `git checkout`/`reset`/`stash` the shared tree.
- **Secrets.** `infra/env.production.local` is a local smoke artifact only — it must be gitignored and never committed (Task 11). No secret value ever enters `infra/env.production.example` or any image layer.
- **No code outside the planned files.** Every change is enumerated in the File Structure table.
