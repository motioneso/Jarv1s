# Job Search module (external) — chief-of-staff career discovery

**Status:** Approved (Ben, 2026-07-22) — build in progress
**Grounded on:** `build/job-search-broad-discovery` @ `45236838` (verify current before build)
**Supersedes:** all prior `job-search` design docs and the existing `external-modules/job-search/`
contents — this is a **ground-up rebuild** that reclaims the `job-search` id and wipes the old
KV/enable state in JS-01. Prior specs are archived history and are not a reference for this design.
**Reference (format only):** the `finance` module (`external-modules/finance/`) — its manifest and
seam shapes are the template. Finance is **not yet fully validated**; this is one of the first large
external modules, so every platform seam below is **proven in JS-00/JS-01, never presumed**.
**Issue map:** epic **#1230**; slice tasks JS-00 **#1231** · JS-01 **#1232** · JS-02 **#1233** ·
JS-03 **#1234** · JS-04 **#1235** · JS-05 **#1236** · JS-06 **#1237** (cross-linked in the epic
body). Supersedes the prior job-search epic **#913** (closed). Broad-discovery source **#1229** is
a separate, already-built track — not part of this epic.

---

## Product goal

A career-discovery module for people (primarily **unemployed, seeking full-time work** — career
changers _and_ same-field next-job seekers) that finds the **right** job, not the fast one. Jarvis
acts as the user's **chief of staff**: it knows the user from their resume, an interview chat, and
their **vault of notes**, then continuously surfaces well-aimed, non-obvious opportunities that point
toward a "dream" job. Two halves:

1. **Get the resume solid.** Intake or build a resume, critique it honestly, and produce an improved
   version — never fabricating, but actively surfacing real strengths the user undersold.
2. **Discover and match.** Build a search profile through conversation, then run a **standing daily
   monitor** across any reachable job source, matching with two-stage AI reasoning and presenting
   ranked opportunities with an **apply link** (no generated applications this phase).

Decisions locked during grilling (2026-07-22):

| Question          | Decision                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| Users             | Unemployed, full-time; career-changer **or** same-field next-job                   |
| Scope             | Discovery + match quality; ends at the **apply link** — no auto-applications       |
| Resume            | Intake PDF/DOCX/paste **or build from interview**; honest critique + rewrite       |
| Truth guard       | **Never fabricate**; **do** surface real, undersold strengths                      |
| Interaction       | Module's **own full-screen chat page**, its **own isolated session** (not drawer)  |
| Interview         | Soft-scripted profile builder, assistant-led, tangent-friendly (not a wizard)      |
| Profile ownership | A **shared data object** — editable from the job-search chat **or** general Jarvis |
| Sources           | Generic URL/RSS extraction **+ big-board scraping**; user-added sources            |
| Source scope (p1) | **Drop ATS/company APIs** — this phase is "right career," not "specific company"   |
| Scraping posture  | **Permissive** ("if the user wants a source, we get it"); postings are untrusted   |
| Cadence           | **Standing monitor, daily**; dedupe; "N new since Tuesday" re-opener               |
| Match             | Two-stage: cheap bulk-filter → deep career-reasoning; vault-enriched               |
| AI                | Two **provider-agnostic** capabilities (bulk-filter + career-reasoning)            |
| Vault             | **On by default** ("we know about you"); user can toggle off; **never outbound**   |
| Feedback          | "Not this / more like this" sharpens the profile                                   |
| Notifications     | In-app phase 1; **email is a fast-follow**                                         |

## Non-goals (this epic)

- **No generated applications** — we stop at the apply link. No autofill, no cover letters, no ATS
  submission.
- **No ATS/company-specific integrations** (Greenhouse/Lever/Ashby APIs) — deliberately deferred;
  this phase discovers _careers_, not openings at one named employer.
