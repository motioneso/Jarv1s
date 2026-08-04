# Job Search foundation — product specification (2026-08-03)

Phase 1 deliverable 3 of `docs/superpowers/handoffs/2026-08-03-job-search-foundation-onboarding.md`.
Companion documents: the baseline
(`2026-08-03-job-search-foundation-baseline.md`) and the competitor capability map
(`2026-08-03-job-search-competitor-capability-map.md`). This spec defines the *product*;
the implementation plan is Phase 2 and deliberately not written yet.

Status: **draft, awaiting independent review** (arranged by the parent session).

## 0. One-paragraph summary

The Job Search module gains a résumé-first foundation: upload a résumé at the start,
extract it into structured, editable records (identity, work history, accomplishments,
skills, education, certifications, languages, constraints), verify the facts, critique
the content and the rendered document separately, and confirm claims into an evidence
bank that scoring and future drafting may cite but never exceed. Criteria grow explicit
hard gates and work-shape preferences; approved criteria derive visible, editable
search-query families; a preview shows what any criteria change would do to the board
before it is committed. Search stays available early — the existing role+want+sources
gate is unchanged — and every deeper stage is resumable, never blocking. Chat handles
ambiguity and judgment; stable facts live in structured state surfaced through editable
UI, not prompt files.

## 1. User journey

### 1.1 Stages

Seven stages. Stage 1 is the only newly *front-loaded* one; stages 2–6 are depth the
user can enter, leave, and resume at any time after the search is running.

| # | Stage | What happens | Blocking? |
|---|---|---|---|
| 0 | Create profile | Name the search; unchanged from today | — |
| 1 | Résumé upload | Upload (or paste) a résumé as the *first* onboarding act; extraction starts on save | No — skippable, search runs with Fit em-dashed as today |
| 2 | Extraction review | Structured records extracted from the résumé, reviewed and edited in UI | No |
| 3 | Verification | Date/claim/seniority checks; ambiguities resolved item by item | No |
| 4 | Critique | Content critique findings; rendered/ATS critique of the uploaded document | No |
| 5 | Criteria calibration | Explicit roles, seniority, comp, geography, remote/travel, work shape, hard exclusions, dealbreakers | Only the existing role+want+sources minimum gates the crawl |
| 6 | Query families & preview | Derived query families reviewed/edited; score-preview of criteria changes | No — defaults derived automatically |

### 1.2 Flow

- **Onboarding opens with the résumé**, not questions: the onboarding screen gains an
  upload affordance above the chat (same vault-attachment transport the resume editor
  uses today) and the seed prompt is revised to ask for an upload-or-paste first, then
  proceed to the interview *while extraction runs in the background*. A user with no
  résumé says so and continues exactly as today.
- **Chat and UI stay two doors to one record.** Every stage's state is a stored record
  rendered by UI; chat can drive any stage (via module tools) and the UI can drive any
  stage (via manual-run queues); neither is required. The competitor's observed failure
  mode — a 9m37s monolithic setup turn — is designed out by making every stage
  independently enterable and resumable.
- **Progress is visible as a stage rail** (extending the existing `completedSteps` rail
  idiom in `onboarding.tsx` / `overview.tsx`): each stage shows
  `not started | in progress | needs review | done`, derived from records only.
- **Early search:** the moment role+want+sources exist, the crawl can run — unchanged.
  Deeper stages improve scoring quality (evidence-grounded Fit, gates, better queries)
  incrementally as they complete. The board never blocks on calibration depth.

## 2. Structured data and ownership boundaries

All new tables are owned by the job-search module (module SQL in
`external-modules/job-search/sql/`, new migration files only), FORCE RLS owner-only,
composite owner-bound FKs `(owner_user_id, id)` like every existing child table. No
other module reads or writes them; the module exposes nothing about them beyond its
declared tools. Nothing here touches `AccessContext`.

### 2.1 New records

