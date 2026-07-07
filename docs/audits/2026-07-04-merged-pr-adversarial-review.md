# Adversarial Review — PRs merged in the 48h window 2026-07-02T15:53Z → 2026-07-04T15:53Z

**Grounded on:** `origin/main @ 422157a1` — read-only worktree `/tmp/audit-ground-0704`,
`pnpm audit:preflight` logic exit 0 (`behind=0 ahead=0`).
**Method:** 4 independent adversarial review agents (RLS/connectors, data/settings, AI/briefings,
dead-code+design sweep), each instructed to refute its own candidate findings before reporting.
Every finding names the deciding line. Review only — no code changes made.

**Scope:** 24 merged PRs. **Excluded by request:** PR #750 (issue #729 live-first source context).
**Excluded by window (merged before cutoff):** PRs #673, #675, #676. **Docs-only, skipped:** PR #720.

## Headline

**Zero CRITICAL, zero HIGH.** All hard invariants held across every PR reviewed: RLS
owner-scoping (incl. the new worker policies), secrets-never-escape, metadata-only job payloads,
provider-agnostic AI, module isolation, VaultContext-only vault I/O, AccessContext shape,
migration hygiene. Real findings: **2 confirmed MED functional gaps** (both in the
people-notes/settings cluster), 1 MED scope-conformance note, and a tail of LOWs.

## MED findings

### MED-1 (CONFIRMED) — PR #749: PATCH/archive person returns 500 for note-less people once a folder is configured

`packages/people/src/routes.ts:264-275` (PATCH) and `:285-296` (archive) call
`updatePersonNote`/`archivePersonNote` unconditionally when `settings.folder && deps.vaultRunner`;
`packages/people/src/notes-service.ts:280` throws `"Canonical People note not found"` when the
person has no canonical `.md` (true for every person projected from email/calendar sync, and
`refreshFromFolder` only files a review candidate — it never creates the note). Unhandled → 500,
no fallback to the DB-only path used in the `else` branch.
**Fix:** catch missing-note and fall back to `repo.updatePerson`/`archivePerson`, or create the
note on demand.

### MED-2 (CONFIRMED) — PRs #749+#752 combined: `people.notes.suggest-updates` is default-on with no reachable UI toggle

Consumed at `packages/module-registry/src/index.ts:397-406` (gates the people-projection
afterSync hook); declared default-on at `packages/people/src/manifest.ts:56`. PR #752 deleted the
generic server-driven "Data sources" pane that rendered all modules' `sourceBehaviors`, and no
replacement surface covers this behavior (`settings-people-pane.tsx` has no switch; it is not in
`BRIEFING_SOURCE_BEHAVIORS`). A default-on behavior that re-projects people on every notes sync
cannot be disabled from the UI on current main.
**Fix:** render the toggle in the people settings pane, wired to
`PUT /api/me/source-behaviors/{id}`.

### MED-3 (PLAUSIBLE, product call) — PR #748: YOLO-controls "move" bundled a behavior narrowing

`apps/web/src/settings/settings-yolo-admin-group.tsx:44-45` filters grant candidates to
`status === "active"`; the old pane rendered a per-user switch regardless of status. An admin can
no longer grant YOLO to pending/deactivated accounts from the UI. Narrower, not a security hole —
arguably an improvement — but it shipped inside what was billed as a pure relocation. Everything
else about the move verified clean: same admin gating (`settings-page.tsx:139-147`), same backend
mutations, old pane fully scrubbed, no widened visibility.
**Action:** Ben decides whether the narrowing is intended; if yes, note it and close.

## LOW findings

| PR | Finding |
| --- | --- |
| #677 | IMAP password lingers in React component state after successful connect (`google-connector-step.tsx` `onSuccess` never clears `imapPassword`). Never reaches logs/responses/prompts — hygiene only. Fix: clear credential state on success. |
| #751 | `mutedSources` deprioritizes but never excludes: `packages/priority/src/scoring.ts:184-186` caps score to low band; `priority-consumer.ts:74-89` keeps all items. User muting `email` still gets email evidence in model context (their own data, grant-gated — UX expectation gap, not security). Fix: drop muted candidates or relabel the toggle. |
| #753 | Quiet-hours pane PUTs per keystroke; clearing a time input sends `""` → backend 400 (`quiet-hours-routes.ts:86`) → drift toast. No corruption. |
| #712 | Orphaned CSS left behind: `apps/web/src/styles/kit-chat.css:926-984` (`.memory-panel`, `.memory-toggle`, …) styles the deleted MemoryPanel, and `tests/unit/unstyled-surfaces-css.test.ts:18` now locks the dead CSS in as a must-exist contract. Also dead token alias `--provisional-opacity` (`tokens.css:245`). |
| #752 | Orphaned module `apps/web/src/settings/settings-data-source-model.ts` (only its own test imports it); `email.briefings`/`calendar.briefings` toggles double-rendered (same pref, shared query key — redundancy only); pre-existing dead behavior `email.capture-tasks` (`email/src/manifest.ts:103`) declared but consumed nowhere. |
| #749 | `upsertPersonProjection` conflicts on user-controlled `id` only (`repository.ts:261-298`) — cross-user overwrite refuted (RLS blocks it); informational defense-in-depth note. |
| #678 | PR bundles a second commit (standings-rail rewrite) beyond the titled photo fix; side effect: `SportsOverviewResponse.degraded` now unread anywhere in `apps/web/src` (backend still sets it) — orphaned field for the next dead-code pass. |
| #691 | Coverage gap: no test asserts `is-active` styling in search-results/expanded-group views (chips only). |