- **No email/SMS notifications in phase 1** (fast-follow slice, not this epic's exit bar).
- **No embedded resume/document editor** — resume edits are chat-driven (house rule: no vault
  viewer/editor in the shell; artifacts show provenance + are edited by talking).
- **No cross-user or "shared search" surfaces** — every profile, resume, and match is owner-only.
- **No paid/proxy scraping infrastructure at scale** — phase 1 ships best-effort direct fetch with
  optional proxy config; industrial anti-bot evasion is out of scope.

## Slices

- **JS-00 (platform) — surface-scoped chat sessions.** The one net-new host change. Extend the chat
  session manager to key sessions by **`${actorUserId}:${surface}`** instead of `actorUserId`
  alone, and thread a `surface` through the turn/stream/seed routes (default `drawer` for
  back-compat). This is what makes the job-search page a **separate conversation** with no bleed to
  or from the drawer. Exit: two live sessions for one actor hold independent transcripts; a drawer
  turn never appears in the job-search stream or vice-versa (integration test).
- **JS-01 — Module skeleton + landing + full-screen chat surface.** Manifest, worker skeleton,
  clean-slate KV reset of any old `job-search.*` data, the **landing page** (saved profiles / start
  new), and the module's **own full-screen chat page** bound to the host's provider-agnostic chat
  engine over the JS-00 surface session, seeded with job-search guidance. Exit: fresh user opens
  Job Search → lands → starts a new search → chats in an isolated full-screen session.
- **JS-02 — Resume intake + review artifact.** Upload (PDF/DOCX) / paste / build-from-interview;
  honest critique; a **resume-review artifact** with proposed revisions and "surfaced strengths"
  callouts; chat-driven approve/revise; truth-guard enforced. Exit: user ends with an approved,
  improved resume stored owner-scoped.
- **JS-03 — Search-profile builder.** Soft-scripted interview that fills the profile schema
  (titles, industry, keywords, comp floor, location/remote, deal-breakers), the **shared profile
  object** with a `job-search.profile.update` tool callable from general Jarvis too. Exit: an
  approved profile exists and is refinable from either surface.
- **JS-04 — Source adapters + scraping infra.** The generic **URL/RSS LLM-extraction** adapter
  (user names a source in chat → we ingest it) and **big-board scraping** (Indeed/LinkedIn-class);
  worker fetch infra, per-source rate limiting, `fetchHosts`, postings-as-untrusted defanging.
  Exit: a profile run pulls real postings from a big board and one user-added URL.
- **JS-05 — Two-stage match engine.** Bulk-filter (embeddings + hard filters) → career-reasoning
  (deep fit over resume + profile + **vault recall**) producing fit score, why-it-fits, gap
  analysis, deal-breaker veto, legitimacy flag. Exit: candidate postings become ranked matches with
  reasons; vault provably never leaves in a source query.
- **JS-06 — Standing monitor + results surfacing + feedback.** Daily per-user schedule, dedupe,
  "N new since" state, **match cards** on the landing/panel, "not this / more like this" feedback
  loop. Exit: e2e #1000-harness UAT drives a seeded run end-to-end on a dev instance.
- **Fast-follow (separate task) — email notifications** on new strong matches.

JS-00…JS-03 are specified in depth; JS-04…JS-06 at architecture level (each gets a short per-slice
spec update before build if its shape shifts — the pattern finance uses).

---

## Design — the authored surfaces (Park Press)

Design is first-class here, not a coat of paint. Everything below uses the **Park Press** system
(`tokens.css`): warm oat paper (`--paper`/`--surface`), **forest** as the one living accent, **gold**
as a _decorative_ co-accent (straps/labels/"new" markers — never semantic), **amber** for caution
(legitimacy flags — never error-red), serif headings / mono eyebrows / sans body, `jds-*` primitives
plus local module primitives, keyline grids. The module ships its own stylesheet using **token vars
only** (no hex literals — that rule lives in `tokens.css`). React Query keys are `["job-search", …]`.

### 1. Landing (`/` — nav "Job Search")

The home of the module. Two states:

- **Returning user** — a keyline grid of **profile cards**. Each: search title (serif), a mono
  eyebrow (`industry · location · comp floor`), a **"N new since Tuesday"** gold strap when the
  monitor found matches since last view, a quiet count of active matches, and last-run timestamp.
  Clicking a card re-enters its full-screen chat (resumes that profile's session). A secondary
  "Refine" affordance and a run-state dot (forest = fresh, ink-3 = idle, amber = source error).
  Primary **"Start new search"** button pinned top-right.
- **First run** — no cards. A single authored hero (serif headline, one sans line of promise, one
  **"Start a new search"** primary CTA). Uses the existing empty-state pattern — **no spinners**;
  skeleton profile cards while the list loads.

### 2. Full-screen chat page (the module's own surface)

Chat-**primary**, full-bleed inside the module container — **not** the host drawer, and on its **own
session** (JS-00). Layout: a centered conversation column (the authored chat kit styling — serif
system/user turns, mono timestamps) with **inline artifacts** rendered between turns:

- The assistant **opens** with the resume step: _"Let's get your resume solid first."_
- **Artifacts render inline in the flow** (not a separate pane — keeps chat-primary honest):
  resume-review cards and match cards appear as the assistant surfaces them, scannable, then the
  conversation continues beneath.
- A slim, non-blocking **progress rail** (mono, top of column) shows the soft-script state — e.g.
  `Resume ✓ · Titles ✓ · Comp — · Location — · Deal-breakers —` — so the user sees what's still
  needed without a wizard. It's a status readout, not a stepper you click.

### 3. Resume-review artifact

An inline card, not an editor. Three registers, all authored:

- **Critique** — plain-language assessment ("does this get you recognized by this employer?"),
  sans body, grouped by section.
- **Proposed revisions** — before/after shown as quiet tracked changes (forest add, struck ink-3
  removal). Approve / "revise this" are **chat actions**, not form fields — clicking seeds the chat
  with the instruction.
- **Surfaced strengths** — the truth-guard's positive half: real strengths the user undersold,
  called out on a **gold decorative strap** ("You mentioned leading a migration — that's a
  leadership signal worth foregrounding"). Never invented; each cites the resume/vault evidence it
  came from.

Real gaps are shown as **honest "go-learn" chips** (amber, anti-shame — "roles you want list Terraform;
you don't have it yet"), never silently papered over.

### 4. Match card

The core discovery unit — appears inline in chat _and_ as the deduped set on the landing/panel:

- **Header:** role title (serif) · company · location/remote (mono eyebrow).
- **Fit badge:** a 0–100 fit score with a forest fill; the number is secondary to the reason.
- **"Why this fits you":** 2–3 sans lines grounded in _the user_ (resume + vault), not keyword echo
  — the chief-of-staff voice ("your logistics background + the ops-analytics interest in your
  notes").
- **Gap chips:** what's missing vs the posting (neutral, not disqualifying unless a deal-breaker).
- **Legitimacy flag:** amber chip when the posting looks like a ghost/scam/reposting ("posted 90+
  days, re-listed 4×"). Never red — caution, not error.
- **Provenance chip:** source + scraped-at (the No-Note-Viewer provenance rule applies to postings
  too).
- **Actions:** **Apply** (primary — opens the source link in a new tab; we never submit) and the
  **"Not this / More like this"** feedback pair.

### Accessibility & states

Every surface has authored empty, loading (skeletons), and error states. Source errors degrade
gracefully — a profile still shows its last matches with a "one source failed" amber note rather
than an empty screen. Keyboard-navigable chat + cards; fit badges carry text alternatives.

---

## Module contract

- **Id:** `job-search` (reclaimed; ground-up rebuild). Directory `external-modules/job-search/`,
  excluded from the core image (`.dockerignore`, no workspace entry, never in `BUILT_IN_MODULES`).
  Build script `build:external:job-search` → `package.json` + `jarvis.module.json` +
  `dist/worker.js` (CJS, self-contained) + `dist/web/index.js` (ESM, host React runtime,
  contract v1).
- **Auth declarations** (`kind: "api-key"`, all optional): only if a user-added source needs a key
  (e.g. a paid board). None required for phase 1 (generic scrape + public boards). A future
  `job-search.proxy` instance credential is reserved for optional scraping proxy config.
- **fetchHosts:** phase 1 declares the big boards we ship an adapter for (e.g. `www.indeed.com`,
  `www.linkedin.com`) plus a **dynamic user-source allowance** — see "Scraping" for how user-added
  hosts are admitted without a manifest edit (the open question JS-04 must resolve; default-safe is
  an instance-admin allowlist).
- **Storage namespaces** (user scope; clean-slate — old keys wiped in JS-01):
  `job-search.profiles` (the shared profile objects), `job-search.resume` (current + revisions),
  `job-search.sources` (built-in + user-added source configs), `job-search.candidates` (raw
  post-filter postings per run, short TTL), `job-search.matches` (ranked, deduped, durable),
  `job-search.feedback` (not-this/more-like-this signal), `job-search.settings` (per-user: vault
  toggle, cadence), `job-search.meta` (monitor state: last-run, seen-hashes, "new since").
- **Worker queues/schedules:**
  - queue `job-search.discover-run` (retryLimit 3, manual run allowed) — one job per profile; runs
    all of that profile's sources, filters, matches, dedupes, updates "new since".
  - user-scoped schedule `job-search.discover-sweep`, cron **`23 7 * * *`** (daily, off-minute per
    fleet guidance) → posts onto `job-search.discover-run` per enabled profile.
  - queue `job-search.resume-revise` (retryLimit 1, manual, identifier-only params) — web-initiated
    resume revision apply (the click is the confirmation; free-text stays assistant-only).
- **Assistant tools** (`permissionId == name`): read-risk `job-search.profiles.list`,
  `job-search.matches.query`; write-risk `job-search.profile.update` (**callable from general
  Jarvis** — the shared-object seam), `job-search.discover.run-now`, `job-search.resume.critique`,
  `job-search.match.feedback`. The full-screen chat drives these over the surface session; general
  Jarvis can call `job-search.profile.update` and the read tools without ever seeing the job-search
  transcript.
- **Web:** contract v1; route `/` (landing + full-screen chat). `jds-*` primitives, Park Press,
  React Query keys `["job-search", …]`.
- **Database:** KV data plane for phase 1 (no `ownedTables`); a later migration to module-owned
  tables is gated on the #914 data plane and gets its own spec, exactly like finance FIN-06.

---

## Resume flow (JS-02)

**Intake.** Three doors: upload (PDF/DOCX — parsed at the attachment seam already used by chat
attachments), paste text, or **build from scratch** — if the user has no resume, the assistant
interviews them into one. Stored owner-scoped in `job-search.resume` as `{ current, revisions[] }`;
revisions are append-only so the user can see what changed.

**Critique + rewrite.** The `career-reasoning` capability assesses the resume against the user's
target ("what does this say about you; will it get you recognized?"). Two hard rules:

- **Never fabricate** — critique only reframes, reorders, and foregrounds _real_ evidence from the
  resume + vault. No invented skills, titles, dates, or metrics.
- **Surface the undersold** — actively find real strengths the user buried or omitted (from resume
  _and_ vault), and propose foregrounding them, each tied to its evidence.

Edits are **chat-driven** (no editor). The artifact (design §3) shows critique, tracked revisions,
and surfaced strengths; the user approves or asks for changes in the chat. Gaps are surfaced
honestly as "go-learn" items, never hidden.

## Search-profile builder (JS-03)

A **soft-scripted** interview, not a wizard: the assistant knows the fields it still needs and steers
toward them while following tangents. Profile schema (`job-search.profiles`, one per search):

```
{ id, title, status: "building" | "active" | "paused",
  titles: string[], industries: string[], keywords: string[],
  compFloor: { amount, currency, period } | null,
  location: { mode: "remote" | "onsite" | "hybrid", places: string[] } | null,
  dealBreakers: string[],            // hard vetoes (e.g. "no on-call", "no relocation")
  vaultEnabled: boolean,             // per-profile override of the on-by-default vault use
  createdAt, updatedAt, lastRunAt, newSince }
```

**Shared object.** The profile is edited from the job-search chat **or** general Jarvis via
`job-search.profile.update` (write tool). Chat _transcripts_ are isolated (JS-00); the profile is
shared _data_ — general Jarvis can "bump my comp floor to 140k" without seeing the job-search
conversation. Search starts once a profile is **approved** (enough fields to run); refining it later
re-tunes the standing monitor live.

## Sources & scraping (JS-04)

**Adapters (phase 1):**

1. **Generic URL/RSS extractor** — the "any reachable listing" path. The user names a source in chat
   ("watch this board: <url>"); the worker fetches it (or its RSS), and the `bulk-filter` capability
   extracts structured jobs `{ title, company, location, url, description, postedAt }` from arbitrary
   HTML. This _is_ the user-added-source mechanism for phase 1 (no separate management UI yet).
2. **Big-board scraping** — one or two high-volume boards (Indeed/LinkedIn-class): paginated search
   by the profile's titles/keywords/location, our own TS fetchers (no third-party runtime
   dependency), inspired by JobSpy's _techniques_ only.

**Scraping posture — permissive but safe.** Ben's rule: _"if the user wants a source, we get it."_
So we do **not** ToS-police or hard-block on robots. The one non-negotiable is **injection safety**:
every scraped posting is **untrusted input**, defanged before it enters any AI prompt (the chat
`defang` pattern), and can never issue tool calls. Fetch goes through the host-pinned `ctx.fetch`
(https-only, SSRF-guarded, redirect re-validation); per-source rate limiting + optional proxy config
keep us polite. Postings are content, never secrets — they never enter job payloads.

**Open question for JS-04 (must resolve at build):** admitting a **user-named host** that isn't in
the manifest `fetchHosts`. `ctx.fetch` pins to declared hosts by design. Options: (a) an
instance-admin dynamic allowlist the module consults, (b) a broadened fetch policy for this module
with the SSRF guard still active. Default-safe pick is (a); JS-04 verifies which the platform
actually supports before promising open user-sources. **Do not assume the seam exists — prove it.**

## Match engine (JS-05)

Two stages, both **provider-agnostic capabilities** (no baked provider/model; the AI router picks
the user's configured model — Ben's illustrative config: a fast board like Groq for bulk-filter,
OpenAI/Anthropic for reasoning):

**Stage 1 — bulk-filter (cheap, wide).** For every candidate posting from JS-04: hard filters first
(comp floor, location/remote, deal-breaker vetoes, title/keyword) cull the obvious misses; then
**embedding similarity** (the runtime embedding provider) between the posting and the
profile+resume embedding ranks the remainder. Hundreds → a top-N shortlist. Cheap and fast; results
land in `job-search.candidates` (short TTL).

**Stage 2 — career-reasoning (deep, narrow).** Each shortlisted posting goes to the reasoning
capability with **resume + interview profile + vault recall** as context, producing a structured
match: `{ fitScore, whyItFits, gaps[], dealBreakerHit?, legitimacy: "ok"|"suspect", legitimacyReason? }`.
This is the chief-of-staff step — the "why" is grounded in who the user _actually is_, including
vault context (interests, location, history). Durable results in `job-search.matches`.

**Vault recall.** Career-relevant context is pulled via the existing owner-scoped memory recall
(GraphMemoryRecall / passive recall), gated by the per-profile `vaultEnabled` (default **on**).

## Standing monitor + feedback (JS-06)

- **Cadence:** daily per active profile (`job-search.discover-sweep` → `discover-run`).
- **Dedupe:** by a normalized key `hash(source + externalId|url + title + company)`; `job-search.meta`
  holds seen-hashes per profile and the `newSince` timestamp powering "N new since Tuesday".
- **Surfacing:** the assistant re-opens a returning session with the count; the deduped set lives as
  match cards (design §4) on the landing/panel with apply links.
- **Feedback:** "Not this / More like this" writes to `job-search.feedback`; the next run folds it
  into filtering + reasoning (a thumbs-down payee-style negative signal, a thumbs-up exemplar).
- **Notifications:** in-app badge/notify on new strong matches; **email is a fast-follow** slice.

---

## Security & privacy

- **Vault never goes outbound.** The chief-of-staff invariant: vault recall enriches the _internal_
  Stage-2 reasoning (the user's own configured model) **only**. It is never placed in a scraper
  query, a source request, or any outbound fetch. The job boards learn nothing about the user beyond
  the profile's explicit search terms.
- **Owner-only, always.** Every profile, resume, revision, candidate, match, and feedback row is
  user-scoped KV under existing RLS. No cross-user surface exists in this module.
- **Metadata-only job payloads.** `discover-run` / `resume-revise` payloads carry
  `{ actorUserId (host-bound), jobKind, profileId, idempotencyKey }` — never resume text, vault
  content, postings, or prompts.
- **Postings are untrusted.** Scraped HTML is defanged before any AI prompt and can never trigger a
  tool call (prompt-injection posture inherited from the chat pipeline).
- **Secrets never escape.** Any user-source API key lives only in `app.module_credentials`
  (AES-256-GCM at rest), never in KV, logs, payloads, exports, or AI inputs.
- **Provider-agnostic.** No provider/model is hardcoded; the module requests the bulk-filter and
  career-reasoning capabilities and the router resolves the user's configured model.
- **Fetch surface.** `ctx.fetch` host-pinning + SSRF guard applies to every source, including the
  generic extractor and any admitted user host (JS-04 open question).
- **Export/delete.** User-scoped KV + any credential ride the existing module lifecycle
  (metadata-only for credential values).

## Testing

- **Pure domain unit tests** (`external-modules/job-search/src/domain/`): profile validation, hard
  filters (comp/location/deal-breaker), dedupe key + "new since" state machine, feedback folding,
  legitimacy heuristics, resume-revision append/versioning. Deterministic, no AI/network.
- **Worker fixture tests** (`tests/unit/external-module-job-search-*.test.ts`): handler wiring over a
  scripted RPC host — a discover run with faked `ctx.fetch` postings + faked `ctx.ai`, cursor/seen
  persistence, per-source error isolation (one source fails, run continues), injection defang.
- **JS-00 chat-session tests:** two surfaces for one actor keep independent transcripts; a drawer
  turn never reaches the job-search stream (the anti-bleed guarantee), seed idempotency per surface.
- **Integration** (`tests/integration/external-module-job-search.test.ts`): install/enable/hash
  fixtures; sources faked at the `ctx.fetch` seam with recorded HTML fixtures — no live scraping in
  CI.
- **e2e UAT (#1000 harness — Ben's rule for every UI slice):** JS-01 landing→chat drive; JS-06
  full seeded run (resume → profile → matches surface with apply links) on a dev instance.

## Open items deliberately deferred

- **JS-00 seam reach** — surface-scoped sessions may need care around persistence, replay, and the
  session-token registry; JS-00 owns proving it end-to-end before JS-01 depends on it.
- **User-host admission** (JS-04 open question above) — resolved at that slice, default-safe to an
  admin allowlist if the platform can't safely admit arbitrary hosts.
- ATS/company APIs; email/SMS notifications; a dedicated source-management UI; paid/proxy scraping at
  scale; module-owned tables (gated on #914) — all named later candidates, not silently implied.
