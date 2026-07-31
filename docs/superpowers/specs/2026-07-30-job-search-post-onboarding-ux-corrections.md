# Job Search Post-Onboarding UX Corrections

**Status:** Approved
**Date:** 2026-07-30 · **Approved:** 2026-07-30
**Issue:** #1375 · child of #1280  
**Evidence:** `docs/superpowers/research/2026-07-30-job-search-ui-post-onboarding-re-review.md`

## 1. Problem

The populated Job Search experience has the right visual foundation, but several prominent signals
disagree with their own evidence or source-of-truth state:

- a role can be labelled Strong fit while its reason says it is a different profession;
- the chat can end on “waiting for confirmation” after the requested source is already enabled;
- Matches and Overview use “New” for different sets;
- Monitors promises a morning cadence while the worker runs every six hours; and
- active utility screens still prioritize setup ceremony over current decisions and controls.

The result is a board that looks confident before it is dependable. This change makes the existing
experience coherent and faster to triage. It is a correction pass, not a visual rewrite.

## 2. Goals

1. A Fit band must never contradict structured negative evidence produced by the same scoring pass.
2. State-changing chat turns must end with a durable, user-readable outcome derived from the tool
   result, not model prose.
3. Repeated board triage must preserve place and expose the minimum useful filters and row actions.
4. Counts, cadence, labels, and accessibility semantics must describe the behavior that actually
   exists.
5. Overview, Profile, and Monitors must have task-specific hierarchy while retaining the Jarv1s
   visual system.

## 3. Preserve

- Warm dark surfaces, forest navigation, restrained gold, and the authored voice.
- The dense, rule-separated Matches list.
- Fit and Want as two independent axes. They are never combined, averaged, or ranked together.
- Honest queued, missing-résumé, degraded-source, and no-posting-body copy.
- Full-page inspector navigation; this work repairs continuity rather than replacing the pattern.

## 4. Non-goals and overlap

- No cards, Kanban board, dashboard-card grid, gradients, animation pass, or decorative AI motifs.
- No combined recommendation score or new score visualizations.
- No new dependency.
- No paging work already owned by #1333.
- No rebuild of the match-detail/open-posting route already owned by #1330. This work extends that
  landed one-match read with the already-stored posting body and `scoredAt`; it does not change the
  list-row contract or add another detail route.
- No per-source crawl schedule editor. Runtime schedule metadata remains a separate capability.
- No automatic application submission or other change to the original Job Search safety boundary.

The earlier mobile report that the inspector can begin under the fixed shell header remains an
acceptance check. It was not re-tested in the post-onboarding pass and must not be treated as fixed
without a mobile verification.

## 5. Approaches considered

### A. Patch each visible symptom

Each screen would gain its own count rule, copy fix, scroll fix, and score safeguard.

This is initially small but leaves the same concepts defined in several places. The next board or
summary change could recreate the contradictions.

### B. Repair the existing shared seams, then simplify each screen

- scoring owns score/reason coherence before persistence;
- one board-bucket helper owns unreviewed/saved/passed membership;
- the existing chat action-result record owns mutation outcomes; and
- each utility screen composes the same records around its actual task.

**Decision: B.** It fixes each contradiction once, reuses current contracts, and deletes ceremonial
layout instead of adding another presentation layer.

## 6. Score coherence

### 6.1 Structured scoring output

`ScoreResult` gains one Fit-only field:

```text
fitDisposition =
  supported
  | insufficient_evidence
  | domain_mismatch
  | dealbreaker
```

The field describes the relationship between the résumé/profile evidence and the role. It is not a
third score, recommendation, confidence percentage, or combined Fit/Want result.

The scoring prompt must require:

- `domain_mismatch` when the title overlaps but the profession or work domain does not;
- `dealbreaker` when the posting conflicts with an explicit dealbreaker;
- `insufficient_evidence` when the résumé does not support a confident Fit judgement; and
- `supported` only when none of those conditions applies.

Strict schema validation remains: missing, unknown, or invalid fields fail the score and persist
nothing.

### 6.2 Persisted Fit

Before `runScore` writes a match:

- `supported` preserves the returned Fit;
- `insufficient_evidence` caps Fit below the Strong band;
- `domain_mismatch` and `dealbreaker` cap Fit in the Weak band.

The persisted numeric Fit is the normalized value. Every existing consumer therefore receives a
coherent band without UI phrase matching or per-screen guards. The original reason remains intact,
so the inspector explains the negative evidence rather than hiding it.

