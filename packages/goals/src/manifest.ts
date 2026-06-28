import { fileURLToPath } from "node:url";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const GOALS_MODULE_ID = "jarvis.goals";

export const GOALS_MEMORY_SYNC_QUEUE = "goals-memory-sync";
export const GOALS_MEMORY_SYNC_RECONCILE_QUEUE = "goals-memory-sync-reconcile";

export const goalsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const goalsModuleManifest: JarvisModuleManifest = {
  id: GOALS_MODULE_ID,
  name: "Goals",
  publisher: "jarv1s",
  version: "1.0.0",
  lifecycle: "user-toggleable",
  compatibility: { jarv1s: ">=1.0.0" },
  routes: [
    { method: "GET", path: "/api/goals", permissionId: "goals.view" },
    { method: "POST", path: "/api/goals", permissionId: "goals.create" },
    { method: "GET", path: "/api/goals/:id", permissionId: "goals.view" },
    { method: "PATCH", path: "/api/goals/:id", permissionId: "goals.update" },
    { method: "POST", path: "/api/goals/:id/evidence", permissionId: "goals.update" }
  ]
};
