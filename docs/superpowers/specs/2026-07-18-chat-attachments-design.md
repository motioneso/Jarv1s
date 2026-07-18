# Chat Attachments — file/image attachment support in global chat (#1133)

- **Status:** Approved (Ben pre-approved the full spec+build flow on issue #1133; this spec records
  the design decisions made under that mandate)
- **Issue:** #1133 — Feature: file/image attachment support in global chat
- **Date:** 2026-07-18
- **Scope:** Global chat drawer (all pages), not job-search-specific. Job search (résumé, job-post
  PDFs, screenshots) is the motivating case, not the boundary.

## Problem

Users cannot hand Jarvis a file. Anything not typable — a résumé PDF, a screenshot of an error, a
job posting saved as a document — has to be transcribed by hand into the chat input. The chat
drawer needs (a) an attach button for files and (b) clipboard image paste, with the attached
content actually reaching the CLI engine so the model can use it.

## Constraints that shape the design

1. **Attachments are private user data.** Hard invariant: all vault I/O goes through
   `VaultContext`; files 0600 / dirs 0700; private-by-default.
2. **Engines cannot read the vault.** `packages/cli-runner/src/sanitized-env.ts` strips every
   `JARVIS_VAULT_*` variable from the engine environment, and engines run under isolated per-user
   uids. This is deliberate (defense-in-depth) and this feature must not weaken it.
3. **Engines already reach the MCP gateway.** Every engine is launched with allowlisted
   `mcp__jarvis__*` tools (module-declared `assistantTools`). This is the one sanctioned channel
   through which api-side code can serve content to an engine.
4. **Metadata-only job payloads / logs / prompts.** Attachment bytes must never land in pg-boss
   payloads, logs, or the persisted chat transcript.
5. **Provider-agnostic AI.** Chat is engine-driven (claude / codex / AGY CLI binaries), not
   model-router-driven. Not every engine can consume images; the design must degrade gracefully
   rather than hardcode a provider.
6. **No new runtime dependencies without need.** The repo deliberately avoids
   `@fastify/multipart`; `POST /api/ai/transcriptions` and `POST /api/chat/skills/import` set the
   precedent of a single raw-blob request body.
7. **`apps/web/src/chat/chat-drawer.tsx` is at 999 lines** against the 1000-line file-size gate.
   New frontend logic must live in `composer.tsx` and new files, not the drawer.

## Considered approaches (engine delivery)

**A. Stage files into the engine's home/work dir and reference paths in the prompt.** Rejected:
requires cli-runner RPC plumbing plus chown across per-user uids, touches all 4 engine launch
paths, and punches a hole in the vault-isolation invariant (bytes copied outside the vault onto
disk the engine owns).

**B. Inline base64 into the turn text.** Rejected: blows the 32k turn-text cap immediately, bloats
the persisted transcript (bytes in DB — violates constraint 4), and most CLI engines don't decode
inline base64 images from prompt text anyway.

**C. MCP gateway read tool (`chat.readAttachment`) + server-composed manifest block (chosen).**
The api process stores the file in the vault, appends a small `<attachments>` manifest (id, name,
mime, size) to the hidden engine text, and the engine fetches content on demand through the
gateway, which holds legitimate vault access. Zero changes to engine launch/env/uid machinery;
bytes stay inside the api process and the vault; works identically for all engines because MCP is
the common denominator.

## Architecture

```
Composer (attach button / paste)
  └─ POST /api/chat/attachments        raw body (transcriptions precedent)
       └─ VaultContext write → vault:<user>/attachments/<id>/{blob, meta.json}
  └─ POST /api/chat/turn { text, attachmentIds }
       └─ buildEngineText(...) appends <attachments> manifest block
       └─ engine calls mcp__jarvis__chat.readAttachment { attachmentId }
            └─ gateway → VaultContext read → text / extracted PDF text / MCP image block
  └─ history: attachment metadata persisted in user message tool_metadata → chips in drawer
```

### 1. Storage (vault)

- Path: `attachments/<attachmentId>/` inside the user's vault
  (`<JARVIS_VAULT_ROOT>/<userId>/attachments/<id>/`), holding:
  - the raw bytes as `blob` (no extension — the name is user input and never used as a path), and
  - `meta.json`: `{ id, fileName, mimeType, sizeBytes, createdAt }`.
