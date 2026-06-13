import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ComposeSmokePlanInput {
  readonly apiPort?: string;
  readonly composeFile?: string;
  /** Build the compose images locally before bringing the stack up (prod variant). */
  readonly build?: boolean;
}

export interface ComposeSmokeCommand {
  readonly args: readonly string[];
  readonly command: "docker";
  readonly description: string;
}

export interface ComposeSmokePlan {
  readonly commands: readonly ComposeSmokeCommand[];
  readonly healthUrl: string;
}

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
          args: [
            "build",
            "-t",
            `ghcr.io/motioneso/jarv1s-api:${imageTag}`,
            "-f",
            "Dockerfile",
            "."
          ],
          description:
            "Build the app (api/worker/migrate) image locally and tag it to the prod GHCR ref"
        },
        {
          command: "docker",
          args: [
            "build",
            "-t",
            `ghcr.io/motioneso/jarv1s-web:${imageTag}`,
            "-f",
            "apps/web/Dockerfile",
            "."
          ],
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = createComposeSmokePlan({
    apiPort: args.apiPort,
    composeFile: args.composeFile,
    build: args.build
  });

  for (const command of plan.commands) {
    console.log(command.description);
    await runCommand(command.command, command.args);
  }

  await waitForHealth(plan.healthUrl);
  console.log(`Compose smoke passed: ${plan.healthUrl}`);
}

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

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function runCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
    });
  });
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = (await response.json()) as {
          readonly ok?: unknown;
          readonly db?: unknown;
          readonly pgboss?: unknown;
        };
        // The readiness probe only returns ok:true when DB and pg-boss are both
        // reachable; assert the component fields too so a future payload change
        // can't let a DB-down server slip through the smoke (#171).
        if (body.ok === true && body.db === "ok" && body.pgboss === "ok") {
          return;
        }
        lastError = new Error(
          `readiness not satisfied: ${JSON.stringify({ db: body.db, pgboss: body.pgboss })}`
        );
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError ?? "health check failed")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
