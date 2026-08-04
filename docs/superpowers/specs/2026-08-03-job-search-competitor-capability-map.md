# ai-job-search competitor capability map (2026-08-03)

Phase 1 deliverable 2 of the foundation onboarding handoff. Sources: the repository's
README, `SETUP.md` layout notes, the generic `/setup`, `/rank`, `/apply` command
definitions, the two `SKILL.md` orchestration files, section structure (headings only) of
the evaluation/template skill files, and the experiential synthetic-user evidence recorded
in the handoff. Per the handoff's scope rules, no personal profile artifacts were opened;
this maps *capabilities and interaction patterns*, not implementation to clone.

The competitor is a fork-and-fill Claude Code framework: the user's profile **is** a set
of markdown skill files, state lives in JSON/CSV files, and every surface is a chat
transcript. Jarv1s's job is to keep the capability depth while replacing the
prompt-file/file-state substrate with structured, owner-scoped records and editable UI.

## 1. Onboarding (`/setup`)

- **Three converging paths**, auto-picked by scanning a `documents/` folder: (A) read a
  whole documents folder (CV, LinkedIn export, diplomas, reference letters, past
  applications), (B) single CV import, (C) structured interview. All converge on the same
  profile files.
- **Path A is read-before-write and idempotent**: it inventories documents, reads the
  existing profile first, builds *additive* vs *conflicting* change sets, applies
  additive changes only on confirmation, and walks conflicts one at a time with
  keep/replace/manual options. Safe to re-run as documents accumulate.
- **Cross-reference consistency check before any write**: date mismatches, title
  mismatches, education mismatches, employer-name variants across CV/LinkedIn/diploma —
  presented as a numbered list the user must resolve before continuing.
- **Inference labeling**: behavioral/style content inferred from LinkedIn About or
  reference letters is explicitly tagged "*[Inferred from … — review before relying on
  this]*"; tailored past drafts are grounded against the profile before anything is
  extracted from them ("a tailored draft that drifted must never become a template").
- **Gap follow-ups** after document ingestion: career goals, excitement, deal-breakers,
  languages with proficiency, salary baseline, commute constraints, search config.
- **Search configuration is part of onboarding** (Path C Section 9): 3–8 role titles,
  3–5 distinctive searchable skills, target companies, geographic tiers (ideal /
  acceptable / borderline / too far), portal selection, CV language — plus *proactive
  suggestion of role types the user hasn't considered* based on their skill profile.
- **Sectioned re-run**: `/setup --section search` updates one area without redoing the
  profile.
- Observed weakness (handoff): a full Path C run took 9m37s and ~37k output tokens in a
  single turn, ignored a conciseness request, and once contaminated one profile with
  another's education — the cost of doing everything in one long chat turn over
  free-form files, and the strongest argument for staged, resumable, record-backed UI.

## 2. Structured profile ("the seven skill files")

One file per concern: candidate profile (identity, languages with levels, education,
experience, projects, skills, publications, awards, references), behavioral profile,
writing style, job-evaluation framework, CV templates, cover-letter templates, interview
prep (STAR examples), plus application-form field patterns. Capabilities worth keeping:

- Identity/education/experience/skills/languages/certifications/constraints are all
  first-class, addressable data — the exact structured-extraction target list in the
  handoff's product direction.
- Languages carry *declared proficiency levels* that later drive an automatic gate.
- The evaluation framework is *personalized at setup* (strong/moderate/weak skill areas,
  career goals, motivation filters) and *calibrated from outcomes* over time
  (`/outcome` → "Calibration from Past Applications": interview/offer patterns become
  confirmed strong-fit signals; repeated rejections/no-responses become notes).

## 3. Verification and the evidence discipline

- **Cross-reference check** at ingestion (§1 above).
- **Factual grounding audit** at application time: the reviewer compares every date,
  employer, title, and quantitative metric in a draft against the union of three profile
  sources; draft mismatches are tagged `reason: "grounding"` (distinct from style edits);
  mismatches *between the sources themselves* surface as profile-consistency warnings.
- **Never-fabricate rules at every layer**: gaps are stated honestly and reframed, never
  filled; "missing (gap)" keywords are left missing; contacts are search links, never
  claimed results; unfetched postings are never scored.
- The profile corpus works as an **evidence bank**: every claim in generated material
  must trace to a profile source, and drift is detected mechanically.

## 4. Critique — content and visual, separately

- **Drafter–reviewer split** (`/apply`): a fresh-context reviewer acting as a "hiring
  manager proxy" critiques drafts it receives inline. Output is two-part: (A) structured
  JSON edits (file / old_string / new_string / one-line reason) the drafter applies
  mechanically, and (B) narrative suggestions in fixed categories (missed keywords,
  company-specific angles, action-oriented reframing, tone/voice vs the behavioral
  profile) — every category reported even when empty, so silence can't read as skipped.
