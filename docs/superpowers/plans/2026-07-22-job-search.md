# Job Search — Phased Implementation Plan (JS-00 … JS-06 + fast-follow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline
> execution — Ben token-budget rule, no subagent fan-out) to implement this plan
> phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved (Ben, 2026-07-22) — building JS-00 first
**Spec:** `docs/superpowers/specs/2026-07-22-job-search.md` (approved design spec; the sole
source of truth — it supersedes and reclaims everything under the `job-search` id)
**Grounded on:** worktree commit `45236838` (re-run `pnpm audit:preflight` before build)
**Issues:** epic **#1230** · JS-00 **#1231** · JS-01 **#1232** · JS-02 **#1233** · JS-03 **#1234**
· JS-04 **#1235** · JS-05 **#1236** · JS-06 **#1237** (cross-linked in the epic body). Repo hard
gate: **no code before both the approved spec and the slice's task issue exist** — both now exist.
**Dependency:** **JS-00 gates all later phases** — every other slice rides the surface-scoped
session seam it proves.

---

## How this plan works — the UAT gates

Every phase ends with a **⛔ UAT GATE (Ben)**: a hands-on pass on the dev instance over LAN
before the next phase begins. Each gate lists concrete things Ben opens, does, and should see.
**No phase starts until Ben has signed off on the previous phase's gate.** Gate sign-off is
recorded as a comment on the slice's task issue.

