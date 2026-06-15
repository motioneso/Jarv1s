# Jarvis Onboarding Process — Designer Brief

**Date:** 2026-06-14  
**Grounded on:** `5084be7` plus current onboarding files in the shared working tree  
**Audience:** product designer  
**Scope:** the user-facing onboarding experience. This document describes behavior, journey,
states, and useful changes. It is **not** a brand or appearance source; use
`docs/brand/design-system-handoff.md` for that separate brief.

---

## 1. What onboarding is for

Onboarding has two jobs:

1. **Founder setup:** help the bootstrap owner provision the shared household instance: choose a
   terminal multiplexer, authenticate a host CLI, and optionally connect Google.
2. **Member setup:** help a secondary user understand that Jarvis already works for them, then let
   them optionally add a personal AI key, connect their own accounts, and take a short product tour.

Every step is optional. Onboarding should reduce anxiety, not create a gate. If status checks fail,
the product intentionally falls through to the app shell rather than trapping the user in setup.

## 2. Current product behavior

### Founder flow

The founder is the first active instance admin and bootstrap owner. When their onboarding state is
`pending`, the app shell is replaced by the onboarding wizard.

Current founder steps:

1. **Welcome** exists as a component, but fresh founder onboarding currently resumes at the first
   incomplete derived step, so the founder usually lands directly on terminal multiplexer setup.
2. **Terminal multiplexer:** choose `auto`, `tmux`, or `herdr`. The step reports host usability:
   tmux must be installed; herdr must be installed and have a root pane configured.
3. **Authenticate a CLI:** explains that Claude, Codex, or Gemini must be installed and logged in on
   the host. The app only detects binary presence, not actual auth.
4. **Connect Google:** optional; reuses the existing Google connector panel.

Founder terminal states:

- **Finish** writes instance onboarding state `completed`.
- **Skip setup** writes instance onboarding state `skipped`.
- Both are audited as instance-level admin actions.

### Member flow

Members do not repeat founder provisioning. They inherit the shared host CLI setup under the house
model and get a lighter, per-user flow.

Current member steps:

1. **Welcome:** explains they were added to a household instance and their data is private.
2. **AI assistant:** says the shared assistant already works; optional link to add a personal API
   key in Settings.
3. **Connect accounts:** optional Google connection, owner-scoped to the member.
4. **Quick tour:** links to enabled sections. Current model includes Tasks, Calendar, Wellness, and
   Settings when available.

Member terminal state:

- **Finish** and **Skip setup** both stamp the member's own private onboarding row as complete.
- There is no separate member "skipped" lifecycle.
- Member completion is intentionally not written to the admin audit log because the fact of a
  member finishing onboarding is private per-user state.

## 3. Important design constraints

- **Existing frontend presentation is not design-approved.** Treat the current UI as functional
  wireframe behavior only.
- **Chat is secondary.** The optional "Ask Jarvis" overlay exists only for founder onboarding and
  stays disabled until a usable CLI chat path exists. Do not make chat the spine of onboarding.
- **Privacy is quiet but real.** Member onboarding must make per-user privacy clear without fear
  language or lock-icon theater.
- **Setup is skippable.** Use language like "skip for now" / "configure later" rather than implying
  failure or incompleteness.
- **Detection is limited.** CLI status means "binary present", not "authenticated and working."
  Designs must not overclaim.
- **Founder and member flows need different mental models.** Founder onboarding is instance
  provisioning. Member onboarding is orientation and personal opt-in.

## 4. Suggested changes

### Highest-value changes

1. **Make the founder welcome moment real.** Fresh founder onboarding currently jumps to the first
   incomplete derived setup step, which means the welcome component is usually skipped. Add a brief
   intro state before technical setup, or change resume logic so first-time founders see the welcome
   once.

2. **Reframe founder setup as "make Jarvis reachable" rather than "install tooling."** The current
   first useful screen is terminal multiplexer setup, which is technical and abrupt. Lead with the
   outcome: Jarvis needs a safe host control channel so it can run the assistant for this household.

