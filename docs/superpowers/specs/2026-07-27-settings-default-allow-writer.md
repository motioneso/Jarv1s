# Settings default-allow writer

Status: PROPOSED 2026-07-27. Grounded on coordinator commit `a3568b34` and the unmerged #1276
implementation at `0648d0f1`.

This spec supersedes the tool-per-setting model in
`docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`. Ben's governing
directive is: every setting is assistant-writable unless it is explicitly denied.

## Outcome

Jarvis gets one generic settings writer backed by a mandatory registry of settings. Adding a setting
requires declaring what it is and classifying it as `writable` or `denied`; it does not require
authoring another assistant tool. Omitting the classification fails the build.

The user experience is silent for writable settings: the requested change runs without a
confirmation card, returns the user-visible value, and can be undone. Denied settings are not
offered to the model and cannot be reached by crafting a raw preference key.

## What survives from the superseded spec

The replacement changes the command surface, not the established safety machinery. These decisions
survive unchanged:

- `ModuleAssistantToolManifest.selfOperationGrant` remains mandatory for write tools; omission still
  fails the build.
- The central self-operation exclusions remain server-owned and cannot be overridden by a module.
- Exclusion is evaluated before YOLO; YOLO still bypasses ordinary confirmation policy.
- Install-time `trusted_auto` remains stored policy data, not a widened `defaultTier` SDK value.
- Personal writes derive the user from `ToolContext`; no tool accepts a target-user argument.
- #1276's revision CAS, bounded per-chat undo stack, metadata-only audit outcomes, no-op suppression,
  and gateway auto-run rate limiter are reused.
- `clearUnread` remains unavailable because it irreversibly destroys existing state.
- The notification-disable response must state that notifications created while disabled will not be
  waiting when notifications are re-enabled.

The six bespoke setters do not survive. `settings.undoLast` does, because undo is an operation over
the chat's mutation history rather than another setting value.

## Registry is the source of truth

### Location and ownership

Add the setting declaration contract to `packages/module-sdk/src/index.ts` and an optional
`assistantSettings` collection to each module manifest. The module that owns a setting owns its
declaration, validation, authorization, read, and apply functions.

`packages/module-registry` assembles all declarations into one immutable registry at startup and
injects that registry into the settings module's generic tool. `packages/settings` must not import
other feature modules to discover their settings; composition stays in `packages/module-registry`,
where built-in manifests are already assembled.

`scripts/build-app-map.ts` remains unchanged as a settings-surface/navigation generator. Its
`manifest.settings` entries do not become the registry because they describe panes, not individual
values.

### Required declaration

Every declaration contains:

- `id`: stable public setting id, such as `appearance.theme`; this is not a database key.
- `displayName` and optional setting-name aliases used in descriptions and error messages.
- `scope`: `user` or `instance`; user scope always derives the owner from `ToolContext`.
- `storageTargets`: fixed, server-owned preference keys or named application targets used for build
  review and audit. They are never accepted from tool input.
- `classification`: required `writable` or `denied`; there is no implicit TypeScript default.
- `valueSchema`: the JSON schema for the canonical input value.
- `choices`: optional static choices, or a module-owned runtime choice resolver, each returning a
  stored value, display name, and aliases.
- `validate`: module-owned validation and normalization for structured or open-domain values.
- `authorize`: live authorization for the current actor and scope.
- `read` and `apply`: module-owned application functions used by both REST/UI writes and the
  assistant path.
- `undo`: the fixed storage targets and reverse operation needed to replay #1276's CAS-safe undo.
- `successText`: server-owned display formatting; consequence text is mandatory where changing the
  setting has a non-obvious user-visible cost.
- For `denied`, a deny category and reason; denied declarations have no assistant apply path.

