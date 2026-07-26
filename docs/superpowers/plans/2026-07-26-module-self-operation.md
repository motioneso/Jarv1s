# Plan: Module self-operation — give the assistant a write side over Jarvis's own configuration

_Locked via grill — by Claude + Ben, 2026-07-26. Grounded on `751c7f14` (clean `main`)._
_Revised after Codex round 1 (`gpt-5.6-sol` high) and Fable 5's independent pass — see the review
log beside this file._

## Goal

Today Jarvis can describe every setting in the product and change none of them. `packages/settings`
exposes exactly one assistant tool — `app.getMapSlice` (`manifest.ts:410`, `risk: "read"`) — which
reads a build-time artifact enumerating every screen, setting surface, feature, error code and
remediation. So when something is misconfigured the assistant can name the screen and quote the fix,
then hand the user a to-do list. That is a worse failure than not knowing: it knows exactly what to
do and makes the user do it.

This spec gives Jarvis hands. A user should be able to ask for a configuration change in chat and
walk away — no permission dialog waiting for a human who has left the room. Safety comes from what
the tools are structurally incapable of doing, not from asking.

## Approach

### The permission model (Ben's ruling, 2026-07-26)

Not an allowlist Claude curates. **Every command declares its own permission, the way a file carries
its mode, and the default is "yes".** The safety property is not which value a command picks — it is
that **picking is mandatory**: a command that declares nothing fails the build. A developer adding
`news.addSource` tags it and it works; a developer who forgets does not silently ship a hole.

Three values, and only the first two are the command author's to choose:

| Value                | Behaviour                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `granted_at_install` | Runs with no dialog once the user has installed the module. The default for anything reversible. |
| `confirm_always`     | Prompts every call. Reserved for the genuinely unrecoverable.                                    |
| _excluded_           | Not the author's choice — a central rule the command cannot opt out of (below).                  |

