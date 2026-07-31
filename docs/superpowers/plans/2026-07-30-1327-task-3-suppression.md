# Task 3 — extraction, monitor, suppression, and resurfacing

Issue: #1371. This plan follows the approved Task 3 slice and Ben's ruling that accepting a
suggested row resets that subject's suppression state.

## Seams verified

- `packages/connectors/src/email-extract.ts:162-167` owns the model signal contract and
  `:320-333` is the sanitizer boundary; `:399-438` is the cumulative body-reconstruction guard.
- `packages/connectors/src/source-context/email-tasks.ts:114-152` is the pure candidate planner;
  `packages/connectors/src/monitor-jobs.ts:109-184` is the per-account monitor and task port seam.
- `packages/connectors/src/action-suppression-repository.ts:12-53` already owns the RLS-scoped
  suppression table access. Task 3 extends it with bounded batch reads and explicit mutation
  operations; no migration is added.
- `packages/tasks/src/routes.ts:290-325` currently updates a task in one data-context transaction
  but records email feedback afterward; this is the atomicity seam to change.
- `packages/module-registry/src/index.ts:945-980` is the existing composition-root bridge for
  email feedback, and `:1137-1158` wires the monitor/task ports.
- `packages/module-registry/src/built-in-module-helpers.ts:23-43` exposes the runtime memory
  retriever; `GraphMemoryRecallService` is already exported by `@jarv1s/memory`.

## Decisions

- Add `inferredSubject?: string` to the extraction signal. Prompt, sanitizer, and cumulative
  reconstruction handling use the same bounded body-echo policy as existing signal text.
- Add a connectors-local SHA-256 helper using trim/lowercase/whitespace normalization and the
  fixed `email-action-subject` namespace. No import from memory internals.
- Replace sender-domain confidence suppression with subject-state planning. The monitor performs
  one batch suppression read per account, keyed by distinct subject signatures; the old
  sender-domain ratchet and its tests are removed, not weakened.
- Suppression mutations are structural `SuggestionSuppressionPort` methods. Dismiss increments
  only a still-suggested task's subject; accept updates the task and resets count/evidence in the
  same `withDataContext()` transaction. Accept uses an update-only reset and is a no-op when no
  row exists.
- Deadline resurfacing uses the actor timezone from the scoped preferences and the exact
  `deadline:<dueAt>` key. Context resurfacing calls both memory seams through one boolean-only
  `ActionRowRelevancePort`, records the message key after either result, and fails closed.
- Candidate rows require guarded title/explanation/inferred subject, signature, cache id, source
  link, eligible category, and confidence. Missing cache id or link is omitted and not counted.

## Tests and verification

- Extend `tests/unit/email-extract-actionability.test.ts` with the inferred-subject exact,
  long-substring, wrapped, and cumulative reconstruction cases.
- Extend `tests/unit/email-monitor-tasks.test.ts` with exact-subject two-dismissal suppression,
  sender-volume non-effect, due-tomorrow one-shot resurfacing, new-message relevance/fail-closed
  cases, and the named `accept clears the subject dismissal count and used evidence keys` test.
- Extend `tests/integration/tasks-suggested-status.test.ts` with an atomic dismiss/accept proof,
  including accept reset/clear and missing-row no-insert behavior.
- Run focused tests, then `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`; run the isolated
  foundation gate per the handoff before closeout. Commands must be unpiped.

## Kill gate

After the first extraction/subject-state vertical slice, stop if the public task/connector ports
cannot carry the required subject signature and transaction boundary without importing module
internals. The coordinator owns that call; current seams above show no such blocker.