The registry descriptor is the canonical declaration for the setting, not assistant-only metadata.
Existing REST routes and UI mutations must call the same module-owned `apply` function as the
generic writer. Direct ad hoc writes are migrated away. Repository mutation APIs used by settings
accept a registry-owned declaration/target token rather than an arbitrary string, and the build gate
rejects direct raw-key setting writes outside the registry implementation. This is how a newly added
setting becomes impossible to ship without a classification.

Application-backed settings are allowed. Notification enablement, for example, uses the fixed
`notifications.moduleEnabled` declaration and validates the requested module id against the live
installed-module inventory; it does not pretend that every setting is one `app.preferences` row.

### Build and startup assertions

The build fails when any of these is true:

- a setting declaration omits `classification`;
- declaration ids collide;
- normalized aliases collide within a setting's legal choices;
- a writable declaration lacks validation, authorization, read/apply, or undo support;
- a denied declaration is included in the generated write-tool schema;
- a writable declaration's fixed storage target intersects the central denied target set;
- an actual settings write bypasses the registry-owned application path;
- a setting application function is registered zero times or more than once;
- a module tries to weaken or replace a central deny classification.

Startup repeats the uniqueness, classification, and central-deny assertions over the actual
registered module inventory. Build checks catch authored mistakes; startup checks catch composition
mistakes.

## Classification and guardrails

There are two setting classifications:

- `writable`: runs silently through the shared `settings.preference-write` action family after the
  install-time grant is present.
- `denied`: absent from the tool schema and rejected by registry lookup even if a caller fabricates
  the public id.

No generic setting classification confirms. Routine confirmation cards would violate the
"guardrails, not permission prompts" ruling. A future operation whose defining behavior is durable,
unrecoverable destruction is not a generic setting write; it needs a separate, narrowly named
`confirm_always` tool.

At minimum, these categories are centrally denied:

1. **Auth, sessions, identity, and registration.** Account lifecycle, admin promotion,
   deactivation, session revocation, onboarding authority, and registration gates can transfer or
   remove access.
2. **Connector and AI credentials.** API keys, OAuth material, provider credentials, connector
   authorization, secret registry entries, and credential bindings expose secrets or grant external
   authority.
3. **Self-operation authority.** YOLO flags, action-family tiers, self-operation grants,
   permissions, module installation/enablement/removal, and any value that widens what Jarvis may do
   are self-promotion.
4. **Prompt and model control.** Persona text, assistant name, model/provider selection, memory fact
   mutation, source selection, chat-skill mutation, page-context writes, and equivalent values let
   the model alter its own instructions or evidence.
5. **Private-data scope consent.** Any flag that widens which private data may enter a prompt remains
   a human-controlled consent boundary.

These are denied because no amount of value validation makes self-escalation, credential access, or
prompt self-modification safe. Ordinary reversible preferences remain writable even when they affect
scheduling, disclosure to an already configured service, or future notifications; their guardrails
are validation, authorization, CAS, undo, audit, and rate limiting rather than prompts.

Instance-scoped settings may be writable only when their declaration is outside the deny categories
and their live authorization confirms the actor may administer that instance. Admin status never
permits reading or targeting another user's private setting.

## Name and value resolution

The model selects a registry `id`; it never supplies a storage key. The selected declaration then
resolves the value.

Resolution applies Unicode normalization, trims whitespace, collapses internal whitespace, and
compares case-insensitively against exact stored values, display names, and declared aliases. It
does not perform fuzzy matching, prefix matching, or nearest-neighbor selection.

Examples:

- `appearance.theme` + `Forest` resolves to stored theme id `light`.
- `appearance.theme` + `dusk` resolves to stored theme id `dusk`.
- `appearance.colorMode` + `dark mode` resolves to stored value `dark`.

Aliases are local to one setting declaration. `dark mode` is an alias for color mode, not permission
to guess which visual theme the user meant. Runtime choices are supported: `appearance.theme` reads
the six built-in themes plus the current user's custom themes from the module-owned resolver, so the
same exact-name rules apply to both.