**UAT setup (every gate):** dev instance from this worktree, Vite started with `--host`
(Ben tests over LAN — never headless), api + worker running, Ben's real user. After each
phase's code lands: `pnpm verify:foundation` exit 0 on a **fresh** gate DB
(DROP/CREATE first — the gate's own uat-seed leaves durable rows).

## Global constraints (all phases)

- **Clean slate.** The spec reclaims the `job-search` id from scratch. The prior contents of
  `external-modules/job-search/` are replaced wholesale in JS-01 and are **not a reference**
  for any design or implementation decision. The **finance** module
  (`external-modules/finance/`) is the format template for manifest/worker/web seams — and
  finance itself is not yet fully validated, so every platform seam is **proven when first
  touched, never presumed**.
- **Hard invariants (CLAUDE.md):** owner-only private-by-default data; DataContextDb /
  VaultContext only; `AccessContext = { actorUserId, requestId }`; secrets never escape;
  metadata-only pg-boss payloads; provider-agnostic AI (capabilities via the router, never a
  hardcoded model); module isolation (only `@jarv1s/module-sdk`); never edit applied
  migrations; module SQL only in the module's `sql/` dir.
- **Design system:** Park Press — token vars from `apps/web/src/styles/tokens.css` only (no
  hex literals in module CSS), serif headings / mono eyebrows / sans body, `jds-*` + local
  primitives, authored empty/loading/error states (skeletons, no spinners), no curved accent
  left-border cards. React Query keys `["job-search", …]`.
- **House rules:** why-comments citing issue/spec ids; `check:file-size` ≤ 1000 lines;
  prettier before every commit; explicit `git add <paths>` (never `-A`); one commit per task;
  every commit body carries a release-note summary line.
- **AI:** `ctx.ai.generateStructured` only, with `tierHint` expressing the two spec
  capabilities — bulk-filter → `"economy"`, career-reasoning → `"reasoning"`. Scraped posting
  text is **defanged before any prompt** and can never issue tool calls.
- **Local gate per phase:** `pnpm verify:foundation` (fresh DB), plus the phase's own suites.

---

## Phase JS-00 — Surface-scoped chat sessions (platform)

**Goal:** one actor can hold two independent live chat conversations — the drawer and a named
module surface — with zero transcript bleed in either direction.

### Scope / tasks

The manager keys **everything** by bare `actorUserId` today: `sessionKey = actorUserId`
(`packages/chat/src/live/chat-session-manager.ts:247`) and seven actor-keyed maps
(`sessions`, `subscribers`, `launching`, `turnsInFlight`, `turnControllers`,
`pendingForcedReplay`, `privateDetachTimers`). JS-00 re-keys the live layer by
**`${actorUserId}:${surface}`** while persistence stays actor-scoped per surface.

- [ ] **Task 1 — Surface type + key helper.** Add `ChatSurface` (validated slug,
      `^[a-z][a-z0-9-]{1,31}$`, default `"drawer"`) and a `surfaceSessionKey` helper
      (actorUserId + surface) with a parse inverse (the composite must round-trip —
      reconciliation receives raw keys back from the cli-runner mux). Unit-test the
      round-trip including user ids containing the delimiter (pick a delimiter that cannot
      appear in either part, or encode).
- [ ] **Task 2 — Re-key `ChatSessionManager`.** Every map above keys by the composite;
      public methods (`ensureSession`, `submitTurn`, `seedContext`, `stopTurn`, `clear`,
      `resumeThread`, `switchProvider`, `subscribe`, `injectRecord`) gain a `surface`
      parameter (defaulted to `"drawer"` so every existing caller compiles unchanged).
      Turn-at-a-time (`ChatTurnInFlightError`) becomes per **(actor, surface)** — two
      surfaces may run turns concurrently by design. `MAX_SUBSCRIBERS_PER_ACTOR` becomes
      per-surface; add a total per-actor cap (2× current) so one user still can't fan out
      unbounded streams.
- [ ] **Task 3 — Persistence surface scoping.** Thread `surface` through
      `ChatPersistencePort` (`chat-session-ports.ts`) and its implementation
      (`live/persistence.ts`): `listPriorTurns`, `recordTurn`, `getCurrentThreadState`,
      `openNewConversation`, `touchExistingThread` scope to the surface's thread lineage. New
      migration adding a `surface` column (default `'drawer'`) to the chat-thread table — in
      the chat package's own `sql/` dir, **new file, never editing an applied migration**;
      add the row to `foundation.test.ts`'s full migration list (it asserts with `toEqual`).
      Existing rows backfill to `'drawer'` via the column default — no data rewrite.
- [ ] **Task 4 — MCP token + reconciliation identity.** `mintMcpToken` /
      `revokeMcpToken` / `touchMcpToken` key by the composite (the `chatSessionId` argument
      becomes the composite key), so each surface session gets its own token and the #342
      reconcile sweep (`reconcileLiveSessions`, `listMcpTokenSessionIds`, `killSession`)
      reaps per-surface. Verify at execution that the cli-runner mux session name derives
      from `sessionKey` and survives the composite (length/charset limits of the mux namer).
- [ ] **Task 5 — Route threading.** `packages/chat/src/live-routes.ts`: the turn, cancel,
      and stream routes (`/api/chat/turn`, `/api/chat/turn/cancel`, `/api/chat/stream`) and
      the seed path (~L360–420) accept an optional `surface` param (validated; absent ⇒
      `"drawer"`). SSE subscription filters to the requested surface. Rate limiting stays
      per-principal (shared across surfaces — one user, one budget). Update the shared
      contract types in `packages/shared/*-api.ts` (remember fast-json-stringify strips
      undeclared response fields).
- [ ] **Task 6 — Back-compat sweep.** Grep every `seedContext` / `submitTurn` /
      `subscribe` caller (gateway notifier, onboarding seed, module-control paths) and
      confirm each lands on `"drawer"` by default; no behavior change for existing surfaces.

### Invariants touched

- **AccessContext shape** — `surface` is a route/manager parameter, **never** a new
  `AccessContext` field.
- **Secrets never escape** — per-surface MCP tokens follow the existing mint/revoke/TTL
  lifecycle; no token in logs or payloads.
- **Private by default** — surface threads inherit the existing owner-only chat RLS;
  incognito semantics stay drawer-only for now (a module surface never goes incognito this
  epic — assert it).

### Tests / verification

- [ ] Unit (`packages/chat`): composite key round-trip; per-(actor,surface) turn locking
      (concurrent turns on two surfaces both proceed; same surface 409s); per-surface seed
      idempotency; per-surface subscriber caps.
- [ ] **Integration — the anti-bleed proof** (`tests/integration/`): one actor, two live
      sessions (`drawer` + `job-search`): independent transcripts; a drawer turn never
      appears in the job-search stream and vice-versa; per-surface `clear` leaves the other
      surface's conversation intact; reconciliation after a simulated restart reaps both.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB) — includes the amended
      `foundation.test.ts` migration list.

### ⛔ UAT GATE JS-00 (Ben) — sign-off required before JS-01

No new UI in this phase; the gate is a **drawer regression pass + recorded proof of isolation**.

- [ ] Open the web app over LAN → open the assistant drawer → send a message → normal reply
      streams in.
- [ ] Send a second message, hit Stop mid-turn → "Stopped by user." appears; drawer stays
      usable.
- [ ] Refresh the page → drawer history is intact (persistence unbroken by the migration).
- [ ] Reviewed: the anti-bleed integration test output (name + pass) pasted on the JS-00 task
      issue, from the `verify:foundation` run on this worktree.

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-01 — Module skeleton · clean-slate reset · landing · full-screen chat

**Goal:** a fresh user opens **Job Search** in the nav, lands on the authored landing page,
starts a new search, and chats in the module's own isolated full-screen session.

### Scope / tasks

- [ ] **Task 1 — Clean-slate reset.** Replace the contents of `external-modules/job-search/`
      wholesale with the new scaffold (git history preserves the old tree; nothing from it is
      referenced). Keep/confirm the root script `build:external:job-search` →
      `scripts/build-external-module.ts`. Add a `job-search.reset` reconcile job (finance
      `reconcileJobs` precedent) whose handler wipes any pre-existing `job-search.*` KV keys
      for the actor via `ctx.kv.list` + `delete` — **verify at execution** whether host
      reconcile jobs run per-user or per-instance and adapt; the reset must be idempotent and
      self-retiring (a `job-search.meta` `resetDone` marker).
- [ ] **Task 2 — Manifest v1** (`jarvis.module.json`, field-by-field against finance's shape:
      `schemaVersion/id/name/version/publisher/lifecycle/compatibility`): id `job-search`;
      storage namespaces (user scope) `job-search.profiles`, `.resume`, `.sources`,
      `.candidates`, `.matches`, `.feedback`, `.settings`, `.meta`; **no `database.ownedTables`**
      (KV data plane phase 1; module tables are a later spec gated on #914); `runtime`
      worker entrypoint contract v1; `web` contract v1 + `navigation` entry (label
      "Job Search", route `/`); no `auth` entries yet (none required phase 1); no
      `fetchHosts` yet (JS-04). Assistant tools v1: `job-search.profiles.list` (read).
      Excluded from the core image (`.dockerignore`, no workspace entry, never in
      `BUILT_IN_MODULES`) — assert in the bundle test.
- [ ] **Task 3 — Worker skeleton.** `src/worker/index.ts` + `registry.ts` + `wrap.ts` +
      `validate.ts` and `src/domain/kv-port.ts` + `errors.ts`, ported from finance's shapes
      (`WorkerPorts` with structural kv/fetch/ai ports, `wrap` error envelope, nullable
      ai/fetch guards). `profiles.list` reads `job-search.profiles`; empty state returns a
      `nextStep` hint.
- [ ] **Task 4 — Web skeleton + landing.** `src/web/` (runtime global read, `h`/`Fragment`
      factories, authored states — port finance's web scaffolding). Landing per spec design
      §1: returning-user keyline grid of profile cards (serif title, mono eyebrow, gold
      "N new since" strap slot, run-state dot) and the first-run hero (serif headline, one
      promise line, primary "Start a new search" CTA); skeleton cards while loading. Module
      stylesheet uses token vars only.
- [ ] **Task 5 — Full-screen chat page** (spec design §2). Chat-primary column inside the
      module container, driven by the **host chat routes with `surface: "job-search"`**
      (JS-00): `POST /api/chat/turn`, SSE `GET /api/chat/stream`, cancel. Seed the session
      once per surface-session with the job-search guidance prompt (the seed route +
      idempotency key; the assistant opens with the resume step). Serif turns, mono
      timestamps, slot for inline artifacts (filled in JS-02). Slim mono progress rail
      placeholder (wired to real profile state in JS-03).
- [ ] **Task 6 — Web run-now plumbing.** Port finance's `invokeTool`/`runQueue` web API
      helpers (`/api/modules/job-search/...` — verify exact routes in
      `apps/api/src/external-module-jobs.ts` at execution). Needed from JS-02 on.

### Invariants touched

- **Module isolation** — module code imports only `@jarv1s/module-sdk`; web bundle carries no
  own React; no host-internal imports.
- **Private by default** — all namespaces user-scoped; KV rides existing owner-only RLS.
- **Spec before build** — manifest v1 declares only what JS-01 ships; later slices extend it
  (finance's incremental-manifest precedent).
- **Provider-agnostic AI** — no AI use yet; the chat page rides the host engine, which
  resolves the user's configured provider.

### Tests / verification

- [ ] Unit: manifest test (real validator, pinned namespaces/tools/nav — finance-manifest
      test shape); bundle test (CJS worker self-contained, ESM web, no `@jarv1s/*` runtime
      leaks, not in the core image); reset-job idempotency over a fake kv.
- [ ] Integration (`tests/integration/external-module-job-search.test.ts`, rebuilt from
      scratch): install/enable through the real registration path; `profiles.list` through
      the real worker runtime for a seeded user; reset job wipes seeded stale keys.
- [ ] **e2e #1000-harness Playwright** (real dev instance, real module activation —
      finance's D7 `docker cp` + restart recipe): nav shows Job Search → first-run hero →
      "Start a new search" → full-screen chat renders → send a turn → reply streams.
      Remember uat-spec-gotchas: seeded owner lands on onboarding (Skip setup → Skip
      anyway); `getByLabel` needs `{ exact: true }`.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB).

### ⛔ UAT GATE JS-01 (Ben) — sign-off required before JS-02

- [ ] Over LAN: nav shows **Job Search** → click it → first-run hero renders (serif headline,
      one CTA, no spinners).
- [ ] Click **Start a new search** → full-screen chat opens; the assistant greets with the
      resume-first opener.
- [ ] Send "hello" → a reply streams in, styled (serif turns, mono timestamps).
- [ ] Open the **drawer** and ask "what did I just say in job search?" → the drawer
      **cannot see it** (isolation, live).
- [ ] Say something in the drawer, return to Job Search → it does not appear there either.
- [ ] Reload the Job Search page → its own conversation history is intact.

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-02 — Résumé intake + review artifact

**Goal:** the user gets an honest critique and an improved, approved resume — never
fabricated, undersold strengths surfaced — stored owner-scoped with revision history.

### Scope / tasks

- [ ] **Task 1 — Domain: resume store.** `src/domain/resume.ts`: `{ current, revisions[] }`
      in `job-search.resume`, append-only revisions, versioned diff records (before/after per
      section). Pure; unit-tested.
- [ ] **Task 2 — Intake (three doors).** Upload rides the **host chat attachment seam**
      (PDF/DOCX already parsed there; the worker reads actor-scoped **extracted text** via
      the module worker attachment port — images return null, surface a friendly retry).
      Paste = plain chat text. Build-from-interview = assistant-led over the JS-01 session.
      Tool `job-search.resume.intake` (write) persists the source text as revision 0.
- [ ] **Task 3 — Critique + rewrite.** Tool `job-search.resume.critique` (write): one
      `generateStructured` call, `tierHint: "reasoning"`, schema
      `{ critique[], revisions[], strengths[], gaps[] }` where **every** `strengths[]` and
      `revisions[]` entry carries an `evidence` field quoting the resume/vault text it came
      from. **Truth guard is structural, not just prompted:** a post-pass drops any entry
      whose evidence string does not appear in the supplied source material (layered-guard
      pattern — sanitize/cap/unknown-key-drop on everything persisted from the model).
      Result stored as a **review artifact** in `job-search.resume`.
- [ ] **Task 4 — Review artifact UI** (spec design §3). Inline card in the chat flow:
      critique (sans, grouped by section); proposed revisions as quiet tracked changes
      (forest add / struck ink-3 removal); surfaced strengths on gold decorative straps, each
      citing its evidence; gaps as amber "go-learn" chips. **Approve / "revise this" are chat
      actions** — clicking seeds the chat input, no form fields.
- [ ] **Task 5 — Apply path.** Queue `job-search.resume-revise` (retryLimit 1, manual
      run-now, **identifier-only params**: `revisionId`) — the web Approve click posts it
      (click = confirmation; free-text revision requests stay assistant-only, since free text
      in a job payload would violate metadata-only). Handler appends the approved revision as
      the new `current`. Manifest v2 adds the queue + `resume.intake`/`resume.critique`
      tools.

### Invariants touched

- **Metadata-only job payloads** — `resume-revise` carries `{ actorUserId, jobKind,
revisionId, idempotencyKey }` only; never resume text.
- **Secrets never escape / LLM-field guards** — model-derived fields pass the four-layer
  persistence guard; resume content never in logs or payloads.
- **Private by default** — resume + revisions owner-scoped KV.
- **Provider-agnostic AI** — capability via `tierHint` only.

### Tests / verification

- [ ] Domain unit: revision append/versioning; diff assembly; the truth-guard post-pass
      (fabricated entry without matching evidence is dropped; real evidence passes).
- [ ] Worker fixture (`tests/unit/external-module-job-search-*.test.ts`): critique over faked
      `ctx.ai` (fabrication in the fake output → dropped; strengths carry evidence);
      intake from a faked attachment port; revise-apply happy path + unknown-revision error.
- [ ] Integration: intake → critique → approve → `current` advanced, revision history
      intact, all rows owner-scoped (second seeded user sees nothing).
- [ ] **e2e #1000-harness:** paste a seeded resume in chat → review artifact renders inline
      (critique + tracked changes + gold strength strap) → click Approve → confirmation turn
      lands.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB).

### ⛔ UAT GATE JS-02 (Ben) — sign-off required before JS-03

- [ ] Over LAN, in Job Search chat: **upload your real resume PDF** → the assistant
      acknowledges it and produces a review artifact inline.
- [ ] The artifact shows: a critique grouped by section; before/after tracked changes; at
      least one **surfaced strength on a gold strap citing where it came from**; any real
      gaps as amber chips.
- [ ] Spot-check honesty: **nothing invented** — every claim traces to something actually in
      the resume.
- [ ] Click **"revise this"** on one item → the chat input is seeded → send → a new proposal
      returns.
- [ ] Click **Approve** → the assistant confirms; ask "show my current resume" → the approved
      version comes back.
- [ ] Paste-intake path: paste a short resume as text in a fresh search → critique also
      works.

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-03 — Search-profile builder (shared profile object)

**Goal:** a soft-scripted interview yields an approved search profile that is one shared data
object, refinable from the job-search chat or general Jarvis — without transcript bleed.

> **Grounded against `origin/main` @ `6f82554e`** (JS-00/01/02 landed). Refined after a JS-03
> adversarial plan review (Fable, 2026-07-23): 1 blocker + 4 major folded in below.
> `job-search.profiles` is a **KV namespace** (shipped manifest `storage[]`, user scope,
> `NS.profiles`) — **not a table**: no migration in this phase.

### Pinned decisions (from the JS-03 review — resolve before build, do not re-litigate mid-flight)

- **Confirm-per-write is accepted (not frictionless).** `job-search.profile.update` is write-risk
  and external-module tools **cannot** declare `actionFamilyId`/`executionPolicy` (the
  `createExternalToolManifests` bridge drops them; gateway `policy.ts` then resolves write-risk to
  `confirm`). So **every** `profile.update` raises one Approve/Deny card, in both surfaces. This is
  the **same consent pattern JS-02 shipped** for `resume.intake`/`critique` — **the card IS the
  user's consent.** We do NOT plumb action families through the external bridge this phase (net-new
  host surface, out of scope). Interview guidance, e2e, and UAT all account for the card.
- **Addressing & creation.** `profile.update` input = `{ profileId?, …fields }`. Omitted `profileId`
  targets the user's sole `building` profile; if none exists it **creates one** (server-minted
  uuid, `status: "building"`); if several match, it returns a typed `ambiguous_profile` error
  listing `{ id, title }`. Single building profile is the common case; ambiguity surfaces a
  pick-list (the drawer path has no transcript to disambiguate from, so this rule is load-bearing).
