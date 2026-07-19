# Job Search — embedded assistant onboarding + Park Press module screens

**Status:** APPROVED 2026-07-19 under Ben's delegation ("You can approve, I may be away").
Adversarial second pass: Codex review returned APPROVE-WITH-CHANGES (1 blocker on the
sanitization mechanism, 3 major precision items); all findings are incorporated below.
**Date:** 2026-07-19
**Owner:** Ben (coordinator executing under delegation)
**GitHub:** #TBD (feature issue; per-lane task issues "Part of #TBD")
**Grounded on:** `origin/main` @ `01fd7d41` (fetched 2026-07-19)
**Design source:** `docs/superpowers/design/job-search-onboarding/` (Park Press handoff, claude.ai
design project `0501fab4`; `JobsOnboarding.jsx.txt` is the primary artifact — copy is final)

---

## Goal

Replace the Job Search external module's web UI with the approved Park Press design: a
**conversational first-run onboarding led by Jarvis inside the app content area** (resume upload →
critique → profile → sources → monitoring on), plus four redesigned screens (Overview, Matches,
Monitors, Profile). The onboarding embeds a **real assistant conversation** — a core-seeded prompt,
real confirm-gated tool writes, real file upload — behind the designed, scripted flow.

Ben's hard requirements:

1. Seed a prompt so the user is chatting with the real Jarvis during onboarding.
2. **File uploading works 100%** — the resume dropzone is a real PDF/DOCX upload, verified
   end-to-end on a real instance (text-equivalence gate, not just "no error").
3. **The design doc is king** — full UI replacement, verbatim copy, no legacy screens preserved.
   (Design-system rules, module contract, backend tools, and hard invariants still stand.)

## Current state (reuse, don't rebuild)

