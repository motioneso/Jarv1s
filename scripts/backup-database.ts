import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getJarvisDatabaseUrls } from "@jarv1s/db";

export interface BackupPlanInput {
  readonly connectionString?: string;
  readonly now?: Date;
  readonly outputFile?: string;
}

export interface BackupPlan {
  readonly args: readonly string[];
  readonly command: "pg_dump";
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

  return {
    command: "pg_dump",
    args: [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      username,
      "--dbname",
      database,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      outputFile
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
  await runCommand(plan.command, plan.args, plan.env);
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

function runCommand(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      env: {
        ...process.env,
        ...env
      },
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
