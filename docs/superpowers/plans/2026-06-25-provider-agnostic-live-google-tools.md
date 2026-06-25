# Provider-Agnostic Live Google Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Jarv1s-owned live Gmail and Calendar MCP tools backed by the existing Jarv1s Google connector, plus keep the existing approved calendar block-time write path.

**Architecture:** Put live read handlers in `packages/connectors` because that module owns Google OAuth and `GoogleApiClient`. Register three read-only assistant tools in the connectors manifest without `requiresServices`, so the gateway policy remains unchanged and provider-owned Gmail/Calendar auth is not used.

**Tech Stack:** TypeScript, Fastify JSON schemas in `@jarv1s/shared`, Jarv1s assistant tool gateway, Vitest integration tests.

---

## File Structure

- Modify `packages/shared/src/connectors-api.ts`: add TypeScript DTOs and closed JSON schemas for live Gmail and Calendar tool input/output.
- Modify `packages/connectors/src/email-extract.ts`: export the existing parser types/functions already needed by sync.
- Create `packages/connectors/src/live-tools.ts`: implement `gmail.searchLive`, `gmail.getLiveMessage`, and `calendar.listLiveEvents` handlers.
- Modify `packages/connectors/src/manifest.ts`: register the three read tools with `externalContent: true`.
- Modify `packages/connectors/src/index.ts`: export live tool handlers if the package barrel requires it.
- Modify `tests/integration/connectors-google.test.ts`: add tests for tool listing, no-active-account failure, successful live Gmail/calendar reads, and one forced refresh retry on 401.

---

### Task 1: Shared Schemas

**Files:**
- Modify: `packages/shared/src/connectors-api.ts`

- [ ] **Step 1: Add DTO interfaces near existing connector response interfaces**

Add:

```ts
export interface GmailLiveMessageSummaryDto {
  readonly id: string;
  readonly threadId: string | null;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly snippet: string | null;
  readonly receivedAt: string;
  readonly labelIds: readonly string[];
}

export interface GmailSearchLiveResponse {
  readonly messages: readonly GmailLiveMessageSummaryDto[];
  readonly skipped: number;
}

export interface GmailGetLiveMessageResponse {
  readonly message: GmailLiveMessageSummaryDto & { readonly bodyText: string };
}

export interface CalendarLiveEventDto {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly location: string | null;
  readonly htmlLink: string | null;
  readonly status: string | null;
  readonly attendeeCount: number;
}

export interface CalendarListLiveEventsResponse {
  readonly events: readonly CalendarLiveEventDto[];
}
```

- [ ] **Step 2: Add closed input schemas**

Add:

```ts
export const gmailSearchLiveInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    limit: { type: "number" }
  }
} as const;

export const gmailGetLiveMessageInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 }
  }
} as const;

export const calendarListLiveEventsInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    timeMin: { type: "string" },
    timeMax: { type: "string" },
    limit: { type: "number" }
  }
} as const;
```

- [ ] **Step 3: Add closed response schemas**

Add:

```ts
const gmailLiveMessageSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "threadId", "from", "to", "subject", "snippet", "receivedAt", "labelIds"],
  properties: {
    id: { type: "string" },
    threadId: { type: ["string", "null"] },
    from: { type: "string" },
    to: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    snippet: { type: ["string", "null"] },
    receivedAt: { type: "string" },
    labelIds: { type: "array", items: { type: "string" } }
  }
} as const;

export const gmailSearchLiveResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messages", "skipped"],
  properties: {
    messages: { type: "array", items: gmailLiveMessageSummarySchema },
    skipped: { type: "number" }
  }
} as const;

export const gmailGetLiveMessageResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "threadId",
        "from",
        "to",
        "subject",
        "snippet",
        "receivedAt",
        "labelIds",
        "bodyText"
      ],
      properties: {
        ...gmailLiveMessageSummarySchema.properties,
        bodyText: { type: "string" }
      }
    }
  }
} as const;

const calendarLiveEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "startsAt", "endsAt", "location", "htmlLink", "status", "attendeeCount"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    startsAt: { type: "string" },
    endsAt: { type: "string" },
    location: { type: ["string", "null"] },
    htmlLink: { type: ["string", "null"] },
    status: { type: ["string", "null"] },
    attendeeCount: { type: "number" }
  }
} as const;

export const calendarListLiveEventsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: { type: "array", items: calendarLiveEventSchema }
  }
} as const;
```

