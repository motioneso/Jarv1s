# Relay 11 — #1264 settings self-operation

Branch/worktree: `1264-settings-self-operation` (this worktree). Coordinator: agent name
`coord-1262` (resolve pane fresh via `herdr pane list` — never trust a cached pane id).
`JARVIS_PGDATABASE=jarvis_build_1264` for all DB work. Integration tests only via
`pnpm exec tsx scripts/test-integration.ts <files>`, never raw vitest on integration files.

## Done, this relay (all green, all committed)

- `e6fe5d8a` — mandatory undo-apply tool (`settings.undoLast`,
  `packages/settings/src/undo-apply-tool.ts` + manifest wiring +
  `tests/integration/settings-undo-apply-tool.test.ts`, 5 tests). Coordinator's 4 binding design
  constraints satisfied: CAS `expectedRevision` is the tracked write's own `resultingRevision`
  (never a re-read), `previousRevision` stays pre-mutation/null-means-absent and is used only for
  delete-vs-upsert branch selection, `pop()` consumes the entry on success, tool itself carries
  `selfOperationGrant: "granted_at_install"` + `actionFamilyId: "settings.preference-write"`.
- `2d96084d` — doc-only fix: `settings.undoLast`'s manifest `description` now states in plain
  language that it only tracks changes made earlier in the same chat since the last restart (spec
  line ~139's "Restart clears it; documented" requirement — was previously only a code comment,
  not assistant-facing).
- `94e4167b` — **Task 10 done.** Rebased `tests/unit/self-operation-manifests.test.ts`'s aggregate
  inventory test. New counts: `grantedAtInstall` 29 → **37**, `confirmAlways` **5** (unchanged),
  `userPromotable` **4** (unchanged), sum 38 → **46**. The +8 jump (not the predicted +7) is
  `chat.setResponseStyle` — landed via `1e7f57ec`/PR #1268, already merged to `main`, unrelated to
  this branch — plus this branch's 7 settings tools (theme mode, locale ×2, quiet hours, weather
  location, notification preference, undoLast). Verified by walking the live
  `getBuiltInModuleManifests()` registry directly (temp script, deleted after use) — don't assume,
  recompute if anything here looks stale.
- Provenance boundary re-confirmed and reported to coordinator (their confirmations ONE/TWO/THREE,
  all resolved): `settingsUndoStack.push` is called ONLY from the 6 settings tool `*Execute`
  functions; every `*-routes.ts` REST handler (`themes-routes.ts`, `locale-routes.ts`,
  `quiet-hours-routes.ts`, `weather-location-routes.ts`) calls the plain non-CAS
  `preferencesRepository.upsert` and never touches the undo stack or `upsertWithRevision`. Manual
  settings-UI edits and other chats are structurally invisible to undo — verified by reading, not
  assuming.
- Coordinator has been messaged with all of the above (task done + count discrepancy explained +
  confirmations ONE/TWO/THREE). No response requiring action was pending at relay time.

## NEXT, in order

### 1. Task 13 — rate limiting

Not yet investigated this branch. Spec section ~lines 144-148: per-actor and per-tool limits
(no-op suppression already done, Task 9, `277d9e81`), bounded mutation retention, metrics on
hard-exclusion hits and repeated CAS-conflict failures. Read that spec section fresh — don't infer
from memory.

### 2. Task 11 — wrap-up

Governed by the coordinator's standing 5-condition ruling (already relayed in prior handoffs, still
binding):
1. UAT spec with inline `test.fixme` per real-chat scenario, citing the reopened #1121.
2. Mutation-tight **backend** proof: no confirmation card emitted for a granted-tier tool against
   the real gateway's emitted event stream.
3. Mutation-tight **frontend** proof: mocked e2e showing no action-request card renders for the
   same case.
4. The undo direct-test (already substantially written and passing —
   `tests/integration/settings-undo-apply-tool.test.ts`, 5 tests, `tests/unit/settings-undo-stack.test.ts`,
   7 tests) is the most valuable already-provable piece; cite it in the PR body.
5. PR body must state plainly that the automated exit criterion is unmet for a **structural
   harness reason** (no #1000-style Playwright harness exists against a real dev instance yet) —
   not silently, not as a footnote — and that Ben's manual LAN pass is still required.

Coordinator reaffirmed this segment: **"Do not expect to merge tonight — Ben's manual pass gates
it."** Do not treat a green local gate as mergeable; it is a PR-readiness bar only.

After Task 11: full `pnpm verify:foundation` green, then `coordinated-wrap-up` (clean tree,
pre-push trio `format:check && lint && typecheck` + fresh rebase against `origin/main`, push, PR
citing #1264 and #1272 as applicable). Report PR + verified evidence to the coordinator. Never
merge, touch the board, or close the issue — that stays the coordinator's job.

## Standing bans (unchanged)

Never `git add -A`. Never commit `.claude/context-meter.log`. Never assume a migration number.
Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265 — size any new string-bound
schema fields as if `minLength`/`maxLength`/`pattern` enforcement is already real). Read spec by
section only, never in full.