Want is untouched. A Fit disposition must never alter Want.

Existing matches are corrected on their next ordinary scoring pass; this slice does not add a
one-off database rewrite.

## 7. Chat action truth

The gateway already emits `action_result` records and `TranscriptRecord` already has a bounded,
structured `result` field. This work completes that seam rather than adding a Job Search transcript
implementation.

For successful state-changing tools:

1. The bounded, sanitized tool result is attached to the `action_result`.
2. A tool may return a short `statusText` intended for the user. Job Search state-changing tools
   return concrete outcomes such as `LinkedIn monitoring enabled`, `Criteria updated`, or
   `Résumé saved`.
3. The transcript renders action results as first-class status rows, not inside the collapsed
   “Behind the scenes” group.
4. Denied or failed actions render `Not changed` plus the safe typed reason.
5. The short outcome survives transcript reload. Structured result data remains live-only unless
   already permitted by its existing persistence contract.

The model’s earlier sentence remains conversation history; it is not rewritten. The later
source-derived action outcome is the terminal status. Query invalidation declared by
`affectsQueryKeys` remains the mechanism that refreshes structured screens after the action.

This is a generic core behavior for state-changing tools. There is no switch on
`job-search.portal.set-enabled` in the chat UI.

## 8. Board triage and continuity

### 8.1 One bucket definition

A shared web-domain helper owns:

```text
unreviewed = unscored | new
saved      = seen
passed     = dismissed
```

Matches and Overview both use it. The user-facing tab and summary label is **Unreviewed**, not New.
Overview may separately show **Scored**; it must not reuse New for the scored subset.

### 8.2 Filters

All rows are already loaded through the existing paged board reader, so filtering stays client-side.
One compact filter row provides:

- one search input over title and company;
- location text;
- posted-date range: Any time, 24 hours, 7 days, 30 days;
- Fit band: Any, Strong, Good, Fair, Weak, Not scored; and
- source.

Filters combine with the selected bucket and existing single-axis sort. An active filter count and
one Clear action are enough; no saved searches or query builder.

### 8.3 Row actions

Each row exposes keyboard-operable Save and Pass controls without opening the inspector. They call
the existing match-state queue and reuse its optimistic/reconcile behavior. Activating either
control must not also activate the row.

The inspector retains Save, Pass, and Discuss for users who want the evidence first.

### 8.4 Position restoration

Opening a match records:

- window scroll position;
- originating match id; and
- the element that held focus.

Back, Save, or Pass closes the inspector, restores the prior scroll position, and returns focus to
the originating row when it still exists. If filtering or a decision removed that row, focus moves
to the nearest remaining row or the board heading.

The inspector must begin below the fixed shell header at mobile widths.

## 9. Posting description and inspector

`Posting.body` is already part of the domain record and database row. freehire already converts its
HTML description to plain text and stores it. Two gaps are corrected:

1. `job-search.match.get` returns the stored body with the existing one-match detail response.
2. LinkedIn search cards contain no description, so the adapter fetches the public job-detail
   fragment when an inspector requests an empty-body LinkedIn posting, converts its description HTML
   to plain text with the existing adapter logic, and stores it.

This lazy path covers both existing and future LinkedIn rows without adding one detail request for
every search result during a crawl. The next read reuses the stored text. The fetch remains subject
to the existing deadline, host allowlist, auth-wall stop, and structured failure rules; it never
signs in or works around a login wall.

The inspector becomes one readable column:

1. Back;
2. company, source, posting date, title, location, and original-posting link;
3. **Job description**, rendered as readable plain text;
4. a short axis definition;
5. Fit, then its reason;
6. Want as `N/100`, then its reason;
7. scored time; and
8. Save, Pass, and Discuss.

The current paragraph telling the user that Jarv1s does not store the description and to open the
original posting is removed. The original-posting link remains a secondary source link in the
header. If a source genuinely provides no public description or enrichment fails, the section says
only **Job description unavailable** and exposes the structured source failure when one exists.

Fit and Want reasons use a readable 55–75 character measure. The queued state keeps its current
honest explanation. The role title is `h2`; the module masthead remains the single `h1`.

The match detail response adds `body` and `scoredAt`, both already stored. No revision model,
confidence score, rich-HTML renderer, or provenance subsystem is introduced.