- [ ] **Step 4: Run typecheck for schema syntax**

Run: `pnpm typecheck`

Expected: fails only if the spread inside the const schema is not accepted by the local TypeScript settings. If it fails, replace the spread with explicit repeated properties.

---

### Task 2: Live Tool Handlers

**Files:**
- Modify: `packages/connectors/src/email-extract.ts`
- Create: `packages/connectors/src/live-tools.ts`

- [ ] **Step 1: Export parser reuse**

In `packages/connectors/src/email-extract.ts`, ensure these are exported:

```ts
export interface ParsedEmail {
  readonly externalId: string;
  readonly historyId: string | null;
  readonly subject: string;
  readonly from: string;
  readonly recipients: string[];
  readonly receivedAt: string;
  readonly labelIds: string[];
  readonly snippet: string | null;
  readonly body: string;
  readonly bodyTruncated: boolean;
}

export function parseEmail(message: GmailMessageFull): ParsedEmail {
  // existing implementation stays unchanged
}
```

- [ ] **Step 2: Create `packages/connectors/src/live-tools.ts`**

Implement the handlers with injectable deps:

```ts
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import type {
  CalendarLiveEventDto,
  GmailLiveMessageSummaryDto
} from "@jarv1s/shared";

import { createConnectorSecretCipher } from "./crypto.js";
import { parseEmail, type ParsedEmail } from "./email-extract.js";
import { GoogleConnectionService, GoogleConnectError } from "./google-connection.js";
import { GoogleApiClient, GoogleApiError, type GoogleCalendarEvent } from "./google-api-client.js";
import { ConnectorsRepository } from "./repository.js";
import { GoogleOAuthClient } from "./oauth.js";

const DEFAULT_GMAIL_QUERY = "newer_than:30d";
const GMAIL_SEARCH_LIMIT_DEFAULT = 10;
const GMAIL_SEARCH_LIMIT_MAX = 20;
const GMAIL_BODY_TEXT_MAX = 12_000;
const CALENDAR_LIMIT_DEFAULT = 20;
const CALENDAR_LIMIT_MAX = 50;
const CALENDAR_DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface LiveGoogleToolDeps {
  readonly googleService: Pick<GoogleConnectionService, "getFreshAccessToken">;
  readonly googleClient: Pick<GoogleApiClient, "listMessageIds" | "getMessage" | "listCalendarEvents">;
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

function summarize(parsed: ParsedEmail): GmailLiveMessageSummaryDto {
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
  const startsAt = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00.000Z` : undefined);
  const endsAt = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00.000Z` : undefined);
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
        messages.push({ ...summarize(parseEmail(full)), threadId: full.threadId ?? null });
      } catch {
        skipped += 1;
      }
    }
    return { data: { messages, skipped } };
  };
}

export function makeGmailGetLiveMessageExecute(deps: LiveGoogleToolDeps = defaultDeps()): ToolExecute {
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
          ...summarize(parsed),
          threadId: full.threadId ?? null,
          bodyText: parsed.body.slice(0, GMAIL_BODY_TEXT_MAX)
        }
      }
    };
  };
}

export function makeCalendarListLiveEventsExecute(deps: LiveGoogleToolDeps = defaultDeps()): ToolExecute {
  return async (scopedDbRaw, input): Promise<ToolResult> => {
    assertDataContextDb(scopedDbRaw);
    const scopedDb = scopedDbRaw as DataContextDb;
    const now = deps.now?.() ?? new Date();
    const rawMin = readString(input.timeMin);
    const rawMax = readString(input.timeMax);
    const timeMin = rawMin ?? now.toISOString();
    const timeMax =
      rawMax ??
      new Date((rawMin ? new Date(rawMin) : now).getTime() + CALENDAR_DEFAULT_WINDOW_MS).toISOString();
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
    return { data: { events: events.flatMap((event) => mapCalendarEvent(event) ?? []).slice(0, limit) } };
  };
}

export const gmailSearchLiveExecute = makeGmailSearchLiveExecute();
export const gmailGetLiveMessageExecute = makeGmailGetLiveMessageExecute();
export const calendarListLiveEventsExecute = makeCalendarListLiveEventsExecute();
```

- [ ] **Step 3: Run targeted typecheck**

Run: `pnpm typecheck`

Expected: TypeScript reports only real typing mistakes. Fix by keeping the handler signatures as `ToolExecute` and the injected `getFreshAccessToken` type compatible with `{ force?: boolean }`.