**`resume_extractions`** — one row per (profile, résumé version): extraction status
(`pending | partial | complete | failed`), structured payload per section, per-section
status, and the model/prompt version used. Sections:

- `identity` — name, contact channels, links (never rendered into prompts for scoring;
  see §8 privacy).
- `work_history[]` — employer, title, start/end (month precision, `present` allowed),
  location, engagement type; each entry carries its source span (character offsets into
  the résumé text version it came from).
- `accomplishments[]` — claim text, the work-history entry it belongs to (nullable),
  quantitative figures parsed out where present, source span.
- `skills[]` — name, kind (`technical | domain | tool | practice`), evidence pointer(s)
  into work history/accomplishments where inferable.
- `education[]`, `certifications[]` — award, institution/issuer, dates, in-progress flag.
- `languages[]` — language + declared proficiency (free-form band, e.g. CEFR or
  native/fluent/conversational; drives the language gate in §6).
- `constraints[]` — anything the résumé itself states about location, authorization,
  availability.

**`resume_claims`** (the evidence bank) — one row per verifiable claim:
`kind` (`date_range | title | employer | metric | credential | language | skill`),
claim text, source span, status
(`unverified | confirmed | corrected | rejected | ambiguous`), the user's correction
when status is `corrected`, and a structured note for `ambiguous`. **Only
`confirmed`/`corrected` claims are citable** by scoring or any future drafting. This is
the real version of the "confirmed claims" strip Ben ruled scrapped as a fabrication —
the UI element returns only once these rows exist to back it.

**`resume_reviews`** — critique output, one row per (résumé version, review kind):
`kind` (`content | rendered`), status, and findings as structured items
(category, severity, finding text, optional anchored span / page reference, optional
suggested rewrite). Findings are records; the UI renders them from the row, never from
a transcript (L9/N4 unchanged).

**`query_families`** — per profile: family name, intent
(`primary | domain | adjacent | broad`), ordered terms (each term = what one board
request sends — the one-title-per-request constraint is a fact of the adapters and is
honored by making it visible), enabled flag, `derivedFrom` (criteria snapshot hash) and
`editedByUser` flag so a criteria change can distinguish "regenerate freely" from
"user-owned, propose an update instead".

**Criteria additions** (same jsonb record, additive keys with defaults so
`withCriteriaDefaults` keeps the read path total): `workShape`
(`{ hoursPattern?, travelMax?, onCall?, contractTypes? }`), `seniorityCalibration`
(`{ floor?, ceiling?, note? }`), and `hardGates` — the explicit gate list (§6). Existing
keys are untouched; `parseCriteriaPatch`'s present-keys-win semantics apply.

**Postings addition:** structured `comp` capture
(`{ min?, max?, currency?, period?, source: "posting" }`) parsed at scoring time from
the posting body when present, null otherwise — never inferred. Fixes the observed
comp-missing-on-6-of-11 weakness at the record level.

### 2.2 Ownership boundaries

- Résumé text, extractions, claims, and reviews are **owner-only** (RLS class:
  owner-only). Nothing is shareable; no admin bypass (hard invariant).
- The crawl path keeps its existing property that it *cannot* read the résumé — and
  gains the same wall for extractions/claims/reviews: adapters and crawl stages import
  none of these stores. Scoring (which already reads the résumé) may read confirmed
  claims.
- Chat receives résumé-derived content only through declared `risk:"read"` tools, as
  `resume.get` already does; extraction/verification/critique *writes* go through
  worker queues.

## 3. Résumé parsing (Stage 2)

- **Trigger:** every résumé save (upload or paste, both existing transports) enqueues
  extraction. Extraction is a new queue (`resume-extract`) rather than an extension of
  `resume-set`'s invocation, which is already budget-constrained by the inline rescore.
- **Mechanism:** `ctx.ai.generateStructured` against the section schema, provider-
  agnostic (capability request, never a named model). Long résumés are processed in one
  call where possible; the schema requires source spans so every extracted item is
  anchored to the text it came from.