- **Merge semantics.** Shallow merge per top-level key; **array fields replace** (not append);
  explicit `null` clears a nullable field.
- **Approval.** Approval = a user-consented `profile.update { status: "active" }`, valid **only when
  `isApproved()` is true** (typed error otherwise); the Approve/Deny card is the consent act.
  `isApproved()` requires `titles.length ≥ 1`, `compFloor ≠ null`, `location ≠ null`, **and** a
  current résumé present — a **cross-object read** of the `job-search.resume` KV namespace (JS-02).
  `industries` / `keywords` / `dealBreakers` are optional (dealBreakers may legitimately be empty).
- **Schema caps (pinned).** `compFloor` = `{ amount: positive int ≤ 10_000_000, currency: 3-letter
uppercase, period ∈ {"year","month","hour"} }`. `location` = `{ mode ∈
{"remote","hybrid","onsite"}, places: string[] ≤ 10 }`. List caps: `titles ≤ 10`, `industries ≤
10`, `keywords ≤ 25`, `dealBreakers ≤ 15`; each free-text string ≤ 120 chars. `status ∈
{"building","active","paused"}` (no separate "approved" state — approval flips to `active`).

### Scope / tasks

- [ ] **Task 1 — Domain: profile schema + validation.** `src/domain/profile.ts` implementing the
      **pinned schema above** with pure validators (per-field enums/caps, unknown-key rejection), an
      `isApproved()` rule (the required set above), and a `completeness()` readout (per-field
      filled/empty) feeding the progress rail. Multiple profiles per user (one per search) in the
      `job-search.profiles` KV namespace. `completeness()`/`isApproved()` **read the
      `job-search.resume` namespace** for the current-résumé signal (cross-object dependency — wire
      it here).
