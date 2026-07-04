# Truthful Chat Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one real Chat response-style setting, apply it to live chat prompts, and remove fake Chat settings controls.

**Architecture:** Reuse existing owner-scoped `app.preferences` through `PreferencesRepository`; no migration. Add small shared Chat settings DTO/normalizer used by API, web, and runtime prompt rendering. Chat settings route lives in `packages/chat/src/routes.ts` because Chat owns runtime behavior.

**Tech Stack:** TypeScript, Fastify, Kysely `DataContextDb`, React Query, Vitest.

---

## Files

- Create: `packages/shared/src/chat-settings-api.ts` for DTOs, route schemas, preference key, normalizer, prompt instruction renderer.
- Modify: `packages/shared/src/index.ts` to export Chat settings contract.
- Modify: `packages/chat/src/routes.ts` to add `GET/PUT /api/chat/settings` using existing `PreferencesRepository`.
- Modify: `packages/chat/src/live/runtime.ts` to read `chat.settings.v1` and append response-style instruction to persona.
- Modify: `packages/module-registry/src/index.ts` to pass `chatPreferences: new PreferencesRepository()`.
- Modify: `apps/web/src/api/client.ts` to add `getChatSettings` / `putChatSettings`.
- Modify: `apps/web/src/api/query-keys.ts` to add `queryKeys.chat.settings`.
- Modify: `apps/web/src/settings/settings-module-subviews.tsx` to remove `NotWired`, local `DEFAULT_CHAT`, fake toggles, and wire response style to API.
- Modify: `apps/web/src/settings/settings-sample-data.ts` to delete `ChatSettings` / `DEFAULT_CHAT`.
- Test: `tests/unit/chat-settings-api.test.ts` for normalizer and prompt instruction.
- Test: `tests/integration/chat-settings.test.ts` for persistence and per-user isolation.

## Task 1: Shared Chat Settings Contract

**Files:**
- Create: `packages/shared/src/chat-settings-api.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/unit/chat-settings-api.test.ts`

- [ ] **Step 1: Write failing unit tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_SETTINGS,
  normalizeChatSettings,
  renderChatResponseStyleInstruction
} from "@jarv1s/shared";

