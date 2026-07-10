# Intelligent job search — open decisions for Ben

**Status:** Open — must be settled before dependent task issues become RFA

**Date:** 2026-07-10

**GitHub:** #913

**Grounding:** grounded on `eafa22dd`

---

The architecture fixes the security, packaging, evidence, and module-isolation boundaries. The
following product/scale forks are intentionally not decided by this spec agent.

## D1 — Ranking strategy and daily AI budget

Choose one MVP strategy:

- **Deterministic gate + AI fit bands:** hard filters first, then structured AI for a bounded number
  of new/changed survivors. Richest explanations; incurs configured-provider cost and latency.
- **Deterministic evidence ranking only:** title/skill/preference/freshness rules with no AI during
  monitoring. Cheapest and easiest to audit; weaker semantic matching and resume-to-requirement
  reasoning.
- **Hybrid on demand:** deterministic feed by default; user requests AI evaluation for selected
  roles. Lowest scheduled cost; less “intelligent” automation in the first week.

Ben must also set the initial per-user daily evaluation ceiling and whether backlog is oldest-first.
All choices must emit evidence, gaps, freshness, confidence, and unknowns; no opaque percentage.

**Blocks:** JS-07.

## D2 — Initial compliant sources

Select the smallest source set that has current terms/policy review and useful coverage for the
first user. Candidate classes are:

- public Greenhouse board endpoints;
- public Lever postings endpoints;
- public Ashby board endpoints;
- direct employer career pages only where a stable public feed/adapter exists;
- manual public URL or pasted-description capture, without recurring generic scraping.

The 2026-07-09 approved design selected Greenhouse + Lever + Ashby + manual capture. Ben should
confirm that selection still stands or reduce it. Each shipped adapter needs a review URL/date,
exact hosts, courtesy interval, and kill-switch posture. LinkedIn/authenticated boards and
known-prohibited automation remain out.

**Blocks:** JS-04.

## D3 — Resume storage format and KV ceiling

`module_kv` caps each JSON value at 65,536 bytes. Choose:

- **Capped normalized Markdown/plain text:** one immutable revision per KV value, with a lower input
  cap leaving room for metadata/evidence. Smallest MVP; rejects unusually large resumes.
- **Chunked Markdown revisions:** manifest plus multiple content chunks. Supports larger input but
  complicates atomic approval, export, cleanup, and truth-evidence links.
- **Wait for #914 relational module storage:** store larger/versioned records outside KV. Removes
  the KV ceiling but makes #914 a hard prerequisite and expands the data-plane dependency.

Also decide whether MVP retains the original pasted text alongside normalized Markdown or only the
approved normalized revision plus evidence hashes. PDF/DOCX parsing remains out in all options.

**Blocks:** JS-02 and JS-03.

## D4 — Onboarding depth

Choose the required first-pass depth:

- **Six checkpoints:** resume intake, critique, approval, search profile, sources/schedule, final
  review/enable. Most complete; longer time to first results.
- **Progressive onboarding:** approve a minimum profile/resume/source, start monitoring, then prompt
  for compensation, company preferences, and exclusions later. Faster activation; early ranking has
  more unknowns.
- **Resume-first:** critique/approve resume before collecting the search profile. Strong document
  outcome; delays source setup.

Ben must also decide whether one-click module-to-assistant launch is acceptance-critical. If yes,
the starter-prompt portion of #916 is a hard runtime task; if no, MVP may instruct the user to open
Chat with supplied text.

**Blocks:** JS-03 and JS-06.

## D5 — KV retention ceiling for opportunities and run history

The no-#914 MVP needs bounded storage. Decide:

- maximum retained opportunities per user;
- maximum stored description bytes per opportunity;
- how long passed/stale jobs and monitor-run records remain;
- whether eviction preserves a compact tombstone to prevent rediscovery.

The smallest design keeps active/saved jobs, evicts oldest passed/stale jobs, and retains only safe
recent run metadata, but exact ceilings are product decisions. If Ben requires unlimited history or
relational reporting, #914 becomes hard and the KV design must be revised before build.

**Blocks:** JS-02 and JS-05.

## D6 — Schedule semantics

The draft #915 runtime design proposes manifest-static per-user schedules, not arbitrary
per-user cron. Choose:

- one periodic due-check whose handler reads each user's local desired time and no-ops when not due;
- one fixed daily manifest time for all users;
- expand the runtime design to support per-user schedule updates before building job search.

The choice must guarantee at most one scheduled discovery run per local day and no missed-run storm.

**Blocks:** the replacement #915 schedule task and JS-05.

## Approval record

Record Ben's selections here or in the draft PR review. After resolution, update the design and task
specs, mark the affected JS issues ready only after spec approval, and do not silently preserve
options the approved choice rejects.
