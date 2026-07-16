import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import type { HerdrInstallDependencies } from "@jarv1s/settings";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * #1088 F1 — resolve the repo root by walking UP to the nearest `pnpm-workspace.yaml`
 * marker, NOT a fixed `MODULE_DIR/../../..` offset. This file is bundled into the prod
 * api by esbuild (scripts/build-app.ts, entry apps/api/src/server.ts), which COLLAPSES
 * `import.meta.url` to the bundle's own location (`dist/server.js`) — the #357
 * bundled-path-resolution trap. A fixed 3-level-up offset from `dist/` resolves outside
 * the repo entirely, so `INSTALL_SCRIPT_PATH` pointed at a nonexistent path in every prod
 * image and the install route failed on every real invocation (tsx/unit runs never
 * bundle, so #993's own tests never caught it). Same fix, same shape, as
 * packages/cli-runner/src/catalog.ts's `findRepoRoot` and
 * packages/module-registry/src/resolve-modules-dir.ts's `resolveModulesDir`: walk from
 * this module's own dir (correct from src via tsx, from the bundle, and from the prod
 * image whose WORKDIR is the repo root copy) to the workspace marker, then `/app`, then
 * cwd. Exported for the regression test (tests/unit/herdr-install-port-path.test.ts).
 */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(join("/app", "pnpm-workspace.yaml"))) return "/app";
  return process.cwd();
}

const REPO_ROOT = findRepoRoot(MODULE_DIR);
const INSTALL_SCRIPT_PATH = join(REPO_ROOT, "scripts", "install-herdr.sh");
const INSTALL_TIMEOUT_MS = 60_000;
// #1088 F2 — grace period between the polite SIGTERM and the unconditional SIGKILL.
const SIGKILL_GRACE_MS = 5_000;

/**
 * #993 — fixed, non-shell, argument-free Herdr install executor. Runs ONLY
 * scripts/install-herdr.sh via execFile (argv array, never a shell string) —
 * no request can ever supply a command, path, or argument. Single-flight:
 * concurrent callers await the same in-flight run. The lock is process-local;
 * a database advisory lock would be needed if API replicas are introduced.
 */
export function createHerdrInstallPort(
  server: Pick<FastifyInstance, "log">
): HerdrInstallDependencies {
  let installInFlight: Promise<{ ok: boolean; timedOut: boolean }> | null = null;

  async function runInstall(): Promise<{ ok: boolean; timedOut: boolean }> {
    let timedOut = false;
    try {
      await new Promise<void>((resolve, reject) => {
        let killTimer: NodeJS.Timeout | undefined;

        const child = execFile("bash", [INSTALL_SCRIPT_PATH], (error) => {
          // Once the timeout path has fired the promise is already settled (rejected);
          // this callback still runs later when the killed process actually exits, but
          // must not resolve/reject a second time.
          if (timedOut) return;
          clearTimeout(timeoutTimer);
          if (error) reject(error);
          else resolve();
        });

        // #1088 F2: previously the timeout path only rejected the race promise and left
        // the spawned bash (and whatever install-herdr.sh itself execs — curl, npm
        // install, etc.) running as an orphaned child forever. Kill the REAL child:
        // SIGTERM first, escalate to SIGKILL after a grace period for a process that
        // ignores the polite signal. child.kill() targets only this one process — never
        // a shell string, matching #993's no-shell-string invariant.
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => child.kill("SIGKILL"), SIGKILL_GRACE_MS);
          reject(new Error("herdr install timed out"));
        }, INSTALL_TIMEOUT_MS);

        // Clears the pending SIGKILL if the child actually exits once SIGTERM'd.
        child.once("exit", () => {
          if (killTimer) clearTimeout(killTimer);
        });
      });
      return { ok: true, timedOut: false };
    } catch (error) {
      timedOut = (error as Error).message === "herdr install timed out";
      // Never log error.message/stdout/stderr here — may echo script output.
      server.log.error({ timedOut }, "herdr install failed (#993)");
      return { ok: false, timedOut };
    }
  }

  return {
    install: async () => {
      if (!installInFlight) {
        installInFlight = runInstall().finally(() => {
          installInFlight = null;
        });
      }
      return installInFlight;
    }
  };
}

/**
 * #993 — resolves the herdrInstall dependency for server.ts wiring: the TEST-ONLY
 * options.installHerdr override when present, else the real fixed-script executor.
 * Factored out (matching the module-distribution precedent) to keep server.ts under
 * the 1000-line file-size cap.
 */
export function resolveHerdrInstall(
  server: Pick<FastifyInstance, "log">,
  options: { readonly installHerdr?: HerdrInstallDependencies["install"] }
): HerdrInstallDependencies {
  return options.installHerdr ? { install: options.installHerdr } : createHerdrInstallPort(server);
}
