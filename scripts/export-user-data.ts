import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";

import { exportUserData as exportUserDataDomain } from "../packages/settings/src/data-export.js";

export interface LegacyExportUserDataOptions {
  appConnectionString: string;
  userId: string;
  exportedAt?: Date;
}

export async function exportUserData(options: LegacyExportUserDataOptions) {
  const urls = getJarvisDatabaseUrls();
  const appDb = createDatabase({
    connectionString: options.appConnectionString,
    maxConnections: 1
  });
  const authDb = createDatabase({
    connectionString: urls.auth,
    maxConnections: 1
  });

  try {
    const dataContext = new DataContextRunner(appDb);
    const exportedAt = options.exportedAt ?? new Date();

    const userExport = await dataContext.withDataContext(
      { actorUserId: options.userId, requestId: "export" },
      async (scopedDb) =>
        exportUserDataDomain({
          scopedDb,
          authDb,
          userId: options.userId,
          exportedAt
        })
    );
    return userExport;
  } finally {
    await appDb.destroy();
    await authDb.destroy();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const userId = args.userId;
  if (!userId) {
    throw new Error("Usage: pnpm export:user -- --user-id <uuid> [--output exports/user.json]");
  }

  const exportedAt = new Date();
  const urls = getJarvisDatabaseUrls();
  const userExport = await exportUserData({
    appConnectionString: urls.app,
    userId,
    exportedAt
  });

  const outputFile = args.output ?? defaultExportFile(userId, exportedAt);

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(userExport, null, 2)}\n`, "utf8");
  console.log(`Wrote sensitive user export to ${outputFile}`);
}

function defaultExportFile(userId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `exports/jarv1s-user-${userId}-${stamp}.json`;
}

function parseArgs(args: readonly string[]): {
  readonly output?: string;
  readonly userId?: string;
} {
  return {
    output: readFlag(args, "--output"),
    userId: readFlag(args, "--user-id")
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
