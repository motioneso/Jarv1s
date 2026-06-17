import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { getJarvisDatabaseUrls } from "@jarv1s/db";

const POSTGRES_CONTAINER = "jarv1s-postgres";

export interface BackupPlanInput {
  readonly connectionString?: string;
  readonly now?: Date;
  readonly outputFile?: string;
}

export interface BackupPlan {
  readonly dockerArgs: readonly string[];
  readonly dockerCommand: "docker";
  readonly env: Readonly<Record<"PGPASSWORD", string>>;
  readonly outputFile: string;
}

export function createBackupPlan(input: BackupPlanInput = {}): BackupPlan {
  const url = new URL(input.connectionString ?? getJarvisDatabaseUrls().bootstrap);
  const outputFile = input.outputFile ?? defaultBackupFile(input.now ?? new Date());
  const database = url.pathname.replace(/^\//, "");
  const username = decodeURIComponent(url.username);

  if (!database) {
    throw new Error("Backup database URL must include a database name");
  }
  if (!username) {
    throw new Error("Backup database URL must include a username");
  }

  const dockerPgDumpArgs = [
    "--username",
    username,
    "--dbname",
    database,
    "--format=custom",
    "--no-owner",
    "--no-privileges"
  ];

  return {
    dockerCommand: "docker",
    dockerArgs: [
      "exec",
      "-i",
      "--env",
      "PGPASSWORD",
      POSTGRES_CONTAINER,
      "pg_dump",
      ...dockerPgDumpArgs
    ],
    env: {
      PGPASSWORD: decodeURIComponent(url.password)
    },
    outputFile
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = createBackupPlan({
    outputFile: args.output
  });

  await mkdir(dirname(plan.outputFile), { recursive: true });
  console.log(`Writing sensitive database backup to ${plan.outputFile}`);
  await runCommandToFile(plan.dockerCommand, plan.dockerArgs, plan.env, plan.outputFile);
  console.log(`Backup complete: ${plan.outputFile}`);
}

function defaultBackupFile(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `backups/jarv1s-${stamp}.dump`;
}

function parseArgs(args: readonly string[]): { readonly output?: string } {
  const output = readFlag(args, "--output");

  return output === undefined ? {} : { output };
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

async function runCommandToFile(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  outputFile: string
): Promise<void> {
  const child = spawn(command, [...args], {
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "inherit"]
  });

  if (!child.stdout) {
    throw new Error(`${command} did not expose stdout for backup output`);
  }

  const exit = new Promise<void>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
    });
  });

  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(outputFile)), exit]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
