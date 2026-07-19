# AssistantSurface Contract v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` to implement this plan task-by-task. This coordinated lane executes inline; `executing-plans` and `subagent-driven-development` are disabled by repo policy. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let external module screens host the shared Jarvis conversation inline while the global drawer stands down.

**Architecture:** Keep `useChatStream()` singular in `AppShell`, expose its records and a surface-presence registration callback through one host context, and bind a stable `AssistantSurfaceHandleV1` to each external module id at `ExternalModuleMount`. The surface reuses `Thread` (therefore `MarkdownMessage` and `ActionRequestCard`), wraps existing attachment/turn clients, and adds only a small text composer because the drawer `Composer` carries unrelated history, model, voice, skill, and private-chat state.

**Tech Stack:** React 19, TypeScript, Vitest + server/test renderer, Playwright route mocks, existing `jds-*` CSS/tokens.

## Global Constraints

- Approved source: `docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md`, issue #1196, Part of #1193.
- Contract change is additive: keep `JARVIS_WEB_CONTRACT_VERSION = 1`; do not mutate frozen `__JARVIS_MODULE_RUNTIME__`.
- Host always supplies `assistantSurface`; optional typing exists only for older-host module degradation.
- `moduleId` comes only from `ExternalModuleMount`; module input never chooses it.
- One actor-keyed chat session and one shell-owned `useChatStream()` remain the source of truth.
- Default record kinds: `user`, `reply`, `action_request`, `action_result`, `error`.
- `activeControl` renders after every conversation row; optional composer renders below the transcript.
- Reuse `Thread`, `MarkdownMessage`, `ActionRequestCard`, `sendChatTurn`, and `uploadChatAttachment`; add no dependency.
- Raw CSS colors stay in `apps/web/src/styles/tokens.css`; new CSS uses semantic tokens only.
- Preserve the authored sans/letterspaced `jds-*` idiom; no emoji.
- Test first. Each slice ends green and commits only explicit paths with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then `git fetch origin main && git rebase origin/main`.
- Before every PR: `pnpm verify:foundation` must exit 0. Do not merge.

## Verified Branch State

- `apps/web/src/chat/assistant-surface/` does not exist.
- No `assistantSurface`, `/api/chat/module-onboarding`, `.jds-bubble`, chip-toggle, or typing-dot implementation exists.
- `AppShell` is the only caller of `useChatStream()` and owns `records`, drawer state, and `openAssistantWithDraft`.
- `ExternalModuleMount` currently passes only `hostActions`.
- `Thread` already renders live markdown, action request cards, user attachments, errors, and grouped action results.
- Existing external-module and chat SSE Playwright fixtures can be extended without a new harness.

## Coordinator Decisions Confirmed at Approval

1. This plan fills the spec's undefined `LocalRow` with the smallest prototype-compatible shape:

   ```ts
   export interface LocalRow {
     readonly id: string;
     readonly role: "assistant" | "user";
     readonly content: ReactNodeLike;
   }
   ```

   Surface order is `localRows` (input order) → filtered live records → typing → `activeControl`. No speculative cross-source timeline protocol is added; Lane E can pass the complete scripted prefix while live records remain in stream order.

2. Requested split is three independently green commits/review slices published as one ready-for-review PR. No stacked branches or draft PR.

---

### Task 1: Core AssistantSurface view and JDS primitives (review slice 1)

**Files:**

- Create: `apps/web/src/chat/assistant-surface/contracts.ts`
- Create: `apps/web/src/chat/assistant-surface/host-context.ts`
- Create: `apps/web/src/chat/assistant-surface/surface.tsx`
- Create: `apps/web/src/chat/assistant-surface/index.ts`
- Create: `apps/web/src/chat/assistant-surface/assistant-surface.css`
- Modify: `apps/web/src/styles/components-core.css`
- Test: `tests/unit/assistant-surface.test.tsx`

**Interfaces:**

- Consumes: `TranscriptRecord`, `ChatRecordKind`, and `Thread` from existing chat code.
- Produces: normative `AssistantSurfaceViewProps`, `LocalRow`, `AssistantRecordV1`, `AssistantSurfaceHostValue`, `AssistantSurfaceHostProvider`, `useAssistantSurfaceHost`, and `AssistantSurface`.

