import { fileURLToPath } from "node:url";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  commitmentListExecute,
  commitmentGetExecute,
  commitmentAcceptExecute,
  commitmentRejectExecute,
  commitmentSnoozeExecute
} from "./tools.js";

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
  // #996/#860: Commitments (and People/Goals) moved from user-toggleable to required —
  // spec 2026-07-12-module-management-admin-ux.md decided core productivity modules
  // should never be turned off; only Wellness/Sports/News stay user-toggleable.
  lifecycle: "required",
  availability: { defaultEnabled: true, required: true },
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
    {
      method: "PATCH",
      path: "/api/commitments/candidates/:id/status",
      permissionId: "commitments.update"
    },
    {
      method: "POST",
      path: "/api/commitments/candidates/:id/resolve",
      permissionId: "commitments.update"
    },
    {
      method: "POST",
      path: "/api/commitments/candidates/:id/suppress",
      permissionId: "commitments.update"
    },
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
  assistantTools: [
    {
      name: "commitments.list",
      description: "List commitment candidates extracted from your chats, notes, and email.",
      permissionId: "commitments.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: [
              "pending_review",
              "accepted",
              "rejected",
              "snoozed",
              "expired",
              "explicit_non_action"
            ]
          }
        }
      },
      execute: commitmentListExecute
    },
    {
      name: "commitments.get",
      description: "Get details and evidence for a specific commitment candidate.",
      permissionId: "commitments.view",
      risk: "read",
      inputSchema: {
        type: "object",
        required: ["candidateId"],
        properties: { candidateId: { type: "string" } }
      },
      execute: commitmentGetExecute
    },
    {
      name: "commitments.accept",
      description: "Accept a commitment candidate as a real commitment.",
      permissionId: "commitments.update",
      risk: "write",
      actionFamilyId: "commitment_review",
      inputSchema: {
        type: "object",
        required: ["candidateId"],
        properties: { candidateId: { type: "string" } }
      },
      execute: commitmentAcceptExecute
    },
    {
      name: "commitments.reject",
      description: "Reject a commitment candidate as not a real commitment.",
      permissionId: "commitments.update",
      risk: "write",
      actionFamilyId: "commitment_review",
      inputSchema: {
        type: "object",
        required: ["candidateId"],
        properties: { candidateId: { type: "string" } }
      },
      execute: commitmentRejectExecute
    },
    {
      name: "commitments.snooze",
      description: "Snooze a commitment candidate until a later date.",
      permissionId: "commitments.update",
      risk: "write",
      actionFamilyId: "commitment_review",
      inputSchema: {
        type: "object",
        required: ["candidateId", "snoozedUntil"],
        properties: {
          candidateId: { type: "string" },
          snoozedUntil: { type: "string", format: "date-time" }
        }
      },
      execute: commitmentSnoozeExecute
    }
  ]
};
