import { afterAll, beforeAll } from "vitest";
import { featureGrantsPrefKey, runGoogleSync, runGoogleSyncChunk } from "@moss/connectors";
import { CalendarRepository, isCalendarFollowThroughEvent } from "@moss/calendar";
import { EmailRepository } from "@moss/email";
import { PreferencesRepository } from "@moss/structured-state";
import { ids } from "../test-database.js";
import {
  seedGoogleAccount,
  setupGoogleSyncDatabase,
  teardownGoogleSyncDatabase,
  type GoogleSyncDatabaseHandles
} from "./google-sync-shared.js";

export let handles: GoogleSyncDatabaseHandles;

beforeAll(async () => {
  handles = await setupGoogleSyncDatabase();
});

afterAll(async () => {
  await teardownGoogleSyncDatabase(handles);
});

export {
  CalendarRepository,
  EmailRepository,
  PreferencesRepository,
  featureGrantsPrefKey,
  ids,
  isCalendarFollowThroughEvent,
  runGoogleSync,
  runGoogleSyncChunk,
  seedGoogleAccount
};
