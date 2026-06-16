# Spec — Source-behavior policy (calendar/email actionable) (#247)

**Status:** approved (Ben, 2026-06-15, via coordinate grill)
**Epic:** #234 · **Issue:** #247
**Tier:** `sensitive` (cross-module contract — modules consult a shared per-user policy; affects what
Jarvis is allowed to do with a user's data). No migration (persist in `app.preferences`).

## Problem

`settings-personal-data-panes.tsx` (`DATA_SOURCES`) shows per-source behavior **badges**
("Include in briefings", "Use for planning", "Detect commitments", "Write events back"; email:
"Include in briefings", "Capture tasks", "Thread summaries", …) — illustrative only, not persisted,
not enforced (`BACKEND-TODO`). And there's **no behavior-gating mechanism** anywhere yet.

## Locked decisions

1. **Scope A — mechanism + enforce live-only.** Build a real per-user source-behavior policy and
   **actually enforce only behaviors whose feature exists today** (start with **"include in
   briefings"** — briefings already pulls sources). Behaviors whose feature isn't built (e.g.
   calendar write-back, email capture, "use for planning"/focus-blocks which is a separate effort)
   stay explicitly **coming-soon** — no fake/persisted-but-unenforced toggles.
2. **Generic + registry-driven (extensible).** The policy is NOT hardcoded to calendar/email.
   **Modules declare their behaviors in their manifest** (`id`, `name`, `description`, default:
   `on`/`off`/`coming-soon`, owning source). The settings pane renders ALL declared behaviors
   dynamically. **Any module taps in** by (a) declaring a behavior in its manifest and (b) calling
   the shared consult helper — no settings-UI or policy changes needed. (Module isolation: collab
   via declared manifest + shared API, never cross-module internals.)
3. **Persist + consult.** Per-user toggles stored in `app.preferences` (owner-scoped, RLS, no
   migration), keyed by behavior id. A shared **`isBehaviorEnabled(scopedDb, actor, behaviorId)`**
   helper returns the user's setting or the declared default. `coming-soon` behaviors are rendered
   disabled and always read as off (not user-toggleable).

## Build outline (contract)

- **Manifest extension:** add an optional `sourceBehaviors: BehaviorDecl[]` to the module manifest
  shape. Calendar + email modules declare their behaviors (move the current `DATA_SOURCES` list into
  the owning modules' manifests as the source of truth).
- **Policy service/port:** read the declared behaviors across module manifests (the registry already
  exposes `listModuleManifests`); persist/read per-user overrides via the preferences repo (reuse
  the injected `PreferencesRepository` pattern from #235 — no new settings→structured-state dep);
  expose `isBehaviorEnabled` + a list-with-current-values read for the UI.
- **Routes (self, owner-only):** `GET /api/me/source-behaviors` (declared behaviors + current
  values) and `PUT`/`PATCH` to set a toggle. Canonical route shape; new file if `routes.ts` is at
  the line cap.
- **Enforce one live behavior:** briefings consults `isBehaviorEnabled(..., "calendar.briefings")`
  / `"email.briefings"` before including that source. This proves the mechanism end-to-end.
- **UI:** `settings-personal-data-panes.tsx` renders behaviors from the API (not the hardcoded
  `DATA_SOURCES`), real toggles for live ones, disabled "coming soon" for the rest; persist via the
  route; remove `BACKEND-TODO`.

## Invariants / guardrails

- **Module isolation.** Behaviors declared in manifests; modules consult the shared helper — no
  module reads another's tables/internals. Briefings gating calendar = via the policy API, not by
  importing calendar.
- **Owner-only.** Policy reads/writes are owner-scoped (preferences RLS). A user sets only their own.
- **Default-safe.** Unknown/unset behavior → declared default. `coming-soon` → always off, disabled.
- **No fake enforcement.** A behavior is only togglable/enforced if its feature actually honors the
  policy; otherwise it ships as coming-soon.

## Out of scope

- Building the underlying features that don't exist yet (calendar write-back, email capture,
  planning/focus-blocks) — those land in their own work and flip coming-soon→enforced by adding the
  one consult-helper check.
- Vault/notes behaviors (#248) — separate, though it can reuse this same policy mechanism later.

## Verification

- Unit: `isBehaviorEnabled` (returns override > default; coming-soon always off); manifest behavior
  declaration aggregation across modules.
- Integration: set "include in briefings" off → briefings omits that source; per-user isolation
  (user B's toggle independent); a newly-declared behavior in a test module appears in the
  list-API and is enforceable; non-admin can set only own toggles.
- Manual: toggle a live behavior, observe the effect; confirm coming-soon ones are disabled.
