# Spec — onboarding provider step: select → install → login → working chat (#365)

**Status:** DRAFT (interview-aligned with Ben 2026-06-20). Needs final sign-off before build.
**Tracks:** #365. Part of #342. Depends on the auto-register-model mechanism (#367) and pairs with
#366/#368/#369 on the same onboarding surface (collision — sequence on the wizard files).
**Goal:** the founder completes **connect a provider → working chat entirely from the UI after only
`install.sh`**, no manual API calls, scripts, or Admin → Assistant & AI detour.

## Problem

The founder onboarding "02 Assistant" step (`apps/web/src/onboarding/cli-auth-step.tsx`) is
**detect-only**: it lists detected host CLIs and offers a "Test login" status check
(`/api/onboarding/provider-check`). It cannot **install** a provider CLI or **log in** — those are
working backend routes (`POST /api/onboarding/provider-install`,
`/api/onboarding/provider-login/{begin,submit-token,poll}`, landed in #362/#364) that nothing in the
UI calls. The v0.1.1 chat E2E only worked because the operator drove them by hand. Result: after
`install.sh`, a founder cannot reach a working chat from the UI.

## Decisions (locked in interview)

1. **One seamless flow.** Selecting a provider runs **install → login → auto-register a default chat
   model** so chat works at the end — no Admin detour. (Auto-register mechanism is #367.)
2. **No manual model-id entry.** The user never types a model id; onboarding registers a per-provider
   default (#367). Live model discovery is a later **settings-level** feature (`/model` in the REPL),
   out of this spec.
3. **Providers offered: claude + codex.** The step is provider-generic (data-driven from the catalog
   `supported` set); **claude is the tested/guaranteed path**; codex may ship degraded (its headless
   login is unconfirmed — show "login unavailable headless" if `begin` can't surface a URL).
4. **Steered but skippable (not required).** "Continue/Finish" is enabled once ≥1 provider is
   connected; "Skip setup" stays but is honest (#369) — no silent dead-end.

## Design

Replace the detect-only `cli-auth-step.tsx` with a **provider-connect step** (same step slot "02
Assistant", `FOUNDER_ORDER`/`FOUNDER_RAIL` in `onboarding-wizard.tsx`).

### UI (per provider card: claude, codex)

State machine driven by `/api/onboarding/status` (extended, see below) + the connect actions:
`not_installed → installing → installed/needs_login → logging_in (awaiting_token) → ready`.

- **Connect** button → `POST /api/onboarding/provider-install {providerKind}`; show progress
  ("Installing… ~30–90s", npm ci in the cli-runner). On `installed`, auto-advance to login.
- **Login** → `POST /api/onboarding/provider-login/begin`; render the returned
  `authorizationUrl` as an **open-in-new-tab link + copy button**, plus a **paste-code field** and
  **Submit** → `submit-token` → poll `/poll` until `ready`/`error` (reuse the bounded poll; show a
  spinner). The pasted code is auth material — never logged; sent straight to the route.
- On **ready** → the backend auto-registers the default chat model (#367); card shows
  **"Connected · chat ready"**. The step is `done` (gates Continue/Finish).
- codex: if `begin` returns no `authorizationUrl` (headless flow unsupported), show
  "Login isn't available headless yet" and keep the card non-blocking.

### Backend / contracts

- The install/login routes already exist (`packages/settings/src/onboarding-routes.ts` +
  `module-registry/onboarding-install.ts`/`onboarding-login.ts`). **Add a thin frontend API client**
  in `apps/web/src/api/client.ts` for `provider-install`, `provider-login/begin|submit-token|poll`
  (mirror the existing `testOnboardingProviderConnection`).
- Extend `OnboardingFounderStatus.steps.cliAuth` (`packages/shared/src/onboarding-api.ts`,
  `assembleOnboardingStatus`) so each provider reports `{ kind, installState, loginState }`
  (installed?, logged-in/ready?) — so the wizard can resume mid-connect and derive `done`
  (≥1 provider `ready`). Keep the existing host-detection fields for backward-compat until removed.
- The single-active-user gate (#347) means install/login are one-at-a-time; surface a "busy" inline
  state if a 503 returns (don't crash the step).

## Provider-agnostic

Step is data-driven from the catalog `supported` set + the existing per-provider adapters; no
provider hardcoded in the UI control flow beyond labels. Adding a provider later = catalog data.

## Test plan

- Unit (web): provider-connect step state machine — install→login→ready transitions; paste-code
  submit; codex no-URL degraded path; busy(503) handling. (Vitest + the existing onboarding test
  patterns.)
- Integration: `/api/onboarding/status` returns per-provider install/login state; the new client
  calls hit the real routes.
- E2E (the deploy test): from `install.sh` → onboard → Connect claude → OAuth → **chat works**, no
  API/Admin steps. (The third verdict, now driven entirely from the UI.)

## Security / invariants

- Pasted OAuth code + the minted token are secrets — never logged/screenshotted; the token is
  persisted + injected per #363/#364 (this spec only triggers those routes).
- Founder-only (bootstrap owner); reuse the existing onboarding auth gate.

## Open questions for sign-off

1. On the provider card, is **Install** implicit in one "Connect" button (install→login chained), or
   two explicit buttons? (Draft: one "Connect", chained.)
2. Multiple providers — can the founder connect both claude and codex, with one set as the chat
   default? (Draft: connect any; first `ready` provider's auto-registered model is the instance
   default; switching default is a settings concern.)
