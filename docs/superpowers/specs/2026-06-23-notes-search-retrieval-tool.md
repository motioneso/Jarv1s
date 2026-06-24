# Spec: `notes.search` retrieval assistant tool

**Date:** 2026-06-23
**Status:** Approved (coordinator)
**Issue:** #451. **Follow-up to:** #449 (Notes Source connector — folder transport, ingest-only). **Part of** Phase 3 · Core Value — Real Briefings.
**Companion specs:** `2026-06-23-notes-source-connector-folder-transport.md` (ingest), `2026-06-22-notes-folder-ingest.md`.

## Problem

The notes connector (#449, merged as #450, live in v0.1.9) ingests the user's Obsidian vault into
`app.memory_chunks` with `source_kind = "notes"`. **Nothing reads that `source_kind`.** Chat recall
reads only `"chat"`; briefings read only `"vault"`. So ingested notes are **write-only dead data** —
Jarvis has no way to surface a note in a conversation. The transport spec explicitly deferred
retrieval ("No changes to `packages/memory/*`"); this spec closes that gap.

## Goal

Give the chat assistant a first-class, RLS-safe way to semantically search the user's ingested notes,
returning chunk text + provenance so Jarvis can answer from and cite the vault.

**Non-goals:** no note viewer/editor in the shell (see [[no-note-viewer]] — provenance + backend-derived
deep link only); no write-back; no change to ingest; no change to chat recall's static seed; no new
container or migration.

## Design

A single new **assistant tool** `notes.search`, mirroring the existing `email.listVisibleMessages`
pattern (`packages/email/src/manifest.ts` + `packages/email/src/tools.ts`).

### Critical architectural constraint — read tools get NO injected services

`notes.search` is `risk: "read"` → gateway policy `"run"` → it dispatches **without** the confirm gate.
Per the write→confirm floor in `packages/ai/src/gateway/gateway.ts`:

- `servicesFor()` returns `{}` for any `"run"`-policy tool, AND
- `executableTools()` **hides** any read tool that declares `requiresServices` (fail-closed #1).

**Therefore `notes.search` MUST NOT declare `requiresServices`, and cannot receive an injected
`MemoryRetriever`/`EmbeddingProvider`.** It builds its own provider from env config — exactly the
factory the composition root uses — memoized at module scope so a local model loads at most once per
process.

### Files

1. **`packages/notes/src/tools.ts`** (new) — `notesSearchExecute: ToolExecute`:
   - `assertDataContextDb(scopedDb)` first (like email).
   - Read `query: string` (trim; empty → return `{ data: { chunks: [] } }`) and optional
     `limit: number` (default 8, clamp 1..20).
   - Module-level memoized retriever:
     ```ts
     let retriever: MemoryRetriever | undefined;
     function getRetriever(): MemoryRetriever {
       if (!retriever) {
         retriever = new MemoryRetriever(
           createEmbeddingProvider(getEmbeddingProviderConfig()),
           new MemoryRepository()
         );
       }
       return retriever;
     }
     ```
     (`MemoryRetriever`, `MemoryRepository`, `createEmbeddingProvider`, `getEmbeddingProviderConfig`
     are all exported from `@jarv1s/memory`.)
   - `const chunks = await getRetriever().retrieve(scopedDb, query, limit, "notes")`.
   - Return `{ data: { chunks: chunks.map(c => ({ sourcePath, lineStart, lineEnd, text })) } }`.
     Reuse the existing `NOTES_SOURCE_KIND = "notes"` constant (export it from `jobs.ts` or
     re-declare a shared const — do not hardcode the string in two places without a named const).

2. **`packages/shared/src/notes-api.ts`** — add `notesSearchResponseSchema` (and an input schema
   `{ query: string (required), limit?: number }`) as a JSON Schema literal, mirroring
   `listEmailMessagesResponseSchema`. Chunk item: `{ sourcePath, lineStart, lineEnd, text }`.

3. **`packages/notes/src/manifest.ts`**:
   - Add a permission:
     ```ts
     { id: "notes.search", label: "Search notes",
       description: "Semantically search the user's ingested notes.",
       scope: "user", actions: ["read"] }
     ```
   - Add `assistantTools`:
     ```ts
     assistantTools: [
       {
         name: "notes.search",
         description:
           "Search the user's own ingested notes (Obsidian vault) by meaning. " +
           "Returns matching note excerpts with file path and line range for citation.",
         permissionId: "notes.search",
         risk: "read",
         inputSchema: notesSearchInputSchema,
         outputSchema: notesSearchResponseSchema,
         externalContent: true,
         execute: notesSearchExecute
       }
     ];
     ```
   - `import { notesSearchExecute } from "./tools.js"` (mirrors email importing its execute).
   - **Do NOT add `requiresServices`** (would hide the tool — see constraint above).

4. **`tests/integration/notes.test.ts`** — add a case: seed `app.memory_chunks` for user A with
   `source_kind="notes"` (via the existing ingest path or a direct repo insert through a scoped db),
   call `notesSearchExecute` (or via the gateway) for user A → assert the seeded chunk returns with
   correct provenance; call as user B → assert **zero** rows (RLS scoping). Tests use the stub
   embedding provider (default), which is deterministic, so an exact-seed assertion is stable.

### Security posture (must be covered in review)

- **RLS:** `vectorSearch` already filters `owner_user_id = app.current_actor_user_id()` and runs under
  `withDataContext`. No cross-user leakage. The test must prove this with a two-user case.
- **Prompt injection:** note content is user-authored free text entering the agentic context. Set
  `externalContent: true` so the gateway's trust-boundary wrapping (`renderAndCap(..., tool.name)`)
  applies — same treatment as `web.read`/`web.search`. This is defense-in-depth; the content is the
  user's own, but a note may contain pasted third-party text.
- **Write→confirm floor:** read tool, no `requiresServices`, no injected services. Verify the tool
  still appears in `listToolsForActor` (not hidden) and dispatches via `runHandler` with `{}` services.
- **Secrets:** none in scope; chunk text + provenance only.

### Embedding-provider caveat (operational, not code)

`retrieve()` embeds the query with whatever provider env configures. Prod is currently
`JARVIS_EMBED_PROVIDER=stub`, so results are mechanically valid but **not semantically meaningful**
until the provider is flipped to `local`. The embed flip is **Ben's reserved decision** ([[project-state]])
and is **out of scope for this code change** — the tool is correct and inert-until-flip; flipping is a
single env change + restart, documented at deploy time.

## Acceptance

- `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm test:notes` green.
- `notes.search` listed for an actor with the notes module enabled; returns RLS-scoped note chunks
  with provenance; two-user test proves isolation.
- No new migration, no container change, no `requiresServices`, no change to ingest or chat recall.
