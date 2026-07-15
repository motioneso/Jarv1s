import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import type { HerdrInstallDependencies } from "@jarv1s/settings";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const INSTALL_SCRIPT_PATH = join(REPO_ROOT, "scripts", "install-herdr.sh");
const INSTALL_TIMEOUT_MS = 60_000;

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
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        execFileAsync("bash", [INSTALL_SCRIPT_PATH]),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("herdr install timed out")),
            INSTALL_TIMEOUT_MS
          );
        })
      ]);
      return { ok: true, timedOut: false };
    } catch (error) {
      const timedOut = (error as Error).message === "herdr install timed out";
      // Never log error.message/stdout/stderr here — may echo script output.
      server.log.error({ timedOut }, "herdr install failed (#993)");
      return { ok: false, timedOut };
    } finally {
      if (timer) clearTimeout(timer);
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
