// Minimal logger — avoids a pino/fastify dependency in the connectors package (mirrors oauth.ts).
interface GoogleApiLogger {
  error(data: Record<string, unknown>, message: string): void;
}

export interface GoogleApiClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly logger?: GoogleApiLogger;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface GoogleCalendarEvent {
  readonly id: string;
  readonly summary?: string;
  readonly description?: string;
  readonly location?: string;
  readonly status?: string;
  readonly htmlLink?: string;
  readonly start?: { readonly dateTime?: string; readonly date?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string };
  readonly attendees?: ReadonlyArray<unknown>;
}

export interface GoogleBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface GoogleFreeBusyResult {
  readonly busy: GoogleBusyInterval[];
}

export interface GoogleInsertedEvent {
  readonly id: string;
  readonly htmlLink?: string;
}

export interface GmailMessageStub {
  readonly id: string;
  readonly threadId?: string;
}

export interface GmailMessageFull {
  readonly id: string;
  readonly threadId?: string;
  readonly historyId?: string;
  readonly labelIds?: readonly string[];
  readonly snippet?: string;
  readonly payload?: GmailPayloadPart;
  readonly internalDate?: string;
}

export interface GmailPayloadPart {
  readonly mimeType?: string;
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly body?: { readonly data?: string; readonly size?: number };
  readonly parts?: readonly GmailPayloadPart[];
}

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export class GoogleApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly logger: GoogleApiLogger;

  constructor(deps: GoogleApiClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
    this.logger = deps.logger ?? { error: (data, msg) => console.error(msg, data) };
  }

  async listCalendarEvents(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    maxPages?: number;
  }): Promise<GoogleCalendarEvent[]> {
    const calendarId = input.calendarId ?? "primary";
    const maxPages = input.maxPages ?? 20;
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("timeMin", input.timeMin);
      url.searchParams.set("timeMax", input.timeMax);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await this.getJson<{
        items?: GoogleCalendarEvent[];
        nextPageToken?: string;
      }>(url.toString(), input.accessToken, "calendar");
      events.push(...(json.items ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return events;
  }

  async listMessageIds(input: {
    accessToken: string;
    query?: string;
    maxPages?: number;
  }): Promise<GmailMessageStub[]> {
    const maxPages = input.maxPages ?? 10;
    const stubs: GmailMessageStub[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${GMAIL_BASE}/users/me/messages`);
      if (input.query) url.searchParams.set("q", input.query);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await this.getJson<{
        messages?: GmailMessageStub[];
        nextPageToken?: string;
      }>(url.toString(), input.accessToken, "gmail");
      stubs.push(...(json.messages ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return stubs;
  }

  async getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull> {
    const url = new URL(`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(input.id)}`);
    url.searchParams.set("format", "full");
    return this.getJson<GmailMessageFull>(url.toString(), input.accessToken, "gmail");
  }

  async freeBusy(input: {
    accessToken: string;
    timeMin: string;
    timeMax: string;
    calendarId?: string;
  }): Promise<GoogleFreeBusyResult> {
    const calendarId = input.calendarId ?? "primary";
    const json = await this.postJson<{
      // A freeBusy 200 can carry a PER-CALENDAR `errors[]` (e.g. notFound, rateLimitExceeded)
      // alongside an empty `busy`. We model it here so the failure is visible — without it a
      // per-calendar error reads as "fully free" and a focus block double-books over a real event.
      calendars?: Record<
        string,
        {
          busy?: GoogleBusyInterval[];
          errors?: ReadonlyArray<{ domain?: string; reason?: string }>;
        }
      >;
    }>(
      `${CALENDAR_BASE}/freeBusy`,
      input.accessToken,
      {
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        items: [{ id: calendarId }]
      },
      "calendar"
    );
    // FAIL-CLOSED: if the requested calendar key is absent OR Google reported a per-calendar
    // error for it, we CANNOT trust an empty busy list as "free". Throw so proposeAndInsert's
    // try/catch returns created:false ("couldn't check availability") instead of inserting a
    // focus block into an unverified slot (double-booking guarantee). Log status only — never
    // the body — to keep the existing no-leak posture.
    const calendar = json.calendars?.[calendarId];
    if (!calendar) {
      this.logger.error(
        { api: "calendar", reason: "freebusy-missing-calendar" },
        "Google freeBusy omitted the requested calendar"
      );
      throw new GoogleApiError(`Google calendar freeBusy missing calendar ${calendarId}`, 502);
    }
    if (calendar.errors && calendar.errors.length > 0) {
      this.logger.error(
        {
          api: "calendar",
          reason: "freebusy-calendar-error",
          // reason codes are non-secret API status tokens (notFound, rateLimitExceeded, ...)
          codes: calendar.errors.map((e) => e.reason ?? "unknown")
        },
        "Google freeBusy returned a per-calendar error"
      );
      throw new GoogleApiError(`Google calendar freeBusy reported a per-calendar error`, 502);
    }
    return { busy: calendar.busy ?? [] };
  }

  async insertEvent(input: {
    accessToken: string;
    calendarId?: string;
    summary: string;
    start: string;
    end: string;
    timeZone?: string;
    extendedPrivateProperties?: Record<string, string>;
    /**
     * Optional caller-supplied event id (base32hex, 5..1024 chars per the Google id rule).
     * When set, the insert is idempotent at Google: a second insert of the SAME id returns
     * 409 Conflict instead of creating a duplicate event. The focus-time impl derives this
     * deterministically from the approved proposal (actor + chosen slot + title) so a retry
     * of the identical approved proposal cannot double-book the real calendar.
     */
    eventId?: string;
  }): Promise<GoogleInsertedEvent> {
    const calendarId = input.calendarId ?? "primary";
    const body: Record<string, unknown> = {
      summary: input.summary,
      start: input.timeZone
        ? { dateTime: input.start, timeZone: input.timeZone }
        : { dateTime: input.start },
      end: input.timeZone
        ? { dateTime: input.end, timeZone: input.timeZone }
        : { dateTime: input.end }
    };
    if (input.eventId) {
      body.id = input.eventId;
    }
    if (input.extendedPrivateProperties) {
      body.extendedProperties = { private: input.extendedPrivateProperties };
    }
    const json = await this.postJson<GoogleInsertedEvent>(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      input.accessToken,
      body,
      "calendar"
    );
    return { id: json.id, htmlLink: json.htmlLink };
  }

  private async getJson<T>(url: string, accessToken: string, api: string): Promise<T> {
    const response = await this.fetchFn(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      // Log status server-side only; NEVER embed the response body in Error.message —
      // handleRouteError propagates Error.message to HTTP responses (oauth.ts:122).
      this.logger.error({ statusCode: response.status, api }, "Google API call failed");
      throw new GoogleApiError(`Google ${api} returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  private async postJson<T>(
    url: string,
    accessToken: string,
    body: unknown,
    api: string
  ): Promise<T> {
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      // Log status server-side only; NEVER embed the response body in Error.message —
      // handleRouteError propagates Error.message to HTTP responses (oauth.ts:122).
      this.logger.error({ statusCode: response.status, api }, "Google API call failed");
      throw new GoogleApiError(`Google ${api} returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }
}