- [ ] **Step 1: Write the failing surface render/filter/order test**

  Create a Vitest server-render test with records for all major kinds and local/control nodes. The assertions lock the default filter and required order:

  ```tsx
  const records: readonly TranscriptRecord[] = [
    { kind: "thinking", text: "hidden thought" },
    { kind: "user", text: "Streamed user" },
    { kind: "reply", text: "**Streamed reply**" },
    {
      kind: "action_request",
      text: "Approve profile",
      actionRequestId: "ar-1",
      toolName: "job-search.profile.approve",
      summary: "Approve profile"
    },
    { kind: "action_result", text: "Profile approved", outcome: "executed" },
    { kind: "error", text: "Visible failure" }
  ];

  const html = renderToString(
    <AssistantSurfaceHostProvider
      value={{
        records,
        registerComposer: () => () => undefined,
        subscribeRecords: () => () => undefined
      }}
    >
      <AssistantSurface
        localRows={[
          { id: "intro", role: "assistant", content: "Scripted intro" },
          { id: "answer", role: "user", content: "Scripted answer" }
        ]}
        activeControl={<button type="button">Choose sources</button>}
        typing
      />
    </AssistantSurfaceHostProvider>
  );

  expect(html).not.toContain("hidden thought");
  expect(html).toContain("<strong>Streamed reply</strong>");
  expect(html).toContain("Approve profile");
  expect(html.indexOf("Scripted intro")).toBeLessThan(html.indexOf("Streamed user"));
  expect(html.indexOf("Streamed user")).toBeLessThan(html.indexOf("Choose sources"));
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run tests/unit/assistant-surface.test.tsx`

  Expected: FAIL because `apps/web/src/chat/assistant-surface/index.ts` does not exist.

- [ ] **Step 3: Add exact additive view contracts**

  `contracts.ts` defines the spec names without duplicating the live record model:

  ```ts
  import type { ReactNode } from "react";
  import type { ChatRecordKind, TranscriptRecord } from "../use-chat-stream";

  export type ReactNodeLike = ReactNode;
  export type AssistantRecordV1 = TranscriptRecord;

  export interface LocalRow {
    readonly id: string;
    readonly role: "assistant" | "user";
    readonly content: ReactNodeLike;
  }

  export interface AssistantSurfaceViewProps {
    readonly localRows?: readonly LocalRow[];
    readonly activeControl?: ReactNodeLike;
    readonly recordKinds?: readonly ChatRecordKind[];
    readonly composer?: {
      readonly placeholder?: string;
      readonly onSubmitText?: (text: string) => "handled" | "send";
    };
    readonly typing?: boolean;
  }
  ```

- [ ] **Step 4: Add one focused host context**

  `host-context.ts` owns only data the host surface cannot receive from module props:

  ```ts
  export interface AssistantSurfaceHostValue {
    readonly records: readonly AssistantRecordV1[];
    readonly registerComposer: (acceptDraft: (draft: string) => void) => () => void;
    readonly subscribeRecords: (
      listener: (records: readonly AssistantRecordV1[]) => void
    ) => () => void;
  }

  const AssistantSurfaceHostContext = createContext<AssistantSurfaceHostValue | null>(null);
  export const AssistantSurfaceHostProvider = AssistantSurfaceHostContext.Provider;

  export function useAssistantSurfaceHost(): AssistantSurfaceHostValue {
    const value = useContext(AssistantSurfaceHostContext);
    if (!value) throw new Error("AssistantSurface must be rendered inside AppShell");
    return value;
  }
  ```

