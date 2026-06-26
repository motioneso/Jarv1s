# Review: #515 / #516 — Calendar + Email briefing signals

**Branch:** `codex/515-516-briefing-signals`
**Scope:** `packages/briefings/src/compose.ts`, `packages/{calendar,email}/src/{manifest,routes,tools}.ts`, `packages/shared/src/{calendar,email}-briefing-settings-api.ts`, `packages/{calendar,email}/src/settings/index.tsx`, `tests/{integration/calendar-email.test.ts,unit/briefings-compose.test.ts}`
**Gate:** unit 19/19 ✓, integration 22/22 ✓, calendar+email typecheck ✓
**Verdict:** No blockers. Approve with 2 medium-risk findings + 4 test gaps to address before/after merge.

---

## BLOCKING FINDINGS

**None.** No bypass of module/action governance, no RLS/account-context loss, no permission mistakes, no behavioral regression. The "no briefing bypass" hard rule (both specs §8.3) is honored: derived `suggestedActions` are **metadata strings only** (`"create_task"`, `"block_time"`, `"auto_send"` etc.) — they are never executed. The compose path never calls a write tool. Settings are read via `PreferencesRepository` (RLS-scoped, `app.current_actor_user_id()`). The REST DTO still does NOT leak `connectorAccountId`/`threadId`/`connectorLabel` — those are added only on the assistant-tool path (`serializeEmailToolMessage`), and the tool's `outputSchema` correctly requires `connectorAccountId` there. Good.

---

## MEDIUM-RISK FINDINGS

### M1. Email signal cap can starve `follow_up_risk` — violates spec #516 §6.3 (hard rule)

**Where:** `packages/briefings/src/compose.ts:701` (`deriveEmailSignals` → `topSignals(scored, 5)`)

**Problem.** Spec #516 §6.3 is a **hard rule**: "older unresolved threads stay in scope … recency alone does not decide whether a thread matters." But the 5-slot global cap is filled by score, and the scoring guarantees `bill_due_or_past_due` (100) and `time_sensitive` (90) always beat `follow_up_risk` (75). A user with 2 billing emails + 1 deadline email fills 5+ slots before any older unresolved thread can surface. The "buried but still important" rescue case the spec exists to serve is the first thing to get crowded out.

**Suggested fix.** Reserve ≥1 slot per signal type before filling the remainder by score (e.g. top-1 of each type, then top-N by score up to 5). This is a small change to `topSignals` or a per-type pre-pass in `deriveEmailSignals`. Not a merge blocker (the heuristic still works for the common case), but it should ship before this is called "done" against §6.3.

### M2. `email.listVisibleMessages` returns the entire mailbox (no LIMIT) → unbounded compose cost

**Where:** `packages/email/src/repository.ts:26-35` (`listVisible` has no `.limit()`)

**Problem.** The tool feeds the entire `app.email_messages` table (ordered by `received_at desc`) into `deriveEmailSignals`, which iterates every row. For a daily-driver user with months of synced mail this is (a) a growing per-briefing cost and (b) a quiet correctness drift: as the mailbox grows, the 5-signal cap is drawn from an ever-larger pool, making it less likely an older thread survives. The calendar side has the same shape but is naturally bounded (a day's events); email is not.

**Suggested fix.** Add a bounded `.limit()` at the repository level (e.g. 200 recent) OR — better for the §6.3 intent — a two-pass read (recent N + a small set of flagged "unresolved" rows). At minimum cap it; an unbounded read feeding an LLM-shaped pipeline is a future incident.

---

## LOWER-RISK / SPEC-DRIFT NOTES

### L1. Calendar lookahead surfaces future events even when they generate NO prep signal

`compose.ts:464` filters future events into `todayEvents` by `diff <= lookaheadDays`, then per-event signal derivation runs. A future event that matches none of the prep/high-stakes regexes is simply dropped from the output — which is correct. But the `schedule_density_overload` and `usable_open_gap` derivations only run over `today` (line 466), so lookahead events contribute nothing to density. This is actually spec-compliant (§6.1: "density/overload/gaps are computed from today only"). **No action — noting that the implementation is more conservative than it looks.**

### L2. `contextTokens` token-length filter (≥5 chars) may miss short but meaningful overlap

`compose.ts:382` drops tokens shorter than 5 chars before building the cross-source context set. A task like "Visa" or a contact "Mum" will never register as overlap evidence. Low impact on this slice (overlap is a tie-breaker, not a gate), but worth knowing if the relevance scoring is ever tuned. **No action for this PR.**

### L3. Composition root does not explicitly inject `preferencesRepository` into the route deps

`module-registry/src/index.ts:518,524` pass bare `registerCalendarRoutes`/`registerEmailRoutes`, so both fall back to `?? new PreferencesRepository()` per request. This is **correct and safe** (the repo is stateless; the `scopedDb` carries connection + actor GUC under RLS). It's just inconsistent with the chat path (`module-registry:557` explicitly constructs one). Not a bug — flagging for consistency only.

---

## RESIDUAL TEST GAPS

1. **No test that `lookaheadDays: 0` suppresses future-day prep signals.** The integration test sets `lookaheadDays: 0` (line 567) but only asserts the settings echo back — it never verifies the compose path then drops a tomorrow event. The unit test only covers `lookaheadDays: 2` _promoting_ a future event. The zero case (the "today only" default if a user sets it) is untested at the compose layer.

2. **No test that an older unresolved thread actually surfaces.** §6.3 is a hard rule and there's no test with a 14-day-old reply-shaped message asserting it appears in `emailSignals`. Given M1, this gap hides the bug.

3. **No test for `schedule_density_overload` / `usable_open_gap` / `travel_transition_pressure`.** Only `prep_needed`, `high_stakes_meeting`, and `needs_reply` are exercised. Three of the five calendar signal types and their thresholds (≥4 meetings, ≥300 min, ≥60 min gap, ≤15 min transition) are uncovered.

4. **No test that `suggestedActions` actually reflect the settings toggles.** The `deriveCalendarSuggestedActions` / `deriveEmailSuggestedActions` logic is the one place settings flow into signal metadata, and it's untested. A user turning `createTasks: false` should remove `"create_task"` from the calendar prep signal's actions — not asserted anywhere.

---

## WHAT'S DONE WELL

- **No briefing bypass.** `suggestedActions` are inert strings; compose never writes. Both specs' §8.3 honored.
- **Account context preserved on the tool path, blocked on REST.** `serializeEmailToolMessage` adds `connectorAccountId`/`threadId`/`connectorLabel`; the REST DTO (`emailMessageDtoSchema`, `additionalProperties:false`) does not. The asymmetry is intentional and correct (spec #516 §6.4, §12).
- **Settings stored as independent preferences** (not an autonomy ladder). Both specs' §8.1 honored.
- **Trust-boundary hardening retained.** New signal summaries route through `sanitizeExternal` before entering the `<external_source>` block; no regression to the #316 prompt-injection defense.
- **Falls closed on missing data.** Empty vault/email/calendar → `gaps[]` entry, not a crash; the `sourceBehaviorPolicy` optional-deps pattern degrades cleanly.