---

### Task 3: Manifest Registration

**Files:**
- Modify: `packages/connectors/src/manifest.ts`
- Modify: `packages/connectors/src/index.ts` if live tool exports are needed by package consumers

- [ ] **Step 1: Import schemas and handlers**

In `packages/connectors/src/manifest.ts`, extend imports:

```ts
import {
  calendarListLiveEventsInputSchema,
  calendarListLiveEventsResponseSchema,
  createConnectorAccountRequestSchema,
  createConnectorAccountResponseSchema,
  gmailGetLiveMessageInputSchema,
  gmailGetLiveMessageResponseSchema,
  gmailSearchLiveInputSchema,
  gmailSearchLiveResponseSchema,
  googleSyncResponseSchema,
  listAdminConnectorAccountsResponseSchema,
  listConnectorAccountsResponseSchema,
  listConnectorProvidersResponseSchema,
  revokeConnectorAccountResponseSchema,
  updateConnectorAccountRequestSchema,
  updateConnectorAccountResponseSchema
} from "@jarv1s/shared";

import {
  calendarListLiveEventsExecute,
  gmailGetLiveMessageExecute,
  gmailSearchLiveExecute
} from "./live-tools.js";
```

- [ ] **Step 2: Register the tools**

Append these entries to `assistantTools` after `connectors.startGoogleGuidance`:

```ts
{
  name: "gmail.searchLive",
  description:
    "Search the user's live Gmail through the Jarv1s Google connector. Returns bounded message metadata and snippets, not full bodies.",
  permissionId: "connectors.view",
  risk: "read",
  inputSchema: gmailSearchLiveInputSchema,
  outputSchema: gmailSearchLiveResponseSchema,
  externalContent: true,
  execute: gmailSearchLiveExecute
},
{
  name: "gmail.getLiveMessage",
  description:
    "Fetch one live Gmail message by id through the Jarv1s Google connector. Returns capped plain-text body content.",
  permissionId: "connectors.view",
  risk: "read",
  inputSchema: gmailGetLiveMessageInputSchema,
  outputSchema: gmailGetLiveMessageResponseSchema,
  externalContent: true,
  execute: gmailGetLiveMessageExecute
},
{
  name: "calendar.listLiveEvents",
  description:
    "List live primary-calendar events through the Jarv1s Google connector for a bounded time window.",
  permissionId: "connectors.view",
  risk: "read",
  inputSchema: calendarListLiveEventsInputSchema,
  outputSchema: calendarListLiveEventsResponseSchema,
  externalContent: true,
  execute: calendarListLiveEventsExecute
}
```

Do not add `requiresServices`.

- [ ] **Step 3: Export live-tools from package barrel if needed**

Open `packages/connectors/src/index.ts`. If it exports local modules one by one, add:

```ts
export * from "./live-tools.js";
```

- [ ] **Step 4: Run manifest typecheck**

Run: `pnpm typecheck`

Expected: pass or actionable import/export errors only.

---

### Task 4: Focused Integration Tests