- [ ] **Step 5: Implement minimum surface view**

  `surface.tsx` uses `Thread` for all live records, local `jds-bubble` rows for scripted nodes, a reduced-motion-safe typing row, and a small controlled form. Submit behavior is exact: trim, call intercept, and dispatch `sendChatTurn` unless intercept returns `"handled"`.

  ```tsx
  const DEFAULT_RECORD_KINDS = new Set<ChatRecordKind>([
    "user",
    "reply",
    "action_request",
    "action_result",
    "error"
  ]);

  export function AssistantSurface(props: AssistantSurfaceViewProps) {
    const { records, registerComposer } = useAssistantSurfaceHost();
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const allowed = new Set(props.recordKinds ?? DEFAULT_RECORD_KINDS);
    const visibleRecords = records.filter((record) => allowed.has(record.kind));

    useEffect(
      () =>
        registerComposer((nextDraft) => {
          setDraft(nextDraft);
          requestAnimationFrame(() => inputRef.current?.focus());
        }),
      [registerComposer]
    );

    const submit = () => {
      const text = draft.trim();
      if (!text) return;
      const outcome = props.composer?.onSubmitText?.(text) ?? "send";
      if (outcome === "send") void sendChatTurn(text);
      setDraft("");
    };

    return (
      <section className="assistant-surface" aria-label="Jarvis conversation">
        <div className="assistant-surface__thread" aria-live="polite">
          {props.localRows?.map((row) => (
            <div
              className={`assistant-surface__row assistant-surface__row--${row.role}`}
              key={row.id}
            >
              <div className={`jds-bubble jds-bubble--${row.role}`}>{row.content}</div>
            </div>
          ))}
          <Thread records={visibleRecords} />
          {props.typing ? <TypingRow /> : null}
          {props.activeControl ? (
            <div className="assistant-surface__row assistant-surface__row--control">
              {props.activeControl}
            </div>
          ) : null}
        </div>
        {props.composer ? (
          <form
            className="assistant-surface__composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={inputRef}
              aria-label="Message Jarvis"
              value={draft}
              rows={1}
              placeholder={props.composer.placeholder ?? "Message Jarvis…"}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="jds-btn jds-btn--primary" type="submit">
              Send
            </button>
          </form>
        ) : null}
      </section>
    );
  }
  ```

- [ ] **Step 6: Add host CSS primitives and surface layout**

  Extend `components-core.css` with `.jds-bubble`, `.jds-bubble--assistant`, `.jds-bubble--user`, `.jds-chip--toggle` plus `[aria-pressed="true"]`, and `.jds-typing-dot`/`@keyframes jds-typing-dot`. Use `var(--radius-xs)` (4px), `var(--radius-card)` (12px), `--surface-*`, `--accent`, `--text-on-accent`, `--border`, and existing spacing tokens only. Add a `prefers-reduced-motion` rule that disables dot animation.

  `assistant-surface.css` supplies only layout selectors for transcript rows, composer, focus border, and responsive width; import it from `surface.tsx`.

- [ ] **Step 7: Export the surface package and make test GREEN**

  `index.ts` exports contracts, host context, and `AssistantSurface`. Run:

  `pnpm vitest run tests/unit/assistant-surface.test.tsx && pnpm check:design-tokens && pnpm --filter @jarv1s/web typecheck`

  Expected: all commands exit 0.