- [ ] **Task 2 — Tools (manifest v3).** Add `job-search.profile.update` (write; **the shared seam**
      — callable from general Jarvis too, so the drawer can "bump my comp floor to 140k" without
      ever seeing the job-search transcript) with the pinned strict input schema (unknown keys
      rejected; per-field validation + create/addressing/merge in the handler). Write its
      **description for ToolSearch discoverability** ("update your job-search profile: comp floor,
      target titles, location, deal-breakers …") — the drawer gets no job-search guidance seed, so
      the model finds the tool by description. Extend `job-search.profiles.list` to return
      `completeness`, `status`, **and the eyebrow fields** `industries` / `location` / `compFloor`;
      extend `ProfileCard` (`landing-model.ts`) accordingly.
- [ ] **Task 3 — Soft-scripted interview.** Extend the surface seed guidance so the assistant knows
      the unfilled fields, steers toward them (tangent-friendly), writes via `profile.update` as
      facts land, and proposes approval when `isApproved()`. **Prefer the purpose-built seed hook:**
      declare `job-search.onboarding.get-state` — `packages/chat/src/module-onboarding-seed.ts`
      looks up exactly `${moduleId}.onboarding.get-state` to inject module state into the surface
      seed — so the assistant has profile state at turn 1 instead of relying on a first-turn
      `profiles.list` call. No wizard component — the script lives in guidance + tools.
- [ ] **Task 4 — Progress rail (real).** Rework JS-01's shipped **`ProfileAside`** (`PROFILE_FIELDS`
      in `onboarding-model.ts`, currently 8 fields) into the status readout `Resume ✓ · Titles ✓ ·
Comp — · Location — · Deal-breakers —` wired to `completeness()`; **drop `experience`** (no
      home in the schema) and **fold `search-status` into the profile `status`**. Style with
      `--font-sans` + `tabular-nums` (matches shipped `.jsn-eyebrow`; **not mono** — retired
      2026-07-08), status readout, not clickable. Landing profile cards show real title + eyebrow
      (`industry · location · comp floor`, `--font-sans` + `tabular-nums`) + status from the store.

