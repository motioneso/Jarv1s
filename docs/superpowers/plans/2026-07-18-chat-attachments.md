# Chat Attachments (#1133 / task #1154) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can attach files (PDF/text/images) and paste clipboard screenshots into the global chat drawer, and the CLI engine can actually read them.

**Architecture:** Bytes live in the user's vault (`attachments/<id>/{blob,meta.json}`) written through `VaultContext`. Upload is a raw `application/octet-stream` POST (no multipart). The turn request carries `attachmentIds`; the session manager appends a server-composed `<attachments>` manifest to the engine text; the engine reads content on demand via a new `chat.readAttachment` MCP gateway tool. Images bypass the gateway's 16k text render via a new `media` pass-through on `ToolResult`/`GatewayToolResponse`, emitted as an MCP image content block.

**Tech Stack:** Fastify raw-body route, `@jarv1s/vault`, MCP gateway assistant tools, `pdf-parse` (dynamic import of `pdf-parse/lib/pdf-parse.js` to dodge its module-root debug read), React composer UI, vitest + Playwright #1000 harness.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-chat-attachments-design.md`. Mime whitelist: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `text/*`, `application/json`. Caps: images ≤ 5 MB, pdf/text ≤ 10 MB, ≤ 5 attachments per turn, ≤ 20 pending uploads per user, pending GC after 24 h.
- Declared mime travels in `x-jarvis-mime-type`; filename in `x-jarvis-file-name` (percent-encoded). Body content-type is always `application/octet-stream` (single exact buffer parser — avoids colliding with the default JSON/text parsers and the skills-import `text/markdown` parser). This supersedes the spec's "file's own content-type" wording; spec updated in Task 9.
- No DB migration. Attachment metadata rides `tool_metadata` on the user message.
- Never log/enqueue/persist attachment bytes. Filenames sanitized before engine-visible composition.
- Attach disabled in private/incognito mode.
- `chat-drawer.tsx` is at 999/1000 lines — any drawer growth requires extracting a block to a new file in the same commit.
- Generous why-comments citing #1133/#1154. Commits carry user-facing summary lines.

---

### Task 1: Shared contracts

**Files:** Modify `packages/shared/src/chat-api.ts`.

**Produces:**

```ts
export interface ChatAttachmentDto {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface UploadChatAttachmentResponse {
  readonly attachment: ChatAttachmentDto;
}
// SendChatTurnRequest gains: readonly attachmentIds?: readonly string[];
// ChatMessageDto gains: readonly attachments?: readonly ChatAttachmentDto[];
```

Steps: add types → `pnpm --filter @jarv1s/shared build` (or typecheck) → commit `feat(shared): chat attachment DTOs (#1154)`.

### Task 2: Vault byte helpers

**Files:** Modify `packages/vault/src/vault-ops.ts`, `packages/vault/src/index.ts`; Test `packages/vault/src/vault-ops.test.ts` (or existing test file).

**Produces:**

```ts
export async function readVaultFileBytes(ctx: VaultContext, relativePath: string): Promise<Buffer>;
export async function writeVaultFileBytes(
  ctx: VaultContext,
  relativePath: string,
  content: Buffer
): Promise<void>;
```

Identical body to the string variants minus the `"utf8"` encoding (same `resolveVaultPath` + `assertNoSymlinkEscape` + mkdir 0700 + write/chmod 0600). TDD: failing test (binary roundtrip preserves bytes, mode is 0600, `../` escape throws `VaultPathError`) → implement → `pnpm --filter @jarv1s/vault test` → commit.

### Task 3: Media pass-through (module-sdk → gateway → MCP)

**Files:** Modify `packages/module-sdk/src/index.ts` (ToolResult), `packages/ai/src/gateway/types.ts` (GatewayToolResponse ok-variant), `packages/ai/src/gateway/gateway.ts` (`runHandler`), `packages/chat/src/mcp-transport.ts` (`gatewayResponseToMcp`). Tests: existing gateway + mcp-transport test files.

**Produces:**

```ts
// module-sdk
export interface ToolResultMedia {
  readonly kind: "image";
  readonly base64: string;
  readonly mimeType: string;
}
// ToolResult gains: readonly media?: ToolResultMedia;
// GatewayToolResponse ok-variant gains: readonly media?: ToolResultMedia;
```

