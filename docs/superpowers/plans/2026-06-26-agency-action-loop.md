# Agency Action Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Jarv1s coordinated-build override:** subagent/executing skills are disabled for this repo handoff. The build agent executes this plan inline with `superpowers:test-driven-development` after Coordinator approval.

**Goal:** Route task assistant write tools through confirmation by default, let the user opt tasks into auto-execute, and keep destructive tools confirm-only.

**Architecture:** Put the trust decision in the existing gateway policy chokepoint. Inject a per-actor `AgencyPrefLookup` from chat composition, backed by `app.preferences`, and reuse existing action-request cards for confirmation. Add the task-owned settings surface and a tiny task route for the `tasks.agency_auto_execute` preference; no migration and no new confirmation machinery.

**Tech Stack:** TypeScript, Fastify, Kysely/DataContextDb, Vitest, React, TanStack Query, `@jarv1s/settings-ui`.

---

## Verified Branch State

- `packages/ai/src/gateway/policy.ts`: `resolvePolicy(tool)` is sync and currently runs `executionPolicy: "auto"` writes.
- `packages/ai/src/gateway/gateway.ts`: `callTool()` is the only `resolvePolicy` caller; `confirmAndRun()` already creates `app.ai_assistant_action_requests` and emits `action_request`.
- `packages/tasks/src/manifest.ts`: task write tools are `risk: "write"` + `executionPolicy: "auto"`; destructive list/tag delete tools are `risk: "destructive"`.
- `packages/tasks/src/manifest.ts`: settings entry exists but has no `entry`.
- `packages/tasks/src/settings/index.tsx`: absent.
- `packages/chat/src/routes.ts`: `buildChatGatewayDependencies()` is the gateway composition point and chat deps already receive a preferences port from module-registry.
- #497 admin-pin touched AI repository/admin routes; it does not change the gateway policy path.

## Files

- Modify `packages/ai/src/gateway/policy.ts`: async trust-tier policy.
- Modify `packages/ai/src/gateway/gateway.ts`: pass module id + actor-scoped prefs, emit first-run notice inside confirmation summary.
- Modify `packages/ai/src/gateway/types.ts`: no new context fields; only if needed for exported pref type.
- Modify `packages/chat/src/routes.ts`: build `AgencyPrefLookup` from `DataContextRunner` + injected preferences port.
- Modify `packages/tasks/src/routes.ts`: GET/PATCH task agency preference routes backed by `app.preferences`.
- Modify `packages/tasks/src/manifest.ts`: add task settings `entry` and route declarations.
- Create `packages/tasks/src/settings/index.tsx`: task-owned settings UI toggle.
- Modify `packages/tasks/package.json`: export `./settings`; add `@jarv1s/settings-ui`, `@tanstack/react-query`, `react`.
- Modify `packages/shared/src/tasks-api.ts`: add route schemas/types for task agency preference.
- Modify tests:
  - `tests/unit/mcp-gateway-units.test.ts`
  - `tests/integration/mcp-gateway.test.ts`
  - `tests/integration/tasks-agency-tools.test.ts`
  - `tests/integration/tasks-web-contract.test.ts`
  - `tests/unit/route-coverage.test.ts`

---

### Task 1: Async Policy With Trust Floor

**Files:**