- **Partial completion is a normal outcome:** each section carries its own status; a
  failed or low-confidence section renders as "needs attention" in UI, with the rest
  usable. Re-running extraction affects only non-user-edited items (see below).
- **Review UI:** the Profile screen gains an extraction review surface — sectioned,
  editable, keyboard-operable rows. Every user edit marks the item `userEdited`;
  re-extraction (e.g. after uploading a new version) *proposes* changes to user-edited
  items (additive vs conflicting, resolved item by item — the competitor's
  keep/replace/manual pattern, rendered visually) and applies untouched items directly.
  This is the module's version of idempotent Path A: safe to re-run, never silently
  overwrites the user's corrections.
- **New résumé version:** extraction diffs against the previous version's records; the
  identical-content short-circuit in `resume.ts` naturally suppresses no-op runs.

## 4. Factual verification (Stage 3)

Two layers, deterministic first:

- **Deterministic checks** (pure domain code, no model): date-range validity
  (start ≤ end), overlaps between work-history entries, unexplained gaps above a
  threshold (surfaced as a question, not an error), education dates vs work dates,
  certification expiry, "present" on more than one full-time entry. Findings become
  `resume_claims` rows with status `ambiguous` and a structured note.
- **Model-flagged ambiguities:** a verification pass reviews extracted claims for
  internal inconsistency and unsupported superlatives ("led", "owned", metrics with no
  anchor), and flags — never rewrites — them. Seniority calibration: the pass proposes a
  seniority reading of the history (e.g. "senior IC, no people-management evidence") for
  the user to confirm into `seniorityCalibration`.
- **Resolution UI:** a review queue, one item at a time or as a list, with
  confirm / correct (inline edit) / reject / leave-ambiguous actions. Confirmations and
  corrections update claim status; nothing auto-confirms. Batch-confirm is allowed only
  for deterministic-clean claims (dates that pass every check), and is a single explicit
  action, never a default.
- **The evidence rule:** anything downstream that makes a factual assertion about the
  candidate (Fit reasons, future tailored-rewrite proposals per the approved v1 spec §9)
  may cite only `confirmed`/`corrected` claims, and the citation is stored with the
  output. Fit reasons that would rely on an unverified claim say so
  ("unverified: …") rather than asserting it.

## 5. Content critique, visual critique, revision (Stage 4)

Two critiques, separate records, separate semantics:

- **Content critique** (`resume_reviews.kind = "content"`): a worker pass over the
  extracted records + résumé text producing categorized findings — unsupported claims
  (cross-referenced against the evidence bank), passive/low-signal phrasing, missing
  quantification where an accomplishment has none, redundancy, section-balance issues.
  Every category reports even when empty ("no issues found"), so silence never reads as
  skipped. Findings with a clean anchored rewrite carry a suggested replacement.
- **Visual critique** (`resume_reviews.kind = "rendered"`): applies only when the
  uploaded file is a rendered document (PDF/DOCX). The pass inspects the *uploaded
  artifact*: page count and balance, orphaned headings, extraction fidelity of the text
  layer vs the rendered page (the host already extracts text server-side; the critique
  compares and flags `(cid:…)`/garbage runs, contact details that exist only as icons or
  link targets, reading-order scrambling in multi-column layouts), and date/contact
  survivability. For paste/`.txt`/`.md` résumés this review reports "not applicable —
  no rendered document on file" as a record, not an absence.
- **Revision workflow:** findings render on the Profile critique panel (the panel Ben
  removed for having nothing to read now has something to read). For text résumés, an
  accepted suggestion applies to the editable text via the existing editor and saves a
  new version through the existing save path (which re-extracts and rescores). For
  binary résumés, Jarv1s does not edit the document: accepted findings become a
  checklist the user takes to their own tool, and clears by uploading a revised file —
  the new version's critique run verifies which findings cleared. **Non-goal restated:
  Jarv1s does not generate or compile résumé documents** (no LaTeX/Typst pipeline).