### Invariants touched

- **Private by default** — profiles owner-only; the _shared_ in "shared object" means shared across
  the user's own surfaces, never cross-user.
- **Module isolation** — general-Jarvis access is exclusively via the declared assistant tool
  (`permissionId` gated), never via module internals. (Transcript isolation is **structural** —
  JS-00 surface-keyed sessions — and is not re-proven in this phase.)
- **Metadata-only payloads** — no jobs in this phase.
- **LLM-field guards** — `profile.update` inputs originate from a model turn: strict schema +
  unknown-key rejection + range caps in the handler; the confirm card is the consent gate.

### Tests / verification

- [ ] Domain unit: schema validation (comp-floor shape/enums, location mode + places cap, list
      caps, string caps); `isApproved()` required-set (incl. the résumé-present cross-read);
      `completeness()` readout.
- [ ] Worker fixture: `profile.update` **create-on-first-write**; addressing (targets the sole
      `building` profile when `profileId` omitted; `ambiguous_profile` error with two profiles);
      **merge semantics** (partial update never clobbers other fields; arrays replace; `null`
      clears); invalid input rejected with typed error; `profiles.list` returns
      completeness/status/eyebrow fields.
- [ ] Integration: create + update from the worker runtime path; owner-only (second user blind);
      **shared-data proof** — a second chat-session-id through the same gateway path lands in the
      same KV profile the job-search page reads (this proves shared KV; **transcript isolation is
      JS-00's anti-bleed test**, not re-proven here).
- [ ] **e2e #1000-harness:** one natural interview turn as the smoke check; then reach an approved
      profile via the **minimum deterministic turns**, **clicking Approve on each `profile.update`
      card**; progress rail ticks as fields fill; landing shows the profile card with eyebrow.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB).

### ⛔ UAT GATE JS-03 (Ben) — sign-off required before JS-04

- [ ] Over LAN, in Job Search chat: answer the interview naturally (titles, industry, comp floor,
      location, deal-breakers) — including at least one tangent; the assistant follows it and still
      steers back. **Approve the profile-update card(s)** as facts land.
- [ ] Watch the **progress rail** fill as facts land; when complete the assistant proposes approval
      — approve it (approval flips `status` → `active` via a consented update).