describe("chat settings api", () => {
  it("normalizes missing and malformed settings to balanced", () => {
    expect(normalizeChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(normalizeChatSettings({ responseStyle: "fast" })).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("accepts supported response styles only", () => {
    expect(normalizeChatSettings({ responseStyle: "concise" })).toEqual({
      responseStyle: "concise"
    });
    expect(normalizeChatSettings({ responseStyle: "detailed" })).toEqual({
      responseStyle: "detailed"
    });
  });

  it("renders runtime prompt instruction for saved style", () => {
    expect(renderChatResponseStyleInstruction("concise")).toContain("concise");
    expect(renderChatResponseStyleInstruction("balanced")).toContain("balanced");
    expect(renderChatResponseStyleInstruction("detailed")).toContain("detailed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/chat-settings-api.test.ts`

Expected: FAIL because `chat-settings-api` exports do not exist.

- [ ] **Step 3: Add shared contract**

```ts
import { errorResponseSchema } from "./schema-fragments.js";

export const CHAT_RESPONSE_STYLES = ["concise", "balanced", "detailed"] as const;
export type ChatResponseStyle = (typeof CHAT_RESPONSE_STYLES)[number];
export const CHAT_SETTINGS_PREFERENCE_KEY = "chat.settings.v1";

export interface ChatSettingsDto {
  readonly responseStyle: ChatResponseStyle;
}

export interface GetChatSettingsResponse {
  readonly chat: ChatSettingsDto;
}

export interface PutChatSettingsRequest {
  readonly chat: ChatSettingsDto;
}

export type PutChatSettingsResponse = GetChatSettingsResponse;

export const DEFAULT_CHAT_SETTINGS: ChatSettingsDto = { responseStyle: "balanced" };

export function normalizeChatSettings(value: unknown): ChatSettingsDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_CHAT_SETTINGS;
  const style = (value as Record<string, unknown>).responseStyle;
  return isChatResponseStyle(style) ? { responseStyle: style } : DEFAULT_CHAT_SETTINGS;
}

export function isChatResponseStyle(value: unknown): value is ChatResponseStyle {
  return typeof value === "string" && CHAT_RESPONSE_STYLES.includes(value as ChatResponseStyle);
}

export function renderChatResponseStyleInstruction(style: ChatResponseStyle): string {
  if (style === "concise") return "Default response style: concise. Prefer short, direct answers unless detail is required.";
  if (style === "detailed") return "Default response style: detailed. Include useful context, reasoning, and next steps.";
  return "Default response style: balanced. Be direct, with enough context to be useful.";
}

const chatSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["responseStyle"],
  properties: {
    responseStyle: { type: "string", enum: CHAT_RESPONSE_STYLES }
  }
} as const;

export const getChatSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["chat"],
      properties: { chat: chatSettingsSchema }
    },
    401: errorResponseSchema
  }
} as const;

export const putChatSettingsRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["chat"],
    properties: { chat: chatSettingsSchema }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["chat"],
      properties: { chat: chatSettingsSchema }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
```

Add to `packages/shared/src/index.ts`:

```ts
export * from "./chat-settings-api.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/chat-settings-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/chat-settings-api.ts packages/shared/src/index.ts tests/unit/chat-settings-api.test.ts
git commit -m "feat: add chat settings contract"
```

## Task 2: Persist Chat Settings

**Files:**
- Modify: `packages/chat/src/routes.ts`
- Test: `tests/integration/chat-settings.test.ts`

- [ ] **Step 1: Write failing integration tests**

Use the sign-up helper shape from `tests/integration/settings-quiet-hours.test.ts`.

```ts
it("returns balanced chat defaults before any update", async () => {
  const res = await server.inject({
    method: "GET",
    url: "/api/chat/settings",
    headers: { cookie: ownerCookie }
  });

  expect(res.statusCode).toBe(200);
  expect(res.json<GetChatSettingsResponse>()).toEqual({
    chat: { responseStyle: "balanced" }
  });
});

it("persists chat response style per user", async () => {
  const put = await server.inject({
    method: "PUT",
    url: "/api/chat/settings",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    payload: { chat: { responseStyle: "concise" } }
  });
  expect(put.statusCode).toBe(200);

  const owner = await server.inject({
    method: "GET",
    url: "/api/chat/settings",
    headers: { cookie: ownerCookie }
  });
  expect(owner.json<GetChatSettingsResponse>().chat.responseStyle).toBe("concise");

  const member = await server.inject({
    method: "GET",
    url: "/api/chat/settings",
    headers: { cookie: memberCookie }
  });
  expect(member.json<GetChatSettingsResponse>().chat.responseStyle).toBe("balanced");
});

it("rejects unsupported response styles", async () => {
  const res = await server.inject({
    method: "PUT",
    url: "/api/chat/settings",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    payload: { chat: { responseStyle: "verbose" } }
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/chat-settings.test.ts`

Expected: FAIL with 404 for `/api/chat/settings`.

- [ ] **Step 3: Add routes using existing preferences**

In `packages/chat/src/routes.ts`, import:

```ts
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  getChatSettingsRouteSchema,
  normalizeChatSettings,
  putChatSettingsRouteSchema,
  type PutChatSettingsRequest
} from "@jarv1s/shared";
```

Add in `registerChatRoutes`:

```ts
const chatSettingsRepo = new PreferencesRepository();
```

Add routes before memory settings:

```ts
server.get("/api/chat/settings", { schema: getChatSettingsRouteSchema }, async (request, reply) => {
  try {
    const access = await dependencies.resolveAccessContext(request);
    const raw = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
      chatSettingsRepo.get(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY)
    );
    return { chat: normalizeChatSettings(raw) };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});

server.put("/api/chat/settings", { schema: putChatSettingsRouteSchema }, async (request, reply) => {
  try {
    const access = await dependencies.resolveAccessContext(request);
    const body = request.body as PutChatSettingsRequest;
    const chat = normalizeChatSettings(body.chat);
    await dependencies.dataContext.withDataContext(access, (scopedDb) =>
      chatSettingsRepo.upsert(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY, chat)
    );
    return { chat };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});
```

- [ ] **Step 4: Run integration test**

Run: `pnpm vitest run tests/integration/chat-settings.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/routes.ts tests/integration/chat-settings.test.ts
git commit -m "feat: persist chat settings"
```

## Task 3: Apply Response Style To Runtime

**Files:**
- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/unit/chat-settings-api.test.ts`

- [ ] **Step 1: Extend existing prompt test**

Add assertion:

```ts
expect(renderChatResponseStyleInstruction("detailed")).toBe(
  "Default response style: detailed. Include useful context, reasoning, and next steps."
);
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run tests/unit/chat-settings-api.test.ts`

Expected: PASS after Task 1, proving exact prompt text used by runtime helper.

- [ ] **Step 3: Thread preference port into runtime**

In `packages/chat/src/routes.ts`, add dependency:

```ts
readonly chatPreferences?: PreferencesPort;
```

Pass to runtime:

```ts
chatPreferences: dependencies.chatPreferences,
```

In `packages/chat/src/live/runtime.ts`, add:

```ts
readonly chatPreferences?: PreferencesPort;
```

In `packages/module-registry/src/index.ts`, pass:

```ts
chatPreferences: new PreferencesRepository(),
```

- [ ] **Step 4: Apply style inside `resolveChatPersona`**

Read `CHAT_SETTINGS_PREFERENCE_KEY` through `chatPreferences`, normalize, append instruction:

```ts
const [stored, localeRaw, chatRaw] = await deps.dataContext.withDataContext(
  { actorUserId, requestId: "chat-live:resolve-persona" },
  (scopedDb) =>
    Promise.all([
      deps.personaPreferences ? deps.personaPreferences.get(scopedDb, "persona.bundle") : null,
      deps.localePreferences ? deps.localePreferences.get(scopedDb, "locale") : null,
      deps.chatPreferences ? deps.chatPreferences.get(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY) : null
    ])
);
const chatSettings = normalizeChatSettings(chatRaw);
const responseStyleBlock = renderChatResponseStyleInstruction(chatSettings.responseStyle);

return [DEFAULT_JARVIS_PERSONA, tzBlock, personaBlock, responseStyleBlock]
  .filter(Boolean)
  .join("\n\n");
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/chat-settings-api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/routes.ts packages/chat/src/live/runtime.ts packages/module-registry/src/index.ts tests/unit/chat-settings-api.test.ts
git commit -m "feat: apply chat response style"
```

## Task 4: Wire Settings UI And Remove Fake Controls

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-module-subviews.tsx`
- Modify: `apps/web/src/settings/settings-sample-data.ts`

- [ ] **Step 1: Add web client helpers**

Import shared types:

```ts
GetChatSettingsResponse,
PutChatSettingsRequest,
PutChatSettingsResponse,
```

Add:

```ts
export async function getChatSettings(): Promise<GetChatSettingsResponse> {
  return requestJson<GetChatSettingsResponse>("/api/chat/settings");
}

export async function putChatSettings(
  body: PutChatSettingsRequest
): Promise<PutChatSettingsResponse> {
  return requestJson<PutChatSettingsResponse>("/api/chat/settings", {
    method: "PUT",
    body
  });
}
```

In `apps/web/src/api/query-keys.ts` add:

```ts
settings: ["chat", "settings"] as const,
```

under `queryKeys.chat`.

- [ ] **Step 2: Wire `ChatSettingsView`**

Remove `DEFAULT_CHAT`, `ChatSettings`, `NotWired`, `ToggleRow` usage from Chat settings. Use query/mutation:

```tsx
const queryClient = useQueryClient();
const settingsQuery = useQuery({
  queryKey: queryKeys.chat.settings,
  queryFn: getChatSettings
});
const mutation = useMutation({
  mutationFn: putChatSettings,
  onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.settings, data)
});
const style = settingsQuery.data?.chat.responseStyle ?? "balanced";
```

Keep only:

```tsx
<Group title="Replies">
  <Choice
    label="Response style"
    hint="Saved default for generated chat answers."
    value={cap(style)}
    options={["Concise", "Balanced", "Detailed"]}
    onChange={(v) =>
      mutation.mutate({
        chat: { responseStyle: v.toLowerCase() as ChatResponseStyle }
      })
    }
  />
</Group>
<Group title="Input">
  <Row
    name="Voice input"
    desc="Tracked for #738. Voice capture is not enabled in Chat settings yet."
    control={<Badge>Coming soon</Badge>}
  />
</Group>
```

Render a `Note` for save/load errors with `readError(settingsQuery.error ?? mutation.error)`.

- [ ] **Step 3: Delete fake sample data**

Remove `ChatSettings` interface and `DEFAULT_CHAT` from `apps/web/src/settings/settings-sample-data.ts`.

- [ ] **Step 4: Run focused UI checks**

Run:

```bash
pnpm typecheck
pnpm vitest run tests/unit/web-settings-module-view-model.test.ts tests/unit/module-settings-ui-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-module-subviews.tsx apps/web/src/settings/settings-sample-data.ts
git commit -m "feat: wire truthful chat settings UI"
```

## Task 5: Final Verification

**Files:** no code edits.

- [ ] **Step 1: Run acceptance checks**

Run:

```bash
pnpm vitest run tests/unit/chat-settings-api.test.ts tests/integration/chat-settings.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all PASS.

- [ ] **Step 2: Re-run code search for fake controls**

Run:

```bash
rg -n "DEFAULT_CHAT|NotWired>Chat settings|Suggested actions|Stream responses|Remember across conversations" apps/web/src/settings packages/chat packages/shared tests
```

Expected: no matches.

- [ ] **Step 3: Commit only if verification edits were needed**

If formatting touched files:

```bash
git add <explicit files>
git commit -m "chore: format chat settings"
```

## Self-Review

- Spec coverage: persists one response style, survives reload via `app.preferences`, applies runtime prompt instruction, removes fake suggested actions/stream/remember controls, keeps voice as tracked coming-soon, removes `DEFAULT_CHAT` source.
- No migration: existing owner-scoped preferences table is sufficient and avoids coordinator migration ordering.
- No product fork: response style values are `concise | balanced | detailed`; this matches spec wording and avoids broader automation/voice/private-chat scope.
