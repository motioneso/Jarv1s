import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const proactiveMonitoringSqlMigrationDirectory = fileURLToPath(
  new URL("./sql", import.meta.url)
);

export const proactiveMonitoringModuleManifest = {
  id: "proactive-monitoring",
  name: "Proactive Monitoring",
  version: "0.0.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: {
    defaultEnabled: true,
    required: true
  },
  database: {
    migrations: [],
    migrationDirectories: [proactiveMonitoringSqlMigrationDirectory],
    ownedTables: ["app.proactive_monitor_state", "app.proactive_cards"]
  },
  permissions: [
    {
      id: "proactive-monitoring.view",
      label: "View proactive cards",
      description: "Read proactive monitoring cards.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "proactive-monitoring.refresh",
      label: "Refresh proactive scan",
      description: "Trigger a proactive monitoring scan.",
      scope: "user",
      actions: ["create"]
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/me/proactive-cards",
      permissionId: "proactive-monitoring.view"
    },
    {
      method: "POST",
      path: "/api/me/proactive-cards/refresh",
      permissionId: "proactive-monitoring.refresh"
    }
  ]
} satisfies JarvisModuleManifest;
