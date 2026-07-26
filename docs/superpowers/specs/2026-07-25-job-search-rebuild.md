# Job Search — Clean-Slate Rebuild Plan

**Status:** Draft for approval
**Date:** 2026-07-25
**Supersedes:** every prior job-search spec, plan, and handoff (see _Retired documents_)
**Decision:** delete the existing job-search module and its history in the tree; rebuild from this plan.

---

## 1. What the user actually asked for

> "I just want this to be a module where users can upload a resume, have a conversation, then see
> job opportunities."

Three things, in order:

1. **Upload a résumé.** It gets read, reviewed, and improved with the user's consent.
2. **Have a conversation.** About what kind of work they want.
3. **See job opportunities.** Real postings, ranked against the profile that conversation produced.

Everything in this plan exists to serve those three sentences. Anything that does not is out of scope
until all three work end to end.

---

## 2. Why we are starting over

Two builds of this module reached UAT. The second one went nineteen rounds of user testing and never
cleared step one — uploading a résumé. That is not bad luck, and it is not a run of unrelated bugs.
It is one architectural mistake expressing itself nineteen different ways.

### 2.1 The core mistake: the user interface was made of language-model output

Almost everything the user was supposed to see was produced by asking a model to say it. The greeting
when the page opened. The acknowledgement that the résumé saved. The note that edits had been
applied. The signal that anything was happening at all. Each of these was implemented as a synthetic
"control turn" — the module surface silently submitted a turn to the host assistant, and the user's
feedback was whatever the model chose to write back.

A model turn is not a mechanism. It is a request. It can:

- **be rejected** — the host serializes turns per session, so a control turn fired while another was
  streaming came back `409` and vanished behind a bare `.catch(() => {})`;
- **duplicate** — the greeting fired on both the open turn and the upload turn, twice in six seconds;
- **arrive late or never** — and there is no difference on screen between "thinking", "failed", and
  "finished but silent";
- **say the wrong thing** — including describing state that had not happened.

The final round is the cleanest possible proof. The user applied their résumé edits. The database
shows the write succeeded: the approved revision was saved and became current at `03:53:58`. The chat
then said **nothing for sixty-six seconds**, until the user broke the silence himself by typing "What
is next?". The system was correct and the user could not tell. His words: _"this happens quite often
where I am out of sync with the chat."_

That is the whole bug. The data was right; the only thing that could tell him was a model turn, and
it did not come.

### 2.2 The second mistake: behaviour was specified in prose instead of code

The module ships a `assistantOnboarding.guidance` string — natural-language instructions injected
into the model's context. On `main` it is **29 words**. On the unmerged JS-03 branch it is **620
words**, and its growth is a perfect log of the UAT rounds:

- "Start every Job Search conversation with: …" (added to fix a missing greeting — became the
  duplicate-greeting bug)
