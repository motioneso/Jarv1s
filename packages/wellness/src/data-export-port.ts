// Cross-module port (#484): Wellness selective export reuses the data_export_jobs table +
// the settings-owned DataExportRepository as infrastructure for its async job.
//
// This file is the sanctioned re-export point so @moss/wellness depends on a declared
// public API surface (not settings internals). DataExportRepository is already exported
// from @moss/settings's index (settings is a shared-infrastructure module, like vault),
// so this just names that dependency at the import site for clarity.

export { DataExportRepository } from "@moss/settings";
