import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import type { CalendarLiveEventDto, GmailLiveMessageSummaryDto } from "@jarv1s/shared";

import { createConnectorSecretCipher } from "./crypto.js";
import { parseEmail, type ParsedEmail } from "./email-extract.js";
import { GoogleConnectionService } from "./google-connection.js";
import { GoogleApiClient, GoogleApiError, type GoogleCalendarEvent } from "./google-api-client.js";
import { GoogleOAuthClient } from "./oauth.js";
import { ConnectorsRepository } from "./repository.js";

const DEFAULT_GMAIL_QUERY = "newer_than:30d";
const GMAIL_SEARCH_LIMIT_DEFAULT = 10;
const GMAIL_SEARCH_LIMIT_MAX = 20;
const GMAIL_BODY_TEXT_MAX = 12_000;
const CALENDAR_LIMIT_DEFAULT = 20;
const CALENDAR_LIMIT_MAX = 50;
const CALENDAR_DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface LiveGoogleToolDeps {
  readonly googleService: Pick<GoogleConnectionService, "getFreshAccessToken">;
  readonly googleClient: Pick<
    GoogleApiClient,
    "listMessageIds" | "getMessage" | "listCalendarEvents"
  >;
  readonly now?: () => Date;
}

function defaultDeps(): LiveGoogleToolDeps {
  const repository = new ConnectorsRepository();
  return {
    googleService: new GoogleConnectionService({
      repository,
      cipher: createConnectorSecretCipher(),
      oauthClient: new GoogleOAuthClient()
    }),
    googleClient: new GoogleApiClient()
  };
}

function clampInt(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.floor(value)))
    : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeEmail(parsed: ParsedEmail): GmailLiveMessageSummaryDto {
  return {
    id: parsed.externalId,
    threadId: null,
    from: parsed.from,
    to: parsed.recipients,
    subject: parsed.subject,
    snippet: parsed.snippet,
    receivedAt: parsed.receivedAt,
    labelIds: parsed.labelIds
  };
}

function mapCalendarEvent(event: GoogleCalendarEvent): CalendarLiveEventDto | undefined {
  const startsAt =
    event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00.000Z` : undefined);
  const endsAt =
    event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00.000Z` : undefined);
  if (!event.id || !startsAt || !endsAt) return undefined;
  return {
    id: event.id,
    title: event.summary ?? "(no title)",
    startsAt,
    endsAt,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
    status: event.status ?? null,
    attendeeCount: event.attendees?.length ?? 0
  };
}

async function freshToken(scopedDb: DataContextDb, deps: LiveGoogleToolDeps): Promise<string> {
  try {
    return await deps.googleService.getFreshAccessToken(scopedDb);
  } catch {
    throw new Error("Connect Google in Settings first.");
  }
}

async function with401Retry<T>(
  scopedDb: DataContextDb,
  deps: LiveGoogleToolDeps,
  token: { value: string },
  op: (accessToken: string) => Promise<T>
): Promise<T> {
  try {
    return await op(token.value);
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.statusCode !== 401) throw error;
    token.value = await deps.googleService.getFreshAccessToken(scopedDb, { force: true });
    return op(token.value);
  }
}

export function makeGmailSearchLiveExecute(deps: LiveGoogleToolDeps = defaultDeps()): ToolExecute {
  return async (scopedDbRaw, input): Promise<ToolResult> => {
    assertDataContextDb(scopedDbRaw);
    const scopedDb = scopedDbRaw as DataContextDb;
    const limit = clampInt(input.limit, GMAIL_SEARCH_LIMIT_DEFAULT, GMAIL_SEARCH_LIMIT_MAX);
    const query = readString(input.query) ?? DEFAULT_GMAIL_QUERY;
    const token = { value: await freshToken(scopedDb, deps) };
    const stubs = await with401Retry(scopedDb, deps, token, (accessToken) =>
      deps.googleClient.listMessageIds({ accessToken, query, maxPages: 2 })
    );
    const messages: GmailLiveMessageSummaryDto[] = [];
    let skipped = 0;
    for (const stub of stubs.slice(0, limit)) {
      try {
        const full = await with401Retry(scopedDb, deps, token, (accessToken) =>
          deps.googleClient.getMessage({ accessToken, id: stub.id })
        );
        messages.push({ ...summarizeEmail(parseEmail(full)), threadId: full.threadId ?? null });
      } catch {
        skipped += 1;
      }
    }
    return { data: { messages, skipped } };
  };
}

export function makeGmailGetLiveMessageExecute(
  deps: LiveGoogleToolDeps = defaultDeps()
): ToolExecute {
  return async (scopedDbRaw, input): Promise<ToolResult> => {
    assertDataContextDb(scopedDbRaw);
    const id = readString(input.id);
    if (!id) throw new Error("id is required");
    const scopedDb = scopedDbRaw as DataContextDb;
    const token = { value: await freshToken(scopedDb, deps) };
    const full = await with401Retry(scopedDb, deps, token, (accessToken) =>
      deps.googleClient.getMessage({ accessToken, id })
    );
    const parsed = parseEmail(full);
    return {
      data: {
        message: {
          ...summarizeEmail(parsed),
          threadId: full.threadId ?? null,
          bodyText: parsed.body.slice(0, GMAIL_BODY_TEXT_MAX)
        }
      }
    };
  };
}

export function makeCalendarListLiveEventsExecute(
  deps: LiveGoogleToolDeps = defaultDeps()
): ToolExecute {
  return async (scopedDbRaw, input): Promise<ToolResult> => {
    assertDataContextDb(scopedDbRaw);
    const scopedDb = scopedDbRaw as DataContextDb;
    const now = deps.now?.() ?? new Date();
    const rawMin = readString(input.timeMin);
    const rawMax = readString(input.timeMax);
    const start = rawMin ? new Date(rawMin) : now;
    const timeMin = rawMin ?? now.toISOString();
    const timeMax = rawMax ?? new Date(start.getTime() + CALENDAR_DEFAULT_WINDOW_MS).toISOString();
    const limit = clampInt(input.limit, CALENDAR_LIMIT_DEFAULT, CALENDAR_LIMIT_MAX);
    const token = { value: await freshToken(scopedDb, deps) };
    const events = await with401Retry(scopedDb, deps, token, (accessToken) =>
      deps.googleClient.listCalendarEvents({
        accessToken,
        calendarId: "primary",
        timeMin,
        timeMax,
        maxPages: 3
      })
    );
    return {
      data: { events: events.flatMap((event) => mapCalendarEvent(event) ?? []).slice(0, limit) }
    };
  };
}

export const gmailSearchLiveExecute = makeGmailSearchLiveExecute();
export const gmailGetLiveMessageExecute = makeGmailGetLiveMessageExecute();
export const calendarListLiveEventsExecute = makeCalendarListLiveEventsExecute();
