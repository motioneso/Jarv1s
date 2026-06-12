import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertUniqueMigrationVersions,
  getJarvisDatabaseUrls,
  loadMigrationFiles,
  runSqlFiles,
  runSqlMigrations
} from "@jarv1s/db";
import { migratePgBoss } from "@jarv1s/jobs";
import { getAllQueueDefinitions, getBuiltInSqlMigrationDirectories } from "@jarv1s/module-registry";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const urls = getJarvisDatabaseUrls();

const bootstrapDirectory = join(root, "infra/postgres/bootstrap");
const migrationsDirectory = join(root, "infra/postgres/migrations");
const grantsDirectory = join(root, "infra/postgres/grants");

await runSqlFiles(urls.bootstrap, bootstrapDirectory);

const allMigrationDirectories = [migrationsDirectory, ...getBuiltInSqlMigrationDirectories()];
const allMigrationFiles = (
  await Promise.all(allMigrationDirectories.map((dir) => loadMigrationFiles(dir)))
).flat();
assertUniqueMigrationVersions(allMigrationFiles);

const migrationResults = [
  await runSqlMigrations({
    connectionString: urls.migration,
    migrationsDirectory
  })
];

for (const moduleMigrationsDirectory of getBuiltInSqlMigrationDirectories()) {
  migrationResults.push(
    await runSqlMigrations({
      connectionString: urls.migration,
      migrationsDirectory: moduleMigrationsDirectory
    })
  );
}

await migratePgBoss(urls.migration, getAllQueueDefinitions());
await runSqlFiles(urls.migration, grantsDirectory);

const applied = migrationResults.flatMap((result) => result.applied);
const skipped = migrationResults.flatMap((result) => result.skipped);

for (const migration of applied) {
  console.log(`applied ${migration.name}`);
}

if (applied.length === 0) {
  console.log(`no SQL migrations applied; ${skipped.length} already current`);
}

console.log("pg-boss schema, queues, and runtime grants are current");
