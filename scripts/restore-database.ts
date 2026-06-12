import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getJarvisDatabaseUrls } from "@jarv1s/db";

export interface RestorePlanInput {
  readonly backupFile: string;
  readonly confirmDatabase?: string;
  readonly confirmRestore?: boolean;
  readonly connectionString?: string;
  readonly execute?: boolean;
}

export interface RestorePlan {
  readonly args: readonly string[];
  readonly backupFile: string;
  readonly command: "pg_restore";
  readonly database: string;
  readonly env: Readonly<Record<"PGPASSWORD", string>>;
  readonly execute: boolean;
  readonly host: string;
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
  const username = decodeURIComponent(url.username);

  if (!database) {
    throw new Error("Restore database URL must include a database name");
  }
  if (!username) {
    throw new Error("Restore database URL must include a username");
  }

  // `--clean --if-exists` drops and recreates objects in the target database, so a
  // mistargeted connection string is destructive. Mirror the confirmUserId guard in
  // delete-user-data.ts: the operator must name the exact database back to us before
  // we will execute against it.
  if (input.execute && input.confirmDatabase !== database) {
    throw new Error(
      `Restore execution requires --confirm-database to match the target database "${database}" ` +
        `on host "${url.hostname}"`
    );
  }

  return {
    command: "pg_restore",
    args: [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      username,
      "--dbname",
      database,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      input.backupFile
    ],
    backupFile: input.backupFile,
    database,
    host: url.hostname,
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
    console.log(`Restore target: database "${plan.database}" on host "${plan.host}".`);
    console.log(
      "Restore drill plan only. Add --execute --confirm-restore " +
        `--confirm-database ${plan.database} to run pg_restore.`
    );
    console.log(`${plan.command} ${plan.args.join(" ")}`);
    return;
  }

  await access(plan.backupFile);
  console.log(
    `Restoring database "${plan.database}" on host "${plan.host}" from sensitive backup ${plan.backupFile}`
  );
  await runCommand(plan.command, plan.args, plan.env);
  console.log(`Restore complete from ${plan.backupFile}`);
}

function parseArgs(args: readonly string[]): RestorePlanInput {
  return {
    backupFile: readRequiredFlag(args, "--input"),
    confirmDatabase: readOptionalFlag(args, "--confirm-database"),
    confirmRestore: args.includes("--confirm-restore"),
    execute: args.includes("--execute")
  };
}

function readOptionalFlag(args: readonly string[], name: string): string | undefined {
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