**Files:**
- Modify: `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Add direct handler tests with fakes**

Add tests using `makeGmailSearchLiveExecute`, `makeGmailGetLiveMessageExecute`, and `makeCalendarListLiveEventsExecute` with fake deps. Use an existing `DataContextRunner` helper in the file to get a scoped `DataContextDb`.

Test cases:

```ts
it("lists bounded live gmail results without bodies", async () => {
  const execute = makeGmailSearchLiveExecute({
    googleService: { getFreshAccessToken: async () => "token-1" },
    googleClient: {
      listMessageIds: async () => [{ id: "m1" }],
      getMessage: async () => gmailMessage({ id: "m1", body: "secret body" }),
      listCalendarEvents: async () => []
    }
  });

  const result = await dc.withDataContext(access, (db) => execute(db, { query: "from:a", limit: 1 }, ctx));

  expect(result.data).toMatchObject({
    messages: [{ id: "m1", subject: "Hello", snippet: "Snippet" }],
    skipped: 0
  });
  expect(JSON.stringify(result.data)).not.toContain("secret body");
});
```

```ts
it("returns a capped live gmail body for one message", async () => {
  const execute = makeGmailGetLiveMessageExecute({
    googleService: { getFreshAccessToken: async () => "token-1" },
    googleClient: {
      listMessageIds: async () => [],
      getMessage: async () => gmailMessage({ id: "m1", body: "x".repeat(13_000) }),
      listCalendarEvents: async () => []
    }
  });

  const result = await dc.withDataContext(access, (db) => execute(db, { id: "m1" }, ctx));

  expect((result.data as any).message.bodyText).toHaveLength(12_000);
});
```

```ts
it("lists bounded live calendar events", async () => {
  const execute = makeCalendarListLiveEventsExecute({
    googleService: { getFreshAccessToken: async () => "token-1" },
    googleClient: {
      listMessageIds: async () => [],
      getMessage: async () => gmailMessage({ id: "unused", body: "" }),
      listCalendarEvents: async () => [
        {
          id: "e1",
          summary: "Focus",
          start: { dateTime: "2026-06-25T10:00:00.000Z" },
          end: { dateTime: "2026-06-25T11:00:00.000Z" },
          attendees: [{}, {}]
        }
      ]
    },
    now: () => new Date("2026-06-25T00:00:00.000Z")
  });

  const result = await dc.withDataContext(access, (db) => execute(db, {}, ctx));

  expect(result.data).toMatchObject({
    events: [{ id: "e1", title: "Focus", attendeeCount: 2 }]
  });
});
```

- [ ] **Step 2: Add one forced-refresh retry test**

Add:

```ts
it("forces one refresh and retries after a live Google 401", async () => {
  const tokens: string[] = [];
  let calls = 0;
  const execute = makeCalendarListLiveEventsExecute({
    googleService: {
      getFreshAccessToken: async (_db, opts) => {
        tokens.push(opts?.force ? "forced" : "cached");
        return opts?.force ? "token-2" : "token-1";
      }
    },
    googleClient: {
      listMessageIds: async () => [],
      getMessage: async () => gmailMessage({ id: "unused", body: "" }),
      listCalendarEvents: async ({ accessToken }) => {
        calls += 1;
        if (accessToken === "token-1") throw new GoogleApiError("Google calendar returned 401", 401);
        return [];
      }
    },
    now: () => new Date("2026-06-25T00:00:00.000Z")
  });

  await dc.withDataContext(access, (db) => execute(db, {}, ctx));

  expect(calls).toBe(2);
  expect(tokens).toEqual(["cached", "forced"]);
});
```

- [ ] **Step 3: Add manifest tool listing assertion**

Extend the existing manifest test:

```ts
const names = connectorsModuleManifest.assistantTools?.map((tool) => tool.name) ?? [];
expect(names).toContain("gmail.searchLive");
expect(names).toContain("gmail.getLiveMessage");
expect(names).toContain("calendar.listLiveEvents");
expect(connectorsModuleManifest.assistantTools?.find((tool) => tool.name === "gmail.searchLive")?.requiresServices).toBeUndefined();
```

- [ ] **Step 4: Add tiny test helper for fake Gmail payloads**

Add near test helpers:

```ts
function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function gmailMessage(input: { id: string; body: string }) {
  return {
    id: input.id,
    threadId: `thread-${input.id}`,
    labelIds: ["INBOX"],
    snippet: "Snippet",
    internalDate: String(Date.parse("2026-06-25T12:00:00.000Z")),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Hello" },
        { name: "From", value: "a@example.com" },
        { name: "To", value: "b@example.com" }
      ],
      body: { data: b64url(input.body) }
    }
  };
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm test:connectors`

Expected: pass.

---

### Task 5: Verification and Commit

**Files:**
- All files changed above

- [ ] **Step 1: Run focused checks**

Run:

```bash
pnpm typecheck
pnpm test:connectors
```

Expected: both pass.

- [ ] **Step 2: Run formatting check**

Run:

```bash
pnpm format:check
```

Expected: pass. If it fails only on changed files, run the repo formatter and re-run `pnpm format:check`.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- packages/shared/src/connectors-api.ts packages/connectors/src/email-extract.ts packages/connectors/src/live-tools.ts packages/connectors/src/manifest.ts packages/connectors/src/index.ts tests/integration/connectors-google.test.ts
```

Expected: diff contains only shared schemas, parser export if needed, live tool handlers, manifest registration, barrel export if needed, and tests.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/shared/src/connectors-api.ts packages/connectors/src/email-extract.ts packages/connectors/src/live-tools.ts packages/connectors/src/manifest.ts packages/connectors/src/index.ts tests/integration/connectors-google.test.ts
git commit -m "feat: add jarvis live google tools"
```

Expected: commit succeeds.
