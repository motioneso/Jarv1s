# Chat Thread Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Repo exception from coordinated-build: execute inline; subagent/executing-plans are disabled here. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let drawer history rows load stored chat messages read-only, owner-scoped.

**Architecture:** Reuse existing `ChatRepository.listMessages` and RLS by adding one read route: `GET /api/chat/threads/:id/messages`. Web adds one client/query key, maps `ChatMessageDto` rows into existing `TranscriptRecord` rendering, and disables composer while reviewing a selected historical thread.

**Tech Stack:** Fastify, Kysely/DataContextDb, shared DTO schemas, React Query, Playwright, Vitest.

---

## Files

- Modify: `packages/shared/src/chat-api.ts` — add `ListChatThreadMessagesResponse` and route schema.
- Modify: `packages/chat/src/routes.ts` — add messages route and `serializeMessage`.
- Modify: `apps/web/src/api/client.ts` — add `listChatThreadMessages(threadId)`.
- Modify: `apps/web/src/api/query-keys.ts` — add `chat.messages(threadId)`.
- Modify: `apps/web/src/chat/chat-drawer.tsx` — history rows, selected review state, DTO-to-record mapping, read-only composer.
- Modify: `apps/web/src/styles/kit-chat.css` — selected history/review/read-only composer states only.
- Modify: `tests/integration/chat-live-api.test.ts` — API owner-scope coverage.
- Modify: `tests/e2e/chat-drawer.spec.ts` — clicking history row renders stored messages.

## Task 1: API Contract + Owner-Scoped Route

- [ ] **Step 1: Write failing integration test**

Add to `tests/integration/chat-live-api.test.ts`:

```ts
it("GET /api/chat/threads/:id/messages returns only the owner's stored thread messages", async () => {
  const thread = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
    const created = await repository.openNewThread(scopedDb, { title: "Historical thread" });
    await repository.recordCompletedTurn(scopedDb, created.id, "old question", "old answer", {
      provider: "anthropic",
      model: "claude-live"
    });
    return created;
  });

  const owner = await server.inject({
    method: "GET",
    url: `/api/chat/threads/${thread.id}/messages`,
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  const other = await server.inject({
    method: "GET",
    url: `/api/chat/threads/${thread.id}/messages`,
    headers: { authorization: `Bearer ${ids.sessionB}` }
  });

  expect(owner.statusCode).toBe(200);
  expect(owner.json<{ messages: Array<{ body: string; role: string }> }>().messages).toEqual([
    expect.objectContaining({ role: "user", body: "old question" }),
    expect.objectContaining({ role: "assistant", body: "old answer" })
  ]);
  expect(other.statusCode).toBe(404);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/integration/chat-live-api.test.ts -t "threads/:id/messages"`

Expected: FAIL with 404 for owner request because route is missing.

- [ ] **Step 3: Add shared response schema**

In `packages/shared/src/chat-api.ts`, export:

```ts
export interface ListChatThreadMessagesResponse {
  readonly messages: readonly ChatMessageDto[];
}
```

Add `chatMessageSchema`, `listChatThreadMessagesResponseSchema`, and `listChatThreadMessagesRouteSchema` beside the existing thread list schema. Keep `modelRoute` nullable and `tools`/`activity` arrays.

- [ ] **Step 4: Implement route**

In `packages/chat/src/routes.ts`, add after `GET /api/chat/threads`:

```ts
server.get<{ Params: { id: string } }>(
  "/api/chat/threads/:id/messages",
  { schema: listChatThreadMessagesRouteSchema },
  async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const messages = await dependencies.dataContext.withDataContext(access, async (scopedDb) => {
        const thread = await repository.getThreadById(scopedDb, request.params.id);
        if (!thread) return null;
        return repository.listMessages(scopedDb, thread.id);
      });
      if (!messages) return reply.code(404).send({ error: "Chat thread not found" });
      return { messages: messages.map(serializeMessage) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Add `serializeMessage(message: ChatMessage): ChatMessageDto` with minimal metadata parsing:

```ts
function serializeMessage(message: ChatMessage): ChatMessageDto {
  const toolMetadata = asRecord(message.tool_metadata);
  return {
    id: message.id,
    threadId: message.thread_id,
    ownerUserId: message.owner_user_id,
    role: message.role,
    status: message.status,
    body: message.body,
    modelRoute: null,
    tools: readTools(toolMetadata.selectedTools),
    activity: readActivity(toolMetadata.activity),
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at)
  };
}
```

Use tiny local guards (`asRecord`, `readTools`, `readActivity`) so malformed JSON metadata degrades to `[]`, not 500.

- [ ] **Step 5: Verify green**

Run: `pnpm vitest run tests/integration/chat-live-api.test.ts -t "threads/:id/messages"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/chat-api.ts packages/chat/src/routes.ts tests/integration/chat-live-api.test.ts
git commit -m "feat(chat): expose owner-scoped thread messages" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 2: Drawer History Review

- [ ] **Step 1: Write failing E2E test**

