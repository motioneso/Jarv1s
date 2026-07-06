# Evening Briefing — Full Redesign (chief-of-staff day close)

**Status:** draft — awaiting Ben approval
**Date:** 2026-07-02
**Owner:** Ben + Claude
**GitHub:** #663 (Evening Review Design — reopened; the "already implemented" close conflated
architecture with content)
**Grounded on:** `origin/main` @ `b1a1f672` via detached read-only worktree (local `main` was 10
commits behind and predates the sports-channel wiring — do not ground builds on it without
re-fetching).
**Supersedes/extends:** the content half of
`docs/superpowers/specs/2026-06-25-evening-review-and-interview.md` (#213) — this IS the
`evening-review-content.md` follow-up that spec deferred, widened to a full evening pipeline
redesign. Complements (does not overlap) `2026-06-29-evening-briefing-today-time-gate.md` (#511,
display-only Today behavior).

---

## 1. Product frame (from the 2026-07-02 interview with Ben)

Jarvis is a **chief of staff delivering two scheduled reports a day**. Together they answer:
_"What do I need to be aware of? What do I need to do to be best equipped for success? What did I
miss out on today?"_

- **Morning briefing** — forward-looking: what's coming, be equipped.
- **Evening briefing** — reflective close: recap what happened (celebrate wins), reconcile what
  slipped against what the day was supposed to be about, and **lean toward tomorrow** so the user
  ends the day in the right mindset. It hands off into the optional evening **interview** ("Prep
  for tomorrow") for the true end-of-day reflection.

The formats are siblings, not twins: same engine, same trust model, same delivery — different
lens, tone, and data lenses.

**What exists today is discarded as content.** The current evening run is the morning gather with
a one-sentence prompt swap (`compose.ts` — the only evening-specific line is
`SYNTHESIS_INSTRUCTIONS_EVENING`); calendar still filters to _today_, tasks are the same open
list, and nothing reconciles the day. Issue #663's screenshot is the result. The **infrastructure
is retained**: `briefing_type` column, second definition per user, 19:00 default schedule,
timezone handling, scheduled job + "Your evening review is ready" notification, degraded fallback,
trust boundary, the interview seed/launch, and the #511 Today time gate all stay.

### Market research (feature/layout inspiration, 2026-07-02)

- **Sunsama's daily shutdown ritual** — the strongest analog: review what got done (patterns, not
  guilt), then force **explicit disposition of incomplete tasks** (carry / reschedule / drop) so
  the backlog never silently rots, then a deliberate "close the day" boundary. Users report the
  shutdown, not the planning, is the feature that most improves work-life balance. We adopt: the
  disposition framing ("Carrying forward" is an explicit list the interview can act on) and the
  closure tone. ([Sunsama daily planning & shutdown](https://www.sunsama.com/features/daily-planning-and-shutdown),
  [changelog](https://roadmap.sunsama.com/changelog/daily-shutdown))
- **AI chief-of-staff briefs (alfred\_, Bond's "Presidential Brief", Briefline)** — recurring
  principle: **signal over summary** — "help me quickly understand what actually requires my
  attention," 3–5 things, never a feed restatement. We adopt: the "Needs your attention" section
  is capped and triaged, not an inbox echo. ([alfred\_](https://get-alfred.ai/ai-chief-of-staff),
  [Sliq's survey](https://www.trysliq.com/blog/ai-chief-of-staff))
- **DayStart AI** — continuity: reference running stories only when something actually developed.
  We adopt the spirit for news/sports: results and developments, no filler on quiet days.
  ([DayStart](https://apps.apple.com/us/app/daystart-ai-morning-briefing/id6751055528))
- **DIY evening-digest pattern** (5:30 PM brief: Action Required / Scheduled / FYI / Handled) —
  validates a **fixed section vocabulary** with triage semantics.
  ([builder writeup](https://doneyli.substack.com/p/i-built-an-ai-chief-of-staff-that))

---

## 2. Format decision (locked)

**A dedicated, fixed section vocabulary with flexible content inside it** — the chief of staff has
a house style but adapts to the day. Concretely:

- Section **headers are a fixed, stable vocabulary** (exact strings below), always in the same
  order. The web can style them; nothing machine-parses the narrative into data (#511's
  presentation-only rule stands — detecting the fixed header strings for styling is permitted,
  parsing content is not).
- A section **appears only when its channel has items**, with three exceptions that always
  render: the opening line, **Tomorrow**, and the closing reflection.
- **Length:** 200–350 words of synthesized narrative — concise, but written as connected prose
  with a voice, not a bullet dump. Bullets allowed inside "Carrying forward" and "Needs your
  attention" where scannability wins.
- **Tone:** reflective; celebrates wins concretely and by name; factual and non-judgmental about
  slips (Sunsama's "patterns, not guilt"); forward-leaning close.

### The evening format (section vocabulary)

Fixed order. Headers are exact literals for the prompt and the fallback:

1. **(opening — no header)** 1–2 sentences: the day's verdict from a chief of staff. Names the
   headline win when there is one; acknowledges a quiet day calmly when there isn't.
2. **`What got done`** — tasks completed today (user-tz), commitments fulfilled today, focus items
   achieved. Celebration is specific ("shipped the IMAP spec"), never generic praise.
3. **`What slipped`** — today's focus items (do-date/due-date today, or morning-flagged) that
   didn't complete; commitments now at-risk/slipped. States facts and, where the data shows it,
   the pattern ("both afternoon tasks lost to the 3pm meeting overrun") — no scolding.
4. **`Carrying forward`** — the explicit roll-forward list: overdue open tasks and unresolved
   commitments moving into tomorrow. Written as a disposition-ready list (these are exactly what
   the interview will ask about).
5. **`Needs your attention`** — email that **arrived today** carrying action signals (reply
   needed, bill/deadline, time-sensitive), plus anything urgent before tomorrow morning. Capped,
   triaged, signal-over-summary.
6. **`Tomorrow`** — always present. Tomorrow's calendar shape (event count, first event, crunch
   windows), tasks due tomorrow, and **one mindset-framing sentence** ("light morning — your deep
   work window is before noon"). This is the section the evening leans on hardest.
7. **`News & sports`** — followed-team results from today and tonight's/tomorrow's games (sports
   channel), plus headline developments (news channel when wired, §4.6). Developments only —
   no filler.
8. **(closing — no header)** 1–2 **reflection questions drawn from this specific day's data**
   ("The launch spec slipped twice this week — is Thursday realistic, or should it move?"), then a
   single pointer to "Prep for tomorrow". These questions are the interview's opening material.

### Empty-day behavior (locked)

The evening briefing **always runs**. On a day with no completions and no slips: calm opening,
sections 2–4 omitted, and the briefing carries on the strength of `Needs your attention`,
`Tomorrow`, and `News & sports`. Never a "nothing to report" dead end.

---

## 3. Architecture

One change of substance: `composeBriefing` grows an **evening gather path** — same skeleton
(sections → caps → one bounded prompt → capability-routed synthesis → deterministic fallback),
different channel set and lenses. Everything below the gather (trust boundary, sanitization,
budget, adapter, persistence, notification, idempotency, schedule) is reused unchanged.

### 3.1 Evening channel set (fixed priority order for the token budget)

| #   | Channel                | Source & lens                                                                                                                                                          |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tasks_reconciliation` | Completed-today ∪ focus-today-not-done ∪ carrying-forward (§3.2). The heart of the evening.                                                                            |
| 2   | `commitments`          | Existing `commitments.listVisible`, evening lens: fulfilled-today / at-risk / rolling.                                                                                 |
| 3   | `calendar_tomorrow`    | Existing `calendar.listVisibleEvents`, filtered in compose to **tomorrow** in user tz (same precedent as morning's today-filter). Today's remaining events too if any. |
| 4   | `email_today`          | Existing signals engine (`deriveEmailSignals`) filtered to `receivedAt` = today; action-carrying signals only.                                                         |
| 5   | `goals`                | Existing selection-gated `goals.list`; evening emphasis: only where progress happened today.                                                                           |
| 6   | `sports`               | Existing selection-gated `sports.followedFactsToday`; evening emphasis: today's results + tonight/tomorrow games.                                                      |
| 7   | `news`                 | `web_research` channel (#31) — **reserved, unwired**. Emits a gap until its slice lands (§4.6).                                                                        |
| 8   | `chats`                | Existing `chat.listTodaysTurns`; **context-only** — enriches the recap ("you decided X in chat"), never its own section.                                               |
| —   | ~~`vault`~~            | **Dropped from evening.** Semantic vault retrieval is forward-looking morning material; the evening reconciles structured day data. Budget goes to the new lenses.     |

### 3.2 New data lenses (tasks)

Tasks own the evening. Three lenses, all user-tz day-windowed:

- **Completed today** — `status = done` with `completed_at` in today's local window. The tasks
  read seam supports status filters but no completed-window today; extend the **tasks public
  seam** (tool input or repository API — build decides, module isolation preserved either way)
  with a completed-window lens.
- **Focus today** — open tasks whose `doAt` or `dueAt` is today, plus whatever the priority
  scorer's existing `focusReadiness` seam flagged. "Things I said I wanted to focus on that day."
  `Focus today − completed today = What slipped`.
- **Carrying forward** — open tasks with `doAt`/`dueAt` ≤ today (overdue inclusive), the explicit
  roll-forward list.

**Morning-run cross-reference (reconciliation):** compose additionally loads the **same-day
morning run** from the briefings module's own table (a type-filtered variant of the existing
run queries) and, when present, uses its `source_metadata` priority signals to let the narrative
say "of what this morning flagged…". Optional and degradable — absent morning run, the lens
falls back to focus-today alone. No new table, no cross-module read.

### 3.3 Prompt

A rewritten `SYNTHESIS_INSTRUCTIONS_EVENING` — still a **pure literal** inside the existing
`TRUST_BOUNDARY` construction (prompt-injection hardening #316; the static isolation test extends
to the new literal). It encodes: the chief-of-staff persona and pairing with the morning report,
the exact section vocabulary + order + omission rules (§2), the 200–350-word target, the tone
rules (celebrate specifically, reconcile without judgment, lean toward tomorrow), the
context-only role of `chats`, the developments-only rule for `News & sports`, and the closing
day-specific reflection questions. `TRUST_BOUNDARY`'s channel enumeration gains the new section
keys (it is a literal — updating it is safe).

### 3.4 Interview handoff

The closing questions live in the review text; the existing interview seed already carries the
review, so "Prep for tomorrow" opens against them naturally — no new seed plumbing. The
**deterministic fallback** ends with two canned questions ("What was today's win?" / "What's the
one thing for tomorrow?") so the handoff survives degraded runs.

### 3.5 Deterministic fallback

The evening fallback mirrors the section vocabulary: same headers, concat-style lines per
channel, `degraded: true` + reason, status `succeeded` — identical policy to morning.

### 3.6 Definition defaults

The evening definition's `selected_tool_names` default gains the evening set (including `sports`
when the user follows teams; `news` once wired). Selection-gating semantics unchanged — users
can still deselect channels in briefing settings.

---

## 4. Delivery, UI, and dependencies

1. **Schedule/notification:** unchanged (19:00 default, tz-aware, "Your evening review is ready").
2. **Today page:** #511 owns layout (evening mode, readable-prose helper, support sections). This
   spec's contract to it: stable header vocabulary + prose paragraphs. The presentation helper
   may style the fixed headers; it must not parse content (unchanged #511 rule).
3. **Feedback:** `BriefingFeedbackMenu` stays on evening runs (usefulness-feedback loop applies).
4. **Sports:** channel already wired (`sports.followedFactsToday`) — evening reuses it as-is.
5. **Goals:** channel already wired — emphasis change only (prompt-level).
6. **News is a declared dependency, not scope:** Ben wants news in the evening; the
   `web_research`/news channel (#31) is reserved but unwired. Until its slice lands, `News &
sports` renders from sports alone and `news` records a `gaps[]` entry — the section improves
   automatically the day news lands. Wiring a news source is **its own spec/issue** (scope
   guardrail: no casual connector builds).

---

## 5. Error handling

Morning's policy applies verbatim (single-source failure → `gaps[]`, synthesis failure →
deterministic fallback with `degraded`/reason, status `succeeded`; hard read-tool failure only →
`failed`). Evening-specific additions:

| Failure                                 | Behavior                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Same-day morning run absent             | Reconciliation lens degrades to focus-today alone; no gap entry (not a source).    |
| Completed-today lens unavailable/errors | `gaps[]` `{source:"tasks_reconciliation", reason:"tool_failed"}`; recap continues. |
| News channel unwired (current state)    | `gaps[]` `{source:"news", reason:"empty_cache"}`; `News & sports` = sports only.   |
| Empty day (no completions/slips/emails) | Not an error — §2 empty-day behavior.                                              |

---

## 6. Security & invariants (CLAUDE.md cited)

- **Trust boundary preserved** — new prompt literals interpolate nothing; every new lens output
  flows through the existing `sanitizeExternal` + `renderExternalBlock` path; static isolation
  test extended to the evening literal and new channel keys.
- **Provider-agnostic AI** — same `selectModelForCapability("summarization","economy")` +
  tier-ladder; no provider/model named anywhere in this spec.
- **Secrets never escape / metadata-only payloads** — no payload shape changes; credentials stay
  in-worker; `source_metadata` keeps path/id/excerpt-only provenance.
- **DataContextDb only / AccessContext shape** — all new lenses read through the branded handle
  under `withDataContext(owner)`; no context fields added.
- **Module isolation** — tasks/calendar/email/goals/sports/chats reached only via existing
  manifest tools or public package seams; the tasks completed-window lens extends the tasks
  module's own public surface. The morning-run cross-reference reads the briefings module's
  **own** table.
- **No cross-user read** — everything actor-scoped, unchanged.
- **Migrations** — none expected (`briefing_type` exists; lenses are query-level). If the tasks
  seam needs a grant, it's a **new** file in `packages/tasks/sql/` — never an edit to an applied
  one.
- **File size** — evening gather lands in a sibling module (e.g. `compose-evening.ts`) if
  `compose.ts` (already ~900+ lines) would breach the 1000-line gate.
- **Spec before build** — this document; task issue #663 (reopened) anchors the build.

---

## 7. Testing strategy

Extend `tests/integration/briefings.test.ts` (fake adapter; no real provider):

1. **Evening prompt assembly:** an evening-type run assembles the evening channel set in §3.1
   order — `tasks_reconciliation` first, no `vault` block; assert on the assembled prompt via the
   existing spy pattern.
2. **Lenses:** a task completed today (user tz) appears in the reconciliation section; an open
   task with `doAt` today and no completion appears as slipped; an overdue task appears as
   carrying-forward. Boundary: completion at 23:59 vs 00:01 across a non-UTC tz.
3. **Tomorrow filter:** calendar events tomorrow (user tz) included; day-after-tomorrow excluded;
   DST-adjacent day tested.
4. **Email-today:** a signal with `receivedAt` today included; yesterday's excluded.
5. **Morning cross-reference:** with a same-day morning run present, its priority signals reach
   the prompt; absent, the run still succeeds with focus-today only.
6. **Empty day:** no completions/slips → sections 2–4 absent from fallback output; run
   `succeeded`; `Tomorrow` present.
7. **Gaps:** unwired news → `gaps[]` entry; run `succeeded`.
8. **Fallback:** synthesis failure → deterministic evening-vocabulary fallback ending with the
   two canned questions; `degraded:true`.
9. **Static isolation:** the extended test proves the evening trusted block interpolates no
   external value and enumerates the new channel keys.
10. **RLS:** evening run executes only the owner's data (extend the existing cross-user test to
    `briefing_type = 'evening'`).

**Gate:** `pnpm verify:foundation` green; `pnpm check:file-size` (compose split rule §6).

---

## 8. Acceptance criteria

1. An evening scheduled run synthesizes the §2 format: fixed header vocabulary in fixed order,
   opening verdict + closing day-specific reflection questions always present, `Tomorrow` always
   present, other sections omitted when empty; 200–350 words.
2. The recap is grounded in real day-reconciliation lenses: completed-today, focus-today,
   carrying-forward, commitments status, tomorrow's calendar/tasks, arrived-today email signals —
   not the morning's open-items snapshot.
3. `What slipped` reflects focus-today (and morning-flagged items when a same-day morning run
   exists) minus completions.
4. `News & sports` renders followed-team facts today; news records a gap until #31 wiring lands.
5. `vault` is absent from evening runs; `chats` grounds the recap but has no section.
6. Empty day still produces a useful briefing (attention + tomorrow + news/sports).
7. Evening prompt is a pure literal inside `TRUST_BOUNDARY`; static isolation test covers it.
8. Fallback mirrors the vocabulary and ends with the canned reflection questions.
9. All morning-path behavior (schedule, notification, idempotency, feedback menu, manual run,
   payload invariants) unchanged and green.
10. No migration edits; any tasks-seam grant is a new file; file-size gate passes.

---

## 9. Out of scope

- **News/web-research connector wiring** (#31) — declared dependency, own spec.
- **Today-page evening layout** — #511 (draft) owns it.
- **Evening interview content/flow changes** — the seed contract is unchanged.
- **Weekly/monthly review, cross-day trends** — Insights territory (unchanged #213 deferral).
- **Proactive "want to prep?" nudges** — notification-posture work governs; deferred.
- **Morning briefing content changes** — siblings, but this spec touches only the evening path
  (shared literals like `TRUST_BOUNDARY` get additive edits only).

---

## 10. Open risks

1. **Reconciliation quality depends on task hygiene.** If Ben's tasks rarely carry `doAt`/due
   dates, focus-today thins out and the evening leans on the morning-run cross-reference and
   completions alone. Mitigation: the priority scorer's focus signals as a second source; watch
   the first week's runs.
2. **Tone is the product.** The prompt literal carries almost all of §2's voice; expect 1–2
   empirical tuning passes against real economy-tier output (same risk the morning had).
3. **Budget pressure.** Eight channels + narrative in one economy budget; the fixed priority
   order protects the reconciliation core, but `News & sports` may truncate on busy days —
   acceptable, it's last.
4. **Header-styling drift.** If the web styles fixed headers, a prompt-literal header change
   breaks styling silently. Mitigation: headers exported as shared constants used by both the
   prompt literal and the presentation helper.