- [ ] Back on the landing: the profile card shows the search title + eyebrow
      (`industry · location · comp floor`, `--font-sans` + `tabular-nums`).
- [ ] In the **drawer**: say "raise my job-search comp floor to $X" → an Approve/Deny card appears;
      approve it → it succeeds.
- [ ] Re-open Job Search → the profile shows the new floor **and** the drawer never saw the
      job-search conversation itself (ask it — it shouldn't know the interview details beyond the
      profile data).

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-04 — Source adapters + scraping infra

**Goal:** a profile run pulls real postings from one big board and one user-named URL, safely
(host-pinned fetch, rate-limited, postings defanged as untrusted input).

### Scope / tasks

- [ ] **Task 1 — Fetch port + defang.** Port finance's `ctx.fetch` adapter shape
      (scrubbed-by-construction error messages). `src/domain/defang.ts`: strip/neutralize
      scraped HTML→text before any prompt (pattern reference:
      `packages/chat/src/live/prompt-safety.ts`) — postings can never carry tool-call syntax
      or instruction framing into a prompt un-neutralized. Per-source rate limiter (KV
      `lastFetchAt` per source + in-run spacing) with polite defaults.
- [ ] **Task 2 — Generic URL/RSS extractor.** User names a source in chat → tool
      `job-search.source.add` (write) stores it in `job-search.sources`; the run fetches
      page/RSS, defangs, and one `generateStructured` (`tierHint: "economy"`) extracts
      `{ title, company, location, url, description, postedAt }[]` — capped counts/lengths,
      unknown keys dropped (LLM-field guards). This _is_ the user-added-source mechanism —
      no management UI this epic.
- [ ] **Task 3 — Big-board adapter(s).** One or two high-volume boards (Indeed/LinkedIn
      class): our own TS fetchers, paginated search from the profile's titles/keywords/
      location, resilient parsers with recorded-HTML fixtures. **Outbound queries are built
      from explicit profile fields only — never resume text, never vault content** (assert in
      tests). Manifest v4 declares their `fetchHosts`.
- [ ] **Task 4 — ⚑ Resolve the user-host admission fork (spec open question — design-fork
      discipline: read both paths in the platform code before ranking).** `ctx.fetch` pins to
      manifest `fetchHosts`. Options: **(a)** instance-admin dynamic allowlist the host
      consults in its fetch policy (admin config = configuration power, fits the invariant);
      **(b)** module-scoped broadened fetch policy with SSRF guard still active. **Default-safe
      pick is (a)**; if the platform's pinning is strictly manifest-static, (a) becomes a
      small host-side change (admin-gated allowlist table/KV consulted by the module-fetch
      policy, https-only + SSRF guard + redirect re-validation unchanged). Whichever lands,
      user-source adds outside the allowlist fail with a clear "ask your admin to allow
      host X" message — never a silent bypass.
- [ ] **Task 5 — Discover-run skeleton.** Queue `job-search.discover-run` (retryLimit 3,
      manual run-now; params `{ profileId }` identifier-only): run all of a profile's
      sources with **per-source error isolation** (one source fails → amber-noted, run
      continues), raw postings into `job-search.candidates` (short TTL, capped per run).
      Tool `job-search.discover.run-now` shares the handler. No matching yet — JS-05.

### Invariants touched

- **Secrets never escape / vault never outbound** — outbound requests contain only explicit
  profile search terms; no resume, no vault, no credentials (none exist yet).
- **Metadata-only payloads** — `discover-run` carries `{ actorUserId, jobKind, profileId,
idempotencyKey }`; postings never ride pg-boss.
- **No admin private-data bypass** — the host-admission allowlist (fork (a)) is instance
  _configuration_; it grants no data access.
- **Postings are untrusted** — defang before every prompt; extraction output passes the
  layered persistence guards.

### Tests / verification

- [ ] Domain unit: defang (tool-syntax and instruction-injection fixtures neutralized); rate
      limiter; extraction output caps.
- [ ] Worker fixture: generic extractor over recorded HTML/RSS fixtures + faked `ctx.ai`;
      big-board pagination over recorded fixtures; **query-purity test** — capture every
      faked `ctx.fetch` request and assert neither resume nor planted vault strings appear
      anywhere in URL/body; per-source error isolation; injection fixture never influences a
      later prompt un-defanged.
- [ ] Integration: source add + discover-run through the real worker runtime, all fetches
      faked at the `ctx.fetch` seam (recorded fixtures — **no live scraping in CI**);
      candidates owner-scoped; host-admission denial path.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB). (UI unchanged this phase — no new e2e;
      the JS-06 harness covers the full pipeline.)

### ⛔ UAT GATE JS-04 (Ben) — sign-off required before JS-05

- [ ] Over LAN, in Job Search chat: **"watch this board: <a real URL Ben picks>"** → the
      assistant confirms the source was added (or, if the host isn't admitted, shows the
      clear admin-allowlist message — exercise whichever path the fork produced, then admit
      the host and retry).
- [ ] Say **"run my search now"** → the run executes against the live big board + the added
      URL; the assistant reports how many postings each source yielded.
- [ ] At least one source returns **real postings** (titles/companies visible when asked).
- [ ] Break one source on purpose (add a bogus URL, run again) → the run still completes and
      reports the one failure — no empty-screen collapse.
- [ ] Confirm politeness: back-to-back "run now" doesn't hammer — the second run visibly
      rate-limits or reuses.

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-05 — Two-stage match engine

