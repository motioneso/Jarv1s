export {
  notesModuleManifest,
  notesModuleSqlMigrationDirectory,
  NOTES_MODULE_ID,
  NOTES_SYNC_QUEUE
} from "./manifest.js";
export { NotesPathError, assertWithinRoot } from "./path-guard.js";
export {
  NOTES_QUEUE_DEFINITIONS,
  handleNotesSyncJob,
  registerNotesJobWorkers,
  type NotesSyncJobPayload,
  type NotesSyncJobResult
} from "./jobs.js";
export { registerNotesSyncRoutes } from "./notes-sync-routes.js";
