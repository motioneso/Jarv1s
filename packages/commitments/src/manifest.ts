import { fileURLToPath } from "node:url";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const COMMITMENTS_MODULE_ID = "jarvis.commitments";
export const COMMITMENT_EXTRACTION_QUEUE = "commitment-extraction";

export const commitmentsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const commitmentsModuleManifest: JarvisModuleManifest = {
  id: COMMITMENTS_MODULE_ID,
  name: "Commitments",
  publisher: "jarv1s",
  version: "1.0.0",
  lifecycle: "user-toggleable",
  availability: { defaultEnabled: true },
  compatibility: { jarv1s: ">=0.0.0" },
  database: {
    migrations: ["0125_commitment_candidates.sql"],
    ownedTables: [
      "app.commitment_candidates",
      "app.commitment_candidate_sources",
      "app.commitment_candidate_events",
      "app.commitment_extraction_state"
    ]
  },
  routes: [
    { method: "GET", path: "/api/commitments/candidates", permissionId: "commitments.view" },
    { method: "GET", path: "/api/commitments/candidates/:id", permissionId: "commitments.view" },
    { method: "PATCH", path: "/api/commitments/candidates/:id/status", permissionId: "commitments.update" },
    { method: "POST", path: "/api/commitments/candidates/:id/resolve", permissionId: "commitments.update" },
    { method: "POST", path: "/api/commitments/candidates/:id/suppress", permissionId: "commitments.update" },
    { method: "POST", path: "/api/commitments/extract", permissionId: "commitments.extract" },
    { method: "GET", path: "/api/commitments/extraction-state", permissionId: "commitments.view" }
  ],
  jobs: [{ queueName: COMMITMENT_EXTRACTION_QUEUE, metadataOnly: true }],
  assistantActionFamilies: [
    {
      id: "commitment_review",
      label: "Commitment review",
      description: "Accept, reject, or snooze commitment candidates extracted from your messages.",
      defaultTier: "ask_each_time",
      allowedTiers: ["ask_each_time", "trusted_auto"]
    }
  ],
  assistantTools: []
};