- **Job Search backend (JS-01→09, issues #930–#938)**: six-checkpoint flow
  (`external-modules/job-search/src/worker/handlers/flow.ts` — `STEP_ORDER`, `deriveStep`:
  `resume_intake → resume_critique → resume_approval → profile → sources_schedule →
review_enable`), truth guard on critique revisions, assistant tools
  (`job-search.onboarding.get-state`, `profile.get/save-draft/approve`,
  `resume.get/save-draft/approve`, `monitor.list/save`, `sources.list`), all writes confirm-gated
  through `AssistantToolGateway`. Module web has **read-only** tool access (`src/web/api.ts`).
- **Chat seeding seam**: `ChatSessionManager.seedContext()`
  (`packages/chat/src/live/chat-session-manager.ts:384`; `buildEngineText` call at `:421`) +
  precedent route `POST /api/chat/evening-interview` (`packages/chat/src/live-routes.ts:328-367`)
  using `<trusted_instructions>` + `<external_source>` framing. Note the precedent's actual
  sanitization: `buildEveningInterviewSeed` calls only a **local, unexported**
  `sanitizeExternalData` (blanket `&`/`<`/`>` escaping in `live-routes.ts`) — it does **not**
  call `neutralizeSeedFraming`, and `neutralizeSeedFraming` (`live/prompt-safety.ts:26`)
  rewrites only a fixed tag list that today excludes `trusted_instructions`/`external_source`.
  This spec mandates fixing that seam (see Seed route section) before reusing it.
- **Chat attachments (#1133/#1154)**: `POST /api/chat/attachments`
  (`packages/chat/src/attachments-routes.ts`), `ChatAttachmentsService`
  (`attachments-service.ts`) — vault blobs, mime whitelist (images/PDF/text, **no DOCX**),
  magic-byte sniffing, 10 MB doc cap, server-side PDF text extraction feeding an `<attachments>`
  manifest into engine text, `ATTACHMENT_TEXT_CAP_CHARS = 15000`. Web client:
  `apps/web/src/client.ts` `uploadChatAttachment`.
- **Prod attachment status**: #1170/#1171 (attachment-turn 503) fixed and prod-verified
  (PRs #1172/#1175). #1179 (prod bundle missing `pdf.worker.mjs`) open — **PR #1180 green**;
  merging it is a hard prerequisite for the upload UAT gate (Lane 0a).
- **Module web contract**: `ExternalWebContributionProps { hostActions }` (#916) bound per-module
  at `ExternalModuleMount` (`apps/web/src/app.tsx`); frozen `__JARVIS_MODULE_RUNTIME__`
  (`apps/web/src/external-modules/loader.ts`).

## Superseded prior decisions (ratified by this spec)

This spec explicitly supersedes three previously approved non-goals. Everything not listed here
stays in force.

1. **JS-06 (“No … embedded chat”)** — superseded. The onboarding embeds a core-owned assistant
   surface inside the module screen. The module still never talks to the engine directly; it goes
   through the new core `AssistantSurface` handle only.
2. **#916 (“No module-authored system prompt”)** — **partially** superseded. Modules may now ship
   declarative onboarding **guidance data** in their manifest, which core defangs with **both**
   layers defined in the Seed route section (blanket angle-bracket escaping **and** an expanded
   reserved-tag neutralizer) before embedding it inside a **core-authored** `<external_source>`
   block. Modules still cannot author trusted instructions; the `<trusted_instructions>` frame is
   core code, not module data.
3. **JS-03 (“No PDF/DOCX parsing” / paste-only resume intake)** — superseded. Resume intake is a
   real file upload through the existing chat-attachment pipeline (PDF extraction exists; DOCX
   extraction added by this spec). Paste remains the fallback.

**Explicitly NOT superseded:** module-web read-only tool access; confirm-gated writes via
`AssistantToolGateway`; the resume truth guard; metadata-only job payloads; provider-agnostic AI;
DataContextDb-only data access; module isolation (declared public APIs only).

## Architecture: UI-led script, model as governed executor

The module owns the conversation script and phase machine; the seeded assistant session is the
execution + free-text channel — not the narrator.

- **Jarvis flow bubbles are module-rendered, verbatim from the prototype.** Deterministic pacing,
  typing indicator, pixel-faithful CritiqueCard and Summary. Live generation cannot guarantee
  final copy; scripted rows can.
- **Controls are module-local components** (ChipToggle, MultiControl, SourcesControl, dropzone,
  AddInput) driven by a local `phase` cursor **rehydrated from durable state** on mount
  (`onboarding.get-state` + `profile.get` + `resume.get` + `monitor.list`). Worker
  `deriveStep`/`STEP_ORDER` remains the single durable truth; the five profile sub-steps
  (titles/comp/workmode/locations/dealbreakers) are local sub-steps within the `profile`
  checkpoint. Leaving mid-flow and returning resumes at the first incomplete checkpoint with the
  ProfileAside refilled.
- **Chip submissions become real chat turns**: `assistantSurface.submitTurn({ text,
controlContext })`. `text` is the design's clean user-bubble copy (persisted + rendered);
  `controlContext` folds into engine-bound text only (never persisted — same seam as the
  `<attachments>` manifest). The seeded model executes the mapped tools with values **verbatim**
  and replies in ≤1 short sentence. Writes surface as standard `action_request` Approve/Deny
  cards **inline in the embedded transcript** — the confirm cards are the governor moments;
  nothing bypasses the gateway.
- **Write batching (~6–8 approvals total):** profile sub-steps buffer locally → one
  `profile.save-draft` + `profile.approve` after dealbreakers. Resume: `save-draft manual` →
  `save-draft critique` → `approve`. Sources: `monitor.save` per enabled board in one combined
  turn.
- **Free text goes to the real model on every step** (seed instructs: answer briefly in voice,
  steer back to the current step). The comp step parses dollar amounts locally first.
- **Phase advance — events trigger, durable state decides.** `action_result` records carry an
  `actionRequestId` and an outcome (`executed`/`denied`/`error`/`allowed`). After submitting a
  step's turn, the module watches for the `action_request` records matching that step's expected
  tool names, remembers their `actionRequestId`s, and treats each matching `action_result` as a
  trigger to re-poll `onboarding.get-state` (+ the relevant `*.get`). **The phase cursor advances
  only when the fresh durable state shows the checkpoint (or sub-step field) actually complete** —
  never merely because _an_ executed result fired. This resolves multi-confirm steps (resume =
  save-draft → critique → approve; profile = save-draft + approve): a denied or errored card
  leaves durable state short, the poll shows it, and the module keeps the current control active
  with a scripted retry row. Unmatched action activity (e.g. from an off-script free-text turn)
  never advances the phase for the same reason.

Rejected alternatives: pure model narration (copy cannot be verbatim; two narrators) and
model-driven structured UI directives (new engine protocol, unreliable rendering, maximal core
surface).

### Resume upload (works 100%)

Reuses #1133 end to end — no parallel upload path.

1. Dropzone → `assistantSurface.uploadAttachment(file)` → existing `POST /api/chat/attachments`.
   Client gate in this control: **5 MB + PDF/DOCX only** (keeps the design copy true; server cap
   stays 10 MB).
2. Module submits a turn with `attachmentIds: [id]` + `controlContext: { step: "resume_intake" }`.
   User bubble renders filename + FileText glyph (the prototype's 📄 emoji is a copy delta — the
   design system bans emoji).
3. **Deterministic import — no LLM round-trip of resume text.** The seeded model calls
   `job-search.resume.import-attachment { attachmentId }` (confirm card). Server-side, the tool
   reads the already-extracted attachment text through a new actor-scoped host port
   (`attachments.readText`, provisioned to the module worker via the existing gateway port seam;
   the attachment must belong to the acting user) and writes it **byte-identical** as revision/0
   (the `mode: "manual"` path internally). Then `resume.save-draft { mode: "critique" }` (truth
   guard applies) → module renders CritiqueCard from `resume.get` → confirm → `resume.approve`.
   Adversarial-review outcome: the earlier model-shuttle design (`chat.readAttachment` → paste
   the text into `save-draft`) was **rejected as the shipped mechanism** — LLM tool-call
   arguments silently truncating or paraphrasing multi-thousand-char strings is a known failure
   mode, and "uploading works 100%" is a hard requirement. The model shuttle remains only for
   the paste fallback (user pastes text into the fallback textarea).
4. The UAT text-equivalence check (Verification below) is the end-to-end proof of the
   deterministic path, not the mechanism's only safety net.
5. The 15k-char extraction cap comfortably covers resumes (~4–6k chars typical). Extraction
   failure → scripted retry bubble, dropzone re-armed, paste textarea fallback.
6. **DOCX extraction (net-new, Lane B):** `mammoth.extractRawText` in `attachments-service.ts`;
   whitelist `application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
   `PK\x03\x04` sniff **plus** a `word/document.xml` zip-entry check (rejects xlsx/pptx renamed
   to .docx); failure note mirrors the PDF one.

## AssistantSurface contract (module web contract v1.1, additive)

Core-owned, at `apps/web/src/chat/assistant-surface/` (reuses MarkdownMessage,
ActionRequestCard, the attachment client, and the shell-lifted `useChatStream` records —
`apps/web/src/shell/app-shell.tsx:117`). Exposed as a new member on
`ExternalWebContributionProps`, host-bound to the module id at `ExternalModuleMount` exactly like
`hostActions`. The frozen `__JARVIS_MODULE_RUNTIME__` is untouched.

**Availability:** the host binds the handle **unconditionally for every module** (same as
`hostActions`); the prop is typed optional only so module bundles built against contract v1.1
degrade cleanly on an older host. Per-module gating happens server-side: `seedOnboarding()`
returns the seed route's 404 for modules whose manifest lacks `assistantOnboarding`. If the
handle is absent at runtime (older host), the module fails closed to a minimal jds-card error
state instead of rendering a dead onboarding.

```ts
interface ExternalWebContributionProps {
  readonly hostActions: ExternalModuleHostActionsV1; // existing (#916)
  readonly assistantSurface?: AssistantSurfaceHandleV1; // NEW
}
interface AssistantSurfaceHandleV1 {
  readonly Surface: ComponentType<AssistantSurfaceViewProps>;
  seedOnboarding(): Promise<{ ok: boolean }>; // POST /api/chat/module-onboarding; idempotent; moduleId host-bound
  submitTurn(input: {
    text: string;
    controlContext?: Record<string, unknown>;
    attachmentIds?: readonly string[];
  }): Promise<void>;
  uploadAttachment(file: File): Promise<{ id: string; fileName: string; sizeBytes: number }>;
  subscribeRecords(listener: (records: readonly AssistantRecordV1[]) => void): () => void;
}
interface AssistantSurfaceViewProps {
  readonly localRows?: readonly LocalRow[]; // module-scripted verbatim rows, merged in order
  readonly activeControl?: ReactNodeLike; // rendered as the last conversation row
  readonly recordKinds?: readonly ChatRecordKind[]; // default: user, reply, action_request, action_result, error
  readonly composer?: { placeholder?: string; onSubmitText?: (text: string) => "handled" | "send" };
  readonly typing?: boolean;
}
```

**Session model: shared single per-actor session** (`ChatSessionManager` is actor-keyed; separate
sessions would need engine multi-session — out of scope). Consequence: onboarding turns appear in
drawer history afterwards (accepted; evening-interview precedent). **Drawer suppression:** the
Surface registers presence in a shell context on mount — topbar chat toggle disabled,
`openAssistantWithDraft` reroutes into the embedded composer, an open drawer force-closes;
unmount restores everything.

## Seed route + prompt structure

New `POST /api/chat/module-onboarding` in `packages/chat/src/live-routes.ts`, wired via a runtime
dep like `resolveEveningInterviewSeed` (`packages/chat/src/routes.ts:140`). Gates: module
installed **and** enabled for the actor **and** manifest declares `assistantOnboarding`, else 404;
standard chat-mutation rate limits. Calls `seedContext`; unlike evening-interview there is **no
visible opening turn** (the module scripts the intro verbatim). Returns `{ ok: true }`.

Seed composition (all framing core-authored):

1. `<trusted_instructions>` — the module screen leads this conversation; when a turn carries a
   `<module_control>` block, perform exactly the described tool calls with values **verbatim**
   and reply in ≤1 short sentence; every write is a proposal the user approves per action
   request — never retry a denied action unprompted; an attached resume means
   `job-search.resume.import-attachment { attachmentId }` (never re-type its contents; the
   server imports the text byte-identical) — only user-**pasted** resume text goes through
   `resume.save-draft { mode: "manual" }` verbatim; free text gets a brief in-voice answer
   (first person, calm, lightly dry, sentence case, no emoji) then steer back; never fabricate
   resume or profile content — unsupported claims come back as questions; never enable
   monitoring before sources are confirmed.
2. `<external_source type="module_onboarding" module="job-search">` — wraps the module's
   guidance data, defanged by **two mandatory layers** (adversarial-review blocker fix — the
   evening-interview precedent applies only layer (a), and today's `neutralizeSeedFraming` tag
   list would let a literal `</trusted_instructions>` breakout through):
   (a) **blanket angle-bracket escaping** — promote the currently-local `sanitizeExternalData`
   from `live-routes.ts` into `live/prompt-safety.ts` as a shared export and apply it to all
   module-supplied strings (escaping `&`/`<`/`>` neutralizes _any_ embedded tag);
   (b) **expanded reserved-tag neutralizer** — add `trusted_instructions`, `external_source`,
   `module_control`, and `module_onboarding_state` to `neutralizeSeedFraming`'s tag regex as
   defense-in-depth, and run it too.
   Guidance content: checkpoint order, sub-step→tool/field map (titles/comp/workmode/locations/dealbreakers →
   `profile.save-draft` fields `targetTitles`/`compensation`/`remotePreference`/`locations`/
   `dealbreakers`; sources → `monitor.save` per board with query/timezone/dueTime), board ids,
   voice notes.
3. `<module_onboarding_state>` — core-fetched `get-state` snapshot at seed time.

Supporting changes: the per-turn `<module_control>` block is **server-composed** from a
validated, size-capped, key-allowlisted `controlContext` and appended to engineText after the
`buildEngineText` call (mirrors the `<attachments>` manifest handling in
`packages/chat/src/live/chat-session-manager.ts`); all string values inside `controlContext`
pass through the same shared `sanitizeExternalData` before composition;
`packages/module-registry` validates a new manifest field `assistantOnboarding.guidance`
(length-capped, control-chars rejected).

**Tool surface during onboarding:** unscoped — the model keeps the full job-search toolset plus
core tools (per-turn tool scoping is out of scope). The seed instructs the model to stay on the
current step and not reach for unrelated tools; if the user free-texts something that triggers an
off-script write anyway, it still surfaces as a confirm card, and the phase machine ignores
unmatched action activity (see Phase advance).

## Module UI (full replacement)

- **First-run gate:** `onboarding.get-state.step !== "done"` → `JobsOnboarding` replaces the tab
  set entirely; `done` → tabs Overview / Matches / Monitors / Profile.
- **Onboarding screen** (`external-modules/job-search/src/web/screens/onboarding/`): scripted
  conversation atoms with **verbatim prototype copy**, controls, CritiqueCard, done Summary,
  sticky ProfileAside (n/8), layout grid `1fr 320px; gap 30px`. "Start over" is backed by a new
  S-sized confirm-gated `job-search.onboarding.reset` worker tool (the flow engine is monotonic
  today; the design keeps the button, so the tool is in scope).
- **Four screens** rebuilt from `module/*.jsx.txt`: new `kit.tsx` (Eyebrow, Strap, SectionHead,
  FitBadge, Meta, Confidence) mapped onto jds-\*/tokens; `screens/{overview,matches,monitors,profile}.tsx`.
  Deleted: `starter-drafts.ts`, old `onboarding.tsx`, `opportunities.tsx`. Kept: `runtime.ts`,
  `api.ts`, `store.ts`, `router.ts`, `states.tsx` plumbing. Monitors/sources render from
  `sources.list` — **no Workday row** (no adapter exists).
- **New host jds primitives** (host CSS, colors in `tokens.css` only): `jds-bubble` (asymmetric
  4/12 radii, jarvis/user variants), chip-toggle states extending `.jds-chip`, typing-dot
  keyframes.

### Prototype→app token mapping (normative for Lanes C/D/E)

| Prototype token                                      | App token (tokens.css)                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--oat-lo`                                           | `--surface-2`                                                                                                                                                                                                             |
| `--oat-hi`                                           | `--paper` (as light fg on ink fields)                                                                                                                                                                                     |
| `--surface`, `--line`, `--ink`, `--ink-2`, `--ink-3` | same names — exist in app                                                                                                                                                                                                 |
| `--gold`                                             | `--gold`                                                                                                                                                                                                                  |
| `--gold-hover`                                       | `--gold-strong`                                                                                                                                                                                                           |
| `--accent` (green)                                   | `--accent` (forest)                                                                                                                                                                                                       |
| `--accent-ink` (fg on accent)                        | `--text-on-accent`                                                                                                                                                                                                        |
| `--steel`                                            | `--steel` (fg pair `--steel-soft`/`--steel-ink`)                                                                                                                                                                          |
| `--amber` on `--amber-field`                         | `--amber-strong` on `--amber-soft`                                                                                                                                                                                        |
| `--font-display` (800 uppercase)                     | `--font-display` (app sans; weight/case kept)                                                                                                                                                                             |
| `--font-text`                                        | `--font-sans`                                                                                                                                                                                                             |
| `--font-mono` (monoLabel etc.)                       | **`--font-sans`** + letterspaced uppercase (app eyebrow idiom, e.g. `.cmd-eyebrow`) + `font-variant-numeric: tabular-nums` for numerics. `--font-mono` was retired app-wide 2026-07-08 ("kill mono anywhere in the app"). |

Serif stays nameplate-only (sports masthead exception) — none of these screens use it.

## Lanes

Sequencing: **0a ∥ 0b → [A ∥ B ∥ C ∥ D] → E → F.** All branches from `origin/main`. Builders on
Codex gpt-5.6-sol; independent QA per PR.

- **Lane 0a — #1179 pdf.worker.mjs** (in flight elsewhere, PR #1180 green): merge gate for the
  upload UAT. Not forked here.
- **Lane 0b — this spec + design assets + issues** (docs-only PR).
- **Lane A — core seed route + module_control seam + attachment-read port** (M, 1–2 PRs):
  `packages/chat/src/live-routes.ts`, `packages/chat/src/routes.ts`,
  `packages/chat/src/live/chat-session-manager.ts`, `packages/chat/src/live/prompt-safety.ts`
  (shared `sanitizeExternalData` export + expanded reserved tags), module-registry validation,
  job-search `jarvis.module.json` guidance, and the actor-scoped `attachments.readText` host
  port provisioned to module workers. Integration tests: disabled-module 404, both defang
  layers round-trip (incl. a literal `</trusted_instructions>` breakout attempt), control-block
  cap, persisted text excludes the control block, port denies non-owner attachments.
- **Lane B — DOCX extraction** (S, 1 PR): `attachments-service.ts` + mammoth + .docx fixture +
  tests (incl. renamed-xlsx rejection).
- **Lane C — host AssistantSurface + contract v1.1 + drawer suppression** (L, 2–3 PRs):
  `apps/web/src/chat/assistant-surface/*`, `loader.ts`, `host-actions.ts`, `app.tsx`,
  `app-shell.tsx`, `client.ts`, host CSS. Unit + mocked e2e with a fixture module.
- **Lane D — module web rewrite: root + 4 screens** (L, 3–4 PRs; root skeleton lands FIRST to
  de-conflict Lane E): kit.tsx, screens, deletions, js06 e2e suites rewritten.
- **Lane E — module onboarding UI + worker tools** (L, 2–3 PRs): onboarding screens, phase
  machine + rehydration, root gate swap, and the two new confirm-gated worker tools —
  `onboarding.reset` and `resume.import-attachment` (consumes Lane A's `attachments.readText`
  port). **Dependencies: Lane C types + Surface, Lane A's live seed route + port, and Lane D's
  root skeleton** — E integrates last of the four; the arrow diagram governs, not just the C
  dependency.
- **Lane F — QA/UAT exit gate** (M; after D+E): see Verification.

## Verification

Per lane: lint/typecheck/vitest green (full local gate `pnpm verify:foundation` where the lane
touches backend), mocked Playwright e2e for UI changes, independent QA agent per PR.

Feature exit criteria (all required):

1. Spec approved before any lane codes (this document; delegated approval recorded).
2. Mocked CI e2e green: first-run routing, scripted flow against a mocked stream, drawer
   suppression, chip→turn text mapping, approval-card phase advance, all four screens, a11y pass.
3. **#1000-harness Playwright UAT on a real dev instance:**
   - fresh user → full onboarding with a **real fixture resume PDF** → done Summary → tabs;
   - **upload integrity gate:** `resume.get` revision/0 text diffed against the fixture's known
     text (normalized whitespace) — **repeated with a DOCX fixture**;
   - attachment turn against the real chat engine (requires #1179 merged);
   - resumability: abandon at the comp step, reload, rehydrate at the right sub-step;
   - screenshot set of every screen/state posted for Ben's design review.
4. Bundle hygiene (module ships no own React, imports no core internals); no regression on
   evening-interview seeding or #916 `openAssistant`.

## Deltas & decisions adopted under delegation (parked in AWAITING-BEN)

1. ~6–8 Approve/Deny confirm cards across onboarding, batched — accepted (cards are the governor
   moments; scoped auto-approve rejected).
2. Model-generated one-line acks + free-text replies alongside verbatim scripted bubbles —
   accepted.
3. Free text routed to the real model on every step (prototype canned it) — adopted.
4. Workday board row dropped (no adapter exists) — copy delta.
5. "Start over" backed by a new confirm-gated `onboarding.reset` tool.
6. Resume text imported **server-side, byte-identical** via `resume.import-attachment` +
   actor-scoped `attachments.readText` port (adversarial review rejected the model-shuttle as
   the shipped mechanism; shuttle survives only for the paste fallback). UAT equivalence gate
   retained as end-to-end proof.
7. DOCX added via mammoth; "up to 5 MB" enforced client-side in this control; server cap stays
   10 MB.
8. 📄 emoji → FileText glyph (design system bans emoji).
9. Topbar "SETTING UP · FIRST RUN" subtitle skipped for MVP (no dynamic-subtitle seam; the
   in-content eyebrow carries it).
10. Shared chat session — onboarding turns visible in drawer history afterwards.
11. Prototype token names translated per the mapping table above.
12. **Prototype mono labels rendered in sans** (letterspaced uppercase, tabular-nums) — Ben's
    2026-07-08 "kill mono anywhere in the app" ruling wins over the prototype's `--font-mono`.