- Modify: `packages/ai/src/gateway/policy.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write failing policy tests**

Change the `gateway policy` test to async and assert trust off/on plus fail-closed:

```ts
describe("gateway policy", () => {
  const tool = (risk: ModuleAssistantToolManifest["risk"]) =>
    ({
      name: `example.${risk}`,
      description: "Fixture.",
      permissionId: "example.use",
      risk
    }) satisfies ModuleAssistantToolManifest;

  it("runs reads and always confirms destructive tools", async () => {
    const prefs = { get: async () => true };

    await expect(resolvePolicy(tool("read"), "example", prefs)).resolves.toBe("run");
    await expect(
      resolvePolicy({ ...tool("destructive"), executionPolicy: "auto" }, "example", prefs)
    ).resolves.toBe("confirm");
  });

  it("only auto-runs auto write tools when module trust is enabled", async () => {
    await expect(
      resolvePolicy({ ...tool("write"), executionPolicy: "auto" }, "tasks", {
        get: async () => false
      })
    ).resolves.toBe("confirm");

    await expect(
      resolvePolicy({ ...tool("write"), executionPolicy: "auto" }, "tasks", {
        get: async (key) => key === "tasks.agency_auto_execute"
      })
    ).resolves.toBe("run");

    await expect(resolvePolicy(tool("write"), "tasks", { get: async () => true })).resolves.toBe(
      "confirm"
    );
  });

  it("confirms writes when preference lookup fails", async () => {
    await expect(
      resolvePolicy({ ...tool("write"), executionPolicy: "auto" }, "tasks", {
        get: async () => {
          throw new Error("db unavailable");
        }
      })
    ).resolves.toBe("confirm");
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run tests/unit/mcp-gateway-units.test.ts
```

Expected: TypeScript/runtime failure because `resolvePolicy` still has the old sync signature.

- [ ] **Step 3: Implement minimal async policy**

Use this shape in `packages/ai/src/gateway/policy.ts`:

```ts
import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

export interface AgencyPrefLookup {
  get(key: string): Promise<unknown>;
  upsert?(key: string, value: unknown): Promise<void>;
}

export async function resolvePolicy(
  tool: ModuleAssistantToolManifest,
  moduleId: string,
  prefs: AgencyPrefLookup
): Promise<PolicyDecision> {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";
  if (tool.executionPolicy !== "auto") return "confirm";

  try {
    return (await prefs.get(`${moduleId}.agency_auto_execute`)) === true ? "run" : "confirm";
  } catch {
    return "confirm";
  }
}
```

- [ ] **Step 4: Run test and commit**

Run:

```bash
pnpm vitest run tests/unit/mcp-gateway-units.test.ts
```

Commit:

```bash
git add packages/ai/src/gateway/policy.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(ai): gate auto tools on agency trust"
```

---

### Task 2: Gateway Uses Actor-Scoped Agency Prefs

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Modify: `packages/chat/src/routes.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write failing gateway tests**

Add/adjust tests so `AssistantToolGateway` gets `agencyPrefs`. Use an in-memory helper in unit tests:

```ts
function agencyPrefs(values: Record<string, unknown> = {}) {
  return () => ({
    get: async (key: string) => values[key] ?? null,
    upsert: async (key: string, value: unknown) => {
      values[key] = value;
    }
  });
}
```

Add assertions:

```ts
it("confirms auto write tools when module agency trust is off", async () => {
  const calls: string[] = [];
  const emitted: GatewaySessionRecord[] = [];
  const gateway = new AssistantToolGateway({
    resolveActiveModules: async () => [exampleWriteModule],
    repository,
    runner,
    tokens,
    confirmations,
    notifier: { emit: (_session, record) => emitted.push(record) },
    confirmTimeoutMs: 20,
    agencyPrefs: agencyPrefs({ "example.agency_auto_execute": false })
  });

  const res = await gateway.callTool(token, "example.writeAuto", { value: "x" });

  expect(res.ok).toBe(false);
  expect(calls).toHaveLength(0);
  expect(emitted.some((r) => r.kind === "action_request")).toBe(true);
});

it("runs auto write tools when module agency trust is on", async () => {
  const gateway = new AssistantToolGateway({
    ...baseDeps,
    agencyPrefs: agencyPrefs({ "example.agency_auto_execute": true })
  });

  const res = await gateway.callTool(token, "example.writeAuto", { value: "x" });

  expect(res.ok).toBe(true);
});
```

In `tests/integration/mcp-gateway.test.ts`, add a persisted-pref assertion with `app.preferences`:

```ts
await runner.withDataContext({ actorUserId: ids.userA, requestId: "trust-on" }, (scopedDb) =>
  scopedDb.db
    .insertInto("app.preferences")
    .values({
      owner_user_id: sql<string>`app.current_actor_user_id()`,
      key: "example.agency_auto_execute",
      value_json: sql`'true'::jsonb`,
      updated_at: new Date()
    })
    .onConflict((oc) =>
      oc.columns(["owner_user_id", "key"]).doUpdateSet({
        value_json: sql`'true'::jsonb`,
        updated_at: new Date()
      })
    )
    .execute()
);
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm vitest run tests/unit/mcp-gateway-units.test.ts tests/integration/mcp-gateway.test.ts
```

Expected: gateway deps lack `agencyPrefs`; `callTool()` still calls old resolver.

- [ ] **Step 3: Implement gateway injection**

In `packages/ai/src/gateway/gateway.ts`:

```ts
import type { AgencyPrefLookup } from "./policy.js";

export interface AssistantToolGatewayDependencies {
  // existing fields...
  readonly agencyPrefs?: (ctx: ToolContext) => AgencyPrefLookup;
}

const denyPrefs: AgencyPrefLookup = { get: async () => false };
```

In `callTool()`:

```ts
const prefs = this.deps.agencyPrefs?.(ctx) ?? denyPrefs;
const policy = await resolvePolicy(found.tool, found.dto.moduleId, prefs);
if (policy === "run") {
  return this.runHandler(found, input, ctx);
}
return this.confirmAndRun(found, input, ctx);
```

In `packages/chat/src/routes.ts`, import `type PreferencesPort` from `@jarv1s/db`, add `agencyPreferences?: PreferencesPort` to `ChatRoutesDependencies`, pass it into `buildChatGatewayDependencies`, and build:

```ts
function buildAgencyPrefs(args: {
  runner: DataContextRunner;
  preferences?: PreferencesPort;
}): AssistantToolGatewayDependencies["agencyPrefs"] {
  if (!args.preferences) return undefined;
  return (ctx) => ({
    get: (key) =>
      args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        (scopedDb) => args.preferences!.get(scopedDb, key)
      ),
    upsert: (key, value) =>
      args.runner.withDataContext(
        { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
        (scopedDb) => args.preferences!.upsert(scopedDb, key, value)
      )
  });
}
```

Pass `agencyPreferences: dependencies.agencyPreferences` into `buildChatGatewayDependencies()`. Do not reuse `personaPreferences`; its local interface is intentionally read-only.

- [ ] **Step 4: Wire module-registry**

In `packages/module-registry/src/index.ts`, pass:

```ts
agencyPreferences: new PreferencesRepository(),
```

beside existing `personaPreferences`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run tests/unit/mcp-gateway-units.test.ts tests/integration/mcp-gateway.test.ts
```

Commit:

```bash
git add packages/ai/src/gateway/gateway.ts packages/chat/src/routes.ts packages/module-registry/src/index.ts tests/unit/mcp-gateway-units.test.ts tests/integration/mcp-gateway.test.ts
git commit -m "feat(chat): inject agency trust preferences"
```

---

### Task 3: Task Trust Preference API And Settings Surface

**Files:**

- Modify: `packages/tasks/src/routes.ts`
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `packages/tasks/package.json`
- Create: `packages/tasks/src/settings/index.tsx`
- Modify: shared task API schema/types file under `packages/shared/src/`
- Test: `tests/integration/tasks-web-contract.test.ts`
- Test: `tests/unit/route-coverage.test.ts`

- [ ] **Step 1: Write failing API/manifest tests**

In `tests/unit/route-coverage.test.ts`, add:

```ts
expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/agency-auto-execute" });
expect(paths).toContainEqual({ method: "PATCH", path: "/api/tasks/agency-auto-execute" });
```

Also assert the settings entry is executable:

```ts
const manifest = getBuiltInModuleManifests().find((m) => m.id === "tasks");
expect(manifest?.settings?.[0]?.entry).toBe("./settings");
```

In `tests/integration/tasks-web-contract.test.ts`, add:

```ts
it("GET/PATCH /api/tasks/agency-auto-execute stores the task trust toggle per user", async () => {
  const initial = await server.inject({
    method: "GET",
    url: "/api/tasks/agency-auto-execute",
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  expect(initial.statusCode).toBe(200);
  expect(JSON.parse(initial.body)).toEqual({ enabled: false });

  const updated = await server.inject({
    method: "PATCH",
    url: "/api/tasks/agency-auto-execute",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { enabled: true }
  });
  expect(updated.statusCode).toBe(200);
  expect(JSON.parse(updated.body)).toEqual({ enabled: true });

  const reread = await server.inject({
    method: "GET",
    url: "/api/tasks/agency-auto-execute",
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  expect(JSON.parse(reread.body)).toEqual({ enabled: true });

  const otherUser = await server.inject({
    method: "GET",
    url: "/api/tasks/agency-auto-execute",
    headers: { authorization: `Bearer ${ids.sessionB}` }
  });
  expect(JSON.parse(otherUser.body)).toEqual({ enabled: false });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm vitest run tests/unit/route-coverage.test.ts tests/integration/tasks-web-contract.test.ts
```

Expected: routes and manifest entry missing.

- [ ] **Step 3: Add shared route contracts**

In `packages/shared/src/tasks-api.ts`, add:

```ts
export interface TaskAgencyAutoExecuteResponse {
  readonly enabled: boolean;
}

export interface UpdateTaskAgencyAutoExecuteRequest {
  readonly enabled: boolean;
}

export const taskAgencyAutoExecuteResponseSchema = {
  type: "object",
  required: ["enabled"],
  properties: {
    enabled: { type: "boolean" }
  }
} as const;

export const updateTaskAgencyAutoExecuteRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled"],
  properties: {
    enabled: { type: "boolean" }
  }
} as const;
```

- [ ] **Step 4: Add task routes**

In `packages/tasks/src/routes.ts`, add:

```ts
const TASKS_AGENCY_AUTO_EXECUTE_KEY = "tasks.agency_auto_execute";
```

Add dependency:

```ts
readonly agencyPreferencesRepository?: PreferencesPort;
```

Use the repo default from dependency; if there is no injected repo, use a tiny local adapter over `scopedDb.db` rather than adding a `@jarv1s/structured-state` dependency to tasks.

Register:

```ts
server.get(
  "/api/tasks/agency-auto-execute",
  { schema: getTaskAgencyAutoExecuteRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const enabled = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const value = await agencyPrefs.get(scopedDb, TASKS_AGENCY_AUTO_EXECUTE_KEY);
          return value === true;
        }
      );
      return { enabled };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

server.patch(
  "/api/tasks/agency-auto-execute",
  { schema: updateTaskAgencyAutoExecuteRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as UpdateTaskAgencyAutoExecuteRequest;
      await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        agencyPrefs.upsert(scopedDb, TASKS_AGENCY_AUTO_EXECUTE_KEY, body.enabled)
      );
      return { enabled: body.enabled };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

- [ ] **Step 5: Add manifest/package/settings surface**

In `packages/tasks/src/manifest.ts`, add `entry: "./settings"` to the existing settings item and add GET/PATCH routes for `/api/tasks/agency-auto-execute`.

In `packages/tasks/package.json`, add:

```json
"exports": {
  ".": "./src/index.ts",
  "./settings": "./src/settings/index.tsx"
}
```

and dependencies:

```json
"@jarv1s/settings-ui": "workspace:*",
"@tanstack/react-query": "^5.0.0",
"react": "^19.0.0"
```

Create `packages/tasks/src/settings/index.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Group, Note, PaneHead, Row, Switch } from "@jarv1s/settings-ui";
import type {
  TaskAgencyAutoExecuteResponse,
  UpdateTaskAgencyAutoExecuteRequest
} from "@jarv1s/shared";

const AGENCY_AUTO_EXECUTE_KEY = ["tasks", "agency-auto-execute"] as const;

async function requestJson<T>(path: string, init?: RequestInit & { body?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(path, {
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "include",
    headers
  });
  if (!response.ok) throw new Error(response.statusText || "Request failed");
  return (await response.json()) as T;
}

function getAgencyAutoExecute(): Promise<TaskAgencyAutoExecuteResponse> {
  return requestJson<TaskAgencyAutoExecuteResponse>("/api/tasks/agency-auto-execute");
}

function patchAgencyAutoExecute(enabled: boolean): Promise<TaskAgencyAutoExecuteResponse> {
  return requestJson<TaskAgencyAutoExecuteResponse>("/api/tasks/agency-auto-execute", {
    method: "PATCH",
    body: { enabled } satisfies UpdateTaskAgencyAutoExecuteRequest
  });
}

export default function TasksSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: AGENCY_AUTO_EXECUTE_KEY, queryFn: getAgencyAutoExecute });
  const mutation = useMutation({
    mutationFn: patchAgencyAutoExecute,
    onSuccess: (data) => queryClient.setQueryData(AGENCY_AUTO_EXECUTE_KEY, data)
  });

  const enabled = (mutation.data ?? query.data)?.enabled ?? false;
  const disabled = query.isLoading || mutation.isPending;
  const error = query.isError || mutation.isError;

  return (
    <>
      <PaneHead title="Tasks" desc="How Jarvis handles task changes from chat." />
      <Group title="Jarvis actions">
        <Row
          name="Let Jarvis create and update tasks without asking"
          desc="When off, Jarvis asks before creating, updating, scheduling, or completing tasks from chat."
          control={
            <Switch
              ariaLabel="Let Jarvis create and update tasks without asking"
              checked={enabled}
              disabled={disabled}
              onChange={(value) => mutation.mutate(value)}
            />
          }
        />
      </Group>
      {error ? <Note>Could not save task action preference. Try again.</Note> : null}
    </>
  );
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm vitest run tests/unit/route-coverage.test.ts tests/integration/tasks-web-contract.test.ts
pnpm --filter @jarv1s/tasks typecheck
```

Commit:

```bash
git add packages/tasks/src/routes.ts packages/tasks/src/manifest.ts packages/tasks/src/settings/index.tsx packages/tasks/package.json packages/shared/src tests/unit/route-coverage.test.ts tests/integration/tasks-web-contract.test.ts
git commit -m "feat(tasks): add agency trust setting"
```

---

### Task 4: Task Proposal Behavior And First-Run Notice

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Test: `tests/integration/tasks-agency-tools.test.ts`

- [ ] **Step 1: Write failing task gateway behavior tests**

Change the old auto-run tests in `tests/integration/tasks-agency-tools.test.ts`.

For trust off:

```ts
it("confirms task writes until task trust is enabled", async () => {
  const call = gateway.callTool(tokenFor(ids.userA), "tasks.create", {
    title: "gateway agency task"
  });
  await tick();

  const request = emitted.find((entry) => entry.record.kind === "action_request")?.record;
  expect(request?.toolName).toBe("tasks.create");
  expect(request?.summary).toContain("Jarvis now asks before creating tasks");

  const taskBeforeApproval = await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "check-before-task-approval" },
    (db) => tasksRepository.listFiltered(db, {})
  );
  expect(taskBeforeApproval.some((task) => task.title === "gateway agency task")).toBe(false);

  await gateway.resolveActionRequest(ids.userA, request!.actionRequestId, "confirmed");
  const response = await call;
  expect(response.ok).toBe(true);
});
```

For trust on, seed `app.preferences` key `tasks.agency_auto_execute` to true under `ids.userA` and assert no action request is emitted.

For destructive floor, use `tasks.deleteList` with trust on and assert it still emits `action_request`.

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run tests/integration/tasks-agency-tools.test.ts
```

Expected: existing gateway still auto-runs tasks or no first-run notice.

- [ ] **Step 3: Implement first-run notice in existing action-request summary**

Keep this in the gateway, not the UI. Add:

```ts
const TASKS_FIRST_RUN_NOTICE_KEY = "tasks.agency_auto_execute.first_prompt_seen";
const TASKS_FIRST_RUN_NOTICE =
  'Jarvis now asks before creating tasks. Enable "create without asking" in Task settings to auto-run task changes.';
```

Before `confirmAndRun()`, compute optional prefix only for `found.dto.moduleId === "tasks"`, `found.tool.risk === "write"`, and `found.tool.executionPolicy === "auto"`. If `prefs.upsert` exists and `prefs.get(TASKS_FIRST_RUN_NOTICE_KEY) !== true`, write true and pass the notice into `confirmAndRun()`.

Change `confirmAndRun()` signature to accept `notice?: string` and emit:

```ts
const summary = [notice, this.summaryFor(found.tool, input, ctx)].filter(Boolean).join(" ");
```

Use `summary` in notifier emission. Keep the persisted `inputSummary` unchanged.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
pnpm vitest run tests/integration/tasks-agency-tools.test.ts tests/integration/mcp-gateway.test.ts
```

Commit:

```bash
git add packages/ai/src/gateway/gateway.ts tests/integration/tasks-agency-tools.test.ts tests/integration/mcp-gateway.test.ts
git commit -m "feat(ai): explain first task confirmations"
```

---

### Task 5: Focused Verification, Format, Reindex

**Files:**

- No planned source edits except fixes from red tests.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run tests/unit/mcp-gateway-units.test.ts tests/unit/route-coverage.test.ts tests/integration/mcp-gateway.test.ts tests/integration/tasks-agency-tools.test.ts tests/integration/tasks-web-contract.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run frontend/package checks**

Run:

```bash
pnpm --filter @jarv1s/tasks typecheck
pnpm --filter @jarv1s/chat typecheck
pnpm --filter @jarv1s/ai typecheck
pnpm check:design-tokens
```

Expected: all pass.

- [ ] **Step 3: Run pre-push trio and rebase**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all pass; branch rebased cleanly.

- [ ] **Step 4: Refresh graph index**

Run:

```bash
codegraph sync .
```

Expected: index refresh succeeds; do not commit `.codegraph/`.

- [ ] **Step 5: Invoke coordinated wrap-up**

Use `coordinated-wrap-up`: full gate, push branch, open PR, report PR + evidence to Coordinator. Do not move board, close issue, merge, or edit milestones.

---

## Spec Coverage Check

- Structured task proposal cards: Task 2/4 route `executionPolicy: "auto"` writes through existing `action_request`.
- Approve executes tool: existing `confirmAndRun()` path preserved and tested in Task 4.
- Task-owned toggle: Task 3 settings surface under `packages/tasks/src/settings/index.tsx`.
- Toggle ON auto-runs: Task 2/4 tests.
- Toggle OFF confirms even auto-declared writes: Task 1/2/4 tests.
- Destructive always confirms: Task 1/4 tests.
- First-run prompt: Task 4 summary prefix, one-time via `app.preferences`.
- `resolvePolicy` async + injected lookup, no new `AccessContext`/`ToolContext` fields: Task 1/2.
- No migration: all preference state uses `app.preferences`.
- Edit button: intentionally skipped; spec says optional and deny/re-ask is acceptable for slice-1.