- **Visual critique is a mandatory compile-and-inspect loop**: compile the document, read
  the rendered PDF, check page count, orphaned headings, page balance, whitespace, and
  iterate until clean. The synthetic run demonstrated this genuinely working (noticed
  poor page balance visually and revised).
- **ATS text-layer verification**: extract the PDF's text layer, check extraction is not
  garbage, contact details survive as literal text, reading order matches visual order,
  dates survive; then a keyword-coverage table with four honest statuses — covered /
  synonym-only / missing (have it) / missing (gap) — where only "have it" gaps get fixed
  and true gaps are never stuffed.

## 5. Criteria, gates, and scoring

- **Gates run before scoring, and veto**: eligibility gate, language gate, employer
  exclusion gate, location tiers. Gate semantics are nuanced: a required language *never
  declared* is an automatic veto; a declared language at a *higher required level* is a
  visible flag for the user's judgment, never a silent pass or auto-reject. Location FAIL
  vetoes regardless of score; FLAG (heavy travel) stays ranked with a marker.
- **Five scoring dimensions** with explicit weights (technical 30 / experience 25 /
  behavioral 15 / career alignment 30; location unweighted pass/fail) and named verdict
  bands (Strong 75+ / Good 60–74 / Moderate 45–59 / Weak 30–44 / Poor <30). Optional
  salary benchmark. (Jarv1s deliberately differs: Fit/Want two-axis, never blended —
  the *gate-vs-score separation* is the part to adopt, not the weighted blend.)
- **Two evaluation tiers, honestly labeled**: `/scrape` quick-fit (high/medium/low from
  snippets), `/rank` batch triage (posting text vs an inline rubric, parallel agents,
  strengths/gaps persisted verbatim, vetoes recorded *with reasons* so exclusions stay
  explainable later), and `/apply` authoritative evaluation with company research that
  always re-runs. Observed weakness: the tiers being separate manual steps meant
  authoritative ranking stayed a second step, and 92 of 103 raw hits were prefiltered
  with little visibility.

## 6. Query derivation

- Search queries are **generated at setup from approved profile data** (titles, skills,
  domain terms, locations) into a persistent, user-visible file, organized into four
  priority families: strongest direction / domain expertise / adjacent pivots / wider
  net. Default runs use the top families; "broad" runs all; a focus argument prioritizes
  one.
- Recalibratable in isolation (`/setup --section search`). Observed weakness: sources
  configured only as query templates (no CLI) silently never got searched.

## 7. Search pipeline hygiene (context for later phases, not this spec's core)

Portal skills are discovered dynamically with per-portal `enabled` toggles; dedupe runs
against both seen-jobs state and the application tracker; identical postings spread
across cities are consolidated with a "posted in N cities" note (flagged, never
accused); portal health is evidence-first (degraded-output scan, yield history) with
bounded sentinel probes, and rate-limiting is never treated as breakage; postings are
untrusted data everywhere (no embedded instructions followed, no body links fetched).

## 8. Capability → Jarv1s disposition summary

| Competitor capability | Jarv1s today | Spec disposition |
|---|---|---|
| Multi-path onboarding (documents / single CV / interview) | Chat interview only | Adopt: résumé-upload-first with chat filling gaps |
| Structured profile (identity…constraints) | Absent (raw text résumé) | Adopt as owned structured records + editable UI |
| Cross-reference / conflict resolution | Absent | Adopt as a visual review queue, not a chat wall |
| Factual grounding audit + evidence tracing | Absent (mockup version was ruled fabricated) | Adopt as a real evidence bank |
| Content critique (structured edits + categories) | Absent | Adopt, record-backed |
| Visual critique + ATS text-layer check | Absent | Adopt for the *uploaded* document; no doc generation |
| Gates-before-scoring with veto/flag semantics | Partial (2 hard-exclude reasons only) | Adopt gate/flag semantics; keep two-axis scoring |
| Language/location declared-level nuance | Absent | Adopt |
| Query families with priorities | Implicit titles only | Adopt as stored, editable families |
| Outcome-driven calibration | Absent | Defer (needs application tracking — non-goal here) |
| CV/cover-letter generation, interview prep, trackers, Gmail/Notion sync | Absent | Non-goals for this foundation |
| Salary benchmark | Absent | Defer; capture per-posting comp instead |

## 9. Anti-patterns to avoid (observed, not hypothetical)

- One giant setup turn (9m37s, ~37k tokens) instead of resumable stages.
- User-maintained prompt files as the source of truth (drift, contamination risk,
  git-tracked personal data).
- Invisible prefiltering (92/103 dropped with little visibility) — Jarv1s's tracked-drop
  and triage-deferral discipline already answers this; keep it.
- Configured-but-never-searched sources — configuration must be provably wired to
  execution or visibly absent.
- Compensation left unstructured (missing on 6 of 11 assessed roles).
