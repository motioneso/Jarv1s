# Spec 1 — Module self-operation: the permissions model and settings commands

Status: APPROVED by Ben 2026-07-26. Grounded on `751c7f14`.
Source plan: `docs/superpowers/plans/2026-07-26-module-self-operation.md` (grilled with Ben, then
survived adversarial review by Codex `gpt-5.6-sol` high ×2 and Fable 5 ×1 — see the review log).

Gives the assistant a write side over Jarvis's own configuration. Today `packages/settings` exposes
one assistant tool, `app.getMapSlice` (`manifest.ts:410`, `risk: "read"`) — Jarvis can name the
screen and quote the fix, then makes the user do it.

## Decisions (locked)

- **Permissions model, not an allowlist (Ben, 2026-07-26).** Default is **yes**. Every write tool
  declares `granted_at_install` or `confirm_always`. **Declaring nothing fails the build** — that is
  the safety property, not which value gets picked. Consent is install (per the #1246 install-time
  grant ruling); nothing prompts again afterwards.
- **The declaration lives on `ModuleAssistantToolManifest`, not in a new registry.**
  `module-sdk/src/index.ts:499` already owns tool name, permission id, action family, risk, execution
  policy, handler, schemas and services, and `gateway.ts:585` executes handlers off module manifests.
  A parallel command registry would be a third source of truth beside `assistantTools` and action
  families. **The only new central artifact is the immutable denylist.** The app map is not involved
  — its `settings` entries are coarse UI surfaces and `AppMapItem` is a generated shape.
- **The install grant is data, not an SDK type change.** `defaultTier` is typed
  `"ask_each_time" | "always_confirm"` (`module-sdk/src/index.ts:26`), so `trusted_auto` can never be
  a declared default — the naive design would prompt on every call forever. But `policy.ts:47` reads
  `(await lookup.getFamilyTier(...)) ?? manifest.defaultTier`, so a **stored** tier wins. The install
  flow persists `trusted_auto` for every action family whose manifest `allowedTiers` already permits
  it. No SDK widening, no new gateway policy.
- **Auto-safe is a definition, and the bar is recoverability (Ben, 2026-07-26 — revised).**
  `confirm_always` is reserved for **durable unrecoverable loss** — something the user cannot get
  back by asking for the reverse. Everything else the exclusion rules already cover (authority,
  prompt-shaping, secrets, identity, consent) is out of reach by construction, not by prompting, so
  those are not reasons to confirm. Third-party disclosure, scheduled work and externally observable
  writes are **not** on their own grounds for a prompt — an earlier draft used them as bars and
  over-classified. A `granted_at_install` tool without a _tested_ reverse still fails the build.
- **Round-one classification, verified in code and re-measured against the recoverability bar:**
  - `granted_at_install` — theme mode; chat response style (three-value enum rendered through a
    server-owned template, `chat-settings-api.ts:3` → `runtime.ts:529`); locale region and date
    format; timezone (feeds prompts at `runtime.ts:526` and the deferral fallback, but is exactly
    reversible — it needs **write-time IANA validation**, not a prompt); quiet hours (the durable
    `deferred_until` it writes delays notifications, it does not destroy them, `repository.ts:199`);
    digest settings (unscheduling and rescheduling delivery jobs is symmetric); weather location
    (coordinates reach Open-Meteo on every read, `weather-service.ts:41` — a disclosure, not a loss;
    the exclusion rules keep secrets out, and this is not one); **notification module enablement**
    (Ben, 2026-07-26 — flipped from `confirm_always`). While disabled,
    `NotificationsRepository.create()` returns null (`notifications/src/repository.ts:185`), so
    notifications arising during the off window are never made and re-enabling cannot recreate them.
    That is a real gap, and it is still not a reason to prompt: nothing the user _had_ is destroyed,
    and turning notifications off is a thing users say out loud and mean. **Surface the consequence in
    the tool's own response** ("notifications are off — anything that happens while it's off won't be
    waiting for you") rather than in a card that blocks.
  - `confirm_always` — **nothing in round one.** The value exists and the build assertion requires it,
    but no settings tool in this round clears the unrecoverable-loss bar. Real deletions arriving in a
    later round are what it is for. A round-one classification landing here should be treated as a
    signal the tool is wrong, not that the prompt is needed.
  - **never a tool** — `clearUnread` (`notification-preferences-routes.ts:96`) is irreversible, and
    unlike everything above it destroys state the user already had.
