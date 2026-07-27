**Dependency:** Task 12 (`0991ab47`) must already be committed. This task corrects it. It must land
**before** Task 14, because Task 14's install-grant logic has to honour the new third value.

**Ben's ruling, 2026-07-26 (binding, corrects Task 12):** deleting a calendar event **asks by
default, and the user may turn that off themselves.** It is not granted at install, and it is not
locked to always-confirm.

**Why Task 12 was wrong.** On `main`, `calendar.deleteEvent` was deliberately double-belted:
no `executionPolicy: "auto"` (so the gateway always confirmed) **and**
`calendar_management.allowedTiers: ["always_confirm"]` (so no tier, user or install, could ever
promote it). Task 12 removed **both** belts and declared `granted_at_install`, which — once Task 14
lands — would have made Jarvis delete calendar events with no card at all. Deleting an event emails
a cancellation to every attendee and that cannot be un-sent. The Coordinator escalated; Ben chose
ask-by-default-but-promotable.

## The problem: neither existing declaration value says that

`selfOperationGrant` is currently `"granted_at_install" | "confirm_always"`.

- `granted_at_install` is false — install must **not** promote this family.
- `confirm_always` is also false — it would claim an unflippable guarantee, while the tool is
  `risk: "write"` with `executionPolicy: "auto"` and a family that permits `trusted_auto`. A user
  who promotes the family would get silent deletes, and the declaration would be a lie. Declarations
  that can be false are worse than no declaration, because the Task 2 assertion trusts them.

## Task 12a — Add the third declaration value and apply it to Calendar

**Files**

- Modify `packages/module-sdk/src/index.ts` (the `selfOperationGrant` union added in Task 1)
- Modify `packages/ai/src/gateway/self-operation.ts` (the assertion)
- Modify `packages/calendar/src/manifest.ts`
- Modify `tests/unit/self-operation-chassis.test.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/calendar-delete.test.ts`

**1. Widen the declaration union to three values**

Add `"user_promotable"`. Full union: `"granted_at_install" | "confirm_always" | "user_promotable"`.

Document it in place, in the SDK, next to the other two:

> `user_promotable` — the tool is fully wired for auto-run (`risk: "write"`, an `actionFamilyId`,
> `executionPolicy: "auto"`, and a family whose `allowedTiers` include `trusted_auto`), but install
> does **not** promote it. The family's `defaultTier` stands, so it asks until the user chooses
> otherwise in settings. Use this when an action is easy to perform but hard to take back — Ben's
> 2026-07-26 calendar ruling is the reference case.

This widens `selfOperationGrant` only. **Do not touch `defaultTier`'s type** — that ban is unchanged
and unrelated.

**2. Extend the build assertion — this is the part that matters**

The assertion must reject a `user_promotable` tool that cannot actually be promoted, which is the
same silent-prompt family of bug Task 2 exists to catch. A `user_promotable` tool MUST have all of:

- `risk: "write"` (a destructive tool can never auto-run — `policy.ts:37` — so `user_promotable`
  would be unreachable and therefore a false declaration)
- an `actionFamilyId`
- `executionPolicy: "auto"`
- a family whose `allowedTiers` include **both** `trusted_auto` (or promotion is impossible) and
  `always_confirm` (or the user can never demand the prompt back — the standing epic rule)

Violating any of these fails the build. Add a unit test per bullet asserting the throw.

**3. Apply it to Calendar**

- `calendar.deleteEvent`: keep `risk: "write"`, keep `actionFamilyId: "calendar_management"`, keep
  `executionPolicy: "auto"`; change `selfOperationGrant` from `"granted_at_install"` to
  `"user_promotable"`.
- `calendar_management`: keep `defaultTier: "always_confirm"`. Set
  `allowedTiers: ["always_confirm", "trusted_auto"]` — `always_confirm` is the default it sits at,
  `trusted_auto` is the promotion Ben wants available.
- **Restore the honesty of the description**, which Task 12 stripped. It must say deletion asks for
  confirmation by default and that attendees are notified of the cancellation. Do not re-add the
  words "Always asks first" — that is no longer strictly true once a user promotes the family. Say
  it asks unless the user has allowed automatic calendar deletions.
- Replace the deleted design comment with one explaining the current shape: the tool is wired for
  auto-run, the family default keeps it confirming, and only the user can change that.
- `calendar.proposeFocusBlock` stays `granted_at_install` — creating a Jarvis-owned block is
  reversible and notifies nobody. Leave `calendar_writeback` as Task 12 left it.

**4. Fix the Task 12 tests rather than deleting them**

Rename and invert `"classifies both Calendar writes as granted_at_install"` — it now asserts the
wrong thing. Assert `proposeFocusBlock` is `granted_at_install` and `deleteEvent` is
`user_promotable` with the four structural properties above, and that `calendar_management`
defaults to `always_confirm`.

**Do NOT** reclassify any other module's tools onto `user_promotable` in this task. Every existing
`granted_at_install` and `confirm_always` declaration stays exactly as committed. This task adds the
value and applies it to one tool.

**Verify**

`pnpm vitest run tests/unit/self-operation-chassis.test.ts tests/unit/self-operation-manifests.test.ts tests/integration/calendar-delete.test.ts`

**Commit**

`feat(calendar): ask before deleting events unless the user allows it`

## Stop conditions (apply to every task)

- A proposed sixth `confirm_always` tool: stop and message the Coordinator. The set is exactly five:
  `memory.forget`, `people.merge`, `people.splitIdentity`, `email.sendReply`, `web.read`.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