Unknown input returns `invalid` with the setting display name and allowed user-visible choices.
Ambiguous input returns `invalid` naming the conflicting display names. Neither case writes, audits a
success, pushes undo state, or silently picks a value.

## Tool surface

Expose one generated write tool:

`settings.set`

Its schema is a generated discriminated `oneOf` over writable registry declarations. Each branch has
a constant `setting` id and that declaration's actual value schema. Declarations that need a target,
such as module notification enablement, add a narrowly validated target object to their branch.

Representative inputs:

```json
{ "setting": "appearance.theme", "value": "Forest" }
```

```json
{ "setting": "notifications.moduleEnabled", "target": { "moduleId": "news" }, "value": false }
```

`setting` is an enum of public ids generated from writable declarations, not a free-form preference
key. After schema validation, execution performs another registry lookup and classification check;
the schema is guidance, not the security boundary.

The result contains the setting id, setting display name, canonical user-visible value, whether the
state changed, and server-owned consequence text when required. It does not expose storage keys,
prior secret values, or raw audit metadata.

Keep these existing tools:

- `settings.undoLast` for "change that back" in the same actor/chat scope;
- `app.getMapSlice` for navigation help, independent of the writer registry.

## Write flow

1. Resolve the constant registry id from the generated schema input.
2. Reject missing, denied, or centrally excluded declarations.
3. Run the declaration's live authorization with `AccessContext` limited to
   `{ actorUserId, requestId }`; derive user ownership from the actor.
4. Resolve aliases/runtime choices and validate the canonical value before opening a mutation.
5. Read the current value and revision through the declaration's application function.
6. Return a no-op success when the canonical value already matches; do not consume mutation
   retention or push undo state.
7. Apply with #1276's expected revision inside `DataContextDb`. A stale revision returns `conflict`
   and never silently overwrites a UI or concurrent-chat change.
8. Write metadata-only success audit data in the same transaction, including actor, request/chat,
   public setting id, fixed non-secret target id, and before/after revision.
9. Push the opaque mutation record to #1276's bounded actor-and-chat undo stack after commit.
10. Return the user-visible value and any mandatory consequence text.

Authorization, validation, conflict, and transaction failures retain #1276's closed audit outcomes:
`denied`, `invalid`, `conflict`, and `failed`. The gateway's per-actor/per-tool auto-run limiter still
applies to `settings.set`; module/target-aware limits may be added only if the shared tool proves too
coarse in measurement.

Undo calls the same declaration's reverse application function with the recorded resulting revision.
If the row was absent before the write, undo deletes the override rather than pinning an old default.
If another legitimate write changed the revision, undo is cancelled rather than overwriting it.

## Migration from #1276

Replace these six manifest entries with registry declarations consumed by `settings.set`:

- `settings.themeMode.set` becomes `appearance.colorMode` and gains the separate
  `appearance.theme` declaration so all six built-in themes and user custom themes are reachable.
- `settings.locale.setTimezone` becomes `locale.timezone`.
- `settings.locale.setRegionAndDateFormat` becomes `locale.regionAndDateFormat`.
- `settings.quietHours.set` becomes `notifications.quietHours`.
- `settings.weatherLocation.set` becomes `weather.location`.
- `settings.notificationPreference.setEnabled` becomes `notifications.moduleEnabled`.

Keep `settings.undoLast` unchanged apart from resolving mutation records through the registry.

Do not keep the six setters as aliases. Duplicate model-visible tools preserve the enumeration
problem, double the schema surface, and create two paths whose validation can drift. The transition
cost is limited to updating assistant-tool tests, prompts/fixtures that name the old tools, and the
#1264 UAT. Stored preferences and revisions do not migrate because declarations call the same
application functions and storage targets. The shared `settings.preference-write` family and its
existing policy row also remain stable.

