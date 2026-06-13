import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const WELLNESS_MODULE_ID = "wellness";
export const WELLNESS_MEDICATION_REMINDER_QUEUE = "wellness-medication-reminder";
export const wellnessModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const wellnessModuleManifest = {
  id: WELLNESS_MODULE_ID,
  name: "Wellness",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "user-toggleable",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: false,
    supportsUserDisable: true
  }
} satisfies JarvisModuleManifest;