## 10. Utility-screen hierarchy

The visual tokens stay shared. The page shapes stop being identical.

### 10.1 Overview: status-led

Overview is only reached for an active or paused profile, so completed onboarding is no longer its
hero.

The first screenful answers:

- how many roles are unreviewed and scored;
- how many are queued;
- when any source last succeeded;
- whether a source needs attention; and
- the next useful action.

The primary action opens Matches with the Unreviewed bucket selected. Completed setup collapses to a
single quiet status line. Existing blockers remain only when the user can act on them.

No “next run” time is invented. Until schedule metadata exists, the copy is **Checks
automatically**.

### 10.2 Profile: field-led

Profile begins with the criteria and résumé fields themselves, not an eyebrow/display-title/strap
hero. Résumé replacement and briefing controls remain.

The criteria section gains one visible **Change in chat** action beside the fields. It opens the
existing profile-scoped assistant surface with the composer seeded to change this search’s
criteria. It does not create a second criteria editor or a new write path.

Because #1246 grants the module’s routine `profile_changes` action family at install time, normal
criteria corrections do not introduce per-field permission prompts. Destructive or external
actions retain their existing confirmation behavior.

### 10.3 Monitors: control-led

Monitors begins with the enabled source rows and their controls. The repeated ceremonial hero,
decorative eyebrow, and gold strap are removed.

For each source:

- Run now is a conventional button in its own action group;
- the switch has visible text such as **LinkedIn monitoring**;
- its accessible name is **Enable LinkedIn monitoring**;
- status remains separate from the switch label; and
- the cause and last-success facts remain record-derived.

The introductory copy says **Checks automatically**. It never says “every morning.”

## 11. Navigation semantics

The profile selector, main view selector, and board bucket selector are ordinary navigation
buttons. Their faux `tablist`/`tab` roles are removed and the selected destination uses
`aria-current`. This keeps their existing click, Tab, and Enter behavior without promising roving
Arrow/Home/End behavior they do not implement.

There is one `h1`: Job Search. Overview, Profile, Monitors, and inspector titles begin at `h2`.

## 12. Accessibility and responsive requirements

- Every switch and icon-only control has an accessible name.
- Row Save/Pass actions expose the role title in their accessible names.
- Focus restoration is covered by a browser test, not only a scroll assertion.
- At 390 px width, the inspector Back control and identity metadata are visible below the fixed
  header without horizontal overflow.
- Filter labels remain visible or programmatically associated at desktop and mobile widths.
- Status changes use a polite live region; failures use an alert.

## 13. Verification

Minimum proof:

1. Domain unit tests reject missing/unknown Fit dispositions and prove both caps without changing
   Want.
2. Score-stage test proves the normalized Fit is what reaches `upsertMatch`.
3. Chat tests prove executed/denied/error outcomes render outside “Behind the scenes,” use
   `statusText`, and survive history reload.
4. Board tests cover every filter, combined filtering, row Save/Pass event isolation, shared
   unreviewed counts, and list restoration.
5. Adapter and handler tests prove freehire and LinkedIn descriptions become stored plain text,
   existing empty LinkedIn rows enrich once, and `match.get` returns `body` and `scoredAt`.
6. Inspector tests cover the one-column description layout, unavailable fallback, `N/100`,
   `scoredAt`, and heading level.
7. Settings tests assert the switch name and absence of “every morning.”
8. Overview/Profile/Monitors tests assert their task-specific primary content and absence of the
   repeated hero template.
9. A browser pass at 1280 × 1800 and 390 × 844 verifies focus/scroll continuity, fixed-header
   clearance, accessible names, and no horizontal overflow.
10. Live dev proof confirms a LinkedIn inspector contains the description text, a source enablement
    produces a visible terminal outcome, and the Monitors row agrees after reload.

## 14. Success criteria

This work is complete when:

- explicit mismatch/dealbreaker evidence cannot coexist with a Strong fit band;
- a chat-initiated source change ends on a durable result that agrees with Monitors;
- inspecting and returning to a role does not lose place;
- the detail page shows the stored public job description instead of directing the user elsewhere;
- a user can reduce and decide a 50+ role board without opening every inspector;
- Matches and Overview use the same unreviewed definition;
- monitor controls are named and cadence copy is true;
- active utility screens lead with status, fields, and controls respectively; and
- all original Job Search safety, degraded-state, and Fit/Want separation invariants remain intact.