- **Central exclusion set, which a tool author cannot opt out of.** Rules, not just a list — a new
  operation matching a rule and not classified **fails the build**:
  1. _Self-authority_ — `yolo.enabled` / `yolo.allowed`, action-family tiers and promotions,
     permissions, module enablement (`/api/admin/modules/:id`, `/api/me/modules/:id`), external-module
     download/enable/remove/purge, connector feature grants (`connectors/src/manifest.ts:162`), task
     agency auto-execution (`tasks/src/manifest.ts:485`), AI service bindings, default provider,
     chat-model override, admin AI pin (`ai/src/manifest.ts:225`).
  2. _Prompt-shaping_ — persona text and assistant name; memory settings and fact mutation
     (`chat/src/manifest.ts:133`); priority-model ranking (`settings/src/manifest.ts:241`);
     source-behavior and notes-source selection; chat-skill CRUD/import (`chat/src/manifest.ts:163`);
     page-context writes (would let the model forge evidence returned by `chat.getCurrentView`).
     **Stated as a property:** a value may reach a prompt only if its write path validates against a
     closed set _and_ it renders through a server-owned constant template.
  3. _Secrets_ — any `secret: true` key; module credential PUT/DELETE; web-search key; provider
     create/update; voice endpoint; connector authorize/complete/connect; onboarding provider
     login/install; terminal password/ticket.
  4. _Identity/auth/registration_ — account create/delete, admin promotion, deactivation, session
     revocation, `registration.enabled`, `registration.requires_approval`, `onboarding.state`.
  5. _Data-scope consent_ — `wellness.ai_consent_granted` and any future flag widening what private
     data reaches a prompt.
  6. _Assistant-brain config_ — `chat.modelOverride`, `ai.chat_model_override.enabled`,
     `ai.embed_provider` (→ `stub` leaves permanent recall holes), AI provider revoke, AI model
     disable, `chat.multiplexer`.
  7. _External effect (general rule)_ — third-party sends, scheduling/cancelling work, externally
     observable writes: digest scheduling, proactive monitoring, notes-source scheduling/sync,
     provider test and model discovery, connector connect/sync/revoke, briefing create/update/run,
     news source preview/refresh, transcription, export jobs, module queue runs, host install
     (`host-install-routes.ts:31`).
- **No tool may take a preference key as an argument.** `yolo.allowed`, `yolo.enabled`,
  `persona.bundle`, wellness consent and the tasks tier compat key all live in the same
  `app.preferences` table behind the same `PreferencesPort` these tools will write. One generic
  set-preference tool is self-promotion to YOLO. Keys are hardcoded per tool; asserted at build.
- **Personal tools derive the target user from `ToolContext`** and never accept a target-user
  argument. Every tool additionally carries a live authorization callback — `scope` is presentation
  metadata (`app-map.ts:35`) and `assertBootstrapOwnerAdminUser` is file-local (`routes.ts:932`).
- **Most of these settings have no service layer to call.** Locale, chat style, quiet hours and
  notification preferences all write repositories directly from their routes. Each needs a
  module-owned application function extracted first — in scope, and the bulk of the work.

## Prerequisite (lands FIRST, as its own PR)

**Gateway policy ordering.** `gateway.ts:160` evaluates the YOLO branch _before_ `resolvePolicy`, so
YOLO today bypasses every confirmation gate, including `requiresConfirmation` and
`risk: "destructive"`. **Ben's ruling (2026-07-26): that is correct and stays.** YOLO is the user
explicitly accepting the risk; a mode that still stops to ask is not the mode they turned on. The
earlier draft of this spec proposed reordering destructive ahead of YOLO — **rejected, and it was
wrong.** Correct order:

1. excluded → **deny**, before anything else and regardless of YOLO
2. YOLO on → **run**, bypassing `confirm_always`, `risk: "destructive"` and `requiresConfirmation`
3. otherwise → ordinary policy (`confirm_always` / destructive / per-call hook → confirm)

The one and only change is hoisting the exclusion check above the YOLO branch, and it is not a
weakening of YOLO. An excluded operation is **not exposed to the model as a tool at all** — there is
no prompt for YOLO to skip. Nothing a user consented to by enabling YOLO changes: the two
`risk: "destructive"` tools `tasks` ships (`tasks/manifest.ts:767,785`) keep auto-running under it.
No user-visible behaviour change, so nothing for the release note beyond the new capability.