**Goal:** candidate postings become ranked matches with grounded "why this fits _you_"
reasoning — vault-enriched internally, vault provably never leaving the box.

### Scope / tasks

- [ ] **Task 1 — Stage 1: hard filters (pure).** `src/domain/filter.ts`: comp floor,
      location/remote mode, deal-breaker vetoes, title/keyword screens over
      `job-search.candidates`. Deterministic, unit-tested exhaustively.
- [ ] **Task 2 — ⚑ Stage 1 ranking seam (grounded fork — resolve before coding).** The spec
      calls for embedding similarity via the runtime embedding provider, but the module
      worker AI port exposes **only** `generateStructured`
      (`packages/module-sdk/src/worker.ts:39`) — no embed RPC. Options: **(a)** add a
      provider-agnostic `ai.embed` bridge to the module worker context (host-side, mirrors
      the `generateStructured` RPC shape, resolves the runtime embedding provider — M-A1
      seams; returns vectors only, no provider/model details); **(b)** rank the post-filter
      remainder with a cheap batched `generateStructured` scoring pass
      (`tierHint: "economy"`). Read the host ai-bridge code first (design-fork discipline);
      (a) is preferred if the bridge is genuinely small, (b) is the no-platform-change
      fallback. Either way: hundreds → top-N shortlist into `job-search.candidates`.
- [ ] **Task 3 — ⚑ Vault recall seam (grounded fork — resolve before coding).** Stage 2
      needs owner-scoped vault recall; the worker context has no recall port. Options:
      **(a)** a host-mediated, bounded `recall` RPC on the module worker context (owner-scoped
      via the existing recall service, token-capped, module-id-tagged for audit); **(b)**
      phase-1 fallback: enrich from the resume + profile only and note vault enrichment as a
      platform follow-up. Verify the recall service seam before promising (a); the
      per-profile `vaultEnabled` toggle (default **on**) gates whichever lands.
- [ ] **Task 4 — Stage 2: career-reasoning.** Per shortlisted posting: one
      `generateStructured` (`tierHint: "reasoning"`) over **defanged** posting + resume +
      profile + recall context, producing the spec's match shape (fitScore, whyItFits,
      gaps[], dealBreakerHit?, legitimacy ok|suspect, legitimacyReason?) — schema-capped,
      layered persistence guards, deal-breaker veto enforced structurally (a hit excludes
      the match regardless of
      score). Durable results in `job-search.matches`. Legitimacy heuristics (repost count,
      stale postedAt) computed in domain code, flagged amber never red.
- [ ] **Task 5 — Wire into discover-run.** The JS-04 run now continues: filter → rank →
      reason → persist matches; AI failure on one posting skips it, never aborts the run.
      Tool `job-search.matches.query` (read) for chat + landing. Match cards (spec design
      §4) render inline in chat: serif header, fit badge (forest fill, number secondary),
      "why this fits you", gap chips, legitimacy amber chip, provenance chip (source +
      scraped-at), **Apply** (new tab, we never submit) + feedback pair (wired live in
      JS-06).

### Invariants touched

- **Vault never outbound** — recall context flows only into the internal Stage-2 prompt via
  the user's own configured model; the query-purity test from JS-04 re-asserts with recall
  active.
- **Provider-agnostic AI** — both stages are capability requests; the embed bridge (if
  built) resolves the runtime embedding provider, never a named model.
- **Postings are untrusted** — Stage-2 prompts consume only defanged text; match fields pass
  the four-layer LLM-persistence guards.
- **Metadata-only payloads** — unchanged; match content never rides pg-boss.

### Tests / verification

- [ ] Domain unit: every hard filter + veto; legitimacy heuristics; score ordering.
- [ ] Worker fixture: full pipeline over faked fetch/ai — shortlist size bounds; structural
      veto (high score + deal-breaker hit → excluded); one posting's AI failure skips not
      aborts; **vault-purity** — planted recall strings appear in zero captured outbound
      fetches; injection fixture in a posting cannot alter the structured output schema.
- [ ] Integration: seeded candidates → ranked matches owner-scoped; `matches.query` through
      the runtime; `vaultEnabled: false` provably excludes recall context (captured prompt).
- [ ] **e2e #1000-harness:** with seeded candidates + faked-at-seam AI, drive "run my
      search" → match cards render inline (fit badge, why-it-fits, provenance, Apply
      opens a new tab).
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB).

### ⛔ UAT GATE JS-05 (Ben) — sign-off required before JS-06

- [ ] Over LAN: with your real resume + approved profile, say **"run my search and show me
      what fits"** → ranked match cards appear inline in the chat.
- [ ] Read the **"why this fits you"** lines on the top matches: they reference _you_ (your
      background/interests), not keyword echo. At least one reason should draw on something
      that isn't literally in the profile fields (vault/resume enrichment — if the vault fork
      landed as (a)).