## Verified clean (selected refutations, with deciding evidence)

- **PR #682 (wellness worker RLS):** all 4 new policies in
  `packages/wellness/sql/0139_wellness_worker_read_policies.sql:9-25` are
  `FOR SELECT TO jarvis_worker_runtime USING (owner_user_id = app.current_actor_user_id())` —
  exact mirrors of the app-role predicates (0082/0083/0084/0089), no `USING(true)` anywhere in
  `packages/wellness/sql/`, no existing migration touched, `foundation.test.ts:312` row present.
  New regression test seeds marked data across all 4 tables and runs the export under the real
  worker role — it fails on silent RLS omission (the actual #672 bug class).
- **PR #677 (IMAP onboarding):** frontend-only; reuses the hardened connect/test endpoints.
  Secrets never echoed (`ConnectorAccountDto.hasSecret: boolean`), host/port/TLS come from the
  in-code preset registry (no SSRF), creds only in `useMutation` (never a cache key), AES-256-GCM
  at rest, only `imap-proton` is plaintext (loopback Bridge, expected).
- **PR #751 (priority ranking):** "priority model" is a **pure deterministic scorer**
  (`packages/priority/src/scoring.ts:204-246`) over user prefs — no LLM, no provider/model id, so
  the provider-agnostic invariant is moot. Feeds only already-grant-gated evidence
  (`runtime.ts:456-467` via `gateway.runReadToolForActor`), reorders in memory, persists nothing,
  fails open to unranked context (`chat-session-manager.ts:648-650`).
- **PR #719 (evening briefing):** model chosen via
  `selectModelForCapability(scopedDb, "summarization", "economy")` (`compose-shared.ts:457-497`);
  credential decrypt worker-scoped and never logged; persisted `summary_text` +
  `source_metadata` are owner-stamped, raw bodies never persisted (`Section.rawItems` excluded,
  email signal summaries templated sender+subject only, `signals.ts:288-324`); trust boundary is
  real — every external value passes `sanitizeExternal` (`trust-boundary.ts:31-44`) including
  re-sanitizing persisted morning signals on refeed (`compose-evening.ts:85`), and
  `briefings-prompt-isolation.test.ts` statically enforces the literal preamble.
- **PR #749 (people-notes):** module isolation holds — people⊥notes, seam only in the
  module-registry composition root (`index.ts:840-852`); all vault I/O via VaultContext with `..`
  rejected; every route owner-scoped; notes job payloads metadata-only (`jobs.ts:30-38,61-64`).
- **Dead-code PRs #710–#718, #693:** every removed symbol independently re-verified
  zero-reference in the worktree (word-boundary + dynamic-access greps). All correct removals;
  only the #712 orphaned-CSS LOW above.
- **Design PRs #754 #746 #699 #698 #697 #696 #694 #692 #691 #678:** no behavior regressions
  hiding in style fixes, no raw colors outside `tokens.css`, no banned left-border accent
  reintroduced, no weakened tests. #697's eslint `no-restricted-imports` rule is error-severity
  and genuinely enforces the Sparkles ban; #694's `check-design-tokens.ts` guard verified
  functional (fails on a synthetic violation, wired into `verify:foundation`).

## Follow-up

Per the build-needs-task-issue rule, MED-1 and MED-2 should become GitHub `task` issues before
anyone fixes them; MED-3 needs a Ben decision. LOWs can be batched into a hygiene issue or the
next dead-code pass. No security follow-up required from this window.

## Review hygiene

- Worktree `/tmp/audit-ground-0704` removed after the run. The stale `/tmp/audit-ground`
  (@ `80bad5eb`, from the unexecuted 2026-07-03 review plan) was left untouched — it belongs to
  that plan's session.
- The broader two-week review planned in
  `docs/superpowers/plans/2026-07-03-merged-pr-adversarial-review.md` (status: planned, never
  executed) remains outstanding; this 48h review covers only its newest slice.