Before removal, migrate every existing settings REST/UI writer to the registry-owned application
function and inventory the remaining settings across built-in modules. Each inventory item lands as
either writable or denied in the same change; there is no "unclassified for later" state.

## Install-grant dependency

At `0648d0f1`, `grantSelfOperationForModule` is called only from module enable handlers. The settings
module is required/always-on, so that handler does not run during normal installation and its
`granted_at_install` family can be missing.

The generic writer must not ship around this bug. A prerequisite change must idempotently apply
install-time grants during initial built-in-module installation/bootstrap and backfill existing
owners, while preserving `insertActionPolicyIfAbsent` so a user's explicit tier is never overwritten.
Verification must prove a clean install and an upgraded existing owner both run the first settings
write without a confirmation card.

## Verification

The feature is complete only when all statements below are observable and true:

1. On a clean dev instance, a user signs in, asks in chat "Use the Forest theme", sees no
   Approve/Reject card, sees Jarvis say `Forest`, and the settings UI and page DOM show Forest as the
   active theme after refresh.
2. In the same real chat path, "switch to dusk" changes the UI to the user-visible label `Dusk`, not
   merely an internal `dusk` database value.
3. "Set my theme to midnight" produces a clear unknown-value response listing valid display names;
   the DOM and stored revision do not change.
4. A deliberately ambiguous runtime choice produces a clear ambiguity response naming both choices
   and makes no change.
5. A clean install and an upgraded existing owner both execute their first `settings.set` call with
   no confirmation card, proving the always-on-module grant dependency is fixed.
6. Chat changes timezone, region/date format, quiet hours, weather location, and one module's
   notification enablement; each change appears in the corresponding real settings control without
   a confirmation card.
7. Turning notifications off makes the UI toggle off and Jarvis states in words that notifications
   created while disabled will not be waiting after re-enabling.
8. "Change that back" in the same conversation restores the immediately preceding setting in the UI;
   the same request in another chat cannot consume that undo record.
9. A concurrent UI write between the assistant read and write wins or loses by revision; the stale
   assistant write reports a conflict and never clobbers the UI value.
10. A crafted call using a denied public id or a raw preference key is rejected, creates no mutation,
    and cannot enable YOLO, alter action tiers, change credentials, revoke sessions, or alter persona.
11. Adding a registry declaration without classification fails the build. Adding a settings write
    path without a registry declaration also fails the build. Adding a denied target to the generated
    tool schema fails the build.
12. The generated schema contains all writable registry ids exactly once and no denied ids; the
    runtime registry repeats that assertion over the composed built-in module set.
13. A synthetic loop is bounded by the existing gateway auto-run limiter, while repeated no-op writes
    do not create undo mutations or advance revisions.
14. Full `pnpm verify:foundation` exits zero, followed by security QA because the registry controls a
    broad write path.

The mandatory UAT is a real chat turn through model selection, tool execution, and DOM assertion.
Database-only assertions, a manifest listing, or a test that merely checks a menu exists do not
satisfy criteria 1, 2, 6, or 7.

## Rejected alternatives

- **Keep adding bespoke tools:** already failed coverage; the current theme tool accepts only
  `light`/`dark` while six built-in themes exist.
- **One raw `setPreference(key, value)` tool:** a caller could target YOLO, persona, credentials,
  consent, or any future sensitive key. Registry lookup and classification must sit between tool
  input and storage.
- **Keep old setters as aliases:** preserves duplicate validation and schema drift for no user value.
- **Prompt for broad or uncertain settings:** shifts safety to confirmation fatigue. Unknown values
  refuse; denied categories remain unreachable; writable settings run silently.
- **Use the app map as the registry:** app-map settings are navigation surfaces and contain no
  per-value schema, aliases, validation, classification, application function, or undo behavior.

## Open decisions

None. The directive, classification model, tool shape, migration, and safety boundary are settled by
this spec. New deny categories may be added centrally when a genuinely new authority boundary is
introduced; modules may not remove existing categories.