- `attachmentId` is a server-generated UUID. The client-supplied filename is stored **only** as a
  JSON string in `meta.json` (sanitized for display), never as a filesystem path component.
- New vault ops in `packages/vault/src/vault-ops.ts`: `readVaultFileBytes` /
  `writeVaultFileBytes` (Buffer variants of the existing UTF-8 helpers, same
  `resolveVaultPath` + `assertNoSymlinkEscape` + 0600/0700 discipline).
- **No DB migration.** Attachment metadata needed for history rendering rides in the user
  message's existing `tool_metadata` JSONB (`attachments: [{ id, fileName, mimeType,
sizeBytes }]`), exactly like tools/activity/provenance already do.

### 2. Upload — `POST /api/chat/attachments`

- Raw single-blob body with the file's own `content-type` header plus an
  `x-jarvis-file-name` header (percent-encoded), mirroring the transcription route's "one blob,
  no multipart" pattern. Registered in `packages/chat/src/routes.ts`, declared in
  `packages/chat/src/manifest.ts` routes with its own permission id (`chat.use`, same as turn).
- Validation (fail-closed whitelist):
  - **Mime whitelist:** `image/png`, `image/jpeg`, `image/webp`, `image/gif`,
    `application/pdf`, `text/*` (plus `application/json`). Anything else → 415.
  - **Size caps:** images ≤ 5 MB, PDFs/text ≤ 10 MB (route `bodyLimit` set to the max; the
    per-type cap enforced in-handler). Empty body → 400.
  - **Magic-byte sniff** for the binary types (png/jpeg/webp/gif/pdf): declared content-type must
    match the sniffed signature, else 415. Prevents mislabeling a binary as `text/plain` from
    mattering (text is read as text — worst case garbage, no execution path).
- Response: `{ attachment: { id, fileName, mimeType, sizeBytes } }` (shared contract in
  `packages/shared/src/chat-api.ts`).
- Rate/abuse bound: per-user cap of pending (not-yet-sent) uploads; uploading while at the cap →
  429-style error. Exact constant in code (default 20).

### 3. Turn wiring — `POST /api/chat/turn`

- `SendChatTurnRequest` gains `attachmentIds?: readonly string[]` (max 5 per turn).
- The route verifies each id exists in the **actor's own** vault (`meta.json` readable via the
  actor's VaultContext — ownership is structural: the vault root is derived from
  `actorUserId`, so cross-user reference is impossible by construction). Unknown id → 400.
- `buildEngineText` (`packages/chat/src/live/engine-text.ts`) appends a **server-composed**
  manifest block after the user text:

  ```
  <attachments>
  The user attached 2 file(s). Read them with the mcp__jarvis__chat.readAttachment tool.
  - id: <uuid> | name: resume.pdf | type: application/pdf | 213 KB
  - id: <uuid> | name: screenshot.png | type: image/png | 1.2 MB
  </attachments>
  ```

  Filenames are sanitized before composition (strip control chars, cap length, neutralize
  framing) so a hostile filename cannot fake or close the block.

- `attachments` joins the reserved-tag list in
  `packages/chat/src/live/prompt-safety.ts#neutralizeSeedFraming` so user-typed
  `<attachments>` framing in the message body is neutralized like the other reserved tags.
- Persistence: the user message row records the attachment metadata list in `tool_metadata`;
  the message **text** stores only what the user typed (no manifest block), keeping transcripts
  clean and metadata-only.

### 4. Engine read — `chat.readAttachment` assistant tool

- Declared in `packages/chat/src/manifest.ts` `assistantTools` alongside `chat.listTodaysTurns` /
  `chat.getCurrentView`; risk: read-only; input `{ attachmentId: string }`.
- Execute (in `packages/chat/src/tools.ts` pattern): resolve via the **actor's** VaultContext
  (gateway already carries AccessContext) → read `meta.json` + `blob` → return by type:
  - `text/*`, `application/json` → decoded text (capped, with truncation note).
  - `application/pdf` → server-side text extraction via `pdf-parse` (pure-JS, no native deps) →
    text (capped). Extraction failure → explicit error result, not a crash.
  - images → `{ kind: "image", base64, mimeType }` in the tool result data;
    `packages/chat/src/mcp-transport.ts#gatewayResponseToMcp` is extended to emit an MCP
    **image content block** for this shape (alongside a short text block naming the file).
    Engines with MCP-image support (Claude) see the image natively; engines without it receive
    the text block and a note that the image could not be rendered for this engine —
    documented degradation, no hard failure. This is the provider-agnostic answer: capability
    handling lives at the MCP boundary, not in any provider-specific code.
- The tool result never enters logs or job payloads; it flows only over the engine's MCP stdio
  channel for the live turn.

### 5. Frontend (composer-owned; drawer untouched except prop threading)

- `apps/web/src/chat/composer.tsx`:
  - Paperclip attach button (lucide `Paperclip`) next to the mic, opening a hidden
    `<input type="file" multiple accept=...>`.
  - `onPaste` handler on the textarea: image items in `clipboardData` are uploaded as
    `pasted-image-<n>.png`.
  - Pending-attachment chips above the input (name, size, remove ×; uploading/error states),
    styled with existing `chatd-*` primitives.
  - Send passes `attachmentIds` through a widened `onSend(text, attachmentIds?)`; send is
    allowed with attachments and empty text.
  - New helper module `apps/web/src/chat/attachments.ts` for the upload state machine and
    validation constants (keeps composer well under the size gate; unit-testable like
    `mergeTranscriptIntoText`).
- `apps/web/src/api/client.ts`: `uploadChatAttachment(file)` (raw-blob fetch, `transcribeAudio`
  precedent) and `sendChatTurn(text, attachmentIds?)`.
- History rendering: messages whose DTO carries `attachments` metadata render read-only chips
  (name + size — v1 does not stream image previews back out of the vault).
- **Private/incognito sessions: attach is disabled** (button hidden, paste ignored) — incognito's
  #1086 purge guarantee covers engine transcripts, not vault files; deferring keeps the guarantee
  honest. Revisit as a follow-up if wanted.

### 6. Retention & deletion

- Attachments referenced by a sent message live as long as chat history; account deletion already
  wipes the whole vault dir (`deleteUserVaultDir`), which includes `attachments/`.
- Uploads never attached to a turn are garbage-collected lazily: on each new upload, sweep the
  actor's `attachments/` for entries older than 24 h with no `sentAt` mark in `meta.json`
  (`sentAt` is stamped by the turn route). No scheduler, no pg-boss job, metadata-only.

### 7. Security tier & threat notes

- **Tier: sensitive.** Résumés/screenshots are exactly the private data class the vault exists
  for. Controls: VaultContext-only I/O (0600/0700), ownership structural via per-user vault root,
  mime whitelist + magic-byte sniff, size caps, filename treated as opaque display string,
  manifest framing neutralized, bytes excluded from logs/payloads/transcripts, engine access only
  via the authenticated per-user MCP gateway.
- Prompt-injection stance: attachment **content** is inherently untrusted input to the model (same
  as pasted text today); the new guarantee this design adds is that attachment **metadata**
  (filename) cannot forge framing, and attachment ids cannot reach another user's data.

## Testing

- **Unit/integration (vitest):** vault byte ops (roundtrip, symlink escape, mode bits); upload
  route (whitelist, caps, sniff mismatch, filename header decode, pending cap); turn route
  (unknown id, >5 ids, manifest composition + neutralization, tool_metadata persistence);
  `chat.readAttachment` (text/pdf/image shapes, missing id); `gatewayResponseToMcp` image block.
- **e2e UAT (#1000 harness, required for UI features):** Playwright spec on a real dev instance —
  attach a text file via the button, paste-path covered at component level (Playwright clipboard
  image paste is flaky headless), send, assert chip renders in history and the assistant turn
  completes.
- Full local gate: `pnpm verify:foundation`.

## Non-goals (v1)

- No image thumbnails/previews in history (chips only).
- No attachment support in private/incognito sessions.
- No re-download endpoint (vault stays write-in/engine-read-only for this feature).
- No OCR, no office-doc (docx/xlsx) parsing — whitelist can grow later.
- No changes to engine launch, uids, or sanitized-env.
