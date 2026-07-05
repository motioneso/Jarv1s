# Private chat mode without memory writes (#744)

**Status:** Proposed — awaiting Ben's approval
**Date:** 2026-07-05
**Tier:** security-sensitive (privacy/data-retention surface)
**Builds on:** #737 (chat settings split), `packages/chat/src/jobs.ts` (embed-turn / extract-facts
workers), `packages/chat/src/live/persistence.ts` (existing incognito job-skip gate)

## Problem

#737 established that "remember across conversations" is default chat behavior, not a setting, and
split private/incognito chat out as its own spec (#744) because it is a deliberate exception, not a
toggle. Users need a way to have a one-off conversation that does not get distilled into long-term
memory or bleed into personalization, cross-tool context, or proactive surfaces.

Grounding this spec turned up something important: a **prior, partial build already exists**.
`app.chat_threads` has an `incognito` boolean column (migration `0058_chat_threads_incognito_immutable.sql`,
enforced immutable-after-creation by a DB trigger), `POST /api/chat/clear?incognito=true` already
creates such a thread, and the persistence layer already gates on it in several places (see "What
already works" below). What is **missing** is almost entirely product surface: no UI entry point, no
visual marking, and no answer to the retention/scope questions the issue asks. This spec is about
closing that gap deliberately, not about designing the mechanism from scratch — the mechanism's
low-level shape is largely already decided by the existing code and should be extended, not
replaced.

## What already works today (verified in code, not assumed)

- **The extraction call is skipped, not run-then-discarded.** `DataContextChatPersistence.recordTurn`
  (`packages/chat/src/live/persistence.ts:229`) only enqueues `CHAT_EMBED_TURN_QUEUE` and
  `CHAT_EXTRACT_FACTS_QUEUE` (`packages/chat/src/jobs.ts`) `if (this.boss && result && !thread.incognito)`.
  For an incognito thread, `handleExtractFactsJob` never runs at all — no distillation prompt is ever
  built or sent to a model, no `memory_candidates` row is ever written, no embedding is ever computed.
  This is the strong form of "no memory write" the hard invariants call for (skip-the-call, not
  extract-then-delete), and it already satisfies "metadata-only job payloads" trivially: for incognito
  turns, the job payload (which is metadata-only anyway — `threadId`/`messageId` only) simply never
  gets created.
- **Passive retrieval / cross-tool reasoning never see incognito content**, not because they check the
  flag, but because they only read from `memory_chunks` and the memory graph (`packages/chat/src/live/
  passive-retrieval.ts`, `packages/chat/src/live/cross-tool-reasoning.ts`) — data that incognito threads
  never populate. This is correct today by construction, but it is an emergent property, not an
  asserted guarantee. No test currently pins it down (see Acceptance).
- **Usefulness feedback "remember" is gated.** `createChatFeedbackTargetVerifier`
  (`packages/chat/src/feedback-verifier.ts:17`) sets `canRemember = !thread.incognito`, so a user
  cannot promote a message from an incognito thread into memory via the feedback surface either.
- **Proactive/briefing surfaces that go through `chat.listTodaysTurns` are excluded.** The manifest tool
  (`packages/chat/src/tools.ts:44`) explicitly `continue`s past incognito threads. No other module
  reads `ChatRepository` directly (checked `packages/briefings`, `packages/proactive-monitoring`), so
  today nothing else in the codebase surfaces incognito chat content elsewhere in the product.
- **Transcript rows are NOT skipped.** `ChatRepository.recordCompletedTurn` (`packages/chat/src/
  repository.ts:173`) has no incognito branch — both the `stored` user and assistant messages are
  written to `app.chat_messages` unconditionally, same as any other thread. So "incognito" today means
  "excluded from memory extraction," not "ephemeral" — the full transcript is a durable, RLS-scoped
  Postgres row like any other thread.
- **The underlying CLI engine also writes a filesystem-level transcript**, independent of the Postgres
  rows: `CliChatEngineImpl` launches a per-turn session under a per-user "neutral dir"
  (`packages/chat/src/live/cli-chat-engine.ts`), and the CLI (Claude Code / Codex / Gemini) writes its
  own `.jsonl` session transcript there via `transcriptGlobDir` (`packages/ai/src/adapters/
  tmux-bridge.ts`). `kill()` removes the entire neutral dir (`§6.5`, line ~346), which happens on
  `/clear` and thread-resume — so this filesystem transcript does not outlive an active session, but it
  is **not currently distinguished for incognito** and is not cleaned up mid-session, on idle timeout,
  or on ungraceful disconnect (browser closed without clicking anything).
- **Global memory settings are a separate axis.** `ChatUserMemorySettingsRepository`
  (`packages/chat/src/memory-settings-repository.ts`) exposes a persistent, user-level
  `recallEnabled`/`factsEnabled` pair. This is orthogonal to per-thread incognito and must not be
  conflated with it (see Non-goals).

## What is genuinely missing

- **No frontend entry point.** `apps/web/src/chat/chat-drawer.tsx` has zero references to `incognito`.
  There is no button, toggle, or menu item anywhere in the web client that calls
  `clearChat({ incognito: true })` (the client function already exists in `apps/web/src/api/
  client.ts:655` — it is simply never invoked).
- **No visual marking anywhere.** `serializeThread` (`packages/chat/src/routes.ts:785`) does not
  include `incognito` in the `ChatThreadDto` sent to the client at all. Even if a private thread were
  started today, `GET /api/chat/threads` could not tell the sidebar which one it was.
- **The thread list does not separate incognito threads.** `ChatRepository.listThreads` has no
  incognito filter; a private thread would appear in the resumable sidebar list
  (`chat-drawer.tsx` `SessionList`) mixed in with ordinary threads, with its full transcript resumable
  exactly like any other conversation. This directly contradicts the issue's acceptance bar ("clearly
  marked private chat").
- **No retention/expiry/delete mechanism exists for any thread**, private or not. There is no
  delete-thread route in `packages/chat/src/routes.ts` or `live-routes.ts`. A private thread's Postgres
  rows persist indefinitely, same as a normal thread, until some future general-purpose deletion
  feature exists.
- **No affirmative guarantee/test that "excluded from memory" actually holds** — today it holds because
  nothing else reads chat data directly, which is fragile against a future module adding a new direct
  read path. This spec should convert "true by omission" into "true by assertion" (see Acceptance).

## Scope

1. **Surface the existing incognito thread as "private chat" in the product**, reusing the backend
   mechanism already in place rather than inventing a new one:
   - Add `incognito` to `ChatThreadDto` / `serializeThread` so the client can tell threads apart.
   - Add a clearly labeled entry point in the chat drawer to start a private chat (exact affordance is
     an open question below).
   - Visually distinguish a private thread's active session and its entry in the thread list (banner
     and/or badge — exact treatment open below).
2. **Decide and implement the transcript-retention behavior** for private chats (ephemeral vs.
   durable-but-marked vs. durable-with-TTL) — this is the crux open question; the current backend
   default (durable, excluded from extraction only) is a valid answer but must be an explicit product
   decision, not an accident of what was half-built.
3. **Assert, don't just assume, the exclusion boundary.** Add a test (or tests) that prove a private
   chat turn never produces a `memory_candidates` row, a `memory_chunks` row, or a promoted memory
   graph fact/entity — directly satisfying the issue's "tests prove memory extraction is skipped"
   acceptance line.
4. **Close the filesystem-transcript gap**: decide whether the per-session CLI `.jsonl` transcript
   needs incognito-specific handling (e.g., write to a location that is guaranteed removed even on
   ungraceful disconnect, or accept the existing kill()-on-clear cleanup as sufficient) and document
   the decision so "no artifacts survive beyond active turn requirements" is a true statement, not an
   aspiration.

## Non-goals / Guardrails

- **Do not build a second memory-suppression mechanism.** The extraction/embedding skip in
  `persistence.ts` already satisfies "skip the call, don't extract-then-discard" — reuse it. Do not
  add a redundant delete-after-write path; that would create a window where sensitive content briefly
  exists in `memory_candidates` or `memory_chunks`, which is strictly worse than never writing it.
- **Do not conflate per-thread incognito with the global `chat_user_memory_settings`
  (`recallEnabled`/`factsEnabled`) toggle.** They answer different questions (permanent user
  preference vs. one-off exception) and must stay independently controllable.
- **Do not build general chat-thread deletion/retention as part of this spec** unless Ben explicitly
  wants private-chat retention to require it — if he does, scope it narrowly (private threads only,
  not a general delete-any-thread feature), since a general deletion feature is its own surface with
  its own spec-worthy questions (cascade to embeddings/facts already promoted from a since-deleted
  non-incognito thread, export interaction, etc.).
- **Do not change action-approval or tool-execution policy.** Per #737, chat does not own automation;
  module-owned action settings (email/calendar/tasks/etc.) already decide off/suggested/automatic
  regardless of which thread invoked them. A private chat does not get to bypass or weaken an
  approval gate, and an approved action's own audit trail belongs to its owning module, not to chat
  memory — #744 governs chat-owned memory only.
- **Secrets never escape, still applies inside a private chat.** `containsSensitiveMemoryText` /
  `rawTurnContainsSensitiveText` (`packages/chat/src/memory-distillation.ts`) already run
  independently of incognito for the (now-skipped) extraction path; nothing in this spec should ever
  loosen that filter — if extraction is ever invoked for a private thread by mistake, the sensitive-text
  gate is a second line of defense, not the only one.
- **Metadata-only job payloads still apply** to anything that does touch a private-chat turn in the
  background (there is currently nothing besides the already-skipped embed/extract jobs — if a future
  feature adds one, it inherits this constraint).

## Open questions

Answered by what already exists in code (recommend ratifying as-is):

- **Memory writes**: already excluded via skip-the-call (see above). Recommend keeping this mechanism.
- **Usefulness feedback "remember"**: already excluded (`canRemember = !thread.incognito`). Recommend
  keeping.
- **Cross-tool context / passive retrieval**: already excluded, as an emergent property of never
  writing to `memory_chunks`/graph. Recommend making this an asserted, tested guarantee rather than
  leaving it implicit.
- **Proactive monitoring / briefings**: already excluded via `chat.listTodaysTurns` skipping incognito
  threads, and via the extraction skip (nothing else in the codebase reads chat content directly).
  Recommend keeping, and recommend a lint/architecture note so a future direct-read of `ChatRepository`
  from another module is caught in review rather than silently leaking private chat content.

Genuinely open — need Ben's decision:

- **Entry point and visual treatment.** No UI exists today. Candidate shapes: (a) a distinct "Start
  private chat" action alongside "New chat" in the drawer header, vs. (b) a toggle on the existing
  "new chat" action. Visual treatment while active: persistent banner/strip in the transcript view
  ("This chat is private — not saved to memory") is the minimum; whether the thread-list entry (once
  it exists) should be badge-marked, visually separated into its own section, or omitted from the
  resumable list entirely is undecided.
- **Whether the transcript itself is ephemeral, durable-but-marked, or durable-with-TTL.** Today's
  backend default is durable-but-excluded-from-extraction. Given "private by default" as a hard
  invariant, is a durably-stored, indefinitely-retained Postgres transcript an acceptable meaning of
  "private" for this feature, or does #744 need to also ship deletion/expiry? If durable is
  acceptable, the UI copy must say so plainly ("not remembered" ≠ "not saved") so users don't
  over-trust the label.
- **Whether a private thread should even be resumable/listed at all**, versus being single-session and
  dropped from the list once the user navigates away or clicks "clear."
- **Exact retention duration**, if a TTL/expiry is chosen (e.g., purge on next login, purge after N
  hours idle, purge on explicit "end private chat").
- **Filesystem CLI transcript handling for incognito specifically** — accept the existing
  kill()-on-clear cleanup (which already applies to every thread, not just incognito), or add
  incognito-specific hardening (e.g., idle-timeout auto-kill so a private session doesn't sit on disk
  indefinitely if the user just closes the tab)?
- **Action-approval and tool-call history exemption.** Confirmed as out of scope for this spec's
  memory-write guarantee (module-owned action settings and audit trails are unaffected), but Ben
  should confirm whether that framing is right, or whether he wants a note added to the *module's* own
  approval/audit spec instead so the two specs stay consistent.
- **Analytics.** No chat-specific analytics/audit pipeline distinct from the memory pipeline was found
  in this codebase today, so there is currently nothing else to explicitly exclude. If/when analytics
  is added, it must respect incognito from day one — worth a forward-looking note rather than a
  decision now.

## Acceptance criteria

- A user can start a chat that is clearly marked as private at the point of entry (exact affordance
  per Ben's decision above), and the active private session is visually distinguishable from a normal
  chat for as long as it is open.
- Starting a private chat sets `incognito = true` on the underlying thread (reusing the existing
  immutable column and `openNewConversation`/`openNewThread` path) — no new schema is needed for this
  alone.
- A completed turn in a private thread never enqueues `CHAT_EMBED_TURN_QUEUE` or
  `CHAT_EXTRACT_FACTS_QUEUE` (already true; add a regression test asserting `sendJob` is not called
  for `thread.incognito === true` in `DataContextChatPersistence.recordTurn`).
- A completed turn in a private thread produces zero rows in `memory_chunks`, `memory_candidates`, and
  no promoted entity/fact in the memory graph — add an integration test that runs a full turn against
  an incognito thread and asserts all three are empty afterward (closes the issue's explicit "tests
  prove memory extraction is skipped" line).
- Usefulness feedback cannot "remember" a message from a private thread (already true via
  `feedback-verifier.ts`; add/keep a test pinning this).
- `chat.listTodaysTurns` (and therefore anything built on it) continues to exclude private threads
  (already true; keep the existing test coverage, extend if the tool's output shape changes).
- Whatever retention behavior Ben selects (durable-marked vs. TTL vs. ephemeral) is explicit in both
  the UI copy shown to the user at the point they start a private chat and in this spec before build
  starts — no version of #744 ships where the retention behavior is left to be discovered by reading
  code.
- No secrets, private content, or full turn text appear in job payloads, structured logs, or
  diagnostics for private-chat turns (already true because the relevant jobs are never enqueued; add
  a test/assertion covering the diagnostic log path in `handleExtractFactsJob`'s catch block should it
  ever be reached in error).
