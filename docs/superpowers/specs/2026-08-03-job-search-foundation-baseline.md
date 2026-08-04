# Job Search foundation — baseline of what exists today (2026-08-03)

Phase 1 deliverable 1 of the foundation onboarding handoff
(`docs/superpowers/handoffs/2026-08-03-job-search-foundation-onboarding.md`). This document
records what the Job Search module actually does today, with code evidence, so the product
spec argues against reality rather than memory. Paths are relative to
`~/Jarv1s/external-modules/job-search/` unless noted.

Classification: **Implemented** (works end to end today), **Partial** (exists but narrower
than the approved product direction), **Absent** (no code; several are explicitly documented
as not-built in source comments).

## 1. Onboarding — Partial

- Chat-driven interview with five steps — `role`, `want`, `where`, `comp`, `sources`
  (`src/domain/criteria.ts`, `ONBOARDING_STEPS`). Progress is derived from the stored
  criteria record, never the transcript (`completedSteps`; ledger L9 render-from-records).
- `isReadyToCrawl` gates the crawl on `role + want + sources` only; `where` and `comp` are
  optional. One coarse gate — there are no deeper calibration stages.
- The seed prompt is at v4 (`src/domain/seed-prompt.ts`): record already-given answers
  before asking, ask one thing at a time, save each answer as it arrives, and ask for the
  résumé outright. Each version encodes a live-run failure (v2: wantNarrative vs mustHave
  confusion; v3: crawl-and-score with zero résumé; v4: empty `criteria.set` losing a
  paste-everything opening message).
- The onboarding screen (`src/web/screens/onboarding.tsx`) renders rail-led step rows from
  `completedSteps` and embeds the host's real chat `Surface`, submitting each turn with a
  `controlContext` that carries the seed prompt. Thread binding is by `surfaceKey`, bound
  before seeding to avoid the drawer leak (`useProfileThread`).
- **Gap vs product direction:** the interview asks the user to *paste* their résumé
  (`buildSeedPrompt`: "Ask them to paste their resume too"); upload lives on the Profile
  screen, not at the start of onboarding. There is no résumé-first flow, no structured
  extraction step, and no document-driven path (the only inputs are chat answers).

## 2. Résumé ingestion — Partial

- Upload of `.txt`/`.md`/`.pdf`/`.docx` via the Profile screen's resume editor
  (`src/web/screens/resume-editor.tsx`). Text files are editable client-side; PDF/DOCX go
  through server-side text extraction (host attachment pipeline, round-trip proven).
- Transport respects the metadata-only pg-boss invariant: browser uploads to the user's
  vault (`POST /api/chat/attachments`), enqueues `job-search.resume-set` with
  `{profileId, attachmentId}` only; the worker resolves text via
  `ctx.attachments.readText` (`src/worker/handlers/resume.ts`).
- Versioned storage: `store.setResume` keeps prior rows (`sql/…resumes` table, one live
  version pointer per profile). Identical-content re-save short-circuits the version bump.
- Saving triggers an inline two-pass rescore in the same invocation: a repair pass over
  Fit-empty rows (`candidates: "unfitted"`, scored in place — never deleted, a delete was
  built and reverted as a user-visible defect) then the ordinary `unscored` pass, under
  `ctx.deadlineAt` with call-reserve headroom in `runScore`. A scoring failure never fails
  the save; it is reported as a structured cause.
- **Gap:** the résumé is a single opaque text blob. No structured extraction of identity,
  work history, accomplishments, skills, education, certifications, languages, or
  constraints exists anywhere — nothing downstream can address a résumé section, date, or
  claim individually.

## 3. Profile state and readiness — Partial

- `job_search_profiles.state`: `in_conversation | active | paused` (`sql/0001`). Root
  swaps the whole screen set on it (`src/web/root.tsx`).
- Readiness is binary: `isReadyToCrawl` plus the five-step `completedSteps` rail. There is
  no per-stage status, no notion of "searchable early, calibration resumable later" —
  once `active`, onboarding surfaces disappear rather than remaining as resumable depth.
- Per-profile `context_summary` (1200-char cap, wholesale replace,
  `parseContextSummary`) and `briefing_detail` (`count | top | full`) exist and are
  chat-settable.

## 4. Criteria — Partial

- One flat `SearchCriteria` record (`src/domain/records.ts`, `src/domain/criteria.ts`):
  `titles`, `seniority`, `locations`, `remote`
  (`required | preferred | no-preference | onsite-ok`), `compFloorCents`,
  `excludeCompanies`, `mustHave`, `niceToHave`, `dealbreakers`, `wantNarrative`.
- `parseCriteriaPatch` is present-keys-win (an empty patch throws — an empty-object save
  once wiped a record while showing "Resolved."); `withCriteriaDefaults` keeps the read
  path total.
- **Gaps vs product direction:** no work-shape preferences, no travel tolerance, no
  explicit seniority calibration (the `seniority` list is free-form strings the model
  fills), no structured hard-gate semantics beyond `excludeCompanies` +
  `dealbreakers`-as-strings, and no separation between "gate" (vetoes) and "preference"
  (scores). `dealbreakers` and `mustHave` feed the score prompt as prose; only excluded
  companies and duplicate URLs hard-exclude (`src/domain/excludes.ts` — deliberately the
  only two reasons permitted).

