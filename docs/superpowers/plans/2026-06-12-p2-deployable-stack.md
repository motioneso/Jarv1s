# Phase 2 Deployable Containerized Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final containerized production topology for Jarv1s — a multi-stage app image (api/worker/migrate), a static-web nginx image, a production Compose file, CI image publish to GHCR on git tags, per-container supervision, a systemd boot unit, graceful api shutdown, and a host-multiplexer bridge so CLI chat works from inside the container — meeting epic #47 DEPLOY CHECKPOINT exit criterion #5.

**Architecture:** One multi-stage app image (`ghcr.io/motioneso/jarv1s-api`) compiled to `dist/` with esbuild and run as plain `node dist/...` (no `tsx`, no per-start `pnpm install`); its runtime role (api / worker / migrate) is selected by the container `command`. A separate nginx image (`ghcr.io/motioneso/jarv1s-web`) serves the Vite SPA bundle and reverse-proxies `/api` + `/health` to the api so the api keeps its `default-src 'none'` CSP. A new `infra/docker-compose.prod.yml` wires these with pinned tags, named volumes, `restart: unless-stopped`, and NO source bind mounts — alongside (never replacing) the dev `infra/docker-compose.yml`. CLI chat reaches the host multiplexer (tmux/herdr) and host CLI auth through bind-mounted host socket + host HOME, using two engine seams added here.

**Tech Stack:** Node 24 (`node:24-bookworm-slim`), pnpm 10.6.2, esbuild (new root devDependency), Docker + Compose v2, nginx (stable image), GitHub Actions (`docker/login-action`, `docker/build-push-action`), systemd, Fastify, pg-boss, `@huggingface/transformers` (+ `onnxruntime-node`/`sharp` native binaries), Vitest.

---

## Grounding

- **Grounded on:** local `main` contains `origin/main` (`5759b90`) plus local doc-only commits; spec baseline `a898533` is in history. Tree is ahead, not behind — acceptable per Grounding Discipline. The autonomous worker MUST run `pnpm audit:preflight` and abort if it reports the tree is *behind* before starting.
- **Spec:** `docs/superpowers/specs/2026-06-12-p2-deployable-containerized-stack-design.md` (read in full; all §/AC references below point at it).
- **Hard dependency confirmed ABSENT in code today:** `transcriptGlobDir(provider, cwd)` is 2-arg and uses `homedir()` (`packages/ai/src/adapters/tmux-bridge.ts:75`); `TmuxIo.run(cmd, args)` has no env/cwd param (`tmux-bridge.ts:11-20`); there are zero `herdr` / `homeBase` references in `packages/chat` or `packages/ai`. Per spec Open Risk #1 mitigation ("land the two seams default-noop as a tiny prerequisite PR"), **Tasks 1–3 land those seams behavior-preserving** so the bridge (Tasks 13–15) has something real to point at. This keeps the plan self-contained for an overnight build.

## Hard Invariants honored (do not weaken)

- **pgvector image** — prod Compose Postgres stays `pgvector/pgvector:pg17` (Task 8).
- **Never edit applied migrations** — this slice adds NO SQL and edits no migration; it only *runs* `scripts/migrate.ts` via the compiled `dist/migrate.js`.
- **Secrets never escape / encrypted at rest** — secrets injected at runtime via `env_file`, never `COPY`'d into image layers; `.dockerignore` excludes `backups/`, `exports/`, `.git`, `*.env` (Task 4).
- **No admin private-data bypass / RLS for all actors** — no role-grant changes; least-privilege per-role URLs unchanged.
- **DataContextDb only / AccessContext shape** — no data-access code touched; `AccessContext` stays `{ actorUserId, requestId }`.
- **Module isolation** — the build bundles declared package entrypoints only; no module internals imported.
- **ADR 0008 (host-provisioned CLI)** — the image does NOT bundle `claude`/`codex`/`gemini` or a multiplexer; the bridge (Tasks 13–15) is the documented host-reach mechanism, opt-in, with the API-key adapter needing none of it.
- **api CSP unchanged** — the SPA moves to a separate nginx origin (Task 11); the api never serves HTML.

---

## File Structure

### New files

