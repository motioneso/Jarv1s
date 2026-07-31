# `ai-job-search` feature comparison

**Date:** 2026-07-31  
**Purpose:** Compare `MadsLorentzen/ai-job-search` with Jarv1s Job Search and identify ideas worth
adapting.  
**Research only:** No implementation or live-state changes were made.

## Grounding and method

- Jarv1s was reviewed at `52ebd59f043e906adeb9cb887e4c6a5de5b75fe9` on
  `build/1375-job-search-ux-corrections`. `pnpm audit:preflight` passed against
  `origin/main@c591a8f9`.
- The comparison repository was reviewed at
  [`1cdaf9497f0026fb4de877b80a439af184bce145`](https://github.com/MadsLorentzen/ai-job-search/tree/1cdaf9497f0026fb4de877b80a439af184bce145).
- Sources were limited to both repositories' own README, command/skill definitions, tests, and
  implementation. The comparison repository was not executed against personal data or live job
  boards.
- A material caveat: `ai-job-search` is a Claude Code workflow, not a persistent application. For
  most of its product workflow, the Markdown command specification **is the implementation**, and
  several tests assert that required instructions remain present rather than exercising the full
  workflow end to end.[U1] Its portal CLIs do have typed source and fixture/mock tests, while its CI
  explicitly excludes live portal smoke tests.[U2]

## Bottom line

Jarv1s already has the stronger **discovery product**: scheduled monitoring, persistent private
records, source health, full posting descriptions, cross-source deduplication, a searchable board,
separate Fit and Want judgements, save/pass triage, profile-scoped chat, and briefing integration.
Those features should not be rebuilt from `ai-job-search`.

The comparison repository is stronger **after a promising job has been found**. Its best ideas are
an application lifecycle, evidence-grounded application documents, outcome capture, follow-up and
interview assistance, and learning from the resulting funnel. That is the seam worth adapting.

Do not port its overall weighted score, file/fork architecture, Notion dashboard, or LaTeX-specific
implementation wholesale. Those solve constraints Jarv1s does not have and, in the case of a
combined score, directly conflict with Job Search's load-bearing Fit/Want rule.[J1]

## Feature inventory and disposition

| Area                        | `ai-job-search` at reviewed commit                                                                                                                                                                                                               | Jarv1s today                                                                                                                                                                                                                      | Disposition                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product shape               | A local Claude Code framework whose workflow is invoked with commands such as `/setup`, `/scrape`, `/rank`, and `/apply`; state is stored in personalized files.[U3]                                                                             | A self-hosted external module with a web UI, worker, scheduled jobs, module-owned Postgres tables, and owner-only RLS.[J2]                                                                                                        | **Materially different.** Borrow user workflows, not runtime architecture.                                                                        |
| Profile onboarding          | Imports a documents folder, a pasted CV, or an interview; keeps separate candidate, behavioral, writing-style, evaluation, CV, cover-letter, and interview files.[U3]                                                                            | Conversational onboarding stores structured titles, seniority, locations, remote preference, compensation floor, must-haves, nice-to-haves, dealbreakers, Want narrative, context, and a versioned résumé per search profile.[J3] | **Already present**, with a different structure. Public-profile/document enrichment remains a gap.                                                |
| Multiple searches           | One personalized framework/search configuration, with query priorities edited in files or `/setup --section search`.[U3]                                                                                                                         | Multiple independent search profiles, each with its own criteria, résumé, sources, thread, and briefing setting.[J1]                                                                                                              | **Already present; Jarv1s is stronger.**                                                                                                          |
| Portal coverage             | Six shipped portal skills: LinkedIn, freehire, and four Danish boards; each exposes search/detail commands. `/add-portal` scaffolds another specialized CLI after investigating and live-testing it.[U4]                                         | Built-in LinkedIn and freehire adapters plus user-named custom sources. Custom sources fetch one registered page and use structured AI extraction; they do not discover pagination or a detail-page contract.[J4]                 | **Materially different.** More specialized adapters may improve recall/reliability, but copying Danish boards is not inherently valuable.         |
| Continuous discovery        | `/scrape` is user-invoked, searches enabled portal CLIs, deduplicates against seen jobs and applications, and writes local state.[U5]                                                                                                            | A per-user crawl sweep runs every six hours, with manual Run now, source enable/pause controls, persistent source state, and briefing/nav surfacing.[J5]                                                                          | **Already present; Jarv1s is stronger.**                                                                                                          |
| Failure and source health   | A bounded portal health check may probe, retry once, and report healthy/degraded/inconclusive; it must not guess.[U5]                                                                                                                            | Structured typed causes record kind, retrieved count, expected count, last success, next action, retry time, and whether the source was disabled; Monitors renders the stored cause.[J6]                                          | **Already present; Jarv1s is stronger.**                                                                                                          |
| Posting retrieval           | Search results are prefiltered, then detail is fetched only for promising jobs. Portal detail commands can return full descriptions, deadlines, employment type, and apply links.[U4][U5]                                                        | `Posting` persists full body text and `postedAt`; freehire stores its returned description and LinkedIn lazily fills an empty body when detail opens.[J7]                                                                         | **Description is present.** Deadline, employment type, stated compensation, and eligibility facts are worthwhile missing structured fields.       |
| Deduplication               | Uses `seen_jobs.json`, the application tracker, portal IDs/URLs, and same-run duplicate handling.[U5]                                                                                                                                            | Persistent cross-portal identity normalizes company/title conservatively and chooses the higher-priority or fuller record.[J8]                                                                                                    | **Already present; Jarv1s is stronger.**                                                                                                          |
| Fit evaluation              | `/rank` records technical, experience, behavioral, and career dimensions, then emits one weighted overall score and verdict. Location dealbreakers veto and near deadlines receive urgency.[U9] `/apply` re-evaluates with company research.[U6] | Stores independent Fit and Want axes with separate reasons. A structured Fit disposition caps unsupported, domain-mismatch, and dealbreaker scores; the combined/overall score is forbidden.[J1][J9]                              | **Materially different.** Keep Fit/Want. Borrow explicit practical gates and deadline urgency, not the combined score.                            |
| Board triage                | Produces a terminal shortlist with strengths, gaps, deadlines, URLs, below-threshold roles, and exclusions.[U9] Optional Notion and offline HTML views add pipeline tables/charts.[U10]                                                          | Native paged web board with unreviewed/saved/passed buckets, search, location/date/Fit/source filters, row Save/Pass, description inspector, reasons, original link, position restoration, and Discuss.[J10]                      | **Already present; Jarv1s is stronger.** A structured application-readiness/gaps section could be useful after saving.                            |
| Proactive surfacing         | No resident scheduler; output appears when commands are run or optional sync/report commands regenerate destinations.[U3]                                                                                                                        | Notification/nav badge plus morning/evening briefing contribution with count/top/full detail.[J5]                                                                                                                                 | **Already present; Jarv1s is stronger.**                                                                                                          |
| Résumé handling             | Stores a master candidate profile and generates a tailored CV for each application.[U6]                                                                                                                                                          | Stores and edits one versioned résumé per search profile; the approved v1 design does not transmit it to a board.[J1][J3]                                                                                                         | **Partly present.** Tailoring and application artifacts are worthwhile missing features.                                                          |
| Application documents       | `/apply` drafts a CV and cover letter, has a second agent research/critique them, revises, compiles PDFs, visually inspects page layout, checks the PDF text layer for ATS parseability, and can produce application-form fields.[U6]            | No application document model or generation flow exists in the module-owned tables/tools. The current boundary stops at résumé storage and match discussion.[J2][J3]                                                              | **Worthwhile missing**, but adapt as provider- and document-tool-agnostic output rather than importing a LaTeX pipeline first.                    |
| Application lifecycle       | A CSV tracker and per-application archive store applied/interview/offer/final statuses, the posting, submitted documents, dates, feedback, and notes.[U7]                                                                                        | Match state has only four values: unscored, new, seen, and dismissed; there is no application record/table or applied/interview/offer/outcome state.[J2][J11]                                                                     | **Highest-value missing product layer.**                                                                                                          |
| Follow-ups and thank-yous   | `/outcome followup` finds quiet applications, drafts 60–120 word messages from already-submitted evidence, caps follow-ups at two, and never sends. Recording an interview can offer a thank-you note.[U7]                                       | No application cadence or submitted-material archive exists.                                                                                                                                                                      | **Worthwhile missing after application tracking.** Draft-only fits Jarv1s's safety posture.                                                       |
| Interview preparation       | Builds stage-specific prep from the exact archived posting and submitted documents, verified company/interviewer research, likely questions, STAR examples, honest bridge answers, and optional mock interviews.[U8]                             | Match-scoped Discuss offers general conversation, but there is no stage-aware application context or prep artifact.                                                                                                               | **Worthwhile missing after application tracking.**                                                                                                |
| Outcome learning            | `/setup` can mine application outcomes to calibrate fit criteria and identify STAR examples; `/upskill` aggregates recurring gaps into a heatmap and learning plan.[U7][U11]                                                                     | Fit/Want reasons persist per match, but no outcome/funnel record can validate predictions or aggregate recurring gaps.                                                                                                            | **Worthwhile missing**, with explicit user review before criteria change.                                                                         |
| Email status detection      | `/gmail-sync` reads relevant messages, proposes matched status changes with source-email evidence, requires batch approval, and never writes to Gmail.[U12]                                                                                      | Jarv1s has email capabilities outside this module, but Job Search declares no cross-module status-ingestion seam.                                                                                                                 | **Potential later addition.** Valuable, but it requires a public API/event boundary and careful approval/provenance design.                       |
| Reporting and external sync | Generates an offline funnel dashboard and optionally syncs a one-way, filename-only view to Notion.[U10]                                                                                                                                         | The native module already owns the persistent UI, board, overview, and briefings.                                                                                                                                                 | **Not worth copying literally.** Add native application/funnel views once application records exist.                                              |
| Profile enrichment          | `/expand` scans candidate documents and user-linked public GitHub/portfolio/research sources, then asks before writing discovered competencies.[U13]                                                                                             | Resume and profile context are entered/uploaded per search; current Job Search has no explicit multi-source competency map.                                                                                                       | **Worthwhile later**, but use existing Jarv1s notes/files/web capabilities and explicit provenance rather than another profile store.             |
| Salary benchmarking         | Optional bring-your-own salary data can be used during evaluation.[U14]                                                                                                                                                                          | Compensation floor is a search criterion, while salary data and offer negotiation are explicit v1 non-goals.[J1][J3]                                                                                                              | **Later / separate spec.** Do not block the core application loop on it.                                                                          |
| Extensibility               | Generates executable portal skills and supports arbitrary document compilers/templates in a user's fork.[U4][U15]                                                                                                                                | Runtime-approved custom fetch hosts, module installation, assistant tools, and a generic custom-page extractor are the extension mechanisms.[J4][J5]                                                                              | **Materially different.** Do not add a code generator or executable-skill installer to solve a capability already covered more safely at runtime. |
| Privacy and trust           | Personal files are gitignored; posting text is declared untrusted; documents stay local; Notion receives filenames only. The repository warns that instruction-level defenses are not a sandbox.[U16]                                            | Module-owned owner-only RLS, metadata-only jobs, bounded host fetch, provider-agnostic AI, and no job-board credentials are hard boundaries.[J1]                                                                                  | **Already present; Jarv1s is stronger structurally.** Preserve these boundaries in every addition.                                                |

## Ranked gaps worth specifying

These are rankings for product planning, not authorization to build. Jarv1s requires an approved
spec before each new feature.

| Rank | Candidate                                   | Likely user value                                                                                                                                             | Implementation fit                                                                                                                                               | Smallest coherent Jarv1s version                                                                                                                                                                                                                                         |
| ---: | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|    1 | **Application lifecycle and outcomes**      | **Very high.** A saved match otherwise becomes a dead end, and the user cannot see what they applied to or learn what advanced.                               | **High.** It belongs entirely in Job Search: one application record, a state history, and native board/detail views.                                             | Let a saved match become an application; store applied date, channel, current stage, posting snapshot, notes, outcome, and submitted-artifact references. No sending, CRM, email sync, or analytics in the first slice.                                                  |
|    2 | **Practical facts and hard gates**          | **Very high.** Deadlines, work authorization, employment type, stated compensation, and location constraints can make an otherwise attractive match unusable. | **High–medium.** The crawl/detail/scoring/inspector pipeline already exists, but adapters, records, migrations, and UI all need deliberate changes.              | Persist source-backed facts with `unknown` as a first-class value; show deadline urgency and explicit veto reasons without introducing a combined score.                                                                                                                 |
|    3 | **Evidence-grounded application pack**      | **Very high.** It converts a good match into useful work and is the comparison project's signature feature.                                                   | **Medium.** Jarv1s already has the résumé, posting, AI, chat, and human approval; it lacks application artifacts, revision state, export, and PDF verification.  | Generate editable tailored résumé suggestions, cover-letter text, and short-form answers from stored evidence, with claim provenance and explicit approval. Add one reviewer pass. Defer LaTeX/custom compilers and strict PDF layout until text artifacts prove useful. |
|    4 | **Interview and follow-up assistance**      | **High.** It supports the moments where context is easiest to lose and where a timely draft has immediate value.                                              | **High after rank 1.** Profile-scoped chat and briefings already exist; the missing dependency is application/stage history.                                     | Stage-aware prep and draft-only follow-up/thank-you messages grounded in the saved posting and submitted artifacts. Never send automatically; cap reminders.                                                                                                             |
|    5 | **Outcome feedback and recurring-gap view** | **High over time.** It answers whether the scoring model predicts real interviews and which gaps recur across desirable jobs.                                 | **Medium–high after rank 1.** Stored Fit/Want/reasons already provide inputs; outcomes provide labels.                                                           | Native funnel counts, Fit/Want vs. outcome review, and an explainable recurring-gap list. Suggest criteria changes, but require the user to approve them. Do not silently retrain or optimize for employer response alone.                                               |
|    6 | **Profile/source enrichment**               | **Medium–high.** Richer evidence improves Fit and document quality, especially when a résumé undersells projects.                                             | **Medium.** Reuse existing Jarv1s attachments, notes, and web research; provenance and user confirmation are essential.                                          | Let the user select existing documents/notes or named public URLs, extract candidate facts with source links, and approve additions to profile context.                                                                                                                  |
|    7 | **Email-derived status proposals**          | **Medium–high.** It removes tracker upkeep and catches interview/rejection messages.                                                                          | **Medium–low.** It crosses module ownership and private-email boundaries, so it needs a declared public contract, least-data payloads, provenance, and approval. | Read-only classification over user-selected application mail; show proposed changes with exact source messages; write only after approval.                                                                                                                               |
|    8 | **Specialized portal adapter packs**        | **Medium and market-dependent.** A specialized adapter can outperform the one-page generic extractor on pagination and detail retrieval.                      | **Medium.** The shared `Portal` interface exists, but every adapter carries maintenance and access-policy cost.                                                  | Add a portal only from observed user need and live failure/coverage evidence. Treat `ai-job-search`'s adapter layout as a reference, not as a reason to ship Danish portals.                                                                                             |
|    9 | **Salary benchmarking**                     | **Medium.** Helpful for deciding and negotiating, but not necessary to discover or progress an application.                                                   | **Low–medium.** Data provenance, geography, freshness, and compensation normalization are a product of their own.                                                | Separate optional spec using user-provided or clearly licensed sources; keep compensation floor and stated posting pay useful without it.                                                                                                                                |

## Things not to copy

1. **The weighted overall fit score.** Jarv1s intentionally protects the distinction between
   “they would want me” and “I would still want this.” A weighted total would recreate the exact
   information loss the module was designed to avoid.[J1]
2. **The Markdown-command/file-state architecture.** It is appropriate for a forked Claude Code
   workspace, but Jarv1s already has typed records, RLS, queues, a UI, and live module contracts.
3. **A LaTeX-first document subsystem.** The useful feature is evidence-grounded tailoring and
   verification. LaTeX, exact one/two-page limits, and local compiler management are one possible
   export implementation, not the product requirement.
4. **The Notion sync and offline HTML dashboard as parallel systems of record.** Native application
   views will be simpler and less drift-prone once Jarv1s stores application records.
5. **A portal code generator or automatic executable-skill installer.** Jarv1s already has runtime
   fetch-host grants and custom sources. Executable third-party code raises a larger trust and
   update problem than adding a source URL.
6. **Referral-person scraping or recruiter CRM.** The comparison repository limits itself to
   search links, and Jarv1s explicitly excludes recruiter CRM and private-person dossiers.[J1][U5]
7. **Autonomous application submission.** Neither project needs it to deliver the valuable part of
   the workflow. Keep user approval and human submission as the boundary.

## Recommended next product decision

Write one spec for **Job Search applications**, scoped to ranks 1 and 2 only: application state plus
practical posting facts. That gives the module a durable handoff after Save and creates the record
foundation every later feature needs. Document drafting, interview prep, follow-ups, email status
signals, and funnel learning should consume that record in later slices rather than each inventing
its own tracker.

## Primary sources

### Comparison repository (`ai-job-search`)

- **[U1] Command specs are the implementation:**
  [`tests/test_rank_command.py` lines 1–7](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/tests/test_rank_command.py#L1-L7),
  [`tests/test_outcome_followup.py` lines 1–9](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/tests/test_outcome_followup.py#L1-L9).
- **[U2] CI coverage and live-test limit:**
  [`.github/workflows/ci.yml` lines 1–14 and 153–180](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.github/workflows/ci.yml#L1-L14).
- **[U3] Product shape, onboarding, commands, and file layout:**
  [`README.md` lines 40–60, 102–151, and 153–219](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/README.md#L40-L60).
- **[U4] Portal and extension contracts:**
  [`README.md` lines 288–321](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/README.md#L288-L321),
  [`.claude/commands/add-portal.md` lines 32–129](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/add-portal.md#L32-L129).
- **[U5] Scrape, dedupe, health, and referral-link behavior:**
  [`.claude/skills/job-scraper/SKILL.md` lines 37–180 and 234–244](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/skills/job-scraper/SKILL.md#L37-L180).
- **[U6] Application drafting/reviewer/PDF/ATS workflow:**
  [`README.md` lines 221–242](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/README.md#L221-L242),
  [`.claude/commands/apply.md` lines 31–320](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/apply.md#L31-L320).
- **[U7] Application state, outcomes, follow-ups, and archive:**
  [`.claude/commands/outcome.md` lines 1–116](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/outcome.md#L1-L116).
- **[U8] Stage-aware interview preparation:**
  [`.claude/commands/interview.md` lines 1–109](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/interview.md#L1-L109).
- **[U9] Ranking dimensions, gates, deadlines, strengths, and gaps:**
  [`.claude/commands/rank.md` lines 1–130](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/rank.md#L1-L130),
  [`.claude/skills/job-application-assistant/04-job-evaluation.md` lines 33–179](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/skills/job-application-assistant/04-job-evaluation.md#L33-L179).
- **[U10] Notion and offline reporting:**
  [`.claude/commands/notion-sync.md` lines 37–136](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/notion-sync.md#L37-L136),
  [`.claude/commands/html-report.md` lines 1–134](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/html-report.md#L1-L134).
- **[U11] Aggregate and targeted gap analysis:**
  [`.claude/skills/upskill/SKILL.md` lines 14–235](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/skills/upskill/SKILL.md#L14-L235).
- **[U12] Gmail-derived status proposals:**
  [`.claude/commands/gmail-sync.md` lines 27–183](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/gmail-sync.md#L27-L183).
- **[U13] Document and public-source profile enrichment:**
  [`.claude/commands/expand.md` lines 9–209](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/expand.md#L9-L209).
- **[U14] Optional salary data:**
  [`README.md` lines 323–325](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/README.md#L323-L325),
  [`.claude/skills/job-application-assistant/04-job-evaluation.md` lines 108–129](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/skills/job-application-assistant/04-job-evaluation.md#L108-L129).
- **[U15] Custom document templates:**
  [`.claude/commands/add-template.md` lines 55–179](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/.claude/commands/add-template.md#L55-L179).
- **[U16] Security model and privacy limits:**
  [`SECURITY.md` lines 7–22](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/SECURITY.md#L7-L22),
  [`LICENSE`](https://github.com/MadsLorentzen/ai-job-search/blob/1cdaf9497f0026fb4de877b80a439af184bce145/LICENSE) (MIT; attribution is required if substantial code is copied).

### Jarv1s

- **[J1] Approved Job Search principles, boundaries, and pipeline:**
  [`2026-07-26-job-search-module-design.md` lines 29–86, 124–169, and 190–208](../specs/2026-07-26-job-search-module-design.md#L29-L86).
- **[J2] Current owned records and module surfaces:**
  [`jarvis.module.json` lines 1–27 and 419–535](../../../external-modules/job-search/jarvis.module.json#L1-L27).
- **[J3] Current criteria and résumé tools:**
  [`jarvis.module.json` lines 55–215](../../../external-modules/job-search/jarvis.module.json#L55-L215),
  [`records.ts` lines 50–87](../../../external-modules/job-search/src/domain/records.ts#L50-L87).
- **[J4] Current source extension and custom extraction:**
  [`jarvis.module.json` lines 218–309](../../../external-modules/job-search/jarvis.module.json#L218-L309),
  [`custom.ts` lines 1–15 and 255–346](../../../external-modules/job-search/src/adapters/custom.ts#L1-L15).
- **[J5] Schedule, briefings, and navigation:**
  [`jarvis.module.json` lines 511–535](../../../external-modules/job-search/jarvis.module.json#L511-L535),
  [`surface.ts` lines 69–112](../../../external-modules/job-search/src/domain/surface.ts#L69-L112).
- **[J6] Structured failure causes and Monitor rendering:**
  [`records.ts` lines 22–48 and 138–237](../../../external-modules/job-search/src/domain/records.ts#L22-L48),
  [`settings.tsx` lines 180–258](../../../external-modules/job-search/src/web/screens/settings.tsx#L180-L258).
- **[J7] Posting body persistence and display:**
  [`records.ts` lines 64–74 and 106–113](../../../external-modules/job-search/src/domain/records.ts#L64-L74),
  [`freehire.ts` lines 208–236](../../../external-modules/job-search/src/adapters/freehire.ts#L208-L236),
  [`inspector.tsx` lines 245–295](../../../external-modules/job-search/src/web/screens/inspector.tsx#L245-L295).
- **[J8] Conservative cross-portal deduplication:**
  [`dedupe.ts` lines 1–23 and 93–140](../../../external-modules/job-search/src/domain/dedupe.ts#L1-L23).
- **[J9] Separate, coherent Fit/Want scoring:**
  [`score.ts` lines 79–142 and 152–210](../../../external-modules/job-search/src/domain/score.ts#L79-L142).
- **[J10] Native filters and row decisions:**
  [`board-filters.tsx` lines 16–110](../../../external-modules/job-search/src/web/screens/board-filters.tsx#L16-L110),
  [`match-row.tsx` lines 39–157](../../../external-modules/job-search/src/web/screens/match-row.tsx#L39-L157).
- **[J11] Current match state vocabulary:**
  [`records.ts` lines 76–87](../../../external-modules/job-search/src/domain/records.ts#L76-L87).
