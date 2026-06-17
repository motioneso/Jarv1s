import type { Page, Route } from "@playwright/test";
import type { CalendarEventDto, EmailMessageDto, GoogleSyncResponse } from "@jarv1s/shared";

/**
 * REST mocks for the Phase 3 connector-sync Calendar + Email pages and the
 * on-demand `POST /api/connectors/google/sync` route. Mirrors the shape of
 * `mock-connectors-api.ts`: a small mutable state object plus a registrar.
 *
 * `mockApi` already serves `GET /api/calendar/events` and `GET /api/email/messages`
 * from its own state, but it does NOT mock the sync POST — and the H4 spec needs
 * a self-contained mock that (a) returns the FULL googleSyncResponseSchema contract
 * `{ enqueued, deduped, jobId }` (all three are `required`) and (b) records that the
 * sync was actually POSTed so the spec can assert it fired and the list refetched.
 */
export interface MockCalendarEmailApiState {
  calendarEvents: CalendarEventDto[];
  emailMessages: EmailMessageDto[];
  /** Number of times `POST /api/connectors/google/sync` has been called. */
  syncCallCount: number;
  /** The 202 response body returned by the sync route. */
  syncResponse: GoogleSyncResponse;
}

export function createMockCalendarEmailState(
  overrides: Partial<MockCalendarEmailApiState> = {}
): MockCalendarEmailApiState {
  return {
    calendarEvents: [],
    emailMessages: [],
    syncCallCount: 0,
    syncResponse: { enqueued: true, deduped: false, jobId: "job-e2e" },
    ...overrides
  };
}

export async function registerMockCalendarEmailRoutes(
  page: Page,
  state: MockCalendarEmailApiState
): Promise<void> {
  await page.route("**/api/calendar/events", (route) => handleCalendarEventsRoute(route, state));
  await page.route("**/api/email/messages", (route) => handleEmailMessagesRoute(route, state));
  await page.route("**/api/connectors/google/sync", (route) => handleGoogleSyncRoute(route, state));
}

async function handleCalendarEventsRoute(
  route: Route,
  state: MockCalendarEmailApiState
): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }
  return fulfillJson(route, 200, { events: state.calendarEvents });
}

async function handleEmailMessagesRoute(
  route: Route,
  state: MockCalendarEmailApiState
): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }
  return fulfillJson(route, 200, { messages: state.emailMessages });
}

async function handleGoogleSyncRoute(
  route: Route,
  state: MockCalendarEmailApiState
): Promise<void> {
  if (route.request().method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }
  state.syncCallCount += 1;
  return fulfillJson(route, 202, state.syncResponse);
}

export function createMockCalendarEvent(
  id: string,
  title: string,
  overrides: Partial<CalendarEventDto> = {}
): CalendarEventDto {
  return {
    id,
    connectorAccountId: "connector-calendar-1",
    ownerUserId: "user-1",
    title,
    startsAt: "2030-06-06T16:00:00.000Z",
    endsAt: "2030-06-06T17:00:00.000Z",
    location: null,
    summary: null,
    bodyExcerpt: null,
    externalId: id,
    isJarvisBlock: false,
    allDay: false,
    attendeeCount: 0,
    status: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockEmailMessage(
  id: string,
  subject: string,
  overrides: Partial<EmailMessageDto> = {}
): EmailMessageDto {
  return {
    id,
    ownerUserId: "user-1",
    sender: "sender@example.test",
    recipients: [],
    subject,
    snippet: null,
    bodyExcerpt: null,
    summary: null,
    signals: {},
    receivedAt: "2026-06-06T12:00:00.000Z",
    externalId: id,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