- [ ] **Step 8: Commit review slice 1**

  ```bash
  git add apps/web/src/chat/assistant-surface/contracts.ts apps/web/src/chat/assistant-surface/host-context.ts apps/web/src/chat/assistant-surface/surface.tsx apps/web/src/chat/assistant-surface/index.ts apps/web/src/chat/assistant-surface/assistant-surface.css apps/web/src/styles/components-core.css tests/unit/assistant-surface.test.tsx
  git commit -m "feat(web): add embeddable assistant surface" -m "Module screens can render the shared Jarvis transcript with scripted rows, controls, and an optional composer." -m "Part of #1193" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 2: Contract v1.1 client and host binding (review slice 2)

**Files:**

- Create: `apps/web/src/chat/assistant-surface/handle.ts`
- Modify: `apps/web/src/chat/assistant-surface/contracts.ts`
- Modify: `apps/web/src/chat/assistant-surface/index.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/external-modules/loader.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/shell/app-shell.tsx`
- Test: `tests/unit/assistant-surface-handle.test.tsx`
- Test: `tests/e2e/mock-modules.ts`
- Test: `tests/e2e/external-modules.spec.ts`

**Interfaces:**

- Consumes: `AssistantSurface`, existing `/api/chat/turn`, and existing attachment upload response.
- Produces: exact `AssistantSurfaceHandleV1`, `seedModuleOnboarding(moduleId)`, optional third `controlContext` argument on `sendChatTurn`, and unconditional host-bound `assistantSurface` prop.

- [ ] **Step 1: Write failing client/handle tests**

  Mock `fetch`, construct a handle for `job-search`, then assert:

  ```ts
  await handle.seedOnboarding();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/chat/module-onboarding"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ moduleId: "job-search" })
    })
  );

  await handle.submitTurn({
    text: "Use these titles",
    controlContext: { step: "titles" },
    attachmentIds: ["att-1"]
  });
  expect(readPostedBody("/api/chat/turn")).toEqual({
    text: "Use these titles",
    controlContext: { step: "titles" },
    attachmentIds: ["att-1"]
  });
  ```

  Also return an upload envelope and assert the public shape is exactly `{ id, fileName, sizeBytes }`.

- [ ] **Step 2: Run focused test and verify RED**

  Run: `pnpm vitest run tests/unit/assistant-surface-handle.test.tsx`

  Expected: FAIL because `createAssistantSurfaceHandle` and `seedModuleOnboarding` do not exist.

- [ ] **Step 3: Extend existing chat client, no parallel transport**

  Add:

  ```ts
  export async function sendChatTurn(
    text: string,
    attachmentIds?: readonly string[],
    controlContext?: Readonly<Record<string, unknown>>
  ): Promise<SendChatTurnResponse> {
    return requestJson<SendChatTurnResponse>("/api/chat/turn", {
      method: "POST",
      body: {
        text,
        ...(controlContext ? { controlContext } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {})
      }
    });
  }

  export function seedModuleOnboarding(moduleId: string): Promise<{ ok: boolean }> {
    return requestJson("/api/chat/module-onboarding", {
      method: "POST",
      body: { moduleId }
    });
  }
  ```

  Lane A owns server behavior; Lane C adds no route.

- [ ] **Step 4: Add exact handle contract and factory**

  Add the normative interface to `contracts.ts`, then implement `handle.ts`:

  ```ts
  export interface AssistantSurfaceHandleV1 {
    readonly Surface: ComponentType<AssistantSurfaceViewProps>;
    seedOnboarding(): Promise<{ ok: boolean }>;
    submitTurn(input: {
      readonly text: string;
      readonly controlContext?: Record<string, unknown>;
      readonly attachmentIds?: readonly string[];
    }): Promise<void>;
    uploadAttachment(file: File): Promise<{ id: string; fileName: string; sizeBytes: number }>;
    subscribeRecords(listener: (records: readonly AssistantRecordV1[]) => void): () => void;
  }

  export function createAssistantSurfaceHandle(
    moduleId: string,
    subscribeRecords: AssistantSurfaceHandleV1["subscribeRecords"]
  ): AssistantSurfaceHandleV1 {
    return {
      Surface: AssistantSurface,
      seedOnboarding: () => seedModuleOnboarding(moduleId),
      async submitTurn(input) {
        await sendChatTurn(input.text, input.attachmentIds, input.controlContext);
      },
      async uploadAttachment(file) {
        const { attachment } = await uploadChatAttachment(file, file.name);
        return {
          id: attachment.id,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes
        };
      },
      subscribeRecords
    };
  }
  ```

- [ ] **Step 5: Extend loader contract additively**

  Add a type-only import and optional member:

  ```ts
  export interface ExternalWebContributionProps {
    readonly hostActions: ExternalModuleHostActionsV1;
    readonly assistantSurface?: AssistantSurfaceHandleV1;
  }
  ```

  Keep `JARVIS_WEB_CONTRACT_VERSION = 1` and `installModuleHostRuntime()` byte-for-byte unchanged apart from surrounding import line shifts.

- [ ] **Step 6: Add shell record subscription without suppression yet**

  In `AppShell`, keep a ref-backed listener set. `subscribeRecords` immediately emits current records, returns an unsubscribe, and an effect emits future arrays. Wrap `props.children` in `AssistantSurfaceHostProvider` with `records` and a temporary no-op `registerComposer`; Task 3 replaces only that callback with presence behavior.

- [ ] **Step 7: Bind handle unconditionally at `ExternalModuleMount`**

  Read `subscribeRecords` from the host context, memoize by `moduleId` + subscription identity, and render:

  ```tsx
  return <Component hostActions={hostActions} assistantSurface={assistantSurface} />;
  ```

  No module id appears in the handle's public methods.

- [ ] **Step 8: Add a contract e2e assertion to existing fixture**

  Extend `mockExternalWebModule`'s inline bundle with a visible `data-assistant-surface` marker when `props.assistantSurface` exists. In `external-modules.spec.ts`, navigate to `/m/job-search` and assert the marker exists while the legacy `hostActions` button still works. This locks unconditional binding and additive compatibility before suppression behavior is introduced.

- [ ] **Step 9: Run focused checks GREEN**

  Run:

  `pnpm vitest run tests/unit/assistant-surface-handle.test.tsx tests/unit/external-host-actions.test.ts && pnpm test:e2e -- tests/e2e/external-modules.spec.ts && pnpm --filter @jarv1s/web typecheck`

  Expected: all commands exit 0; old starter draft test remains green.

- [ ] **Step 10: Commit review slice 2**

  ```bash
  git add apps/web/src/chat/assistant-surface/contracts.ts apps/web/src/chat/assistant-surface/handle.ts apps/web/src/chat/assistant-surface/index.ts apps/web/src/api/client.ts apps/web/src/external-modules/loader.ts apps/web/src/app.tsx apps/web/src/shell/app-shell.tsx tests/unit/assistant-surface-handle.test.tsx tests/e2e/mock-modules.ts tests/e2e/external-modules.spec.ts
  git commit -m "feat(web): bind assistant surface to external modules" -m "Enabled modules receive a host-bound assistant handle for seeding, turns, uploads, and shared transcript records." -m "Part of #1193" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 3: Surface presence, drawer suppression, and fixture e2e (review slice 3)

