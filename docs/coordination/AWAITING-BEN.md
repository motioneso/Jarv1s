# Awaiting Ben

Decisions parked because they are product calls, not implementation calls. Each entry names both
sides and a recommended reading, so confirming one line is enough to unblock.

---

## 1. Does the core chat drawer show a module's thread while you are inside that module?

**Status:** blocking the job-search UAT's drawer phase (#1306) and the disposition of #1332.
**Raised:** 2026-07-27, epic #1280.

Two approved sources say opposite things.

- `apps/web/src/shell/app-shell.tsx:194` — _"#1284 — Ben's ruling: a module's thread must never
  appear in the main drawer."_
- `docs/superpowers/specs/2026-07-26-job-search-module-design.md:183-184` — _"Chat after onboarding
  is the existing core header chat control — the module does not add its own chat button. **Opening
  it inside a profile gives that profile's thread.**"_

The job-search spec requires exactly what the #1284 ruling forbids.

**What the code does today, which is neither.** `app-shell.tsx:426` renders
`<ChatDrawer records={recordsForSurface(DEFAULT_CHAT_SURFACE)} />`. Once a module claims the stream
via `setSurfaceKey`, `activeSurface` becomes the module's surface id, so
`"drawer" === activeSurface` is false and the drawer renders `[]` — an **empty** drawer. Not the
profile's thread, and not the default thread either. That outcome serves neither ruling's intent,
which is the strongest evidence that it is an unintended third state rather than a deliberate
compromise.

**Recommended reading — the two are reconcilable, scoped by location.** `useProfileThread`
(`external-modules/job-search/src/domain/seed-prompt.ts`) claims the surface on mount and releases it
with `setSurfaceKey(null)` on unmount. So:

- **Inside a profile** → the header control shows that profile's thread (job-search spec §7).
- **Anywhere else** → the claim is released and the drawer shows the default thread, with no module
  content visible (#1284's concern, which reads as a **leakage** rule).

Under that reading #1332 is a real one-line bug — `recordsForSurface(activeSurface)` at
`app-shell.tsx:426` — and #1284 stays satisfied, because `activeSurface` reverts to `"drawer"` the
moment the module lets go.

**The alternative reading** is that "never" is absolute: the drawer stays empty inside a module and
job-search spec §7 must be rewritten instead. That is a coherent position — it makes the drawer
strictly a core-only surface — but it means the module's chat is reachable **only** through its own
embedded surface, and spec §7's "the module does not add its own chat button" would need revisiting
at the same time, or there is no way in at all.

**Traced since this was parked (2026-07-27).** The mechanism is now known, which narrows the
question to intent alone — the recommended reading is mechanically sound, not a hope.

History is fetched over REST, separately from the SSE stream, and it is keyed by **surface** the
whole way down: `apps/web/src/chat/use-chat-stream.ts:122-141` calls `listChatThreads(surface)`,
takes `threads[0]` (most-recently-active, chosen client-side), then
`listChatThreadMessages(thread.id, surface)`. Server-side, `packages/chat/src/repository.ts:37-44`
filters threads by `surface` and `incognito = false`; the read is authorised at the **thread** level
(`surface` match plus `thread.owner_user_id === access.actorUserId`, `packages/chat/src/routes.ts:441`).

Two consequences for this decision:

- Binding the drawer to the module's surface key genuinely surfaces that module's own thread —
  history included, not just live stream. The recommended reading's one-line change at
  `app-shell.tsx:426` is sufficient; nothing else is missing.
- Releasing the claim (`setSurfaceKey(null)`) sends the very same query back to the default surface,
  so no module content can survive the exit. #1284's leakage concern is enforced by the surface
  filter itself, not by convention.

This is why ruling N46 (bind by `profile.surfaceKey`, never `profileId`) restores a capability rather
than tidying naming: the surface key **is** the history lookup key.

**Sharper still: the module's transcript is already in the browser's memory.** `app-shell.tsx:155`
calls `useChatStream(activeSurface)` — the *active* surface, so once a module claims the stream the
shell has already fetched and is already holding that module's thread. Line 426 then hands
`recordsForSurface(DEFAULT_CHAT_SURFACE)` to the drawer, and `recordsForSurface` (`:198-200`) returns
`[]` for any surface that isn't the active one. Nothing is missing or unfetched; one render-time
filter discards data the shell already has. That is the whole of the change either way.

**One live consequence.** The UAT's Phase 11 (`tests/uat/specs/job-search-board.uat.spec.ts:563`)
asserts the **recommended** reading — a marker seeded on the profile's surface is visible in the
drawer inside the profile, and absent on `/tasks`. It therefore fails today, by design, and is the
one phase whose outcome this decision flips. If the alternative reading wins, that phase inverts
rather than being deleted: the assertion becomes "empty inside the module too".

**What we need:** which reading is right. If the recommended one, #1332 proceeds as a bug fix. If the
alternative, spec §7 needs an amendment and the job-search UAT's drawer phase changes shape.

**Not guessed in the meantime.** The UAT phase is being written against the spec's contract with the
conflict cited inline, so whichever way it goes the assertion is one edit, not a rewrite.
