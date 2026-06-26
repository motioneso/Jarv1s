// Cross-module port (#484): Wellness selective export reuses the data_export_jobs table +
// the settings-owned DataExportRepository as infrastructure for its async job.
//
// This file is the sanctioned re-export point so @jarv1s/wellness depends on a declared
// public API surface (not settings internals). DataExportRepository is already exported
// from @jarv1s/settings's index (settings is a shared-infrastructure module, like vault),
// so this just names that dependency at the import site for clarity.

export { DataExportRepository } from "@jarv1s/settings";