**Files:**

- Modify: `apps/web/src/chat/assistant-surface/host-context.ts`
- Modify: `apps/web/src/shell/app-shell.tsx`
- Modify: `tests/e2e/mock-modules.ts`
- Create: `tests/e2e/assistant-surface.spec.ts`

**Interfaces:**

- Consumes: Task 1 `registerComposer` mount lifecycle and Task 2 unconditional handle.
- Produces: topbar suppression, force-close, embedded draft rerouting, and unmount restoration.

- [ ] **Step 1: Write failing mocked e2e covering all issue exit behaviors**

  Add `mockAssistantSurfaceWebModule(page)` that serves a fixture Root rendering `props.assistantSurface.Surface` with:
  - two `localRows` in known order;
  - `recordKinds: ["reply", "action_request"]`;
  - an `activeControl` button that calls `props.hostActions.openAssistant({ starterPrompt: "Draft routed inline" })`;
  - `composer: { placeholder: "Message embedded Jarvis" }`.

  Stream a markdown reply and action request through `/api/chat/stream`. Test sequence:

  ```ts
  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  await expect(page.getByRole("dialog", { name: "Chat with Jarvis" })).toBeVisible();
  await page.getByRole("link", { name: "Job Search" }).click();

  const toggle = page.getByRole("button", { name: "Chat with Jarvis" });
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Chat with Jarvis" })).toHaveCount(0);
  await expect(page.locator(".assistant-surface .chatd-md strong")).toHaveText("Embedded reply");
  await expect(page.locator(".assistant-surface .action-request-card")).toBeVisible();

  await page.getByRole("button", { name: "Route draft inline" }).click();
  const composer = page.getByRole("textbox", { name: "Message Jarvis" });
  await expect(composer).toHaveValue("Draft routed inline");
  await expect(composer).toBeFocused();

  await page.getByRole("link", { name: "Today" }).click();
  await expect(toggle).toBeEnabled();
  ```

- [ ] **Step 2: Run focused e2e and verify RED**

  Run: `pnpm test:e2e -- tests/e2e/assistant-surface.spec.ts`

  Expected: FAIL because Task 2's `registerComposer` is a no-op and topbar remains enabled.

