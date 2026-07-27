# Coordinator rulings on Task 8 work (7b43a1c5, 127156d7) — apply before/alongside Task 9

Arrived after relay-7 was written and the successor spawned. Durable record so it survives
another relay. Coordinator = `coord-1262` (session `43e5f5e2-0deb-4ab5-9237-436e8795b611`).

## Confirmed already correct

- Step 3 (CAS-convert `setNotificationPreferenceEnabled`) landed as a real CONVERT (not an
  add-alongside): `getWithRevision`/`upsertWithRevision`, `PreferenceRevisionConflictError` → 409
  on the REST route. Coordinator confirmed this is fine as built.
- b61009db (plain-upsert revision bump) confirmed correct with a real regression test.

## Required fixes to 127156d7 (`SettingsUndoStack`) — do before/alongside Task 9

1. **Retention leak.** The per-chat stack is capped at 20, but the outer map of stacks is never
   evicted — `clear()` has zero callers anywhere (coordinator grepped). Every `(actor, chat)` pair
   ever seen keeps up to 20 `previousValue` entries (private data — e.g. weather location is a
   home address) for the life of the process. Fix: use the existing `appliedAt` timestamp to sweep
   entries past a bounded window, and/or LRU-evict whole stacks once the map exceeds a cap.
   "Cleared on process restart" is explicitly rejected as an eviction policy for a long-lived API.

2. **Key collision.** `stackKey` is `${actorUserId}:${chatId}` (string concat with `:`). If either
   id ever contains `:`, actor A's key can equal actor B's, and `pop()` leaks one user's undo entry
   to another. Both are UUIDs today so it's latent, not live — but this is the exact
   `module:<id>:<key>` concatenation trap this repo already hit once (see
   `chat-surface-pattern-trap` in agentmemory). Fix structurally: `Map<actorUserId, Map<chatId,
   entries>>` (nested map), not string-keyed.

3. **Undo-apply binding (for whatever task builds the apply/undo path — not yet written).** Undo
   MUST replay via `upsertWithRevision(..., entry.previousRevision)`, using the recorded revision as
   the CAS expectation. On `PreferenceRevisionConflictError`, surface it to the user as "this
   setting changed since, not undoing" — do NOT swallow it and do NOT re-read current revision and
   force the write. A force-write undo makes the whole CAS chain (b61009db/7b43a1c5) decorative and
   silently destroys whatever the user changed in between. Required test: push an undo entry, let a
   plain write land on top, then undo — assert it refuses and the newer value survives untouched.

4. **Inventory impact.** Whatever tool exposes undo is a write tool and must declare
   `selfOperationGrant` — that changes the Task 10 inventory counts. Task 10's baseline from
   #1265's PR #1273 is exact `toBe` 31/5/4=40; add whatever the undo-expose tool contributes and
   keep every assertion exact (`toBe` on each of the three plus the sum — never a range, never
   `toBeGreaterThan`, even to dodge a rebase conflict).

## Standing bans (repeated by coordinator, unchanged)

- No widening any `defaultTier` — hard stop, escalate to coordinator, do not just do it.
- Never touch `docs/coordination/`.
- Never `git add -A`.
- Never run a repo-wide `pnpm format` (only `format:check`, and only touched files with `format`).
- `JARVIS_PGDATABASE` must be set to an isolated DB for anything touching a database.
- Never pipe a gate command through `tail`/`head` (masks a real failing exit code as green).

## Also re-check (coordinator's item 2 on the Task 8 ruling, not yet done)

Now that plain `upsert()` also bumps revision (b61009db), grep for any other code that treats
`revision` as a count of CAS writes specifically, or asserts it stays stable across a plain write.
Do not assume none exists — grep it.
