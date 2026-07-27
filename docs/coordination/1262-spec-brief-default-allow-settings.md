# Spec brief — default-allow settings writer (epic #1262)

**You are writing a design spec, not code.** Output one file:
`docs/superpowers/specs/2026-07-27-settings-default-allow-writer.md`. Do not implement anything.
Do not touch `docs/coordination/` other than reading this brief.

## Ben's directive (verbatim, 2026-07-27)

> "I don't want to have to define every setting that Jarvis can change. I want it to be able to
> change every setting unless we say it can't."

This **replaces** the approach in the approved spec
`docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`, which enumerates one
bespoke tool per setting. Read that spec first — your spec supersedes its tool-per-setting model and
must say so explicitly, including what of it survives.

## Verified current state (grounded, do not re-derive from memory)

Branch `1264-settings-self-operation` @ `0648d0f1` (PR #1276, unmerged).

- Seven hand-written settings tools exist, declared in `packages/settings/src/manifest.ts:451-540`:
  `settings.themeMode.set`, `settings.locale.setTimezone`,
  `settings.locale.setRegionAndDateFormat`, `settings.quietHours.set`,
  `settings.weatherLocation.set`, `settings.notificationPreference.setEnabled`,
  `settings.undoLast`. Each has its own file and its own input schema.
- **Coverage is already wrong.** `packages/settings/src/theme-mode-tool.ts:16` accepts only
  `["light","dark"]`. There are six themes (`BuiltInThemeId` in `packages/shared/src/themes-api.ts:25`
  = light | sage | canyon | teal | dusk | dark). Four cannot be set by any tool. This is the
  enumeration problem making itself.
- **Display names differ from ids.** `packages/settings/src/themes-routes.ts:30` is
  `{ id: "light", name: "Forest" }`. The UI shows "Forest"; the tool takes `light`. A user asking
  for the name they can see cannot be served. Any design that does not resolve user-visible names is
  a non-answer.
- **No settings registry exists.** `scripts/build-app-map.ts:31-32` maps `manifest.settings` to
  settings *surfaces* (which panes exist) — navigation-level only. Nothing describes an individual
  setting's key, type, legal values, or display name. **Building that registry is the bulk of this
  work**; treat it as the spec's centre, not a detail.
- Preferences live in `app.preferences` (`owner_user_id, key, value_json, revision`). The `revision`
  column is #1276's optimistic-concurrency anchor.
- #1276 also lands machinery the generic writer needs regardless: an undo stack
  (`packages/settings/src/undo-stack.ts`), audit outcomes widened to include `conflict`/`invalid`
  (`packages/ai/sql/0177_audit_outcome_widen.sql`), and an auto-run rate limiter
  (`packages/ai/src/gateway/auto-run-rate-limit.ts`). Assume these exist; design on top of them.

## The safety property that must survive (non-negotiable)

Today's invariant: **every write tool must declare `selfOperationGrant`, and declaring nothing fails
the build.** The build failure *is* the safety property. Default-allow must not delete it — it must
invert it:

- **Product behaviour:** every setting is assistant-writable by default. No enumeration to opt in.
- **Build behaviour:** every setting must be **classified** — writable or denied — and an
  unclassified setting **fails the build**. This is what stops someone adding an auth, credential,
  or permission setting in six months and silently handing it to the model.

Specify the deny categories concretely and argue each: at minimum anything touching auth/sessions,
connector or AI credentials, and the self-operation permission settings themselves (a setting that
can widen the model's own authority is self-promotion to YOLO and is banned outright).

## Questions the spec must settle

1. **Where the registry lives and what a setting declaration contains** — key, type, legal values,
   display name(s), classification, and how a value is validated before write. A generic writer with
   no per-setting validation lets the model write garbage; say exactly how that is prevented.
2. **Name resolution.** How "Forest", "dusk", "dark mode" map to stored values, and what happens on
   an ambiguous or unknown name. Failure must be a clear refusal, never a silent nearest-match.
3. **The tool surface.** One generic tool, or a small family? What its input schema is. **No tool may
   take a raw preference key as a free-form parameter** unless the registry validates it against the
   classification — an unvalidated key parameter is self-promotion to YOLO.
4. **Migration.** What happens to the seven existing tools: replaced, or kept as aliases. Say which,
   and what the transition costs.
5. **Concurrency and undo** on a generic path, reusing #1276's `revision` CAS and undo stack.
6. **Confirmation policy.** Which classifications are silent, which confirm. Ben's governing ruling
   for this epic is **"guardrails, not permission prompts"** — a design that prompts routinely has
   failed. Note that `granted_at_install` is currently broken for always-on modules (the grant is
   only written by a module-*enable* handler that never fires for required modules); do not design
   around that bug, but state the dependency.
7. **How this is tested so it cannot pass while broken.** See below — this is a required section.

## Required section: verification

A settings feature just passed every gate and failed in Ben's hands three ways. Cause: tests
asserted database state; the UAT spec (`tests/uat/specs/1264-settings-self-operation.uat.spec.ts`)
only logs in, checks a menu is visible, and asserts a persona tool is absent. Nothing drove the real
path and looked at the screen.

Your exit criteria must therefore be **user-observable statements**, not "add e2e coverage" — a
login smoke test satisfies the latter. At least one criterion must drive chat turn → tool → DOM
assertion, and assert on the words a user sees ("Forest"), not internal ids.

## Constraints

Hard invariants in `CLAUDE.md` apply — no admin private-data bypass, private by default,
`DataContextDb` only, `AccessContext` is `{actorUserId, requestId}` only, secrets never escape,
metadata-only job payloads, provider-agnostic AI, module isolation, never edit applied migrations
(`0175`/`0176`/`0177` are FROZEN). Preserve the authored design system; no new fonts or raw colors
outside `tokens.css`.

Scope: **spec only.** No code, no migrations, no tool implementations. Flag anything you believe
needs Ben's decision rather than deciding it yourself — mark those clearly in an "Open decisions"
section. When the file is written, commit it by explicit path (never `git add -A`) and report the
path back to the Coordinator pane. Do not open a PR.
