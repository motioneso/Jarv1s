# Adversarial security review — PR #1376 (Jarv1s issue #1371)

You are an independent reviewer. You did NOT write this code. Your job is to find what is
**wrong, unproven, or untested** — not to summarise what the PR does.

Branch: `build/1327-core` @ `d4c7d734`. PR: #1376. Spec: `docs/superpowers/specs/2026-07-29-1327-briefing-action-rows.md` (read §5, §9 Tasks 1-4, §10, §11 — do not read it in full).
Risk tier: **security**.

## Scope

Spec §9 Tasks 1-4 only: shared contracts, email reply targets + provider links, extraction/monitor/
suppression/resurfacing, and the Gmail link enablement. The row UI is a later lane — out of scope.

## Hunt these specifically

1. **Trust boundaries that are asserted rather than proven.** `GMAIL_ACTION_LINKS_ENABLED` was
   flipped to `true`. The `/u/0` account index is a documented unverifiable assumption about the
   viewer's browser session — check the limitation is actually recorded at the call site and in the
   PR body, and that nothing in the code claims more than was proven.
2. **Data leakage.** No email body, subject, sender, recipient, thread id or message id may reach a
   log line, an error message, a pg-boss payload, a test diagnostic, or an AI prompt. Model-written
   fields must pass the existing `safeSignalStr()` sanitiser and the cumulative body-reconstruction
   guard in `packages/connectors/src/email-extract.ts`.
3. **Account-scoping.** `listEmailContext()` was changed to key the cache by
   `(connectorAccountId, externalId)`. Prove two accounts sharing one provider message ID cannot
   cross over. This is the RLS-adjacent bug class.
4. **The linkless-row change (Ben's ruling, 2026-07-30).** A candidate with no `sourceHref` must
   still be emitted and counted with `primaryAction: null`. A candidate with no `cacheMessageId`
   must still be omitted and not counted. Verify BOTH directions, and verify the link *builder* was
   not weakened: google-without-thread-metadata still returns null, IMAP still returns null.
5. **What is NOT tested.** Suppression fail-closed paths, the accept-resets-the-count transaction
   boundary, and the resurfacing evidence keys. Name any behaviour the spec locks that has no test.

## Rules

- Trust CI for the mechanical gate (`gh pr checks`). Do not re-run lint/typecheck/tests unless CI is red.
- If you need a DB, export an isolated `JARVIS_PGDATABASE` you DROP/CREATE yourself, via
  `docker exec jarv1s-postgres psql -U postgres` (never `-U jarv1s`). Never touch prod (`10.252`, `1533`).
- Never print an env value, a token, or any real mailbox content into your output.
- You are a reviewer: do not fix anything, do not push, do not merge.

## Output

Post your verdict to the PR: `gh pr comment 1376 --body "..."`. Structure it as:
APPROVE or REJECT, then blocking findings (file:line + why it is exploitable or wrong), then
non-blocking notes. Be specific; "looks fine" is not a review.

The coordinator will push back on findings it disagrees with — expect that and defend your reasoning.