| Path | Responsibility |
| --- | --- |
| `Dockerfile` | Multi-stage app image (deps → build → runtime). Runs api/worker/migrate by command. |
| `apps/web/Dockerfile` | Multi-stage static-web image: `pnpm build:web` → nginx serving `apps/web/dist`. |
| `infra/nginx/jarv1s-web.conf` | nginx server block: SPA history fallback + `/api`,`/health` reverse proxy to `api:3000`; SPA CSP. |
| `.dockerignore` | Keep build context small; exclude `node_modules`, `.git`, `tests/`, `spikes/`, `docs/`, `backups/`, `exports/`, `**/dist`, `.codegraph/`, `*.env`. |
| `scripts/build-app.ts` | esbuild bundler producing `dist/server.js`, `dist/worker.js`, `dist/migrate.js` (used by `build:api`/`build:worker`). |
| `scripts/migrate-entry.ts` | Thin re-export wrapper so esbuild has a stable migrate entrypoint that resolves `infra/postgres/*` dirs relative to the repo at build/runtime. |
| `infra/docker-compose.prod.yml` | The deploy artifact: postgres + migrate + api + worker + web, pinned tags, named volumes, no source mounts. |
| `infra/systemd/jarv1s-stack.service` | systemd unit running `docker compose -f infra/docker-compose.prod.yml up -d` at boot (`WantedBy=multi-user.target`). |
| `scripts/verify-reboot-survival.sh` | Scripted reboot-survival check: stack up → `/health/ready` green + multiplexer liveness probe. |
| `tests/unit/api-signal-shutdown.test.ts` | Unit test for the api SIGTERM/SIGINT graceful-shutdown handler. |
| `tests/unit/transcript-home-base.test.ts` | Unit test for the `transcriptGlobDir` `homeBase` seam. |
| `tests/unit/tmux-io-run-options.test.ts` | Unit test for the `TmuxIo.run` env/cwd options seam. |
| `tests/unit/prod-compose-plan.test.ts` | Unit test asserting the prod-compose smoke plan shape (composeFile, build step). |

### Modified files

| Path | Change |
| --- | --- |
| `apps/api/src/server.ts` | Extract a `shutdownOnSignal()` helper + register `SIGTERM`/`SIGINT` in the entrypoint (graceful `server.close()` → `exit(0)` with bounded timeout). |
| `packages/ai/src/adapters/tmux-bridge.ts` | Add optional `homeBase` 3rd param to `transcriptGlobDir`; add optional `{ env?, cwd? }` 3rd arg to `TmuxIo.run` (default-noop). |
| `packages/chat/src/live/cli-chat-engine.ts` | Thread an optional `homeBase` through the engine into `transcriptGlobDir`. |
| `packages/chat/src/live/runtime.ts` | Read `JARVIS_CLI_HOME_BASE` and pass it to the engine factory. |
| `package.json` | Add `build:api`, `build:worker`, `smoke:compose:prod` scripts; add `esbuild` devDependency. |
| `scripts/smoke-compose.ts` | Add an esbuild-free prod-compose plan variant (build images locally, then smoke `infra/docker-compose.prod.yml`). |
| `.github/workflows/ci.yml` | Add a `publish` job (build both images; push to GHCR on `v*` tags; build-no-push on PRs; optional `:edge` on main) gated on `needs: [verify, compose-smoke]`. |
| `infra/env.production.example` | Add model-cache (`HF_HOME`), host UID/GID, multiplexer/herdr socket path, neutral-dir base, image tag vars; document the CLI-auth-mount tradeoff (or link the doc). |
| `docs/operations/dev-environment.md` | Document the prod stack, the §6 host-mount security tradeoff, the API-key-adapter-needs-nothing forward-compat, and the reboot-survival runbook. |

---

## Tasks

### Task 1: `transcriptGlobDir` gains an optional `homeBase` seam (behavior-preserving)

Spec §6 "The env/home wiring" + Open Risk #1. Today `transcriptGlobDir(provider, cwd)` uses `homedir()`. Add an optional 3rd `homeBase` param that, when provided, replaces `homedir()`; when omitted, behavior is identical (default-noop). This is the seam the bridge points at the mounted host HOME.

**Files:**
- Modify: `packages/ai/src/adapters/tmux-bridge.ts:75-97`
- Test: `tests/unit/transcript-home-base.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/transcript-home-base.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { transcriptGlobDir } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("transcriptGlobDir homeBase seam", () => {
  it("uses the provided homeBase instead of the OS home for anthropic", () => {
    const dir = transcriptGlobDir("anthropic", "/home/ben/Jarv1s/apps/worker", "/host-home");
    expect(dir).toBe("/host-home/.claude/projects/-home-ben-Jarv1s-apps-worker");
  });

  it("uses the provided homeBase for openai-compatible (codex sessions root)", () => {
    const dir = transcriptGlobDir("openai-compatible", "/tmp/neutral", "/host-home");
    expect(dir.startsWith("/host-home/.codex/sessions/")).toBe(true);
  });

  it("uses the provided homeBase for google", () => {
    const dir = transcriptGlobDir("google", "/tmp/neutral", "/host-home");
    expect(dir).toBe("/host-home/.gemini/tmp");
  });

  it("falls back to the OS home when homeBase is omitted (behavior-preserving)", () => {
    const dir = transcriptGlobDir("anthropic", "/home/ben/Jarv1s/apps/worker");
    expect(dir.endsWith("/.claude/projects/-home-ben-Jarv1s-apps-worker")).toBe(true);
    expect(dir).not.toContain("/host-home/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/transcript-home-base.test.ts`