- [ ] A posting violating a deal-breaker is **absent** (add a deal-breaker that matches a
      known posting, re-run, confirm it's gone).
- [ ] At least one card shows honest **gap chips**; any sketchy posting carries the amber
      legitimacy chip, not red.
- [ ] Click **Apply** on one card → the source posting opens in a new tab; nothing was
      submitted on your behalf.
- [ ] Toggle **vault off** for the profile, re-run → results still come back (reasons lean on
      resume/profile only).

**The next phase does not start until Ben signs off on this gate.**

---

## Phase JS-06 — Standing monitor + surfacing + feedback

**Goal:** the search runs itself daily; returning users see "N new since Tuesday" and the
deduped match set; "not this / more like this" sharpens the next run.

### Scope / tasks

- [ ] **Task 1 — Domain: dedupe + new-since state machine.** Normalized key
      `hash(source + externalId|url + title + company)`; `job-search.meta` per profile holds
      seen-hashes + `newSince`; pure state machine (run merges, view resets) unit-tested.
- [ ] **Task 2 — Schedule.** Manifest v5: user-scoped schedule `job-search.discover-sweep`,
      cron **`23 7 * * *`** (daily, off-minute per fleet guidance), posting onto
      `job-search.discover-run` per **active** profile (finance's schedule-onto-queue
      precedent — the reconciler registers per-user schedules; verify the per-profile fan-out
      shape at execution: one sweep job that enqueues per-profile runs, since schedules
      can't parameterize per profile).
- [ ] **Task 3 — Feedback loop.** Tool `job-search.match.feedback` (write; `matchId`,
      `verdict: "not-this" | "more-like-this"`) → `job-search.feedback`. Next run folds it
      in: not-this exemplars become negative signals in Stage-1 ranking + a Stage-2 prompt
      block; more-like-this become positive exemplars. Domain-pure folding, unit-tested.
- [ ] **Task 4 — Surfacing.** Landing cards get the live gold **"N new since Tuesday"**
      strap + run-state dot (forest fresh / ink-3 idle / amber source error); a
      re-opened job-search session is seeded with the new-since count so the assistant
      re-opens with it; match cards on the landing/panel are the deduped durable set with
      Apply + the now-live feedback pair. Viewing resets `newSince`.
- [ ] **Task 5 — Degradation.** A profile with a failed source still shows its last matches
      with the amber "one source failed" note — never an empty screen (authored states).

### Invariants touched

- **Metadata-only payloads** — sweep + run payloads stay `{ actorUserId, jobKind, profileId,
idempotencyKey }`.
- **Private by default** — meta/feedback owner-scoped; the schedule is per-user.
- **No stale concepts** — any scaffolding placeholder from JS-01…05 (rail placeholder,
  unwired feedback buttons) is removed or wired in this pass.

### Tests / verification

- [ ] Domain unit: dedupe key normalization (url vs externalId), seen-hash merge, new-since
      reset, feedback folding into rank inputs.
- [ ] Worker fixture: sweep fan-out per active profile; second identical run yields zero new;
      feedback changes the next run's shortlist; source-failure degradation.
- [ ] Integration: schedule reconciliation registers the sweep; run → meta advances;
      owner-only across two seeded users.
- [ ] **e2e #1000-harness — the epic exit test:** seeded dev instance, full flow: resume →
      profile → seeded-source run → matches surface → landing shows "N new" strap → feedback
      click → re-run reflects it. This spec is the epic's exit criterion.
- [ ] `pnpm verify:foundation` exit 0 (fresh gate DB).

### ⛔ UAT GATE JS-06 (Ben) — epic exit; sign-off closes the epic

- [ ] Over LAN, landing: your profile card shows a **gold "N new since …" strap** after a
      run with fresh postings, and the run-state dot reads right.
- [ ] Open the search → the assistant re-opens with "N new since …" and shows the new
      matches.
- [ ] Click **"Not this"** on a match → it's acknowledged; **"More like this"** on another →
      acknowledged; run again ("run my search now") → the not-this posting (and its close
      twins) don't return; results lean toward the more-like-this shape.
- [ ] Re-run with nothing new at the sources → **no duplicate cards**, "0 new" honesty.
- [ ] Leave the daily schedule armed overnight → next day the strap count moved on its own
      (or the worker log shows the 07:23 sweep ran).
- [ ] Kill one source (bogus URL) → landing still shows last matches + the amber "one source
      failed" note.

**Ben's sign-off here closes the epic.**

---

## Fast-follow — Email notifications (post-epic, own task issue)

Brief by design; **not** part of this epic's exit bar. After JS-06 ships: notify on new
strong matches via the host's email seam if one exists (verify — if none, this fast-follow
inherits a small platform task first). Per-user opt-in in `job-search.settings`; email body
carries match titles + links only (no resume/vault content — secrets/private-content posture
applies to outbound mail); daily digest not per-match spam. Gets its own task issue and a
short spec update before build.

---

## Execution-time verifications (flagged inline above, collected)

| Phase | Verify before coding                                                                  |
| ----- | ------------------------------------------------------------------------------------- |
| JS-00 | cli-runner mux session-name derivation survives the composite key; seed route shape   |
| JS-01 | reconcile-job scope (per-user vs instance) for the clean-slate reset; run-now routes  |
| JS-02 | module worker attachment port shape (extracted-text read)                             |
| JS-04 | **fork:** user-host admission — allowlist seam vs manifest-static pinning             |
| JS-05 | **fork:** `ai.embed` bridge vs structured-scoring fallback; recall RPC vs resume-only |
| JS-06 | per-profile sweep fan-out shape under the schedule reconciler                         |

Each ⚑ fork follows design-fork discipline: read both paths' actual code with equal depth
before ranking; adversarial second opinion (Codex review preferred) for the two JS-05
platform-touch forks.