`runHandler` copies `result.media` onto the ok response verbatim — it must NOT flow through `renderAndCap`/`sanitizeAssistantToolResult` (schema projection would drop it; 16k text cap would corrupt base64). `gatewayResponseToMcp`: when `res.media` present, emit `content: [{type:"image", data: media.base64, mimeType: media.mimeType}, {type:"text", text: ...}]`. TDD per file; commit.

### Task 4: ChatAttachmentsService

**Files:** Create `packages/chat/src/attachments-service.ts`; Test `packages/chat/src/attachments-service.test.ts`. Add `@jarv1s/vault` + `pdf-parse` deps to `packages/chat/package.json`.

**Produces:**

```ts
export interface StoredAttachmentMeta {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly sentAt?: string;
}
export class ChatAttachmentUploadError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  );
}
export class ChatAttachmentsService {
  constructor(vaultRunner: VaultContextRunner);
  saveAttachment(
    access: AccessContext,
    input: { fileName: string; mimeType: string; bytes: Buffer }
  ): Promise<StoredAttachmentMeta>; // validates whitelist/caps/sniff/pending-cap, GC-sweeps, writes blob+meta.json
  getMeta(access: AccessContext, id: string): Promise<StoredAttachmentMeta | undefined>;
  markSent(access: AccessContext, ids: readonly string[]): Promise<void>; // stamps sentAt in meta.json
  readContent(
    access: AccessContext,
    id: string
  ): Promise<
    | { kind: "text"; meta: StoredAttachmentMeta; text: string }
    | { kind: "image"; meta: StoredAttachmentMeta; base64: string }
    | { kind: "missing" }
  >; // pdf → extracted text via pdf-parse; extraction failure → kind "text" with explicit error note
  sanitizeFileName(raw: string): string; // strip control chars/newlines, collapse ws, cap 120 chars, neutralizeSeedFraming-safe (no < >)
}
```

Magic-byte sniff table: png `89 50 4E 47`, jpeg `FF D8 FF`, gif `47 49 46 38`, webp `52 49 46 46 … 57 45 42 50`, pdf `25 50 44 46`. Ids are `randomUUID()`; `id` is validated as UUID before any path use (defense-in-depth on top of `resolveVaultPath`). TDD (happy paths, each rejection, sniff mismatch, GC sweep, markSent) → commit.

### Task 5: Upload route + manifest entry

**Files:** Modify `packages/chat/src/routes.ts` (register parser + route, construct service with `new VaultContextRunner(getVaultBaseDir())`), `packages/chat/src/manifest.ts` (routes: `{ method: "POST", path: "/api/chat/attachments", permissionId: "chat.message" }`). Test: `packages/chat/src/attachments-route.test.ts` via `app.inject`.

Route: `bodyLimit: 10 MB + slack`, single exact `application/octet-stream` buffer parser, decode `x-jarvis-file-name` with `decodeURIComponent` (reject on failure), 400 empty body / missing headers, 415 mime, 413 per-type cap, 429 pending cap. Response 201 `{ attachment }`. TDD → commit.

### Task 6: Turn wiring (attachmentIds → manifest → persistence)

**Files:** Modify `packages/chat/src/live-routes.ts` (parse `attachmentIds`, validate ≤5 + all UUIDs + all exist via service, `markSent`, pass through), `packages/chat/src/live/chat-session-manager.ts` (`submitTurn`/`runTurn` gain optional `opts?: { attachments?: readonly StoredAttachmentMeta[] }`; after `buildEngineText`, append manifest block; thread metadata into `persistence.recordTurn` opts), Create `packages/chat/src/live/attachments-manifest.ts` (`renderAttachmentsManifest(metas): string` — the `<attachments>` block with sanitized names and the `mcp__jarvis__chat.readAttachment` instruction), `packages/chat/src/live/prompt-safety.ts` (add `attachments` to the reserved-tag regex), `packages/chat/src/live/persistence.ts` + `packages/chat/src/repository.ts` (`recordTurn`/`recordCompletedTurn` opts gain `attachments?: readonly ChatAttachmentDto[]` → user message `toolMetadata.attachments`), `packages/chat/src/routes.ts` (`serializeMessage` reads `toolMetadata.attachments` via a shape-checked `readAttachments`), `packages/chat/src/live/types.ts` if the runtime interface needs the widened `submitTurn` signature.