Add to `tests/e2e/chat-drawer.spec.ts`:

```ts
test("clicking a history row renders stored messages read-only", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "thread-old",
        ownerUserId: "user-1",
        title: "Planning notes",
        createdAt: "2026-06-05T12:00:00.000Z",
        updatedAt: "2026-06-05T12:00:00.000Z"
      }
    ],
    chatMessages: {
      "thread-old": [
        {
          id: "msg-user",
          threadId: "thread-old",
          ownerUserId: "user-1",
          role: "user",
          status: "stored",
          body: "What did we decide?",
          modelRoute: null,
          tools: [],
          activity: [],
          createdAt: "2026-06-05T12:01:00.000Z",
          updatedAt: "2026-06-05T12:01:00.000Z"
        },
        {
          id: "msg-assistant",
          threadId: "thread-old",
          ownerUserId: "user-1",
          role: "assistant",
          status: "stored",
          body: "We chose the small path.",
          modelRoute: null,
          tools: [],
          activity: [{ kind: "tool", text: "Looked up prior notes" }],
          createdAt: "2026-06-05T12:02:00.000Z",
          updatedAt: "2026-06-05T12:02:00.000Z"
        }
      ]
    },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });

  await drawer.getByRole("button", { name: "Planning notes" }).click();

  await expect(drawer.getByText("What did we decide?")).toBeVisible();
  await expect(drawer.getByText("We chose the small path.")).toBeVisible();
  await expect(drawer.getByText("Looked up prior notes")).toBeVisible();
  await expect(drawer.getByLabel("Message Jarvis")).toBeDisabled();
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm test:e2e -- tests/e2e/chat-drawer.spec.ts -g "history row"`

Expected: FAIL because no history row renders.

- [ ] **Step 3: Add web client/query key**

In `apps/web/src/api/client.ts`:

```ts
export async function listChatThreadMessages(
  threadId: string
): Promise<ListChatThreadMessagesResponse> {
  return requestJson<ListChatThreadMessagesResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/messages`
  );
}
```

In `apps/web/src/api/query-keys.ts`:

```ts
messages: (threadId: string) => ["chat", "threads", threadId, "messages"] as const,
```

- [ ] **Step 4: Render history rows and selected stored records**

In `apps/web/src/chat/chat-drawer.tsx`:

- import `listChatThreadMessages`, `listChatThreads`, `type ChatMessageDto`, and `MessageSquareText` from `lucide-react`.
- add `const [reviewThreadId, setReviewThreadId] = useState<string | null>(null);`
- query `queryKeys.chat.threads` and `queryKeys.chat.messages(reviewThreadId)`.
- render `.chatd-sess` rows from `threadsQuery.data?.threads ?? []`; click sets `reviewThreadId`.
- compute `displayRecords = reviewThreadId ? recordsFromMessages(messagesQuery.data?.messages ?? []) : props.records`.
- pass `readOnly={Boolean(reviewThreadId)}` to `Composer`.
- `startNewChat` clears `reviewThreadId` before clearing live records.

Use helpers:

```ts
function recordsFromMessages(messages: readonly ChatMessageDto[]): TranscriptRecord[] {
  return messages.flatMap((message) => [
    ...message.activity.map((event) => ({
      kind: safeActivityKind(event.kind),
      text: event.text
    })),
    ...message.tools.map((tool) => ({
      kind: "tool" as const,
      text: tool.name
    })),
    {
      kind:
        message.role === "user"
          ? ("user" as const)
          : message.status === "error"
            ? ("error" as const)
            : ("reply" as const),
      text: message.body
    }
  ]);
}
```

- [ ] **Step 5: Add minimal CSS**

In `apps/web/src/styles/kit-chat.css`, add selected/review/read-only rules for:

```css
.chatd-sess__row.is-selected {
  background: var(--pine-soft);
  border-color: var(--accent);
}
.chatd-review {
  margin-bottom: 12px;
  color: var(--text-subtle);
  font-size: 12px;
}
.chatd-input.is-readonly {
  opacity: 0.72;
}
```

- [ ] **Step 6: Verify green**

Run: `pnpm test:e2e -- tests/e2e/chat-drawer.spec.ts -g "history row"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css tests/e2e/chat-drawer.spec.ts
git commit -m "feat(web): review stored chat threads" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 3: Focused Gate

- [ ] **Step 1: Run touched-slice checks**

```bash
pnpm vitest run tests/integration/chat-live-api.test.ts -t "threads/:id/messages"
pnpm test:e2e -- tests/e2e/chat-drawer.spec.ts -g "history row"
pnpm lint
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 2: Commit any test/lint fix**

Only if needed:

```bash
git add <explicit fixed paths>
git commit -m "fix(chat): finish thread review checks" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Self-Review

- Spec coverage: click history row, load stored messages, owner-scoped API, read-only historical review, existing drawer skin, stored activity/tool metadata.
- Skipped: resume/send on old sessions, summaries, replay, new styling system, migration. Add only if Coordinator expands scope.