3. **Separate "detected" from "ready."** For CLI auth, the app can only detect the binary. The UI
   should show states like `Not installed`, `Detected`, and `You still need to sign in on the host`
   rather than a simple done/not-done treatment.

4. **Clarify skip semantics.** There are two skip controls: global "Skip setup" and step-level
   "Skip this step." Their scope should be unmistakable: one exits onboarding, the other advances
   within onboarding.

5. **Add a better post-onboarding landing.** Today completion falls through to the app shell. Design
   a first landing state that acknowledges what is configured and gives one next useful action, such
   as "Open today's brief," "Create first task," or "Connect another account."

### Useful polish

6. **Turn the member quick tour into orientation, not a link list.** It should answer "where do I go
   first?" using enabled modules only. Keep it short, but give each section a job, not just a label.

7. **Show privacy boundaries in context.** Member welcome and connector setup should state that
   connected accounts, tasks, wellness data, and preferences are private to that member. Keep it calm
   and factual.

8. **Handle optional Google connection as progressive disclosure.** The current connector panel is
   reused wholesale. Consider a lighter onboarding wrapper that explains why Google helps, then
   opens the full connector flow only when the user chooses to continue.

9. **Make disabled "Ask Jarvis" explain itself without becoming a nag.** It should be a small
   secondary affordance with a tooltip/help line. Avoid bot/AI-first treatment.

10. **Review section coverage against actual modules.** The Phase 4 spec mentions Email, Briefings,
    and Notifications in the member tour, but the current section model only includes Tasks,
    Calendar, Wellness, and Settings. Either keep the tour limited to real enabled nav or expand the
    model when those sections are ready.

## 5. Recommended designer deliverables

Design the onboarding experience as two role-specific journeys that share a common frame.

### Founder screens

- First-run welcome / orientation
- Terminal multiplexer setup with host-status states
- CLI setup with installation vs sign-in distinction
- Optional Google connection wrapper
- Finish / skipped / error-fallthrough states
- Optional "Ask Jarvis" secondary overlay affordance

### Member screens

- Member welcome with privacy framing
- Shared assistant vs personal API key choice
- Optional account connection
- Quick tour of enabled sections
- Completion handoff into the app

### States to cover

- Fresh first run
- Returning mid-onboarding
- Step already satisfied
- Step skipped
- Host tool not detected
- Host tool detected but not known-authenticated
- Connector already connected
- Status endpoint error / onboarding unavailable
- Mobile-responsive layout

## 6. Copy direction

Use calm, direct language. Avoid productivity guilt and technical drama.

Good:

- "You can skip this and configure it later."
- "Detected on this host. Sign in there if you have not already."
- "Your connected accounts are private to you."
- "Jarvis already works with the shared household setup."

Avoid:

- "You must complete setup."
- "Authentication successful" when the app only knows a binary exists.
- "You are behind setup."
- AI-hype language such as magic, sparkles, or copilots.

## 7. Source map

Primary implementation files:

- `apps/web/src/app.tsx`
- `apps/web/src/onboarding/onboarding-wizard.tsx`
- `apps/web/src/onboarding/resume.ts`
- `apps/web/src/onboarding/*-step.tsx`
- `packages/shared/src/platform-api.ts`
- `packages/settings/src/routes.ts`
- `packages/settings/src/repository.ts`
- `infra/postgres/migrations/0079_member_onboarding.sql`

Behavioral tests:

- `tests/e2e/onboarding.spec.ts`
- `tests/e2e/onboarding-member.spec.ts`
- `tests/integration/onboarding.test.ts`
- `tests/integration/onboarding-member.test.ts`
- `tests/unit/onboarding-resume.test.ts`
- `tests/unit/web-section-tour.test.ts`

Design grounding:

- `docs/brand/design-system-handoff.md`
- `docs/brand/brand-brief.md`
- `docs/brand/product-goals-and-ideals.md`
- `docs/brand/visual-language-research.md`
