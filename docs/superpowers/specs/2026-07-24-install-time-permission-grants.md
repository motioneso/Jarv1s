# Spec: Install-Time Permission Grants (global)

**Status:** Approved (Ben, 2026-07-24 — chose "fix friction first" to unblock JS-03 UAT). Ready to build.
**Date:** 2026-07-24
**Author:** Jim (hive agent), directed by Ben
**Supersedes:** JS-03 (#1234) confirm-per-write requirement for `job-search.profile.update`

## Problem

Assistant tools with `risk: "write"` currently raise an Approve/Deny card on **every**
invocation unless the user has manually promoted the tool's action family to `trusted_auto`.
During JS-03 UAT this surfaced a card per profile field — friction for an action the module
exists to perform.

Ben's directive (2026-07-24, global — not job-search-only):

> "Permission prompts should really be only for out-of-the-ordinary requests. Something that
> HAS to function for a module to work is approved just by installing it, no more prompts."

**Consent moves to install time.** Installing a module grants the permissions it declares as
core to its function. Per-invocation prompts are reserved for the genuinely out-of-the-ordinary.

## The line (confirmed with Ben)

| Action                                                                      | Behaviour                          |
| --------------------------------------------------------------------------- | ---------------------------------- |
| Module doing its own job on the user's own data (read **and** write)        | **No prompt** — granted at install |
| Destructive / irreversible (delete, lossy overwrite)                        | **Prompt**                         |
| Outbound side effect (send email, spend money, share cross-user or off-box) | **Prompt**                         |
| Per-call unusual condition (`requiresConfirmation(input)` → true)           | **Prompt**                         |

Test: _does this touch the outside world or destroy something?_ → prompt. _Is it the module
doing its declared job on the user's data?_ → install-granted, silent.

## Current mechanism (grounded on js-03-build)

- `packages/ai/src/gateway/policy.ts` `resolvePolicy()`:
  - `risk: "read"` → `run`
  - `risk: "destructive"` → `confirm`
  - `requiresConfirmation(input) === true` → `confirm`
  - `risk: "write"` → `confirm` **by default**, unless the tool's action family tier is
    `trusted_auto` **and** `executionPolicy: "auto"` **and** the family manifest allows
    `trusted_auto`.
- Family tier is a per-user preference: key
  `assistant.action_policy.v1.${moduleId}.${actionFamilyId}` (`repository.ts`). Absent →
  falls back to the manifest's `defaultTier`.
- `ConfirmationRegistry` bridges the blocked call to the human Approve/Deny; the card is an
  `action_request` row.

**The machinery for silent writes already exists** — the change is to the _default_, not a
new subsystem.

## Design

Revised after Fable review (2026-07-24). Ben's ruling on consent: **pure install-grant, no
per-user first-use card.**

1. **Explicit manifest opt-in — NOT a blanket write default.** The install grant applies only
   to a write tool that _explicitly_ declares `actionFamilyId` **and** `executionPolicy: "auto"`
   on a family whose `allowedTiers` includes `trusted_auto`. A **familyless** write tool keeps
   confirming. This makes every silent-write grant a greppable, reviewable line in the manifest
   — the module cannot get silent writes by omission. (Fable finding 1.)
   - This deliberately re-opens the `defaultTier` type, which today excludes `trusted_auto`
     (`packages/module-sdk/src/index.ts:26`). That exclusion was a prior "modules cannot
     self-default to auto" decision; we reverse it **only** behind the explicit two-field
     declaration above, and note the reversal openly rather than silently.
2. **Reserve `confirm`** for `risk: "destructive"`, the new `risk: "outbound"` class (below),
   and per-call `requiresConfirmation(input)`. Ordinary declared writes on owner data → `run`.
3. **Consent = choosing to use the module.** There is **no** approval card — not per-write, not
   first-use. Rationale (Ben): the admin installs the module, but the silent writes only touch a
   user's **own** data, and only when _that user_ chooses to engage the module. No user is forced
   to use it; using it is the consent. The install/enable UI should still honestly **describe**
   what a module does (read/write scope, any outbound tools) so the choice is informed, but it is
   a description, not a gate.
   - _Edge to flag (follow-up, not MVP):_ a module that writes a user's data **passively**
     (background job, no user engagement) has no "choosing to use it" moment. Install-grant is
     sound for user-initiated actions; passive/background writes on behalf of a non-engaged user
     are out of scope here and must be revisited if a module needs them.
4. **Mandatory confirm on consequential/injectable calls (Fable finding 3).** Because writes are
   driven by an LLM reading untrusted content (e.g. a 120k-char résumé via `resume.intake`), the
   genuinely consequential fields MUST route through `requiresConfirmation(input)` even under the
   install grant:
   - `job-search.profile.update` with `status: "active"` → confirm (activation triggers outbound
     discovery; today it's guarded only by guidance prose the LLM can be injected to ignore).
   - `vaultEnabled` flips → confirm (data-at-rest change; wired in #1247).
     These are the "outside module functionality / externally-facing" cases Ben's principle already
     carves out — enforce them in code, not prose.
   - **Mechanism (declarative, not a TS predicate).** `requiresConfirmation` is a TS _function_ on
     `ModuleAssistantToolManifest` (`module-sdk/src/index.ts:516`), but external modules ship a
     **JSON** manifest that cannot carry a predicate, and the external adapter
     (`packages/module-registry/src/external/tool-manifests.ts`) maps no such field. So these
     confirms need a **declarative** form on JSON tool manifests — `confirmWhen: [{key:"status",
equals:"active"}]` and `confirmWhenKeys: ["vaultEnabled"]` — mapped host-side into a
     synthesized `requiresConfirmation`. Semantics are **input-only key/value presence** (the hook
     never sees KV, so it detects a field's _presence/value in the call_, not a _flip_); interview
     guidance must instruct the LLM to include such fields only when actually changing them. This
     mechanism is **shared with #1247** (vault persistence); **whichever spec builds first lands
     it**, the other consumes it. (Fable finding, both specs.)
5. **`risk: "outbound"` is a new enum value, not a manifest flag (Fable finding 4).** Keeps
   `resolvePolicy` a single declarative switch and flows into audit rows. Precedence:
   `destructive` > `outbound` > `requiresConfirmation` > `write`. A dual-nature tool (sends
   _and_ writes) declares `outbound` and confirms. **Honesty gap to log:** module workers have
   full Node network access, so `risk` labelling is honor-system today; near-term mitigation is
   the first-party review gate, long-term follow-up is tying network egress to declared
   `outbound` tools. Not built now — logged.
6. **Stored user prefs always win (Fable finding 5).** The install grant applies **only** when
   the per-user pref at `assistant.action_policy.v1.${moduleId}.${familyId}` is **absent**. A
   stored `ask_each_time` keeps prompting; a stored `always_confirm` is a hard veto. Only absent
   → granted. `tier ?? defaultTier` must not erase an explicit user choice.

### Not changed

- **Data-access authorization is untouched.** RLS, `DataContextDb`, owner-only-by-default all
  stand. Verified against the run path: the silent-run branch still goes through the
  actor-scoped handler and audits with `approvalMode: "auto"` (`gateway.ts:~180-200`) — no authz
  change. A silent write is still RLS-scoped to the actor's own data; dropping the card removes a
  UX gate, not a security boundary.
- **yolo mode** already bypasses this path (`gateway.ts:~160`) and is unchanged.

## Blast radius

- **JS-03 (#1234):** (a) add `actionFamilyId` + `executionPolicy: "auto"` + family manifest to
  `job-search.profile.update` so it qualifies for the grant; (b) add the declarative
  `confirmWhen`/`confirmWhenKeys` for `status: "active"` and `vaultEnabled` (Design 4 mechanism,
  shared with #1247); (c) rewrite the interview `guidance` — remove "Every
  profile update is a proposal that needs the user's approval; wait for the card result" **and**
  "never retry a denied write" (no card will appear). Profile writes apply silently; the progress
  rail is the feedback surface. JS-03 does not land until it conforms.
- Any other module wanting silent core writes must add the explicit family declaration; none get
  it by default.

## Open questions

- Passive/background writes on behalf of a non-engaged user (edge in Design 3) — defer.
- Enforcing `risk: "outbound"` at the network-egress layer (Design 5 honesty gap) — follow-up
  invariant, separate issue.
- Install/enable UI copy that describes (not gates) module behaviour — separate design pass.

## Verification

- Unit: `resolvePolicy` truth table covering — familyless write → confirm; family+auto+absent
  pref → run; family+auto+stored `ask_each_time` → confirm; stored `always_confirm` → confirm;
  `status:"active"` / `vaultEnabled` → confirm; `outbound` → confirm; `destructive` → confirm.
- Integration: a granted core write runs with **no** `action_request` row; destructive / outbound
  / activation calls still create one.
- e2e (#1000-harness): JS-03 interview completes with zero approval cards for ordinary fields;
  rail fills as fields are written; proposing `status:active` still surfaces one confirm.