- [ ] **Step 3: Implement one presence registration seam in AppShell**

  Store the current embedded draft receiver in a ref and only one boolean in state:

  ```ts
  const embeddedComposerRef = useRef<((draft: string) => void) | null>(null);
  const [assistantSurfacePresent, setAssistantSurfacePresent] = useState(false);

  const registerComposer = useCallback((acceptDraft: (draft: string) => void) => {
    embeddedComposerRef.current = acceptDraft;
    setAssistantSurfacePresent(true);
    setChatOpen(false);
    setModuleDraft(undefined);
    setFocusActionRequestId(null);
    return () => {
      if (embeddedComposerRef.current !== acceptDraft) return;
      embeddedComposerRef.current = null;
      setAssistantSurfacePresent(false);
    };
  }, []);
  ```

  This matches shell routing: one external route is mounted at a time. No registry/factory is added for hypothetical simultaneous surfaces.

- [ ] **Step 4: Reroute legacy host action and disable toggle**

  Replace `openAssistantWithDraft` body with:

  ```ts
  const openAssistantWithDraft = useCallback((draft: string) => {
    const embeddedComposer = embeddedComposerRef.current;
    if (embeddedComposer) {
      embeddedComposer(draft);
      return;
    }
    setModuleDraft(draft);
    setChatOpen(true);
  }, []);
  ```

  Add `disabled={assistantSurfacePresent}` to the topbar chat button. Pass the real `registerComposer` into `AssistantSurfaceHostProvider`. Unmount cleanup restores enabled toggle and drawer routing.

- [ ] **Step 5: Verify focused and regression suites GREEN**

  Run:

  `pnpm test:e2e -- tests/e2e/assistant-surface.spec.ts tests/e2e/external-modules.spec.ts tests/e2e/chat-drawer.spec.ts tests/e2e/app-shell.spec.ts`

  Expected: all tests pass. The existing #916 editable drawer draft test proves unmounted fallback still works.

- [ ] **Step 6: Run lane gate and resync graph**

  Run:

  ```bash
  pnpm format:check
  pnpm lint
  pnpm check:file-size
  pnpm check:design-tokens
  pnpm typecheck
  pnpm verify:foundation
  codegraph sync .
  ```

  Expected: every command exits 0. Record actual exit codes in closeout.

- [ ] **Step 7: Commit review slice 3**

  ```bash
  git add apps/web/src/chat/assistant-surface/host-context.ts apps/web/src/shell/app-shell.tsx tests/e2e/mock-modules.ts tests/e2e/assistant-surface.spec.ts
  git commit -m "feat(web): suppress drawer for embedded assistant" -m "Inline module conversations now own assistant focus, close the drawer, and receive routed starter drafts until unmount." -m "Part of #1193" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 4: Publish approved PR split and report

**Files:** None unless coordinator requests PR-body notes in-repo.

**Interfaces:** Produces PR URL(s) and verified evidence; coordinator owns QA, merge, issue, and board.

- [ ] **Step 1: Confirm clean explicit diff**

  Run: `git status --short && git diff --check && git log --oneline origin/main..HEAD`

  Expected: clean tree, no whitespace errors, exactly three feature commits plus any coordinator-approved plan commit handling.

- [ ] **Step 2: Run mandatory pre-push trio and fresh rebase**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  git fetch origin main
  git rebase origin/main
  ```

  Expected: exit 0 and no unresolved conflicts. Re-run focused tests if rebase changes touched files.

- [ ] **Step 3: Use `coordinated-wrap-up`**

  Follow its instructions exactly. Open one ready-for-review PR for `feat/1196-assistant-surface`; PR body includes user-facing summary, tests with exit codes, `Part of #1193`, and no merge/board mutation.

## Self-Review

- Spec coverage: surface rendering, default/filter record kinds, local/control/typing rows, optional intercept composer, handle methods, module id binding, shared stream, seed client, attachment reuse, contract optionality, frozen runtime, suppression, force-close, reroute, restoration, CSS primitives, unit tests, and fixture e2e are each mapped above.
- Non-goals preserved: no server seed route, no module UI/phase machine, no new chat session, no dependency, no frozen-runtime edit.
- Placeholder scan: no deferred or content-free steps; coordinator decisions have concrete defaults.
- Type consistency: `AssistantRecordV1` aliases `TranscriptRecord`; `subscribeRecords`, handle factory, host context, and loader prop use the same contracts.
