import { afterAll, beforeAll } from "vitest";
import { featureGrantsPrefKey, runGoogleSync } from "@jarv1s/connectors";
import { CalendarRepository, isCalendarFollowThroughEvent } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { PreferencesRepository } from "@jarv1s/structured-state";
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
  seedGoogleAccount
};
