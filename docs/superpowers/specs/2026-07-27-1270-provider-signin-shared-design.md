# Provider sign-in: one shared surface for onboarding and settings — design spec

- **Date:** 2026-07-27
- **Status:** Draft (awaiting owner review)
- **Task:** #1270
- **Parent:** Part of epic #983 (dogfood UX hardening); related to #869 (Assistant & AI admin),
  #1059 (owner terminal), #1271 (terminal copy bug)
- **Grounded on:** `main` @ `73e50847` (re-verified; nothing in scope changed since drafting)

## Context

Jarvis signs in to Claude and Codex by driving their command-line tools. Those sign-ins expire.
When one does, chat stops working and there is **no way to sign back in from the app** — the only
recovery is the owner terminal (#1059), where you must know to type the login command yourself.

The full sign-in flow already exists and works. It lives in the first-run wizard
(`apps/web/src/onboarding/cli-auth-step.tsx`), is mounted exactly once
(`onboarding-wizard.tsx:310`), and is unreachable afterwards.

The backend is complete and stays untouched. The owner-gated routes
(`/api/onboarding/provider-login/{begin,poll,submit-token,cancel}`) are gated on owner-admin, not
on onboarding being incomplete, so they are already callable from settings today.

## Goals

1. **Consolidate.** The sign-in flow lives in **one** place. Onboarding and settings both render
   that one place. A future change to sign-in is a one-file change.
2. **Make it reachable from settings** for a command-line provider.
3. **Show the device code.** The "here is a code, type it at the provider" half of the flow was
   never wired to the screen (see _The dropped code_ below).
4. **Stop claiming "Connected" when it isn't true.**

## Non-goals

- No change to the sign-in contract
  (`docs/superpowers/specs/2026-06-20-cli-runner-login-contract.md` is **FROZEN**), the RPC verbs,
  the per-provider adapters, or the routes.
- Does not replace the #1059 terminal; that stays as the manual fallback.
- Does not fix #1271 (terminal copy). Separate issue, separate change.
- No new provider and no new authentication method.
- No visual redesign. This is a functionality pass: same authored look, moved and completed.

## The two defects this closes

### The dropped code

Two shapes of sign-in exist. One gives you a **link** to open, and the provider hands you back a
code to paste. The other gives you a **code** to type at the provider yourself. Only the first is
on screen today.

The second is fully built server-side and then discarded in the browser:

| Layer                                       | Status                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/cli-runner/src/login-adapters.ts` | extracts the code against a per-provider allowlist pattern                 |
| `login-service.ts:432-440`                  | returns it; suppressed once a token was submitted (contract §L.6.2 HIGH-2) |
| `onboarding-routes.ts:952`                  | puts it on the response                                                    |
| `onboarding-routes.ts:408`                  | declared in the response schema                                            |
| `packages/shared/src/onboarding-api.ts:125` | declared on the response type                                              |
| `apps/web/**`                               | **never read**                                                             |

The card's interactive branch is guarded on `awaitingToken && authorizationUrl`
(`cli-auth-step.tsx:347`). A code-only sign-in fails that guard, falls through to a bare
"Signing in…" spinner, and the code never reaches the user. `provider-connect-machine.ts` does not
model the field at all.

### The false badge

`settings-ai-admin-pane.tsx:194` renders a hardcoded `Connected` badge on every provider card. It
is not computed from anything. A provider whose sign-in expired reads "Connected" in settings.

## Resolved decisions

| #   | Decision                                                                                | Rationale                                                                                                                          |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **One shared surface, two callers.** Not a copy into settings.                          | Owner ruling 2026-07-27: "if we change something, we don't have to change it twice."                                               |
| D2  | Move the piece **whole** — install states included — rather than splitting sign-in out. | Splitting means choosing a cut line and maintaining two shapes. States that cannot occur in settings simply never fire.            |
| D3  | Settings shows the sign-in action **and** a state label when it knows the state.        | Owner picked this over an unconditional bare button. A control with no indication of whether you need it is the #983 failure mode. |
| D4  | Settings reads the state from the existing status endpoint. **No backend change.**      | The owner may call it at any time. Adding the field to the provider DTO would be a second source of truth for the same fact.       |
| D5  | The hardcoded `Connected` badge is **replaced**, not supplemented.                      | Two badges disagreeing is worse than one wrong badge.                                                                              |
| D6  | Backend, routes, and contract are untouched.                                            | Anything requiring a backend change is a finding to escalate, not to invent (contract is frozen).                                  |

## Architecture

### New shared location

```
apps/web/src/providers/            (new)
  provider-signin-card.tsx         presentational card, pure from its view model
  provider-signin-flow.tsx         owns begin → poll → submit-token → cancel, holds the pasted code
  provider-connect-machine.ts      moved verbatim from onboarding/, extended for the code
  provider-signin-client.ts        moved verbatim from api/onboarding-connect-client.ts
```

Both callers render `provider-signin-flow`. Neither owns sign-in logic.

`cli-auth-step.tsx` (447 lines today) currently mixes flow orchestration, the presentational card,
and wizard-step chrome. The split above is the boundary that already exists inside the file —
`cli-auth-step.tsx:260` documents the card as "Presentational, PURE-from-`model`" with transitions
living in the parent. The move makes that boundary a file boundary. Each unit stays well under the
1000-line file-size gate.

### What each caller keeps

- **Onboarding** keeps its step chrome, headings, skip affordance, and the wizard's completion
  signal. Behaviour is unchanged — same states, same copy, same look.
- **Settings** renders the flow inside the existing provider card's action row, next to Terminal.
  It supplies the state label described below.

### Data flow

Unchanged and reused as-is:

```
begin  ──> { loginId, status, authorizationUrl?, userCode? }
poll   ──> same shape, polled until terminal
submit ──> same shape (code suppressed after submit, §L.6.2)
cancel ──> { ok }
```

Settings additionally reads the existing status endpoint for `installState`
(`OnboardingCliProviderDto.installState`) to label the card. That endpoint returns the whole
first-run status object; settings uses only the per-provider state from it.

The two provider-kind vocabularies differ — the sign-in vocabulary covers three kinds, the AI
provider vocabulary adds two more that have no command-line sign-in. The shared surface accepts
only the three; the settings card renders it only for a command-line provider, so the extra kinds
are unreachable by construction rather than by a runtime check.

### The settings state label

The label is a direct mapping from the fetched state — no new vocabulary is invented, and nothing
is inferred from the presence of a binary (`cliPresent` is documented as presence-only and is
explicitly **not** a claim of authentication):

| State                  | Label           | Sign-in action |
| ---------------------- | --------------- | -------------- |
| `ready`                | Signed in       | not offered    |
| `needs_login`          | Sign-in expired | offered        |
| `not_installed`        | Not installed   | offered        |
| `installing`           | Installing…     | busy           |
| `error`                | Needs attention | offered        |
| `installed`            | (no label)      | offered        |
| unknown / fetch failed | (no label)      | offered        |

`installed` carries no label because it says nothing about authentication. Anything the map does
not cover renders unlabelled with the action available — the failure mode is a missing label, never
a wrong one or a missing way back in.

### Rendering the code

The interactive branch is re-guarded to fire when **either** a link or a code is present, and
renders whichever arrived:

- **Link present:** open-the-page link, copy-link, paste-the-code input. Unchanged from today.
- **Code present:** the code, displayed large enough to read and type, with a copy control.
- **Both:** both, link first.
- **Neither:** the existing "Signing in…" spinner.

The suppress-after-submit rule (§L.6.2 HIGH-2) is enforced server-side and must not be re-derived
in the browser. The UI renders what the response carries; when the field stops arriving, the code
disappears.

### Copy controls and the clipboard

The copy affordance must work on the LAN dev instance, which is plain HTTP. `navigator.clipboard`
is unavailable outside a secure context, so a `document.execCommand("copy")` fallback is required
or copy silently does nothing on the box the owner actually tests on. The existing copy-link
control (`cli-auth-step.tsx:365`) already has this defect (`navigator.clipboard?.` — optional-chained
to a silent no-op) and is fixed as part of this move. This is the same root cause as #1271 but a
different component; neither change depends on the other.

### Styling

The card's styles are 19 rules under an `onb-auth__*` prefix in
`apps/web/src/styles/onboarding-design.css`. A shared component carrying an onboarding-named prefix
into settings is a stale-vocabulary smell (see the `feedback-no-stale-concepts` rule). The rules
move to a neutral prefix in their own stylesheet in the same pass.

Rendered output must be **visually identical** in onboarding — this is a rename, not a redesign.
Authored tokens, `jds-*` primitives, and the no-mono/no-serif rules apply unchanged; no new raw
colours outside `tokens.css`.

## Error handling

- Sign-in failure keeps today's behaviour: the status-specific button doubles as the retry
  (`cli-auth-step.tsx:300` documents this deliberately — no failure is silently swallowed).
- The status read that produces the settings label is **best-effort**. If it fails, the card falls
  back to offering sign-in with no state label. It must never block the action or the rest of the
  pane — a provider you cannot diagnose is still a provider you must be able to sign in.
- Sign-in is instance-wide and single-flight. The existing "another install or sign-in is in
  progress" state must remain reachable in settings, since a second surface makes concurrent
  attempts newly possible.

## Testing

- **Unit** — view-model mapping for all four shapes: link only, code only, both, neither. Assert a
  code that arrives after a token submit is not rendered.
- **Unit** — the settings label derives from the fetched state, and its absence degrades to the
  unlabelled card rather than throwing.
- **Wired, not just defined** — assert through a real caller, not the component in isolation. A
  props-only test would pass with nothing mounted in settings (the #1257 lesson).
- **e2e dev UAT** — Playwright against a real dev instance over LAN, per the project rule for any
  UI feature: reach sign-in from settings, see the code or link render, confirm the state label.
  Required as an exit criterion, not optional.
- Onboarding regression: existing wizard coverage must pass untouched. If a wizard test needs
  editing, the move was not behaviour-preserving — stop and reassess.

## Exit criteria

1. Sign-in logic exists in exactly one place; onboarding and settings both render it.
2. A device code reaches the screen and can be copied on plain-HTTP LAN.
3. A code is never shown after a token was submitted.
4. Sign-in is reachable from settings for a command-line provider.
5. The hardcoded `Connected` badge is gone; the card reflects real state or says nothing.
6. Onboarding is unchanged in behaviour and appearance.
7. `pnpm verify:foundation` green; e2e dev UAT green.

## Hard invariants honored

- **Secrets never escape.** The pasted code is auth material: forwarded only, never logged,
  persisted, or echoed. `cli-auth-step.tsx:188` clears it from state before the request is issued;
  that ordering moves across intact.
- **No admin private-data bypass.** Routes stay owner-admin gated; no gate is relaxed to reach them
  from a second surface.
- **Frozen contract.** No change to the sign-in contract, verbs, adapters, or routes.
- **Preserve the authored design system.** Token-driven, `jds-*` primitives, no mono, no serif, no
  raw colours outside `tokens.css`.
- **Spec before build.** This document is that gate.
