import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const STRUCTURED_STATE_MODULE_ID = "structured-state";
export const structuredStateSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const structuredStateModuleManifest: JarvisModuleManifest = {
  id: STRUCTURED_STATE_MODULE_ID,
  name: "Structured State",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true
  },
  database: {
    migrations: ["sql/0031_structured_state.sql"],
    migrationDirectories: ["packages/structured-state/sql"],
    ownedTables: ["app.commitments", "app.entities", "app.preferences"]
  },
  shareableResources: [
    { resourceType: "commitment", grantLevels: ["view", "contribute", "manage"] },
    { resourceType: "entity", grantLevels: ["view", "contribute", "manage"] }
  ]
};