## 5. Scoring — Implemented (within its design)

- Two independent axes, Fit (0–100, résumé-vs-posting evidence) and Want (0–100,
  wantNarrative), never blended (ruling L9; `sql/0004` deliberately has no combined
  column; `parseScoreResult` throws on an `overall` field).
- `fitDisposition` (`supported | insufficient_evidence | domain_mismatch | dealbreaker`)
  with `normalizeFitScore` caps (≤84 / ≤39). Explicit no-résumé branch: fit is discarded
  and the board renders an em dash (`buildScorePrompt`).
- Pipeline: crawl → dedupe (`src/domain/dedupe.ts`, cross-portal identity) →
  hard-exclude → embedding triage (768-dim pgvector, `RECALL_SLICE` reserved for
  outside-frame postings, missing similarity = deferred never 0, `src/domain/triage.ts`)
  → model score → surface (want-descending briefing, `src/domain/surface.ts`).
- **Absent around it:** no score *preview* (no way to see how a criteria change would
  affect discovery or scores before committing), and no per-posting compensation capture
  (comp appears only inside prose reasons when the posting mentioned it).

## 6. Query and source configuration — Partial

- Sources: LinkedIn guest endpoint and FreeHire adapters
  (`src/adapters/linkedin.ts`, `freehire.ts`), plus user-named custom boards extracted by
  `ctx.ai.generateStructured` over stripped page content (60KB cap,
  `src/adapters/custom.ts`) with a dynamic fetch-host grant (#1309).
- Queries are derived directly and implicitly from `criteria.titles` — one title per
  board request (agentmemory: `job-board-query-one-title-per-request`). There is no
  stored, reviewable notion of *search-query families*: nothing groups titles/terms by
  intent, nothing lets the user see or edit what will actually be sent to a board, and
  skills/domain terms never become queries at all.
- Portal health is real: structured `FailureCause`
  (`rate_limited | login_required | parse_failed | network | deadline`), terminal
  `login_required` disables the portal, deterministic `describeFailure` copy — never
  model prose (`src/domain/records.ts`).

## 7. UI affordances — Implemented (with documented omissions)

- Four tabs: Matches / Overview / Profile / Monitors (`src/web/root.tsx`). Board pages at
  25 rows via the web read path with optimistic dismiss reconciled by re-read
  (`board.tsx`); inspector is a full view-swap detail (`inspector.tsx`); Discuss hands a
  structured match record to chat (`discuss.tsx`); Monitors carries portal health and
  Run-now (`settings.tsx`). Fit renders as a band word, never a bar or percentage (K-D1).
- **Documented not-built, in source comments:**
  - `profile.tsx`: no résumé filename / revision hash / "confirmed claims" strip — the
    mockup versions were fabricated placeholders and Ben ruled them scrapped until real
    records back them; no critique panel ("no backing tool or queue… nothing to read, so
    nothing rendered"); no "Work mode" field (nothing in criteria stores it).
  - `inspector.tsx`: mockup fields omitted rather than faked — recommendation, summary,
    evidence, blockers, gaps, preference-match, unknowns, provenance, work mode, comp.
  - `settings.tsx`: `source.add/remove` are chat-only (no queue → no buttons).

## 8. Absent capabilities (the spec's subject matter)

Each of these has zero backing code today; several are explicitly marked as omitted in
the files cited above:

1. **Structured résumé extraction** — no schema, no storage, no UI (résumé = one text blob).
2. **Factual verification** — no date/claim/seniority checks, no ambiguity queue.
3. **Content critique** — no tool, queue, or storage for critique findings.
4. **Visual / rendered critique** — nothing inspects the uploaded document's layout or
   ATS-extractability; only its extracted text is kept.
5. **Evidence bank** — no confirmed-claims store; the fabricated mockup version was
   explicitly ruled out, which makes building the *real* one the prerequisite for that UI.
6. **Search-query families** — no derived, stored, user-editable query sets.
7. **Score / discovery preview** — no what-if surface for criteria changes.
8. **Deeper readiness semantics** — no resumable calibration stages beyond the five
   onboarding steps.
9. **Per-posting compensation capture** — no structured comp field on postings/matches.

## 9. Existing rulings the spec must not re-litigate

- Fit and Want never blend (L9); fit is a band word in UI (K-D1); reasons live in the
  inspector only (N39).
- UI renders from records, never model prose (L9/N4); chat actions report "queued", never
  "done"; browser writes go through manual-run queues (risk-write 403 floor).
- Hard-exclude reasons are exactly excluded-company and duplicate-URL; everything else is
  scored, not silently dropped.
- Metadata-only job payloads; résumé content moves via vault attachments only.
- The crawl path can never read the résumé (`resume.ts` imports no adapter code — keep it
  that way in anything new).
- No fabricated UI: a field appears when a record backs it, otherwise it is omitted.