Expected: FAIL — the three-arg calls ignore the 3rd argument, so `/host-home` does not appear.

- [ ] **Step 3: Write minimal implementation**

In `packages/ai/src/adapters/tmux-bridge.ts`, replace the `transcriptGlobDir` function (lines 75-97) with:

```ts
export function transcriptGlobDir(provider: ProviderKind, cwd: string, homeBase?: string): string {
  // homeBase lets the container point transcript resolution at a bind-mounted
  // host HOME (Phase 2 deployable-stack §6). Omitted → the OS home (unchanged).
  const home = homeBase ?? homedir();
  switch (provider) {
    case "anthropic": {
      // Claude Code encodes the project dir by replacing both "/" and "." with
      // "-", and KEEPS the leading "-" (an absolute path starts with "/").
      // e.g. /home/ben/Jarv1s/apps/worker -> -home-ben-Jarv1s-apps-worker
      const encoded = cwd.replace(/[/.]/g, "-");
      return join(home, ".claude", "projects", encoded);
    }
    case "openai-compatible": {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      return join(home, ".codex", "sessions", String(y), m, d);
    }
    case "google": {
      // Gemini uses a hash of the project dir; approximate by using a glob
      // under <home>/.gemini/tmp — in practice we find the newest chats file
      return join(home, ".gemini", "tmp");
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/transcript-home-base.test.ts tests/unit/ai-tmux-bridge.test.ts`
Expected: PASS (both the new seam test and the existing tmux-bridge regression suite stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/tmux-bridge.ts tests/unit/transcript-home-base.test.ts
git commit -m "feat(ai): add optional homeBase seam to transcriptGlobDir for host-mount bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `TmuxIo.run` gains an optional env/cwd options seam (behavior-preserving)

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

---

### Task 3: Thread `homeBase` through the live chat engine + runtime

Spec §6: `homeBase` must reach `transcriptGlobDir` from the engine. Add an optional `homeBase` to `TmuxCliChatEngineOpts`, use it in `launch()`, and have `runtime.ts` read `JARVIS_CLI_HOME_BASE` and pass it through the factory. Default-noop (no env → `homedir()` via the Task 1 fallback).

**Files:**
- Modify: `packages/chat/src/live/cli-chat-engine.ts:35-40,56-69,98-101`
- Modify: `packages/chat/src/live/runtime.ts:41-45`
- Test: `tests/unit/cli-chat-engine.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/cli-chat-engine.test.ts` (after the existing describe blocks):

```ts
describe("TmuxCliChatEngine — homeBase seam (#deployable-stack §6)", () => {
  it("resolves the transcript path under the provided homeBase", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("anthropic", "host-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath().startsWith("/host-home/.claude/projects/")).toBe(true);
  });

  it("falls back to the OS home when no homeBase is given", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("anthropic", "local-session", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath()).not.toContain("/host-home/");
    expect(engine.transcriptPath()).toContain("/.claude/projects/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts`
Expected: FAIL — `TmuxCliChatEngineOpts` has no `homeBase`, so the option is ignored and the path never starts with `/host-home`.

- [ ] **Step 3: Write minimal implementation**

In `packages/chat/src/live/cli-chat-engine.ts`:

Add `homeBase` to the options interface (lines 35-40):

```ts
export interface TmuxCliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
  /**
   * Base dir whose `.claude`/`.codex`/`.gemini` hold the CLI transcripts.
   * Set to the bind-mounted host HOME when running containerized (deployable-stack §6);
   * omitted → the OS home of the running process.
   */
  readonly homeBase?: string;
}
```

Add a private field + assign it in the constructor (within lines 47-69). Add the field declaration after `private readonly promptFile: string;`:

```ts
  /** Optional host-HOME base for transcript resolution (containerized bridge). */
  private readonly homeBase?: string;
```

And inside the constructor body (after the `this.promptFile = ...` line):

```ts
    this.homeBase = opts.homeBase;
```

In `launch()`, pass `homeBase` to `transcriptGlobDir` (lines 98-101):

```ts
    this.storedTranscriptPath = join(
      transcriptGlobDir(this.provider, opts.neutralDir, this.homeBase),
      `${sessionId}.jsonl`
    );
```

In `packages/chat/src/live/runtime.ts`, update `realEngineFactory` (lines 41-45) to read the env seam:

```ts
export type ChatEngineFactory = (provider: ProviderKind, sessionKey: string) => CliChatEngine;

/** The real engine factory: a persistent tmux-driven CLI session per live session. */
export const realEngineFactory: ChatEngineFactory = (provider, sessionKey) =>
  new TmuxCliChatEngine(provider, sessionKey, createRealTmuxIo(), {
    // Containerized deploys (deployable-stack §6) point this at the bind-mounted
    // host HOME so transcripts written by the host CLI are read back correctly.
    // Unset on a host install → the engine uses the OS home (unchanged).
    homeBase: process.env.JARVIS_CLI_HOME_BASE
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (engine tests green) and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/cli-chat-engine.ts packages/chat/src/live/runtime.ts tests/unit/cli-chat-engine.test.ts
git commit -m "feat(chat): thread homeBase through live engine + JARVIS_CLI_HOME_BASE

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
*.env
*.env.*
!infra/env.production.example
.DS_Store
*.log
```

- [ ] **Step 2: Verify it excludes secrets but keeps the example**

Run: `docker --version >/dev/null && printf '%s\n' "secrets.env exclude check"; grep -q '^\*\.env$' .dockerignore && grep -q '^!infra/env.production.example$' .dockerignore && echo OK`
Expected: prints `OK` (an actual `*.env` is excluded; the committed example is re-included so it is never the source of a leaked secret because it has no real values).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore for small, secret-free image context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: esbuild bundler script (`scripts/build-app.ts`) + migrate entrypoint

Spec §1 build stage + §2. Bundle each entrypoint (`apps/api/src/server.ts`, `apps/worker/src/worker.ts`, the migrate entry) into a single `dist/*.js` file resolving the `@jarv1s/*` workspace graph at build time, so runtime is plain `node dist/...`. esbuild is chosen over `tsc` because the repo links packages by tsconfig path aliases + `workspace:*` symlinks (spec §1, Open Risk #3). Native deps (`onnxruntime-node`, `sharp`) and `@huggingface/transformers` are marked external (they load native `.node` binaries at runtime and must come from the pruned `node_modules`, not be bundled).

**Files:**
- Create: `scripts/migrate-entry.ts`
- Create: `scripts/build-app.ts`
- Modify: `package.json:30` (scripts) + devDependencies

- [ ] **Step 1: Add esbuild + the build scripts to `package.json`**

In `package.json`, add to `devDependencies` (alphabetical, after `@types/pg`):

```json
    "esbuild": "^0.25.0",
```

Add to `scripts` (after the existing `"build:web"` line):

```json
    "build:api": "tsx scripts/build-app.ts api",
    "build:worker": "tsx scripts/build-app.ts worker",
    "build:migrate": "tsx scripts/build-app.ts migrate",
    "smoke:compose:prod": "tsx scripts/smoke-compose.ts --compose-file infra/docker-compose.prod.yml --build",
```

Run: `pnpm install`
Expected: esbuild installed; lockfile updated.

- [ ] **Step 2: Create the migrate entrypoint wrapper**

Create `scripts/migrate-entry.ts` (re-runs the existing idempotent migrate flow; kept thin so esbuild bundles the same code path the dev compose runs via `tsx scripts/migrate.ts`):

```ts
/**
 * Compiled migrate entrypoint for the production image (`node dist/migrate.js`).
 * Runs the SAME idempotent flow as `tsx scripts/migrate.ts` (bootstrap -> app +
 * module SQL -> pg-boss -> grants). It only RUNS the hash-checked runner; it adds
 * and edits no migration (Hard Invariant).
 */
import "./migrate.js";
```

- [ ] **Step 3: Write the failing test (build smoke)**

There is no unit test framework fit for "esbuild produced a runnable file"; assert it by running the build and checking the artifact exists and is plain JS. Create the assertion as a shell check (run in Step 5). First, create `scripts/build-app.ts`:

```ts
/**
 * esbuild bundler for the production image. Produces a single runnable file per
 * entrypoint under dist/, resolving the @jarv1s/* workspace graph at build time
 * so the runtime needs no tsx and no per-start pnpm install (deployable-stack §1/§2).
 *
 * Native deps that load .node binaries (onnxruntime-node, sharp) and the
 * transformers wrapper are kept EXTERNAL — they must be required from the pruned
 * production node_modules at runtime, never inlined (Open Risk #3/#6).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Target = "api" | "worker" | "migrate";

const ENTRYPOINTS: Record<Target, { entry: string; outfile: string }> = {
  api: { entry: "apps/api/src/server.ts", outfile: "dist/server.js" },
  worker: { entry: "apps/worker/src/worker.ts", outfile: "dist/worker.js" },
  migrate: { entry: "scripts/migrate-entry.ts", outfile: "dist/migrate.js" }
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
  // No/unknown arg -> build all three.
  for (const t of Object.keys(ENTRYPOINTS) as Target[]) {
    await buildTarget(t);
  }
}

await main();
```

- [ ] **Step 4: Build all three entrypoints and assert runnable artifacts**

Run:
```bash
pnpm build:api && pnpm build:worker && pnpm build:migrate && \
  node --check dist/server.js && node --check dist/worker.js && node --check dist/migrate.js && \
  ! grep -RIl "from \"tsx\"\|require('tsx')" dist/ && echo BUILD_OK
```
Expected: `built dist/server.js`, `built dist/worker.js`, `built dist/migrate.js`, then `BUILD_OK` — each artifact parses as valid Node ESM and contains no `tsx` import.

> If esbuild reports an unresolved `@jarv1s/*` import, the workspace symlink path is the cause: add a matching `alias` map in `build-app.ts` mirroring `tsconfig.json` `paths` (e.g. `{ "@jarv1s/db": resolve(root, "packages/db/src/index.ts") }`) and re-run. Do not switch to `tsc` — bundling is the chosen contract (spec §1).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/build-app.ts scripts/migrate-entry.ts
git commit -m "build: esbuild bundler for api/worker/migrate dist entrypoints

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

Spec §1 + AC#1. One image, three roles by command. deps → build → runtime; non-root `node` user; runtime carries only `dist/` + pruned production `node_modules` (incl. native binaries). Default `CMD` is the api; worker/migrate override `command` in Compose.

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Jarv1s app image (ghcr.io/motioneso/jarv1s-api) — deployable-stack §1.
# One multi-stage image runs api / worker / migrate, selected by the container
# command (node dist/server.js | dist/worker.js | dist/migrate.js).
# No tsx, no per-start pnpm install: runtime is plain node dist/...
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

# ---- build: compile entrypoints to dist/ ----------------------------------
FROM deps AS build
WORKDIR /app
RUN pnpm build:api && pnpm build:worker && pnpm build:migrate

# ---- prod-deps: prune to production node_modules --------------------------
FROM deps AS proddeps
WORKDIR /app
# Keep only production deps (the externals: transformers, onnxruntime-node, sharp,
# pg, kysely, pg-boss, fastify, helmet, rate-limit) for the runtime stage.
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: slim, non-root, dist + pruned node_modules only -------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Default cache location for the embedding model weights (§3); the prod Compose
# mounts a named volume here so weights survive restarts.
ENV HF_HOME=/app/.cache/huggingface
COPY --from=build /app/dist ./dist
COPY --from=proddeps /app/node_modules ./node_modules
# Native module dirs live under node_modules already; nothing else from source.
RUN mkdir -p "$HF_HOME" && chown -R node:node /app
USER node
EXPOSE 3000
# Default role is the api; worker/migrate override `command:` in Compose.
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Build the image (this is the build test)**

Run: `docker build -t jarv1s-api:plan-test -f Dockerfile .`
Expected: build succeeds through all stages; final image tagged `jarv1s-api:plan-test`.

- [ ] **Step 3: Assert no tsx, plain-node runtime, non-root**

Run:
```bash
docker run --rm jarv1s-api:plan-test sh -c 'node --check dist/server.js && node --check dist/worker.js && node --check dist/migrate.js && id -u && ! ls node_modules/.bin/tsx 2>/dev/null && echo RUNTIME_OK'
```
Expected: prints the non-root uid (not `0`) and `RUNTIME_OK` (all three entrypoints parse; `tsx` is absent from the runtime image).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: multi-stage app Dockerfile (api/worker/migrate, non-root, no tsx)

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
    command: ["node", "dist/migrate.js"]
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
      - ${JARVIS_HOST_HOME:-/home/ben}:/host-home:ro
      # Shared neutral-dir base: identical absolute path on host + container so
      # the host-spawned CLI cd's into the same dir the container computed (§6.3).
      - ${JARVIS_CHAT_HOME:-/home/ben/.jarvis/chat}:${JARVIS_CHAT_HOME:-/home/ben/.jarvis/chat}
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
      - ${JARVIS_HOST_HOME:-/home/ben}:/host-home:ro
      - ${JARVIS_CHAT_HOME:-/home/ben/.jarvis/chat}:${JARVIS_CHAT_HOME:-/home/ben/.jarvis/chat}
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
  grep -q 'restart: unless-stopped' infra/docker-compose.prod.yml && echo PROD_COMPOSE_OK
```
Expected: `config --quiet` exits 0 (valid); prints `PROD_COMPOSE_OK` — no `..:/workspace` source mount, Postgres is pgvector, migrate gates api/worker via `service_completed_successfully`, and `restart: unless-stopped` is present.

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
    expect(plan.commands.every((c) => c.args.includes("infra/docker-compose.yml"))).toBe(true);
    expect(plan.commands.some((c) => c.args.includes("build"))).toBe(false);
  });

  it("targets the prod compose file and prepends a build step when build is set", () => {
    const plan = createComposeSmokePlan({
      composeFile: "infra/docker-compose.prod.yml",
      build: true
    });
    expect(plan.commands.every((c) => c.args.includes("infra/docker-compose.prod.yml"))).toBe(true);
    const first = plan.commands[0];
    expect(first.args).toContain("build");
    expect(first.description.toLowerCase()).toContain("build");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/prod-compose-plan.test.ts`
Expected: FAIL — `createComposeSmokePlan` has no `build` option, so no build step is prepended.

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

  const buildCommands: ComposeSmokeCommand[] = input.build
    ? [
        {
          command: "docker",
          args: [...composeArgs, "build"],
          description: "Build prod compose images locally"
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

> `infra/env.production.local` is excluded by `.dockerignore` (`*.env*`) and must be in `.gitignore`. If `.gitignore` lacks it, add a line `infra/env.production.local` to `.gitignore` in this step and `git add .gitignore` in Step 4. The smoke uses `JARVIS_EMBED_PROVIDER=stub` so the worker does not download model weights during CI/smoke.

- [ ] **Step 2: Run the prod-compose smoke on a non-default port**

Run:
```bash
JARVIS_IMAGE_TAG=plan-test \
JARVIS_ENV_FILE=./infra/env.production.local \
JARVIS_API_PORT=3098 JARVIS_WEB_PORT=5181 \
JARVIS_TMUX_SOCKET_DIR=/tmp/tmux-$(id -u) JARVIS_HOST_HOME="$HOME" \
JARVIS_HOST_UID=$(id -u) JARVIS_HOST_GID=$(id -g) \
JARVIS_CHAT_HOME="$HOME/.jarvis/chat" \
pnpm smoke:compose:prod -- --api-port 3098
```
Expected: builds the prod images locally, brings postgres → migrate → api/web/worker up, then prints `Compose smoke passed: http://localhost:3098/health/ready` (the readiness probe asserts `{ ok:true, db:"ok", pgboss:"ok" }`).

> The prod compose builds `image:` references with no `build:` directive, so `docker compose build` would be a no-op. Before Step 2, tag the locally built images to match: `docker tag jarv1s-api:plan-test ghcr.io/motioneso/jarv1s-api:plan-test && docker tag jarv1s-web:plan-test ghcr.io/motioneso/jarv1s-web:plan-test`. (Tasks 7/8 already built `jarv1s-api:plan-test`/`jarv1s-web:plan-test`.) Run those two `docker tag` commands first.

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

- [ ] **Step 2: Append the `publish` job**

Append to the end of `.github/workflows/ci.yml` (after the `compose-smoke` job, keeping the top-level `permissions: contents: read` unchanged — the publish job sets its own job-scoped permissions):

```yaml

  publish:
    name: Build and publish images
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: [verify, compose-smoke]
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
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); j=d['jobs']['publish']; assert j['needs']==['verify','compose-smoke'], j['needs']; assert j['permissions']['packages']=='write'; print('CI_PUBLISH_OK')"
```
Expected: prints `CI_PUBLISH_OK` (valid YAML; the `publish` job has the correct `needs` gating and `packages: write` permission).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GHCR publish job (build on PR, push on v* tag + edge on main)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: systemd boot unit `infra/systemd/jarv1s-stack.service`

Spec §8 + AC#8. Mirror `jarv1s-backup.service` (`User=ben`, `WorkingDirectory`, `After/Requires docker.service`) but run `docker compose up -d` and be `WantedBy=multi-user.target` so it starts at every boot.

**Files:**
- Create: `infra/systemd/jarv1s-stack.service`

- [ ] **Step 1: Write the unit**

Create `infra/systemd/jarv1s-stack.service`:

```ini
[Unit]
Description=Jarv1s production stack (docker compose)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=ben
WorkingDirectory=/home/ben/Jarv1s
# Operator env file for JARVIS_* substitution in the prod Compose (image tag,
# host UID/GID, socket paths, secrets). The leading "-" tolerates absence.
EnvironmentFile=-/home/ben/Jarv1s/infra/env.production.local
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

Spec §3, §5, §6, §8 + AC#10. Add the new vars (model cache `HF_HOME`, host UID/GID, tmux/herdr socket path, host HOME, neutral-dir base, image tag, env-file path) and document the CLI-auth-mount tradeoff (or link the doc). No secret baked into any image — these are runtime env only.

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

# Host per-uid tmux socket dir, bind-mounted at the same path in the container so
# tmux derives the same socket from /tmp/tmux-$(id -u).
JARVIS_TMUX_SOCKET_DIR=/tmp/tmux-1000

# herdr socket path (if using herdr instead of tmux). Set this AND mount it; the
# reboot-survival probe checks it when present.
HERDR_SOCKET_PATH=

# Host operator HOME, bind-mounted read-only at /host-home in the container; its
# .claude/.codex/.gemini hold the CLI transcripts the engine reads back.
JARVIS_HOST_HOME=/home/ben

# Inside the container, transcript resolution + spawned multiplexer commands use
# this base (the mount point above). Keep it /host-home unless you remap.
JARVIS_CLI_HOME_BASE=/host-home

# Per-user neutral chat dir base. Mounted at the SAME absolute path on host and
# container so the host-spawned CLI cd's into the dir the container computed (§6.3).
JARVIS_CHAT_HOME=/home/ben/.jarvis/chat

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
`infra/docker-compose.yml`, which bind-mounts source and runs `tsx`). It runs three
images: one app image (`ghcr.io/motioneso/jarv1s-api`) used for api / worker / migrate
by command selection, and an nginx static-web image (`ghcr.io/motioneso/jarv1s-web`)
that serves the SPA and reverse-proxies `/api` + `/health` to the api — so the api keeps
its `default-src 'none'` CSP and never serves HTML.

**Deploy steps:**

```txt
cp infra/env.production.example infra/env.production.local   # off-git; fill secrets/UIDs/tag
# set JARVIS_IMAGE_TAG to a published version tag (never :edge/:latest)
docker compose -f infra/docker-compose.prod.yml up -d
# or, at boot: systemctl enable --now jarv1s-stack
```

Order: postgres (healthcheck) → migrate one-shot (`node dist/migrate.js`: bootstrap →
app+module SQL → pg-boss → grants; exits 0) → api+worker (gated on
`service_completed_successfully`) → web (gated on api healthy). Every long-running
service is `restart: unless-stopped`; the api keeps a `/health` HEALTHCHECK.

**Host prerequisites:** Docker + the compose plugin installed and the daemon running
(`jarv1s-stack.service` has `Requires=docker.service`). The embedding model downloads on
first use into the `jarv1s-model-cache` named volume (`HF_HOME=/app/.cache/huggingface`);
set `JARVIS_EMBED_PROVIDER=stub` to skip it.

## Host-multiplexer bridge (CLI chat from the container)

Live CLI chat drives `claude`/`codex`/`gemini` through a multiplexer (tmux/herdr) under
the operator's personal auth. Per ADR 0008 §2 we do NOT bundle the CLIs or a multiplexer
into the image — they are host-provisioned. Instead the api/worker container **steers the
host's** multiplexer and **reads the host's** transcripts through bind mounts (only on
api/worker):

1. **Multiplexer socket** — the host per-uid tmux socket dir (`/tmp/tmux-<uid>`, mode
   0700) or the herdr socket (`HERDR_SOCKET_PATH`) is bind-mounted at the same path; the
   tmux/herdr server runs on the host, so the CLIs execute on the host with host auth.
2. **Host CLI dirs** — the host HOME (`~/.claude`, `~/.codex`, `~/.gemini`) is bind-mounted
   read-only at `/host-home`; `JARVIS_CLI_HOME_BASE=/host-home` points transcript
   resolution (and the spawned multiplexer commands' env/cwd) at it.
3. **Neutral-dir alignment** — the per-user neutral dir base (`JARVIS_CHAT_HOME`) is
   mounted at the SAME absolute path on host and container so the host-spawned CLI `cd`s
   into the dir the container computed.

**UID mapping:** the container runs as `JARVIS_HOST_UID:JARVIS_HOST_GID` (the host operator
uid/gid) so it can open the 0700 socket and read the host HOME. If the uid does not match,
CLI chat silently breaks while REST stays green — the reboot-survival probe catches this.

**Security tradeoff (accepted, documented):** mounting the host CLI auth + multiplexer
socket means a container compromise can reach the operator's personal CLI credentials and
steer host sessions. This is accepted under the **single-operator household model**
(ADR 0007) — the same shared-uid soft boundary the CLI-adapter slice documents. It is
**opt-in**: present only when the CLI-subscription adapter is chosen. The **API-key adapter
needs NONE of these mounts** (it talks HTTP to a provider), so an API-key instance runs
with a strictly smaller attack surface.

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

  - §1 App image / AC#1 → Task 7 (Dockerfile), Task 5 (build scripts, `node dist/...`, no tsx).
  - §2 Build scripts → Task 5 (`build:api`/`build:worker`/`build:migrate`, esbuild).
  - §3 Worker runtime + model cache → Task 7 (`HF_HOME`, native binaries via `onlyBuiltDependencies`), Task 9 (`jarv1s-model-cache` volume), Task 15 (`HF_HOME` env).
  - §4 Static-web image / AC#2 → Task 8 (nginx Dockerfile + config, SPA fallback, api CSP preserved).
  - §5 Prod Compose / AC#3 → Task 9 (pinned tags, named volumes, restart, no source mounts, pgvector, migrate gating).
  - §6 Host-multiplexer bridge / AC#7 → Tasks 1-3 (homeBase + TmuxIo.run seams + engine threading), Task 9 (mounts + UID mapping), Task 15 (env), Task 16 (doc).
  - §7 CI publish / AC#5 → Task 12 (publish job, tags, gating, packages: write).
  - §8 Supervision + reboot survival / AC#8, AC#9 → Task 9 (`restart: unless-stopped`, HEALTHCHECK), Task 13 (systemd unit), Task 14 (reboot script).
  - §9 Graceful shutdown / AC#6 → Task 6 (SIGTERM/SIGINT handler + test).
  - AC#4 prod smoke green → Tasks 10-11.
  - AC#10 env example + no baked secret → Tasks 4, 15.
  - AC#11 verify:foundation / check:file-size / audit:release-hardening green, no new migration → Task 18.
  - AC#12 doc + epic link → Task 16 (doc; the epic-link is a human board action).

  List any gap. If found, add a task and implement it before Step 2.

- [ ] **Step 2: Placeholder scan** — search the changed files for red flags:

```bash
git diff --name-only origin/main...HEAD | grep -vE '\.md$' | xargs grep -nE 'TODO|FIXME|TBD|implement later|fill in|similar to above' 2>/dev/null || echo NO_PLACEHOLDERS
```
Expected: prints `NO_PLACEHOLDERS`. (Markdown plan/doc files are excluded — they legitimately discuss these words.)

- [ ] **Step 3: Type consistency** — confirm the names introduced earlier are used identically later:

  - `transcriptGlobDir(provider, cwd, homeBase?)` — Task 1 signature == Task 3 call site.
  - `TmuxIo.run(cmd, args, options?: { env?; cwd? })` — Task 2 interface == real impl.
  - `TmuxCliChatEngineOpts.homeBase` — Task 3 field name == `JARVIS_CLI_HOME_BASE` env read in `runtime.ts`.
  - `shutdownOnSignal(server, { timeoutMs?, exit? })` — Task 6 export == test usage == entrypoint call.
  - `createComposeSmokePlan({ composeFile?, build? })` — Task 10 input == test == `main()` thread-through.
  - `JARVIS_IMAGE_TAG`, `JARVIS_CLI_HOME_BASE`, `JARVIS_HOST_UID/GID`, `JARVIS_TMUX_SOCKET_DIR`, `JARVIS_HOST_HOME`, `JARVIS_CHAT_HOME`, `HF_HOME` — same spelling in Task 9 Compose, Task 15 env example, Task 16 doc.

  Run:
```bash
grep -rn "JARVIS_CLI_HOME_BASE" infra/docker-compose.prod.yml infra/env.production.example packages/chat/src/live/runtime.ts && \
  grep -rn "JARVIS_IMAGE_TAG" infra/docker-compose.prod.yml infra/env.production.example && echo NAMES_CONSISTENT
```
Expected: each name appears in every place listed; prints `NAMES_CONSISTENT`.

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
Expected: exit 0 — lint, format:check, check:file-size, typecheck, test:unit (incl. the new `transcript-home-base`, `tmux-io-run-options`, `cli-chat-engine`, `api-signal-shutdown`, `prod-compose-plan` tests), db:migrate, test:integration all pass. If `format:check` flags any new file, run `pnpm format`, re-stage, and amend the relevant commit.

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

- **Order matters.** Tasks 1-3 (engine seams) MUST land before Task 9's bridge mounts have anything to point at. Tasks 5/7/8 (build + images) MUST precede Tasks 10/11 (smoke). Do not reorder.
- **Docker availability.** Tasks 7, 8, 11, 12 (validation), 13 need a working Docker daemon. If Docker is unavailable in the build environment, complete the file authoring + the non-Docker assertions (YAML/shell/`config --quiet` where possible) and leave a clear note in the task's commit body that the Docker build step was deferred — do NOT mark the build-test step PASS without running it.
- **Shared tree discipline.** Stage only explicit paths per commit (every task already does this). Never `git add -A`. Never `git checkout`/`reset`/`stash` the shared tree.
- **Secrets.** `infra/env.production.local` is a local smoke artifact only — it must be gitignored and never committed (Task 11). No secret value ever enters `infra/env.production.example` or any image layer.
- **No code outside the planned files.** Every change is enumerated in the File Structure table.