1. **Consent is install, not a dialog.** Consistent with the install-time permission-grant ruling
   (#1246): installing a module grants the permissions its manifest declares. Nothing prompts again
   afterwards. The user's control point is install/uninstall and a per-module revoke screen, not a
   stream of interruptions.
2. **The install grant is data, not an SDK change.** Fable found that `defaultTier` is typed
   `"ask_each_time" | "always_confirm"` (`module-sdk/src/index.ts:26`), so `trusted_auto` can never
   be a _declared default_ — meaning the naive design prompts on every call forever. But
   `policy.ts:47` reads `(await lookup.getFamilyTier(...)) ?? manifest.defaultTier`, and a _stored_
   tier wins over the default. So the install flow persists `trusted_auto` for every action family
   whose manifest-declared `allowedTiers` permits it. No SDK type widening, no new gateway policy —
   the promotion the machinery already expects simply happens at install instead of being nagged out
   of the user one call at a time.
3. **A central exclusion set the command author cannot opt out of.** If a command touches any of
   these, its own declaration is irrelevant:
   - **Self-authority** — YOLO settings (`yolo.enabled`, `yolo.allowed`), action-family tiers and
     promotions, permissions, module install / trust / instance-wide enable-disable, and the command
     registry itself. Installing a module adds code and tools, so install _is_ an authority grant;
     instance disable is a hard floor for every user (`active-modules-resolver.ts:43`).
   - **Prompt-shaping** — persona text and assistant name (`resolveChatPersona` renders stored
     `personaText` straight into the system prompt), and _any_ free-text or write-time-unvalidated
     value that reaches a prompt. Stated as a property, not a list: a value may reach a prompt only
     if its write path validates it against a closed set. Chat response style qualifies (enum of
     three, `chat-settings-api.ts:33`); stored timezone does not today — the read path validates
     (`locale-utils.ts:7`) but the write path takes any ≤100-char string (`locale-routes.ts:63`), so
     write-time IANA validation is a prerequisite for exposing it.
   - **Secrets** — any key flagged `secret: true`, and any credential operation.
   - **Identity, auth, registration** — account create/delete, admin promotion, deactivation,
     session revocation, `registration.enabled`, `registration.requires_approval`,
     `onboarding.state`.
   - **Data-scope consent** — `wellness.ai_consent_granted` and any future flag that widens what
     private data reaches a prompt. This category was missing entirely until Fable's sweep.
   - **Assistant-brain configuration** — `chat.modelOverride`, `ai.chat_model_override.enabled`,
     `ai.embed_provider` (setting it to `stub` silently stops embedding, leaving permanent recall
     holes), plus the three original brick vectors: AI provider revoke, AI model disable,
     `chat.multiplexer`.
   - **Host operations** — `POST /api/admin/host/install` runs a host-level script deliberately
     outside any DB context (`host-install-routes.ts:31`).
   - **External effect, as a general rule** — anything that sends data to a third party, schedules or
     cancels work, or produces an externally observable write. Named instances from Codex's sweep:
     notification digest scheduling, proactive monitoring, notes-source scheduling/sync, provider
     test and model discovery, connector connect/sync/revoke, briefing create/update/run, news source
     preview/refresh, transcription, export jobs, module queue runs.
     The review log carries the full operation-ID sweep. Every one of those IDs enters the denylist,
     but the _rule_ is what governs: a new operation matching a rule and not classified fails the
     build, rather than shipping because nobody remembered to list it.
4. **Enforced as a server-owned denylist of exact tool IDs, asserted at startup.** Prose cannot be
   enforced. Startup asserts that every registered write tool is classified exactly once —
   `granted_at_install`, `confirm_always`, or excluded — and modules cannot override their own
   classification. Build time additionally asserts that no command's key set intersects the excluded
   key set. The gateway checks the denylist before the YOLO branch, so a registry mistake fails
   closed at runtime too.
5. **No command accepts a preference key as an argument.** `yolo.allowed`, `yolo.enabled`,
   `persona.bundle`, wellness consent and the tasks tier compat key all live in the same
   `app.preferences` table behind the same `PreferencesPort` these commands will write. One generic
   set-preference command — or any command taking a key as input — is self-promotion to YOLO. Keys
   are hardcoded per command; the build asserts it.

### The machinery

6. **Extend `ModuleAssistantToolManifest` — do not build a parallel registry.** The previous draft
   proposed a new server-owned command registry. Codex is right that it duplicates one that exists:
   `module-sdk/src/index.ts:499` already owns tool name, permission id, action family, risk,
   execution policy, handler, schemas and services, and `gateway.ts:585` executes handlers straight
   off module manifests. A third source of truth beside `assistantTools` and action families is how
   drift starts. Self-operation adds the declaration field to the existing manifest; the only new
   central artifact is the immutable denylist. (The app map stays out of it entirely — its `settings`
   entries are coarse UI surfaces and `AppMapItem` is a generated shape, not a declaration type.)
7. **Commands live in the module that owns the data — and mostly need a service layer written.**
   `settings` does not become a central dispatcher over other modules' repositories. But the claim
   that commands can "call the module's existing service layer" is false for locale, chat style,
   quiet hours and notification preferences: all four write repositories directly from their routes.
   Each needs a module-owned application function extracted first, so route orchestration is not
   silently skipped. That extraction is in scope and should be estimated as such.
8. **Auto-safe is a definition, not a vibe.** "Reversible effect" applied literally excludes
   everything, since a rendered screen cannot be recalled. A command may declare
   `granted_at_install` only if it is **state-restorable with no durable loss, no authority change,
   no secret exposure, no third-party disclosure, no scheduled work, and no externally observable
   write**. Transient presentation effects are explicitly permitted. A command declaring
   `granted_at_install` without a tested reverse fails the build — reverses need tests, not
   declarations.
9. **Applying that definition reclassifies most of the obvious candidates**, each verified in code:
   - `confirm_always` — notification module enablement (`NotificationsRepository.create()` returns
     null while disabled, `notifications/src/repository.ts:185`, so undo cannot recreate what was
     never made); digest settings (schedules and unschedules delivery jobs); quiet hours (writes a
     stored `deferred_until`, `repository.ts:199`, that restoring the setting does not undo); weather
     location (every future read sends lat/lon to Open-Meteo, `weather-service.ts:41`, and cannot be
     retracted); timezone (feeds prompts _and_ supplies the fallback for deferral).
   - **never an auto command** — `clearUnread` (`notification-preferences-routes.ts:96`) is
     irreversible.
   - `granted_at_install` — theme mode, chat response style (three-value enum through a server-owned
     template), and the strictly validated presentation half of locale (region, date format) once it
     is split from timezone.
     The point of the permissions model is that this classification is per command and mandatory, not
     that everything lands on `granted_at_install`.
10. **Explicit authorization per command, and the actor comes from context.** `scope` is presentation
    metadata; the app map's own filtering only distinguishes admin (`app-map.ts:35`), and
    `assertBootstrapOwnerAdminUser` is file-local to `routes.ts:932`. Every command carries its own
    live authorization callback, tested for owner, promoted admin, ordinary user, deactivated user
    and target user. Personal commands derive the target user structurally from `ToolContext` and
    never accept a target-user argument.
11. **Writes are compare-and-swap on an integer revision — which requires a migration.** Read-then-
    write races the UI and other chat turns. `app.preferences` is `owner_user_id, key, value_json,
updated_at` with a last-write-wins upsert (`structured-state/preferences-repository.ts:9`), and
    `instance_settings` likewise. `updated_at` is not a safe token — same-timestamp collisions and
    clock-derived correctness — so the migration adds an integer revision incremented atomically,
    with conditional update/delete and `ON CONFLICT DO NOTHING` for absent-row creation. Owned by
    core, since `app.preferences` is shared. Each write returns an opaque mutation id; undo applies
    only while the current revision still matches, so a later legitimate change cancels the undo
    rather than clobbering it. Records track presence and source, so undoing a write over an absent
    row deletes the override instead of pinning the old default (`runtime-config-keys.ts:10`).
12. **Undo is a bounded in-memory per-chat stack, scoped to its own mutation ids.** Undo is itself an
    auto-run write tool, so it must reverse only mutations this feature created — never a generic
    revert, or it becomes a second write surface with none of the declarations. No table, no
    retention policy, no prior private values in model output: the assistant holds mutation ids, not
    old values. Restart clears it, and that is documented behaviour. The seam exists so a durable
    sink is additive later.
13. **Audit transactionally, with the command named — and defined outcomes for the paths that have
    no transaction.** Gateway audit input summaries are key-names only by design
    (`packages/ai/src/assistant-tools.ts:36`), so a generic write would log as `key,value`, and
    gateway audit is fire-and-forget after execution (`gateway.ts:169/187`). A successful write
    records metadata-only audit in the same transaction: actor, exact non-secret command id, request
    and chat id, before/after revisions, outcome. Authorization rejections, validation failures and
    transaction aborts cannot share that transaction, so each has an explicitly named outcome
    (`denied`, `invalid`, `conflict`, `failed`) written outside it, and the set of outcomes is closed.
14. **Bounded in frequency, not just in blast radius.** A bounded surface still allows an injected
    loop to oscillate a setting indefinitely, filling audit and undo state. Per-actor and per-command
    rate limits, no-op suppression (a write matching current state is not a mutation), bounded
    mutation retention, and metrics on hard-exclusion hits and repeated CAS failures.
15. **Fail closed on registry/handler drift.** `loadAppMap` does a shallow schema-v1 check and the
    build script copies declarations (`app-map.ts:27`, `scripts/build-app-map.ts:23`). The runtime
    registry becomes canonical, the artifact is derived from it, and startup asserts exact parity
    between declared commands and live handlers.

## Key decisions & tradeoffs

- **Permissions list, not allowlist (Ben's call).** The first revision narrowed round one to six
  hand-picked commands. Rejected as scaffolding: a command only exists because someone wrote it, so
  the allowlist was mostly just describing what got built first. Default is yes; the surface grows
  as modules grow, not as a list is curated.
- **Guardrails over permission prompts.** A prompt only protects a user who is present, so it is
  worthless for the walk-away case that motivates the feature. Prompts are reserved for the
  unrecoverable.
- **Capability reduction is the answer to prompt injection, not intent tokens.** Codex proposed
  binding each write to a server-parsed command or first-party intent token. Rejected: that is a
  confirmation prompt wearing a different hat, and it breaks the one requirement this feature exists
  to satisfy. With authority, secrets, identity, consent flags, brain configuration, host operations
  and external effects out of the tool surface entirely, a successful injection changes someone's
  theme — bounded and reversible — rather than escalating its own privileges. Codex withdrew the
  demand at round 2, on terms this plan now meets: _"capability reduction is a defensible product
  choice when commands are closed, actor-bound, rate-limited, and genuinely incapable of durable
  loss, authority changes, secrets, or external disclosure."_
- **The exclusion set is defined by properties, not by enumeration.** Codex and Fable both proved a
  hand-kept list rots: between them they found seven items the first draft missed. Each exclusion
  category above is a _rule_ (grants authority / feeds a prompt / holds a secret / has external
  effect / widens data scope), the build asserts against it, and adding a setting that matches a rule
  without excluding it fails the build rather than shipping.
- **Module-owned commands over one registry-driven tool.** A single generic tool moves safety from
  the tool's shape into its arguments and hands one tool every module's write service. Narrowness is
  the guardrail. Per-user surface is bounded by `ActiveModulesResolver`, so a user who has disabled a
  module never carries its tools.
- **Per-user module disable needs no guard; instance-wide disable is excluded.**
  `active-modules-resolver.ts:41` keeps `required: true` manifests regardless of the deny-list, and
  `chat`, `ai` and `settings` are all required — so a user cannot disable their way out of chat. But
  `instanceDisabled` is a hard floor for everyone, which is why it sits in the exclusion set.
- **The YOLO fix evaluates the whole mode, not just the exclusions.** `gateway.ts:160` evaluates YOLO
  before `resolvePolicy`, so YOLO currently bypasses `requiresConfirmation` and even
  `risk: "destructive"`. An earlier draft moved only the permanent exclusions ahead of that branch,
  which Codex correctly called incomplete — `confirm_always` and destructive tools would still slip
  through. Correct order: **excluded → deny; `confirm_always` / destructive / `requiresConfirmation`
  → confirm; only then may YOLO bypass ordinary policy.** Fable is right that `tasks` ships two
  destructive tools that auto-run under YOLO today, so this visibly changes existing behaviour.
  Ruling: correct it anyway — YOLO was never meant to bypass the unrecoverable. Lands first, as its
  own change, with the `tasks` behaviour change called out in the release note.
- **Extending the existing tool manifest beats a new registry.** Codex's strongest simplification:
  `ModuleAssistantToolManifest` already carries everything a command needs, and a parallel registry
  would be a third source of truth beside `assistantTools` and action families. Dropped. The only new
  central artifact is the immutable denylist.
- **No content versioning.** Where Jarvis changes content in a third-party app, that app's own
  version history is the undo. Jarvis builds none.
- **Split into two specs.** Settings commands + the undo seam + the CAS migration land first; module
  content commands (`news.addSource`, `sports.followTeam`) follow in a second spec. Both share the
  same command registry shape, so the second is additive.

## Risks / open questions

- **Prompt injection reaching writes is reduced, not eliminated.** The gateway sees actor identity
  but has no evidence the human actually asked for a given change (`gateway.ts:127`). The mitigation
  is the size of the blast radius, not a provenance check.
- **The exclusion rules must be mechanically checkable to be worth anything.** "Feeds a prompt" and
  "has an external effect" need to be expressible as declared properties on a setting — extending the
  existing `secret: true` flag pattern — or the build assertion degrades back into the hand-kept list
  that already failed twice.
- **Deferred-effect settings generally.** `chat.multiplexer` and `ai.embed_provider` are both
  excluded, but both were found by inspection rather than by a rule. Other boot-read settings may
  exist where a write appears to succeed and does nothing until restart — which reads to the user as
  the assistant lying.
- **Install-time grant needs its own UX.** The user must be able to see what a module was granted and
  revoke it without uninstalling. That screen does not exist yet.
- **In-memory undo dies on restart**, and users may expect "change it back" to work tomorrow. The
  seam is designed so a durable sink is additive rather than a rewrite.

## Out of scope

- Module content commands (`news.addSource` etc.) — second spec, follows this one.
- Durable / cross-session undo, and any version history.
- Replacing Brave Search with self-hosted SearXNG — separate module change with a deploy
  consequence, tracked independently.
- The Composio BYO-key connector — sequenced after this; its durable-preference half depends on
  settings-write existing.
- Everything in the exclusion set above.

## Process note

Per `CLAUDE.md`, no code lands from this plan. It feeds two approved design specs under
`docs/superpowers/specs/`, each with a GitHub `task` issue, before any build work starts.