- "never say it is in the drawer" (the model told users to approve in a panel that wasn't on screen)
- "Omit profileId entirely unless the user is juggling…" (the model invented an ID that matched
  nothing, and the handler scored the failure as a success)
- "ask whether to activate and then end your turn without calling…" (the model asked _and_ called in
  the same turn, burning the ~150s confirmation window)
- "call `job-search.resume.critique` and let its result stand" (the model wrote the review as prose
  and the UI card stayed blank)

The manifest's own test now asserts roughly fifteen separate substrings of that prose. When a test
suite is reduced to grepping an English paragraph, the logic is in the wrong place. Each of those
sentences is a **wish**. None of them is enforced. The model complies most of the time, which is
worse than never, because it means the failure is intermittent and only the user finds it.

### 2.3 The third mistake: model-authored text was written into the user's document

The résumé critique returned `before`/`after` pairs through a structured-output schema in which both
fields were declared as a bare `{ "type": "string" }` with **no description**, and the prompt never
defined what they meant. So the model filled `after` with coaching notes — _"Consider replacing
informal phrasing with a factual statement of tenure and scope."_ — and the apply step pasted those
notes into the user's résumé verbatim.

The user's own document was corrupted by a feature meant to improve it. Three separate defences were
missing at once: the schema had no field contract, the prompt had no contract, and nothing validated
the values at the boundary before writing them to storage.

### 2.4 The fourth mistake: the module reached into the host's chat

The surface drove the host assistant by injecting turns into it. That single coupling produced its
own family of failures: chat state bleeding between the module surface and the global drawer (fixed
by re-keying live sessions per `actor:surface`), the turn-lock contention above, a seeded greeting
that instructed the model to call a tool that did not exist, and a general inability to reason about
who was talking to whom.

### 2.5 The fifth mistake: we tested the parts and shipped the whole

Every one of those nineteen rounds began with a green unit suite. Over 3,400 unit tests passed while
the first user-visible step was broken. There was no test that drove the actual flow — open the page,
attach a file, wait, read what came back — against a running instance. One was finally written in
round 18 and **still has never been executed**.

A test suite that cannot fail when step one is broken is not protecting anything.

### 2.6 Cost

Nineteen UAT rounds, each requiring the user to stop and manually test. The overwhelming majority of
fixes were edits to prose in a manifest or a prompt. That is the signature of debugging at the
symptom layer: the same defect keeps returning wearing new clothes because the mechanism that
produces it was never removed.

---

## 3. What we keep

Starting over does not mean the last two months were wasted. These parts worked and their design is
sound. They are being deleted along with everything else, but they are the reference for the rebuild
and should be re-derived deliberately, not reinvented.

- **The external-module contract itself** — packaging, the worker entrypoint, the web entrypoint, the
  manifest validator, install/reconcile. The platform is fine. The module misused it.
- **Résumé ingestion** — attachment upload and text extraction worked from early on.
- **The record/revision model** — an immutable source revision plus derived review and approved
  revisions, with the current pointer. This is a good shape for an editable document with history.
- **The board adapters** — Greenhouse, Lever, Ashby, with fixtures. Straightforward and tested.
- **Surface-scoped chat sessions** — keying live sessions by `actor:surface` was a genuine host bug
  fix and stays in the host regardless of this module.
- **The design-system integration** — the surface looked right. Tokens, type scale, layout.

---

## 4. Architecture for the rebuild

Five rules. Each one closes a specific failure above and is stated so a reviewer can tell whether
code violates it.

### Rule 1 — The surface renders state from the record. The model never reports state.

The module's stored record is the single source of truth. Every visible status — no résumé yet,
uploading, extracting, reviewing, review ready, applying, applied — is a field on that record, and
the surface renders it directly. The user learns what happened by looking at the page, not by waiting
for a sentence.

**Violation looks like:** the only way the user finds out X happened is an assistant message.

### Rule 2 — The module never injects turns into the host chat.

No synthetic control turns, no seeded greetings, no module-authored user messages. Static text is
static text and lives in the surface. If the model has nothing to say, the page is still complete.

**Violation looks like:** the surface calling a chat turn/stream endpoint for any reason other than a
message the user typed.

### Rule 3 — The model has exactly two jobs.

1. Produce the résumé critique as **structured data**.
2. Hold the conversation about what work the user wants, and extract profile fields from it as
   **structured data**.

It does not greet, acknowledge, narrate progress, decide flow, or drive the UI. Behaviour that must
be guaranteed is code. The guidance string exists only to shape conversational tone and to define
domain vocabulary, and there is a hard cap: **if guidance exceeds 150 words, the design is wrong.**

**Violation looks like:** a new sentence added to guidance in order to fix a bug.

### Rule 4 — Model-authored values crossing into user data pass a typed contract and a boundary guard.

Any field a model produces that will be written into the user's document must have, all four:

1. a **description on every schema field** stating what belongs in it and what does not;
2. an explicit **contract in the prompt** with a worked example of right and wrong;
3. a **validator at the write boundary** that rejects values failing that contract, with the rejection
   surfaced rather than swallowed;
4. presentation to the user as an **exact before/after diff, accepted per item**. Nothing model-written
   reaches the stored document without the user seeing the literal text first.

**Violation looks like:** a `{ "type": "string" }` with no description in any schema whose output is
persisted.

### Rule 5 — Every phase ships with an end-to-end test that runs before the user sees it.

Each phase's exit criterion is a browser test against a real running instance that performs the
user's actual actions and asserts what appears on screen. Unit tests are necessary and are not
sufficient. **A phase is not done until that test has been executed and observed to pass** — not
written, not typechecked. Executed.

**Violation looks like:** handing the user a build whose flow test has never run.

---

## 5. Phases

Each phase is independently demonstrable. The user tests at each gate. Nothing starts before the
previous gate is signed off.

### Phase 1 — Résumé in, résumé improved

Upload a file. See it parsed. See a critique as a list of concrete edits. Accept or decline each one.
See the result saved. Every state change visible on the page without any assistant message.

_Exit: browser test drives upload → wait → critique visible → accept two, decline one → saved
document contains exactly the accepted text._

**This phase alone is what nineteen rounds failed to deliver. It ships on its own.**

### Phase 2 — The conversation

A real chat about target roles, seniority, compensation, location, work mode, dealbreakers. The model
extracts fields as structured data; the surface shows the profile filling in beside the conversation
and the user can correct any field directly. The chat is a chat — no injected turns, no scripted
openings.

_Exit: browser test holds a scripted conversation and asserts the profile fields it produces._

### Phase 3 — Opportunities

Fetch from the board adapters against the profile. Rank. Show a feed with why each posting matched.

_Exit: browser test with fixture boards asserts the ranked feed._

### Phase 4 — Keeping it fresh

Scheduled re-runs, new-since markers, retention. Only after 1–3 are signed off.

**Broad discovery via an aggregated source (freehire.dev) is deferred.** It was selected before step
one worked. Revisit at Phase 3, not before.

---

## 6. Operational traps to carry forward

These cost real hours and are not discoverable from the code. They are properties of the module
platform, not of the old design, so they will apply again.

- **The live install directory is the running worktree's, not the repo root's.** Copying a build to
  the wrong `data/modules/<id>/` produces a "fix" that changes nothing.
- **`package_hash`, not `manifest_hash`, is the content anchor.** Trust gates compared the normalized
  manifest digest, which goes stale on a core change alone and silently kills the module's queues.
- **The worker's wall-clock timeout counted host latency.** Time spent inside a host `ai.*` call was
  charged against the handler's budget, producing intermittent `handler_error` with an empty log.
- **The host spreads `actorUserId` onto every external tool input** (deliberate, anti-spoof). Strict
  unknown-key validators must strip it at the worker boundary or every call fails.
- **A module surface only receives a tool's result if the tool opts in** via `surfacesResultToUi` in
  the manifest, and it needs an `outputSchema` to be projected.
- **Modules compile with their own JSX factory**, so `key` is not compiler-stripped — every keyed
  component needs `key?: string` on its props or it fails typecheck (and only `pnpm typecheck` covers
  external modules).
- **Comments inside a served CSS template literal are served as CSS**, and an issue number like
  `#1234` inside one trips the raw-hex-colour check. Keep those notes above the literal.
- **Stale queues are not reaped on reconcile** — `reconcileModule` only deletes queues present in the
  in-memory owned-queue map, which is empty at boot, so removed queues linger.

---

## 7. Retired documents

Deleted with the code. Listed so their absence is intentional rather than an accident:

`specs/2026-07-09-intelligent-job-search-module.md`, `specs/2026-07-10-job-search-js-01`…`js-09`,
`specs/2026-07-10-job-search-module-design.md`,
`specs/2026-07-10-job-search-module-host-starter-action.md`,
`specs/2026-07-10-job-search-open-decisions.md`,
`specs/2026-07-10-job-search-task-decomposition.md`,
`specs/2026-07-19-job-search-embedded-onboarding.md`,
`specs/2026-07-20-job-search-recovery-dev-hitl.md`,
`specs/2026-07-21-job-search-broad-discovery.md`, the four `plans/2026-07-19`/`-20` job-search plans,
the six job-search handoffs, and the `design/job-search-onboarding/` mockup set.

The design mockups are worth keeping as visual reference and are the one item proposed for
**retention**; everything else goes.

---

## 8. Open questions for approval

1. **Retain the design mockups?** (`docs/superpowers/design/job-search-onboarding/`) — they are
   static reference material, not code. Recommend keep.
2. **Phase 1 scope of the critique.** Edits only (a list of concrete line replacements), or edits plus
   a short narrative assessment? Recommend edits only for Phase 1 — the narrative was where the model
   drifted into writing prose the UI could not render.
3. **GitHub tracking.** The existing epic and its task issues describe the deleted design. Recommend
   closing them as superseded and opening a fresh epic against this plan, since every task's
   acceptance criteria referenced the old architecture.
   </content>
