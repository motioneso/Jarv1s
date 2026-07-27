**Dependency:** Task 10 must already be committed.

**Ben's ruling, 2026-07-26 (binding, REPLACES the previous ruling on this task):** "Jarvis should
approve for email. Again users can give it full freedom though." Sending email requires
confirmation by default. The earlier `granted_at_install` classification for `email.sendReply` —
which would have sent mail with no card, ever — is **withdrawn**. Do not implement it.

**The `confirm_always` set is four:** `memory.forget`, `people.merge`, `people.splitIdentity`,
`email.sendReply`. (`notes.delete` left the set in Task 7a; `email.sendReply` joins it here.)

**This is a preserved-by-declaration change, not a behaviour change.** `email.sendReply` is already
`risk: "destructive"` with no family and no `executionPolicy`, and
`packages/ai/src/gateway/policy.ts:37` confirms any destructive tool regardless of tier. It prompts
today and it must still prompt after this task. You are declaring the existing guarantee so the
Task 2 assertion can see it — you are not adding a new prompt and you are not removing one.

**How a user gets "full freedom" today:** YOLO mode, which deliberately bypasses `confirm_always`,
`risk: "destructive"` and `requiresConfirmation` alike. That is the whole escape hatch and it is
global, not per-family. Do **not** invent a per-family email auto-send path — keeping the
destructive floor is what makes "Jarvis never silently sends mail" a hard guarantee rather than a
default someone can flip by accident. A finer-grained per-family control is a separate decision the
Coordinator has flagged to Ben; it is not part of #1263.

## Task 11 — Classify Email

**Files**

- Modify `packages/email/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/email-reply-tools.test.ts`

**Exact classification**

- Add `always_confirm` to `email_drafts.allowedTiers` (`manifest.ts:174`).
- `email.draftReply`: `granted_at_install`, retaining `email_drafts` and `executionPolicy: "auto"`.
  Drafting is not sending: a draft is fully reversible and reaches nobody.
- `email.sendReply`: **keep `risk: "destructive"`, and keep it with no `actionFamilyId` and no
  `executionPolicy`.** Add `selfOperationGrant: "confirm_always"` and nothing else.
- Do **not** add an `email_sends` family. Do **not** change `risk` to `write`. Either one removes
  the destructive floor and is the exact mistake this ruling reverses.
- Keep the existing comment at `manifest.ts:255` explaining the destructive floor — it is now
  load-bearing documentation, not a leftover. Extend it to name Ben's ruling and its date.

**Tests**

- `"classifies email.draftReply as granted_at_install"`.
- `"keeps email.sendReply destructive and confirm_always so mail is never sent without approval"` —
  assert `risk === "destructive"`, `selfOperationGrant === "confirm_always"`,
  `actionFamilyId === undefined`, and `executionPolicy === undefined`. All four together are the
  guarantee; any one of them alone can be satisfied while mail still auto-sends.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/email-reply-tools.test.ts`

**Commit**

`feat(email): require approval before sending mail`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool beyond the four named above: stop that package task and
  message the Coordinator.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
