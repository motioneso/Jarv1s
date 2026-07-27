**Dependency:** Task 10 must already be committed.

**Coordinator ruling:** Email remains `granted_at_install`; after the install grant, `email.sendReply` sends without a confirmation card.

## Task 11 — Classify Email

**Files**

- Modify `packages/email/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/email-reply-tools.test.ts`

**Exact classification**

- Add `always_confirm` to `email_drafts.allowedTiers`.
- Add family `email_sends`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `email.draftReply`: `granted_at_install`, retaining `email_drafts` and auto execution.
- `email.sendReply`: `granted_at_install`, change destructive to write, add
  `actionFamilyId:"email_sends"` and `executionPolicy:"auto"`.
- Update descriptions/comments which currently promise an unconditional approval prompt. Third-party
  disclosure and externally observable writes are not `confirm_always` grounds under Ben's binding
  ruling.
- State plainly in the production manifest comment and regression test: after the install grant,
  Jarvis sends the email immediately with **no confirmation card ever**. This consequential effect
  must remain impossible to miss in review.
- Add `"classifies both Email writes as granted_at_install"` and
  `"email.sendReply sends without a confirmation card after install grant"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/email-reply-tools.test.ts`

**Commit**

`feat(email): classify reply writes for install grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