Rules: empty `text` allowed when `attachmentIds` non-empty (engine text = manifest only; persisted body = ""). Unknown id → 400 before any engine work. SSE user record unchanged. TDD (manifest rendering + hostile filename, neutralization of user-typed `<attachments>`, persistence roundtrip through serializeMessage, live-route validation) → commit.

### Task 7: `chat.readAttachment` assistant tool

**Files:** Create `packages/chat/src/attachment-tool.ts`; Modify `packages/chat/src/manifest.ts` (assistantTools entry, `risk: "read"`, `permissionId: "chat.view"`, inputSchema `{ attachmentId: string (required) }` — no outputSchema for the image case; text case returns `{ data: { fileName, mimeType, text } }`), `packages/chat/src/routes.ts` (`buildChatToolServices` gains `services.chatAttachments = attachmentsService`; `buildChatGatewayDependencies` resolver includes the tool — mirror the `currentView` wiring).

```ts
export const chatReadAttachmentExecute: ToolExecute = async (_scopedDb, input, ctx, services) => {
  const svc = services?.chatAttachments as ChatAttachmentsService | undefined;
  if (!svc) throw new Error("chat attachments service unavailable");
  const result = await svc.readContent(
    { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
    String(input.attachmentId ?? "")
  );
  if (result.kind === "missing") return { data: { error: "Attachment not found" } };
  if (result.kind === "image")
    return {
      data: { fileName: result.meta.fileName, mimeType: result.meta.mimeType },
      media: { kind: "image", base64: result.base64, mimeType: result.meta.mimeType }
    };
  return {
    data: { fileName: result.meta.fileName, mimeType: result.meta.mimeType, text: result.text }
  };
};
```

TDD (text, pdf, image→media, missing, cross-user isolation is structural — assert vault-root derivation) → commit.

### Task 8: Frontend

**Files:** Modify `apps/web/src/api/client.ts` (`uploadChatAttachment(file: File | Blob, fileName: string): Promise<UploadChatAttachmentResponse>` — raw fetch, octet-stream + headers; `sendChatTurn(text, attachmentIds?)`), Create `apps/web/src/chat/attachments.ts` (pending-upload state machine: `PendingAttachment { localId, fileName, sizeBytes, status: "uploading"|"ready"|"error", id? }`, client-side mime/size validation constants mirroring server), Modify `apps/web/src/chat/composer.tsx` (Paperclip button + hidden file input, textarea `onPaste` image extraction, chips row with remove ×, widen `onSend(text, attachmentIds?)`, allow send when chips ready and text empty, hide attach when new `privateMode` prop true), Modify `apps/web/src/chat/chat-drawer.tsx` (thread `privateMode` prop; widen `sendMessage`; render history chips — if the drawer would exceed 1000 lines, extract the message-row rendering block to `apps/web/src/chat/message-row.tsx` in the same commit), CSS in the chat drawer stylesheet using existing `chatd-*` tokens. Unit tests for `attachments.ts` helpers (vitest, mirror `mergeTranscriptIntoText` pattern); e2e covers the rest.

Commit per coherent slice; final commit user-facing summary: "Attach files and paste screenshots directly into Jarvis chat."

### Task 9: Gates, e2e UAT, PR

**Files:** Create `tests/e2e/chat-attachments.spec.ts` (#1000 harness: seeded owner → open drawer → attach small `.txt` via file input → send → chip renders on the sent message → turn completes; paste path covered by unit tests — headless clipboard-image is flaky). Modify spec doc (octet-stream wording). Run `pnpm verify:foundation` (record exit code), run the e2e spec against a real dev instance, fix fallout, push branch, open PR "Part of #1133 / closes #1154" with release-note summary, auto-merge NOT enabled (VF not a required check — poll green then merge or leave for review).

## Self-Review

- Spec coverage: storage §1→T2/T4, upload §2→T4/T5, turn §3→T6, engine read §4→T3/T7, frontend §5→T8, retention §6→T4 (GC+markSent), security §7→T4/T6 (sanitize/sniff/UUID), testing→each task + T9. Gap check: none.
- Type consistency: `StoredAttachmentMeta` (server) vs `ChatAttachmentDto` (wire) — conversion drops `createdAt`/`sentAt`; `media` field name consistent across module-sdk/ai/chat.
- Deviation from spec recorded: octet-stream + `x-jarvis-mime-type` (Task 9 updates spec).
