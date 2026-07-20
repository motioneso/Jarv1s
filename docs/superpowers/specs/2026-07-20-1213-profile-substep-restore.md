# Design note — #1213: restore exact profile sub-step after onboarding reload

**Status:** v3 — **APPROVED: Option A** (Ben ruling); Approach 1 **REJECTED by adversarial pass**. ·
**Author:** Coord 1193 Supervisor 5
**Grounded on:** `ad11d979` (origin/main) · **Part of:** #1193 · **Fast-follow to:** #1198 (Lane E)
**Hard ordering:** must merge **after** #1198 and **before** #1199 (Lane F) runs the resumability UAT.
**Not on tonight's critical path:** #1213 is gated behind #1198 (mid-build), so this decision does
not block Lane E. Spec exit criterion 3 ("abandon at the comp step, reload, rehydrate at the right
sub-step") stays unchanged; the MVP shipped by Lane E restarts Profile at Titles with approved
fields prefilled.

## Problem

Under the approved one-write batching, the five profile sub-steps (titles → comp → workmode →
locations → dealbreakers) are buffered in browser memory and flushed as a single
`profile.save-draft` + `profile.approve` after dealbreakers. If the user reloads mid-profile, that
buffer is gone and nothing durable can restore it:

- `profile.get` returns full `fields` for the **active approved** revision only; every other
  revision surfaces as a **bare id** by explicit privacy design
  (`external-modules/job-search/src/worker/handlers/profile.ts:123-144`, comment at 129-131). No
  worker handler dereferences a draft `revisionId` to its `fields`.
- `OnboardingState` carries `step` + `completed` flags + two approved revision ids **only**, never
  field values, and `"profile"` is a single top-level checkpoint with no sub-step
  (`external-modules/job-search/src/domain/onboarding.ts:14-20`; `worker/handlers/flow.ts:12-31`).
- `controlContext` folds into engine-bound prompt **text** and is **never persisted** (also not yet
  on main — prospective in Lane E). It cannot be the durable store.

## ⛔ Approach 1 (auto-approved user-provenance draft buffering) — REJECTED

The prior draft of this note proposed reclassifying `job-search.profile.save-draft` as auto-approved
**only for `provenance:"user"`** (via the `requiresConfirmation(input)` hook), so per-sub-step saves
land without a confirm card, plus a `profile.get-draft` read to restore them. **An adversarial
review (independent Claude critic, 2026-07-20) proved this unsound. Do not build it.**

**CRITICAL — the security premise is false.** `provenance` is a **caller-supplied tool argument**,
not a host-derived fact. `save-draft` is a registered assistant/MCP tool, so for a model-invoked
call the **model controls `provenance`**. Auto-approving on `provenance:"user"` therefore keys the
confirm-card decision on a field the writer sets. Concretely:

1. `save-draft` is **confirm-carded today**. Approach 1 _removes_ that card for anything labeled
   `"user"` — a net regression in the write-confirmation posture, not a neutral optimization.
2. The model can save **inferred** data as `provenance:"user"`, get it auto-approved with **no
   card**, then `profile.get-draft` surfaces it to the user as "your earlier answers," the user
   hits Approve, and inferred data is **laundered into the active profile** — defeating the
   module's own "inferred data never activates without explicit confirmation" invariant
   (`approveProfileHandler` refuses inferred at `profile.ts:103-113`).

**HIGH — unbounded revision growth.** Content-hash idempotency only dedupes byte-identical re-saves;
cumulative per-sub-step saves are all distinct hashes → ≥5 immutable revisions per onboarding, with
**no TTL, cap, or prune** anywhere in the module (`domain/profile.ts:32-46`, `81-86`). Any buffering
design must bound this.

**MEDIUM — call-surface contradiction.** Approach 1 conflated two surfaces with different trust
stories. The module's read-only UI client is explicitly ruled write-free:
`external-modules/job-search/src/web/api.ts:5-6` — _"Only risk:read tools are ever invoked here;
write tools go through the assistant confirm flow, never this client (Coordinator ruling)."_ Any
design that writes from the UI must reconcile with, and explicitly override, that ruling.

## Two sound options (Ben selected Option A)

Both satisfy exit criterion 3 without keying any auto-approve on a model-controlled field. They
differ in blast radius and in whether restore survives a full browser-close.

### Option A — actor-keyed `sessionStorage` client buffer (RECOMMENDED)

The onboarding UI writes the cumulative profile buffer to `sessionStorage` under a key namespaced by
an opaque **actor-scope key** (`jobsearch:onboarding:profile:<actorScopeKey>`) after each sub-step. The
host derives that key from the authenticated actor id it already holds and passes it through the
existing `hostActions` contract; the isolated module never fetches `/api/me`. On mount the module
reads that key, prefills, and resumes at the first sub-step whose fields are absent. The one durable
`save-draft` + `approve` batch at the end of Profile is **unchanged** — the buffer is a pure UI restore
aid that is cleared on approve.

- **Server blast radius: zero.** No new write, no new read tool, no `provenance` decision, no
  auto-approve, no card change, no unbounded server-side revision growth. The write-confirmation
  posture and `web/api.ts` ruling are untouched.
- **Resolves the original rejection's stated objection.** #1213's issue body rejected "browser
  storage: no actor-scoped key → cross-user leak on shared machines." That objection is **specific
  and solvable**: (a) namespace the key by `actorUserId`, and (b) use `sessionStorage`, which is
  per-browsing-context and cleared when the tab/session ends — so a _different_ user on the same
  machine opens a fresh, empty store. The residual "same open tab, walk away, stranger sits down"
  case already implies the stranger is inside the victim's authenticated app session (a far bigger
  problem than a profile buffer), so the buffer adds no meaningful new exposure.