- Critique runs are user-triggered per résumé version (a "Run critique" queue action),
  not automatic — a critique is a session the user chooses, and model spend stays
  visible. Chat can trigger the same queue.

## 6. Criteria calibration, hard gates, query derivation, score preview (Stages 5–6)

### 6.1 Calibration

Criteria keep their single-record shape and gain the §2.1 additive fields. The
calibration UI is the existing Profile criteria surface extended with work-shape and
seniority-calibration fields; chat continues to write through `criteria.set`. Extraction
feeds calibration with *proposals* (e.g. languages found on the résumé pre-fill the
language gate; seniority reading pre-fills calibration) that the user confirms — records
propose, the user disposes.

### 6.2 Hard gates

A `hardGates` list inside criteria, each gate
`{ kind, value, mode: "veto" | "flag" }` with kinds: `location` (outside the declared
geography/relocation), `language` (posting requires a language not declared at any
level), `authorization`, `compFloor` (below `compFloorCents` *when the posting states
comp*), `employer` (subsumes `excludeCompanies`), `travel` (above `travelMax`),
`contractType`. Semantics, adopted deliberately from the competitor's best distinction:

- **veto** removes the posting from surfacing *with a stored reason* — extending the
  existing tracked-drop discipline; a vetoed posting is inspectable ("excluded:
  requires fluent German — not declared"), never silently gone.
- **flag** keeps the posting scored and surfaced with a visible marker and the reason in
  the inspector (e.g. declared language below the required level; comp unstated).
- Gate evaluation happens at scoring time (gates need the posting body), *not* in
  `excludes.ts` — the hard-exclude stage keeps its exactly-two reasons; gates are a
  scoring-stage disposition, stored on the match. The two-axis rule is untouched: gates
  neither blend into Fit nor cap Want; `fitDisposition: "dealbreaker"` continues to cap
  Fit exactly as today, and gate vetoes are a separate, explainable state.

### 6.3 Query derivation

- On criteria approval (and on demand), the module derives query families
  (`primary | domain | adjacent | broad`) from titles, confirmed skills, and domain
  terms — including *proposed adjacent titles* the user hasn't considered, presented for
  approval rather than silently searched.
- Families are stored, listed in Settings/Monitors with per-family enable toggles, and
  fully editable; each term maps 1:1 to a board request so the user can see exactly what
  a crawl will send (and the run cost: N families × M terms × K boards, shown before
  enabling — the crawl budget and the shared 60/min browser-poll rate limit make this
  arithmetic user-relevant).
- The crawl consumes enabled families instead of raw `criteria.titles`; with no families
  yet (new stage not visited), it derives a default `primary` family from titles —
  existing behavior, now visible as a record.
- **Configured means searched:** a family/term that cannot run on any enabled portal
  renders with an explicit "no portal can run this" state — the competitor's
  silently-never-searched sources, designed out.

### 6.4 Score preview

Preview answers "what would this criteria change do?" **deterministically and for
free** — no model calls:

- Editing criteria (or gates, or families) in the UI produces a staged-change state with
  a preview panel: postings currently on the board that the new gates would veto/flag
  (with names and counts), matches whose stored `fitDisposition`/gate state would
  change, query families that would be added/retired, and the count of matches that
  would need model re-scoring (with the "this queues N model calls" cost stated).
- Committing applies the change and queues the (bounded) rescore; discarding reverts.
  Preview never mutates records and never calls the model — it is arithmetic over
  stored postings/matches, so it is honest about what it can't know ("N postings would
  be re-scored; new scores are not predictable in advance").

## 7. Readiness and status semantics

- **`searchable`** (existing): role + want + sources recorded — unchanged, and the only
  state that gates the crawl.
- **Per-stage status** for stages 1–6: `not_started | in_progress | needs_review | done`,
  each derived from its records (résumé rows exist → stage 1 done; extraction row
  complete with zero unresolved conflicts → stage 2 done; zero `ambiguous` claims →
  stage 3 done; latest version has both review rows resolved → stage 4 done; and so on).
  No stage state is a stored enum a process can forget to update — every one is derived,
  the same way `completedSteps` is derived today.
- **Overview** shows the stage rail with a single next-best-action ("3 ambiguous claims
  to review"), replacing nothing that exists — the checkpoint row idiom extends.
- **Scoring honesty per readiness:** Fit already renders an em dash with no résumé; with
  a résumé but an unreviewed extraction, scoring proceeds (as today) and Fit reasons
  simply cannot cite unconfirmed claims (§4). Deeper stages sharpen output; their
  absence never fabricates it.

## 8. Accessibility, privacy, failure, retry, partial completion

**Accessibility.** All new surfaces follow the module's existing patterns: rail rows
with per-row `aria-label`s carrying status in words (as `onboarding.tsx` does), ordered
lists where sequence matters, review-queue actions reachable by keyboard, status
conveyed by word + colour never colour alone (fit-band-word precedent), and no
information that exists only in a transient toast. The extraction review and claim queue
are list-and-detail patterns, not drag interactions.

**Privacy.**
- All new tables owner-only under FORCE RLS; composite owner-bound FKs; no admin bypass.
- Résumé-derived content never enters pg-boss payloads (IDs only — the existing
  attachment pattern extends to every new queue), never logs, never briefings
  (briefing stays match-shaped), and never leaves the module's declared tools.
- Identity records (contact details) are excluded from every model prompt — extraction
  writes them; nothing downstream reads them into a prompt. Scoring prompts continue to
  carry résumé content as today, plus confirmed claims; critique prompts carry the
  résumé the user asked to critique. All model traffic goes through the provider-
  agnostic router; persisted LLM outputs (extractions, findings) get the standard
  four-guard exfiltration defence (strict schemas, no URLs followed, spans validated
  against the source text, rendered as data never markup).
- User export/delete: extractions, claims, and reviews delete with their profile
  (cascade via the composite FKs) and appear in the user's export like other owned rows.

**Failure, retry, partial completion.**
- Every stage's worker output carries the module's structured-cause pattern: a failed
  extraction/verification/critique run stores a `FailureCause`-style record and the UI
  renders deterministic copy (`describeFailure` idiom) — never model prose, never
  silence. Stage status shows `needs_review` with the cause, plus a retry action
  (manual-run queue; results are "queued", never "done").
- Extraction and critique are section-granular: a run that dies at the deadline keeps
  completed sections (the `runScore` partial-is-normal philosophy); the next run
  processes only what's missing. Queue retryLimit stays 0 where a retry would re-spend
  model calls without new information (the `resume-set` precedent), with the identical-
  input short-circuit making manual retry safe.
- Preview (§6.4) is pure read — it has no failure mode beyond a failed fetch, which
  renders as the board's existing error states.

## 9. Acceptance criteria

Live-path gate applies: each numbered item must be demonstrated through the real UI on a
live dev instance, not just CI-green.

1. A new profile's onboarding offers résumé upload before any interview question; a
   `.pdf` upload and a pasted text résumé both produce an extraction with every §2.1
   section populated or explicitly marked empty, each item carrying a source span.
2. Skipping the résumé still reaches a running search exactly as today (role + want +
   sources), with Fit em-dashed.
3. Editing an extracted item marks it user-owned; uploading a revised résumé proposes
   (not applies) changes to that item, and applies clean changes elsewhere.
4. Deterministic verification flags an overlapping date range planted in a test résumé;
   resolving it via "correct" updates the claim and the extraction view together.
5. A Fit reason citing a fact traces to a confirmed claim; with that claim rejected, a
   rescore produces a reason that no longer asserts it.
6. Content and rendered critiques produce separate stored reviews; a `.txt` résumé's
   rendered critique reads "not applicable" as a record; a two-column PDF with icon-only
   contact details gets flagged for ATS extraction risk.
7. A language hard gate (undeclared language, veto) removes a matching posting from the
   board with an inspectable stored reason; the same language declared at a lower level
   (flag) leaves it scored with a visible marker.
8. Query families derived from criteria are visible and editable; disabling a family
   provably changes what the next crawl sends (portal request log or equivalent);
   a term no enabled portal can run renders the "no portal can run this" state.
9. A staged criteria change shows the deterministic preview (veto/flag deltas by name,
   rescore count) before commit; discard leaves records untouched.
10. Stage statuses on Overview are derived from records: deleting the underlying rows in
    a dev DB (as the owner) regresses the stage display without any other write.
11. Every new failure path (extraction failure, critique failure, deadline partial)
    renders deterministic copy with a working retry, and partial results survive.
12. RLS: a second user can read none of the new tables' rows (owner-only proof, same
    harness as existing suites); no new queue payload contains résumé-derived content.

## 10. Non-goals

- **No application drafting**: no CV/cover-letter generation, no document compilation
  (LaTeX/Typst), no application-form field drafting, no interview prep, no outcome
  tracking, no Gmail/Notion analogues. (Tailored-rewrite *proposals* remain a future
  item per the approved v1 spec §9 — not this foundation.)
- No autonomous application submission; no headless browser; no new portals; no OAuth
  or connector work (scope guardrails unchanged).
- No salary benchmarking service; per-posting comp capture only.
- No behavioral/personality profiling (the competitor's behavioral file has no Jarv1s
  counterpart in this foundation; wantNarrative remains the "what you want" home).
- No blended score, no change to the two-axis ruling, no third hard-exclude reason in
  `excludes.ts`, no re-litigation of §9-baseline rulings.
- No cross-profile or shared access to any résumé-derived record.

## 11. Migration and compatibility

- **Existing profiles keep working untouched.** All new tables are additive; criteria
  additions are optional keys with defaults (`withCriteriaDefaults` keeps every
  existing record readable); no applied migration is edited (new files in the module's
  `sql/`, next free number per the migration-numbering rule).
- Existing résumé versions get no retroactive extraction. The Profile screen shows
  stage 2 as `not_started` with a one-click "Extract my résumé" action that runs the
  standard pipeline on the latest stored version — opt-in, visible, no surprise model
  spend on upgrade.
- Existing matches/postings keep their rows; gate evaluation applies to newly scored
  work only (a criteria commit that adds gates offers the standard preview + bounded
  rescore for existing rows).
- `excludeCompanies` remains valid; the criteria parser treats it as the `employer`
  gate's storage until a later cleanup — no data rewrite in this milestone.
- The onboarding seed prompt bumps to v5 (résumé-upload-first); `seedIdempotencyKey`'s
  version suffix handles in-flight conversations — existing threads keep v4 framing
  until the key changes, exactly the mechanism built for this.
- Rollback: disabling the new stages (feature flag at module manifest/queue level)
  leaves the module functioning at today's baseline; new tables are inert when unread.

## 12. Open questions for review

1. Should extraction auto-run on the *first* résumé save but stay manual for
   re-uploads, to balance "it just works" against visible model spend? (Spec currently
   auto-runs on every save; critique is manual.)
2. Is `comp` capture at scoring time enough, or should the crawl detail-fetch parse it
   earlier so gates can veto before a model call is spent? (Currently: scoring time, to
   keep adapters dumb.)
3. Do query families warrant their own table (as specced) or a criteria sub-key? Table
   chosen for per-family enable toggles and edit provenance, at the cost of one more
   owned table.
4. Stage 4 critique on binary résumés produces a user-actioned checklist — is that
   enough product, or does it push users toward paste/text résumés as the de facto
   editable path? (Deliberate for now; document generation is a non-goal.)
