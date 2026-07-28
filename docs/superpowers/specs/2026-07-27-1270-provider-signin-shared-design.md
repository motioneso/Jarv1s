# Provider sign-in: one shared surface for onboarding and settings — design spec

- **Date:** 2026-07-27
- **Status:** **Approved** by Ben 2026-07-27. The one open question (is Codex in scope?) was settled
  by recovered history rather than a ruling: it was already in scope and already built. Everything
  else is settled after two adversarial review rounds. Shape is **recover, then consolidate** — see
  Context.
- **Task:** #1270
- **Parent:** Part of epic #983 (dogfood UX hardening); related to #869 (Assistant & AI admin),
  #1059 (owner terminal), #1271 (terminal copy bug)
- **Grounded on:** `main` @ `73e50847`
- **Review log:** `docs/superpowers/specs/2026-07-27-1270-SPEC-REVIEW-LOG.md` (cross-model
  adversarial review, Codex `gpt-5.6-sol`)

## Context

Jarvis signs in to Claude by driving the `claude` command-line tool. That sign-in expires. When it
does, chat stops working and there is **no way to sign back in from the app** — the only recovery is
the owner terminal (#1059), where you must know to type the login command yourself.

The sign-in flow already exists and works. It lives in the first-run wizard
(`apps/web/src/onboarding/cli-auth-step.tsx`), is mounted exactly once
(`onboarding-wizard.tsx:310`), and is unreachable afterwards.

### RESOLVED: Codex is in scope — and this was already built once

**Settled by recovered history, not by a ruling.** The owner remembered completing a Codex
device-code sign-in in Jarvis "just the other day" — Jarvis showed a code, he entered it, it worked.
He was right. On 2026-07-19 a live-feedback lane built exactly that, and the 2026-07-26 repo reset
deleted it: the work had no issue and no PR, and the branch triage keyed on merged-PR presence.
Full account: `docs/audits/2026-07-27-repo-reset-loss-forensics.md`.

The deleted commits answer this question outright:

- `977effdd` **fix(onboarding): handle Codex device auth** — adds `readonly userCode?: string` state
  and renders the code for the user to type. This is the UI the owner remembers.
- `c2607105` **feat(settings): surface all provider setup options** — replaces
  `ONBOARDING_LOGINABLE_PROVIDER_KINDS = ["anthropic"]` with
  `ONBOARDING_PROVIDER_KINDS = ["anthropic", "openai-compatible", "google"]`, and rewrites the doc
  comment from the v0.1.2 single-active-gate reasoning to "Onboarding offers every CLI provider
  kind. Installation and login support remain separate capability gates."

So the presentation filter below was already lifted deliberately, with the reasoning recorded, and
the flow was live-verified by the owner before it was lost. `codex login --device-auth` completes
headlessly on this deployment; the `bad9c75b` fix held. **No live-proof task is required** — but the
single-active-gate regression from v0.1.2 stays an explicit regression check.

Method note: the earlier draft of this section concluded the code must have come from raw CLI output
in the #1059 owner terminal, on the strength of `grep -rn userCode apps/web/src/` returning nothing.
That grep was searching a tree the commit had been deleted from. Never conclude "never built" from a
`main`-only grep in this repo.

It also explains #1271: the owner was trying to copy that device code out of the UI.

### This is a recovery, then a consolidation

`recover/1270-0719-settings-onboarding` restores the nine lost commits on top of current `main`. That
lands the _behaviour_ #1270 and #1271 describe. It does **not** satisfy the owner's consolidation
ruling: `bf8e80ad` imports only `ApiError` and four symbols from `onboarding-connect-client`, then
reimplements the flow with its own local state — two copies of the same wizard, which is the exact
duplication this spec exists to remove. Plan accordingly: recover first, then extract the one shared
surface both callers mount.

The analysis below is kept because it documents _why_ the filter existed and what lifting it means.

### Background — the stale filter

The first-run wizard offers **Claude only**
(`ONBOARDING_LOGINABLE_PROVIDER_KINDS = ["anthropic"]`, `packages/settings/src/repository.ts:131`).
**That is a presentation filter, not a server gate**, and the two must not be confused. Server-side,
loginability derives from login-adapter presence alone (`onboarding-login.ts:72-80`); the Codex
(`openai-compatible`) adapter is present and passes load validation
(`login-adapters.ts:160-174`), so `provider-login/begin` **accepts Codex today**. Only `google`
(agy), which has no adapter, is genuinely rejected.

The filter is probably **stale**:

| Date       | Commit     | What happened                                                                                                                                                                                                 |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-21 | `3c8dc386` | Codex hidden from onboarding (v0.1.3). Its login bricked chat via the single-active gate in the v0.1.2 live test — the default flow used a `localhost:1455` OAuth callback a headless container cannot reach. |
| 2026-06-23 | `bad9c75b` | `fix(cli-runner): use Codex device auth` — switched to `codex login --device-auth` (prints URL + one-time code, auto-completes by polling), **fixing exactly that defect**.                                   |

The presentation filter was never revisited after the fix.

**This matters more than a provider count.** Codex is the **only** provider with a device-code flow;
Anthropic is paste-mode (URL out, token pasted back). So Goal 3 — showing a code to type — has **no
live provider unless Codex is in scope**. Since it is, both sign-in shapes ship with a real provider
behind each, and the on-screen device code is a real exit criterion rather than dormant support.

The backend is complete and stays untouched. Every route this needs already exists and is callable
from settings today. The routes that _act_ — begin, poll, submit-token, cancel — are owner-gated
(`assertBootstrapOwnerAdminUser`); the loginability pre-check is not (see D11), which is why the UI
does not depend on it.

## Goals

1. **Consolidate.** The sign-in flow lives in **one** place. Onboarding and settings both render
   that one place. A future change to sign-in is a one-file change.
2. **Make it reachable from settings** for every provider in the eligible-kind set — Claude and
   Codex; `google` (agy) has no login adapter and stays out.
3. **Show the device code.** The "here is a code, type it at the provider" half of the flow was
   never wired to the screen on `main` (see _The dropped code_ below). Codex provides the live
   provider, so this is a real on-screen exit criterion.
4. **Stop claiming a provider is connected when we do not know that.** Three separate places in
   settings currently assert it without evidence, one of them a button that does nothing.

## Non-goals

- No change to the sign-in contract
  (`docs/superpowers/specs/2026-06-20-cli-runner-login-contract.md` is **FROZEN**), the RPC verbs,
  the per-provider adapters, or the routes.
- **Does not change any adapter, catalog entry, or login mechanism.** If Codex comes into scope it is
  by lifting a stale presentation filter after a live proof, not by making its login work — that
  already landed in `bad9c75b`. The single-active-gate regression from v0.1.2 is the first thing the
  live proof must re-check.
- Does not replace the #1059 terminal; that stays as the manual fallback.
- Does not fix #1271 (terminal copy). Separate issue, separate change.
- No visual redesign. This is a functionality pass: same authored look, moved and completed.

## The three defects this closes

### 1. The dropped code

Two shapes of sign-in exist. One gives you a **link** to open, and the provider hands you back a
code to paste. The other gives you a **code** to type at the provider yourself. Only the first is
on screen today.

The second is fully built server-side and then discarded in the browser:

| Layer                                       | Status                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `packages/cli-runner/src/login-adapters.ts` | extracts the code against a per-provider allowlist pattern |
| `login-service.ts:436`                      | returns it on `begin`/`poll`; suppressed after submit      |
| `onboarding-routes.ts:952`                  | puts it on the response                                    |
| `onboarding-routes.ts:408`                  | declared in the response schema                            |
| `packages/shared/src/onboarding-api.ts:125` | declared on the response type                              |
| `apps/web/**`                               | **never read**                                             |

The card's interactive branch is guarded on `awaitingToken && authorizationUrl`
(`cli-auth-step.tsx:347`). A code-only sign-in fails that guard, falls through to a bare
"Signing in…" spinner, and the code never reaches the user. `provider-connect-machine.ts` does not
model the field at all.

### 2. Three false "connected" claims in settings

| Where                            | What it does                                                              |
| -------------------------------- | ------------------------------------------------------------------------- |
| `settings-ai-admin-pane.tsx:193` | hardcoded `Connected` badge on every provider card, computed from nothing |
| `settings-ai-admin-pane.tsx:293` | "Signed in via the {provider} CLI", rendered unconditionally              |
| `settings-ai-admin-pane.tsx:298` | a **Re-authenticate button whose entire body is a success toast**         |

The third is the worst of them: pressing Re-authenticate authenticates nothing and then tells you it
succeeded. All three are replaced by the shared surface.

### 3. No sign-in after first run

Covered in Context. The flow is mounted once and never again.

## Resolved decisions

| #   | Decision                                                                                                                                   | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **One shared surface, two callers.** Not a copy into settings.                                                                             | Owner ruling 2026-07-27: "if we change something, we don't have to change it twice."                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D2  | Share the **sign-in controls and flow**. Card chrome stays caller-owned.                                                                   | Revised after review. The onboarding card is a selectable radio tile (`onb-cli`, name, detect badge, install controls); nesting it inside the settings provider card duplicates card chrome. The contested, expensive logic is the flow — that is what must not exist twice.                                                                                                                                                                                                                            |
| D3  | The state label **never makes a positive authentication claim from persisted state**.                                                      | Revised after review. `installState` is surfaced without probing (`onboarding-install.ts:174`), so a persisted `ready` can outlive expired credentials — the same overclaim as the hardcoded badge, in weaker form.                                                                                                                                                                                                                                                                                     |
| D4  | State comes from the live probe `POST /api/onboarding/provider-check`, not from `GET /api/onboarding/status`.                              | Revised after review. The status route projects only `anthropic` by design (`repository.ts:789`) and returns persisted state. `provider-check` is the presence/auth probe, per-provider, already owner-gated.                                                                                                                                                                                                                                                                                           |
| D5  | All three false claims are **replaced**, not supplemented.                                                                                 | Two disagreeing indicators is worse than one wrong one; a button that fakes success is worse than both.                                                                                                                                                                                                                                                                                                                                                                                                 |
| D6  | Backend, routes, and contract are untouched.                                                                                               | Every route needed already exists. Anything requiring a backend change is a finding to escalate, not to invent.                                                                                                                                                                                                                                                                                                                                                                                         |
| D7  | Sign-in renders **once per eligible kind, in its own owner-only "CLI sign-in" section** — not inside the per-configuration provider cards. | Revised twice. Provider configs are not unique by kind (`packages/ai/src/repository.ts:370`), but the login session and persisted lifecycle are instance-global per kind. Per-config controls would show N buttons for one credential; putting the single control "in the card" leaves it undefined which of two Anthropic cards owns it, making placement depend on list order. A separate section removes the ambiguity. The cards still lose their three false claims (D5).                          |
| D8  | The surface renders only for the **bootstrap owner** (`me.user.isBootstrapOwner`).                                                         | Added after review. The routes require `assertBootstrapOwnerAdminUser` (`onboarding-routes.ts:717`), but the AI pane is shown to any instance admin (`settings-page.tsx:290`). Without this, non-owner admins get controls that always 403.                                                                                                                                                                                                                                                             |
| D9  | The eligible-kind set is **whatever the server projects** in the onboarding status provider list — never a hardcoded list in the browser.  | Revised after review. The first version said "read the server's loginability gate"; that gate is an **internal injected port**, not an HTTP route (`onboarding-routes.ts:262`), reachable only by calling the _mutating_ begin route — so it cannot be read. The projected provider list (`repository.ts:789`) is the one server-owned kind list a browser can read, and it needs no new endpoint (D6). Consequence, and it is a feature: including Codex is a one-constant server change, not UI work. |
| D11 | The blocked-provider verdict is **not treated as owner-only data**.                                                                        | Added after review. The begin route checks loginability at `onboarding-routes.ts:712` **before** `assertBootstrapOwnerAdminUser` at `:717`, so any authenticated non-owner can reach `blockedReason`. Low sensitivity (a static build-config string), but the spec must not claim a gate that is not there. The UI does not depend on it — D9 supersedes.                                                                                                                                               |
| D12 | The shared flow **invalidates the caller's probe** on every terminal outcome: ready, error, and cancel.                                    | Added after review. The label is a point-in-time probe (D4); without invalidation, settings keeps showing "Sign-in expired" after a successful sign-in. Onboarding already does this (`cli-auth-step.tsx:113`, `:138`) — the shared flow takes ownership so both callers get it. Needs a browser `provider-check` wrapper, which does not exist yet.                                                                                                                                                    |
| D13 | A positive label **expires**: it is re-probed on window focus and shows when it was last checked.                                          | Added after review. Credentials can expire while the pane stays mounted, which would recreate the D3 overclaim in slow motion. Bounded freshness plus a visible "checked at" keeps the claim honest without polling.                                                                                                                                                                                                                                                                                    |
| D10 | `cancel` is **new client code**, and one component owns cleanup.                                                                           | Added after review. No browser caller invokes the cancel route today, and `pollLoop` (`cli-auth-step.tsx:126`) is fire-and-forget with no unmount guard. Settings can unmount by navigation at any time; without cleanup the instance-wide login slot stays occupied until the 10-minute server timeout (`login-service.ts:83`).                                                                                                                                                                        |

## Architecture

### New shared location

```
apps/web/src/providers/            (new)
  provider-signin.tsx              the shared sign-in controls (link / code / paste-token / retry)
  provider-signin-flow.ts          owns begin → poll → submit-token → cancel and the cleanup contract
  provider-signin-session.ts       login-session state + response interpreter, SPLIT out of
                                   onboarding/provider-connect-machine.ts, extended for the device code
  provider-signin-client.ts        moved from api/onboarding-connect-client.ts, PLUS new
                                   cancel and provider-check wrappers
```

`provider-connect-machine.ts` is **split, not moved** — a correction forced by the review. Its
`deriveCardModel` consumes `provider.installable`, `provider.installState`, and `installing`
(`provider-connect-machine.ts:62`, `:84`, `:89`) — precisely the install and card concerns D2 leaves
caller-owned. Moving it whole would drag onboarding's card derivation into the shared module and
re-break the boundary D2 draws. Only the transient login session and the response interpreter move;
install/card derivation stays in `onboarding/`.

Both callers render `provider-signin`. Neither owns sign-in logic.

**What is shared:** the flow, the state machine, the client, and the controls that are identical in
both places — the link, the code, the paste-token input, the status message, and the retry.

**What stays caller-owned:** the card shell around those controls. Onboarding keeps its selectable
tile (`onb-cli`, provider name, detect badge, install controls); settings renders the controls
inside its existing provider card. This is the boundary the review forced and it is the right one:
chrome differs between the two surfaces, flow does not.

`cli-auth-step.tsx` (447 lines today) keeps its wizard-step chrome and its tile, and delegates the
flow. Each unit stays well under the 1000-line file-size gate.

### Data flow

Unchanged and reused as-is. The shapes below are the frozen contract's, verbatim
(`2026-06-20-cli-runner-login-contract.md:555`):

```
begin        ──> { providerKind, loginId, status, authorizationUrl?, userCode?, installState, message? }
poll         ──> same shape, polled until terminal
submit-token ──> { providerKind, loginId, status, installState, message? }   ← no link, no code
cancel       ──> { ok, installState }
```

The pasted token is request-only: never in a response, never persisted, never logged (§L.6.3).

### The settings state label

The label is read from a **live** `provider-check` probe, taken when the pane opens, on window focus
(D13), on explicit re-check, and whenever a flow settles (D12) — not on every render, and never
inferred from `cliPresent` (documented as presence-only, explicitly not a claim of authentication).

| Probe result              | Label                   | Action offered                |
| ------------------------- | ----------------------- | ----------------------------- |
| `ready`                   | Signed in (checked at…) | none                          |
| `needs_login`             | Sign-in expired         | **Sign in**                   |
| `not_installed`           | Not installed           | **Install** (then sign in)    |
| `multiplexer_unavailable` | Can't check right now   | Retry check                   |
| `error`                   | Needs attention         | **Sign in**, plus the message |
| not yet probed / failed   | (no label)              | **Sign in**                   |

**`not_installed` does not offer sign-in** — corrected after review. `provider-login/begin` installs
nothing; it starts a login immediately (`onboarding-routes.ts:718`), so a missing CLI cannot be
repaired by that button and labelling it recovery would be a third kind of lie. The existing
`provider-install` route is the correct action there, invoked as a caller-owned action (installing is
not part of the shared sign-in flow, per D2).

"Signed in" appears only on a live probe that just returned `ready`, and carries when it was checked.
Anything the map does not cover renders unlabelled with sign-in available — the failure mode is a
missing label, never a wrong one, and never a missing way back in.

### Rendering the code

The interactive branch is re-guarded to fire when **either** a link or a code is present, and
renders whichever arrived:

- **Link present:** open-the-page link, copy-link, paste-the-code input. Unchanged from today.
- **Code present:** the code, displayed large enough to read and type, with a copy control.
- **Both:** both, link first.
- **Neither:** the existing "Signing in…" spinner.

The suppress-after-submit rule (§L.6.2 HIGH-2) is enforced server-side and must not be re-derived in
the browser. Because `submit-token` cannot carry a code at all, the UI rule is simpler than
"suppress it": **entering the submitting state clears any displayed code**, and nothing in the
submit response can put one back.

### Cancellation and cleanup

One owner, stated once: the component that started a flow cancels it.

- Explicit close/dismiss → cancel.
- Unmount for any reason (navigation, pane switch, provider removal, auth-method change, list
  refresh) → abort the poll loop **and** best-effort cancel.
- A failed cancel is logged and swallowed; the server's own timeout is the backstop, not the plan.

This matters more in settings than in onboarding: a wizard step is stable for the duration of the
flow, a settings pane is one click away from unmounting.

### Copy controls and the clipboard

The copy affordance must work on the LAN dev instance, which is plain HTTP. `navigator.clipboard` is
unavailable outside a secure context, so a `document.execCommand("copy")` fallback is required or
copy silently does nothing on the box the owner actually tests on. The existing copy-link control
(`cli-auth-step.tsx:365`) already has this defect (`navigator.clipboard?.` — optional-chained to a
silent no-op) and is fixed as part of this move. Same root cause as #1271, different component;
neither change depends on the other.

### Styling

The moved controls depend on more than one prefix: `onb-auth__*` (19 rules from
`onboarding-design.css:348`) plus `onb-cli`/`onb-cli__*` (`:246`) and `onb-detect*` (`:320`). The
plan must enumerate every selector the shared piece actually renders and split them: rules for the
shared controls move to a neutral prefix in their own stylesheet; rules for onboarding's card shell
stay where they are, since that chrome stays caller-owned.

Rendered output must be **visually identical** in onboarding — this is a rename, not a redesign.
Authored tokens, `jds-*` primitives, and the no-mono/no-serif rules apply unchanged; no new raw
colours outside `tokens.css`.

## Error handling

- Sign-in failure keeps today's behaviour: the status-specific button doubles as the retry
  (`cli-auth-step.tsx:300` documents this deliberately — no failure is silently swallowed).
- The probe that produces the settings label is **best-effort**. If it fails, the card falls back to
  offering sign-in with no label. It must never block the action or the rest of the pane — a
  provider you cannot diagnose is still a provider you must be able to sign in.
- A 400 with a `blockedReason` (non-loginable provider) renders that reason instead of the sign-in
  control. This is the D9 path and it must be reachable, not theoretical.
- Sign-in is instance-wide and single-flight, admission-controlled server-side
  (`engine-host.ts:527`). The existing "another install or sign-in is in progress" state must remain
  reachable from settings, since a second surface makes concurrent attempts newly possible.

## Testing

- **Unit** — view-model mapping for all four render shapes: link only, code only, both, neither.
- **Unit** — entering the submitting state clears a displayed code.
- **Unit (service/route)** — HIGH-2 belongs where it is enforced: assert `submit-token` never
  returns `userCode` or `authorizationUrl`. A UI test cannot cover this; the contract makes the
  input impossible.
- **Unit** — the settings label derives from the probe; an absent or failed probe degrades to the
  unlabelled card rather than throwing, and never renders "Signed in".
- **Unit** — a non-owner admin gets no sign-in control (D8), and a non-loginable provider renders
  its `blockedReason` (D9).
- **Unit** — unmount mid-flow aborts the poll and issues a cancel (D10).
- **Wired, not just defined** — assert through a real caller, not the component in isolation. A
  props-only test would pass with nothing mounted in settings (the #1257 lesson).
- **e2e dev UAT** — Playwright against a real dev instance over LAN, per the project rule for any UI
  feature: reach sign-in from settings, see the code or link render, confirm the label. Required as
  an exit criterion, not optional.
- Onboarding regression: existing wizard coverage must pass untouched. If a wizard test needs
  editing, the move was not behaviour-preserving — stop and reassess.

## Exit criteria

1. Sign-in logic exists in exactly one place; onboarding and settings both render it.
2. A Codex device code reaches a real screen on a live sign-in and can be copied on plain-HTTP LAN.
3. Submitting a token clears any displayed code, and `submit-token` is proven not to carry one
   (asserted at the service/route boundary, where HIGH-2 is actually enforced).
4. Sign-in is reachable from settings for every kind the server projects, once per kind in its own
   section, for the bootstrap owner only.
5. All three false "connected" claims are gone — including the Re-authenticate button that only
   showed a toast. Settings reflects a live probe or says nothing.
6. Signing in successfully from settings updates the label without a manual reload, and a positive
   label re-probes on focus rather than persisting indefinitely.
7. Leaving the pane mid-flow does not strand the instance-wide login slot.
8. `not_installed` offers install, not sign-in.
9. Onboarding is unchanged in behaviour and appearance.
10. `pnpm verify:foundation` green; e2e dev UAT green.

## Hard invariants honored

- **Secrets never escape.** The pasted token is auth material: forwarded only, never logged,
  persisted, or echoed. `cli-auth-step.tsx:188` clears it from state before the request is issued;
  that ordering moves across intact.
- **No admin private-data bypass.** Routes stay owner-gated; no gate is relaxed to reach them from a
  second surface. D8 aligns what the UI offers with what the route already enforces.
- **Frozen contract.** No change to the sign-in contract, verbs, adapters, or routes. Response
  shapes above are quoted from it rather than restated.
- **Preserve the authored design system.** Token-driven, `jds-*` primitives, no mono, no serif, no
  raw colours outside `tokens.css`.
- **Spec before build.** This document is that gate.