- **Satisfies the testable exit criterion.** Criterion 3 is literally _reload_ (F5) → `sessionStorage`
  survives reload and same-session navigation.
- **Limitation (the fork question):** does **not** survive a full tab/browser **close**. "Come back
  tomorrow in a new session" restarts Profile at Titles — identical to the Lane E MVP for that case.
  If the product intent is durable cross-session/cross-device restore, Option A is insufficient and
  Option B is required.

### Option B — host-attested user-provenance draft (durable, heavier)

A **dedicated onboarding write** whose provenance is guaranteed by the **call surface**, not a
self-asserted field: a server-side handler that **hardcodes `provenance="user"`**, exposed **only**
on the authenticated onboarding UI REST surface and kept **OFF the model's MCP allowlist**. The model
can therefore never produce a card-free user-provenance draft; only the user's own keystrokes on the
first-run UI can. `profile.get-draft` (read-risk, actor-scoped) restores it on reload.

- **Durable:** survives full close / different device (server-side, RLS-scoped to the actor).
- **Costs that must be paid for it to be sound:** (1) establishes a **privileged onboarding UI write
  surface**, which explicitly overrides the `web/api.ts` "write tools never go through this client"
  Coordinator ruling — a deliberate security-posture decision, not an incidental one; (2) must
  **bound revision growth** (cap-and-prune to newest, or a single mutable in-progress buffer row
  rather than an immutable revision per keystroke); (3) must ensure `get-draft` returns only the
  host-attested buffer, never a model-written `provenance:"user"` draft (distinct origin marker or a
  dedicated buffer table separate from the revision store).
- Higher blast radius than A; genuinely durable. Warranted only if cross-session restore is a
  product requirement.

## Decision

**Ben selected Option A (actor-keyed `sessionStorage`).** It satisfies the tested exit criterion
(reload), carries zero server-side blast radius, changes no security posture, and directly answers
the original rejection's objection with actor-namespacing + session-scoping. Option B's extra
durability buys cross-session restore at the cost of a new privileged write surface and
revision-bounding work, which #1213 does not need.

**Decision record:** this choice reverses a documented prior rejection of browser storage only after
closing its concrete actor-isolation gap. The host-provided actor-scope key plus session scoping is
the approved boundary; the module must not acquire identity through a host-internal API.

## Steelman of the other rejected candidates (unchanged)

- **Approach 2 — buffered values on the checkpoint record.** Smallest code change, one record.
  Rejected: breaks the load-bearing "ids/flags only, never field values" invariant of
  `OnboardingState` (`domain/onboarding.ts:14-20`), forcing response-filtering on `onboarding.get-state`
  and putting PII on the progress record. Still needs the same provenance/auto-approve decision.
- **Approach 3 — transcript / controlContext rehydration.** No new writes, but `controlContext` is
  not persisted and not on main; rehydration means fragile text-parsing of engine-bound prompts for
  state deliberately never stored. Not viable without inventing durable structured-transcript
  persistence — a far larger change than #1213.

## Gates (from issue #1213)

1. **This design note + adversarial second opinion before any code.** ✅ Adversarial pass rejected
   Approach 1 and surfaced Options A/B; Ben selected Option A with the host-provided actor-scope
   refinement recorded above.
2. DB-less unit coverage for the chosen option (A: buffer round-trips + actor-key isolation, no
   server change; B: host-attested provenance can't be model-set, `get-draft` never returns inferred
   or model-written drafts, revision bound enforced, `profile.get` privacy unchanged).
3. Extend Lane E's mocked e2e reload scenario to assert comp-sub-step restoration.
4. Lane F (#1199) validates spec exit criterion 3 verbatim on a real instance.

**User-facing summary:** Leaving Job Search setup partway through the profile questions and
reloading now drops you back where you left off with your earlier answers filled in, instead of
restarting the profile section.