Note that YOLO's own settings are themselves in exclusion rule 1 — Jarvis cannot turn YOLO on for
itself, which is what keeps step 2 an expression of the user's choice rather than the assistant's.
Distinct from #1085, which covered native tools only.

## Files

- `packages/module-sdk/src/index.ts` — add the self-operation declaration field to
  `ModuleAssistantToolManifest` (:499); no change to `defaultTier`'s type.
- `packages/ai/src/gateway/gateway.ts` (:160) — prerequisite PR: hoist the denylist check above the
  YOLO branch. Do **not** move `resolvePolicy` ahead of YOLO; YOLO keeps bypassing confirmations.
- `packages/ai/src/gateway/policy.ts` — unchanged logic; document that a stored tier wins (:47).
- **New** central denylist + startup assertion (every registered write tool classified exactly once;
  modules cannot override their own classification).
- `packages/settings/src/locale-routes.ts` (:63) — write-time IANA validation; split region/date
  format from timezone; extract an application function.
- `packages/settings/src/notification-preferences-routes.ts` (:96) — extract; `clearUnread` never
  exposed.
- `packages/structured-state/src/preferences-repository.ts` (:9) — CAS.
- **New migration (core-owned)** — integer revision column on `app.preferences` and
  `instance_settings`; conditional update/delete; `ON CONFLICT DO NOTHING` for absent-row creation.
  `updated_at` is not a safe token (same-timestamp collisions, clock-derived correctness).
- Install flow — persist `trusted_auto` for eligible families at install; a per-module view + revoke
  screen (does not exist yet).
- Undo: bounded in-memory per-chat stack, keyed by opaque mutation id bound to actor **and** chat,
  scoped to mutations this feature created. No table, no prior values in model output. Restart clears
  it; documented. Seam only — a durable sink stays additive.
- Audit: metadata-only, in the same transaction as a successful write (actor, exact non-secret tool
  id, request + chat id, before/after revision). Authorization rejections, validation failures and
  transaction aborts get named outcomes written outside it — `denied` / `invalid` / `conflict` /
  `failed`, closed set. Existing summaries are key-names-only by design
  (`packages/ai/src/assistant-tools.ts:36`) and fire-and-forget (`gateway.ts:169/187`).
- Rate limiting: per-actor and per-tool limits, no-op suppression (a write matching current state is
  not a mutation), bounded mutation retention, metrics on hard-exclusion hits and repeated CAS
  failures. Bounded blast radius is not bounded frequency — an injected loop can otherwise oscillate
  a setting indefinitely.

## Tests

- Build fails when a write tool declares no permission value.
- Build fails when a registered tool's key set intersects the excluded key set, and when a new
  operation matches an exclusion rule without being classified.
- Startup assertion: every registered write tool classified exactly once; a module attempting to
  override its own classification is rejected.
- Policy ordering, both halves: with YOLO **on**, an excluded tool is denied, **and** a
  `confirm_always` tool and a `risk: "destructive"` tool both still run without a card. The second
  half is the guard that stops a future change from quietly re-tightening YOLO.
- With YOLO **off**, the same `confirm_always` and destructive tools confirm.
- Install grant: after install, a `granted_at_install` tool runs with **no** confirmation card on
  first use — the walk-away requirement, proven at runtime rather than by unit stub.
- Every round-one settings tool runs card-free, asserted as a set rather than tool-by-tool, so adding
  a tool that quietly confirms fails the suite.
- The notifications-off tool's response text names the consequence; a silent success is a failure.
- CAS: concurrent chat-turn and UI writes; the loser gets `conflict`, not a silent clobber.
- Undo over an absent row deletes the override rather than pinning the old default
  (`runtime-config-keys.ts:10`); undo after a later legitimate change is cancelled, not applied.
- Authorization callback per tool: owner, promoted admin, ordinary user, deactivated user, target
  user. A tool given a target-user argument fails review by construction.
- Rate limit + no-op suppression under a synthetic oscillation loop.

## Exit criterion (UAT — #1000 harness, mandatory)

Real dev-instance Playwright run: ask Jarvis in chat to change the theme, then quiet hours, then the
weather location, then to turn notifications off → all four change with **no confirmation card at any
point** and the UI reflects them; the notifications reply states the consequence in words. Ask it to
change the persona → refused as not-a-tool. Then "change that back" undoes the theme in the same
conversation. **A confirmation card appearing anywhere in this run is a failure** — that is the
walk-away requirement, and it is the whole exit criterion. Full `pnpm verify:foundation` green with a
real exit code. Security QA on Opus — this touches the gateway policy path.
