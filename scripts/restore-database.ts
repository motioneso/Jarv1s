import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getJarvisDatabaseUrls } from "@jarv1s/db";

export interface RestorePlanInput {
  readonly backupFile: string;
  readonly confirmRestore?: boolean;
  readonly connectionString?: string;
  readonly execute?: boolean;
}

export interface RestorePlan {
  readonly args: readonly string[];
  readonly backupFile: string;
  readonly command: "pg_restore";
  readonly env: Readonly<Record<"PGPASSWORD", string>>;
  readonly execute: boolean;
}

export function createRestorePlan(input: RestorePlanInput): RestorePlan {
  if (!input.backupFile) {
    throw new Error("Restore backup file is required");
  }
  if (input.execute && !input.confirmRestore) {
    throw new Error("Restore execution requires --confirm-restore");
  }

  const url = new URL(input.connectionString ?? getJarvisDatabaseUrls().bootstrap);
  const database = url.pathname.replace(/^\//, "");

  if (!database) {
    throw new Error("Restore database URL must include a database name");
  }

  return {
    command: "pg_restore",
    args: [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      decodeURIComponent(url.username),
      "--dbname",
      database,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      input.backupFile
    ],
    backupFile: input.backupFile,
    env: {
      PGPASSWORD: decodeURIComponent(url.password)
    },
    execute: input.execute ?? false
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const plan = createRestorePlan(args);

  if (!plan.execute) {
    console.log("Restore drill plan only. Add --execute --confirm-restore to run pg_restore.");
    console.log(`${plan.command} ${plan.args.join(" ")}`);
    return;
  }

  await access(plan.backupFile);
  console.log(`Restoring database from sensitive backup ${plan.backupFile}`);
  await runCommand(plan.command, plan.args, plan.env);
  console.log(`Restore complete from ${plan.backupFile}`);
}

function parseArgs(args: readonly string[]): RestorePlanInput {
  return {
    backupFile: readRequiredFlag(args, "--input"),
    confirmRestore: args.includes("--confirm-restore"),
    execute: args.includes("--execute")
  };
}

function readRequiredFlag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);

  if (index === -1) {
    throw new Error(
      `Usage: pnpm restore:db -- --input <backup.dump> [--execute --confirm-restore]`
    );
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
