# Plan — #1187 unified, actionable module library

**Spec:** `docs/superpowers/specs/2026-07-19-1187-module-inventory-feedback.md`
**Tier:** security (UI-only; no route/schema/auth/hash/state-machine/settings-shell change)
**Coordinator pre-approval:** received 2026-07-19 — scope confirmed to the 3 files below.

## Grounding (verified against this branch)

- `settings-instance-modules-pane.tsx`: renders 2 separate blocks today — a built-in
  "Optional modules" `Group` (from `listAdminModules`, `!module.required` already filtered,
  so no Required badge here) and a conditionally-shown "External modules" `Group` (trust
  warning always renders whenever `external?.enabled`, regardless of whether any undeclared
  module actually exists — this is the decision-5 bug).
- `settings-module-registry-section.tsx`: separate `<section><h3>Available modules</h3>` with
  its own `<ul>` markup (not `Row`/`Group` primitives), a `describeCapabilities()` that dumps
  raw `capabilities.permissions` id strings, and button label "Install" (spec wants "Download
  and install" wording per decision 2).
- Registry rows (`ModuleRegistryRowDto`, via `deriveModuleRegistryRows`) are a **different
  DTO family** from built-in optional modules (`AdminModuleDto`) — merging means rendering
  both into one `Group`/`Row` list client-side, not a shared backend shape. No backend change.
- `capabilities.permissions` are raw `permissionId` strings from `manifest.assistantTools`
  (`scripts/publish-module-registry.ts:119`), open-vocabulary and module-defined — do NOT
  invent a translation table (would misrepresent unknown ids). Instead: lead the confirm copy
  with a plain consequence sentence built from the *structured* fields already on the DTO
  (`fetchHosts` → network access, `tools[].risk` → side-effecting tools, `ownsTables` → stored
  data), then keep the raw permission ids as a supporting detail line — preserves full risk
  info (non-goal: "no weakening... of install risk information") while leading with
  consequences (decision 4).
- No unit-test infra exists inside `apps/web`; tests for these files live at repo-root
  `tests/unit/*.test.tsx` (see `settings-instance-modules-pane-render.test.tsx`,
  `instance-modules-dedup.test.tsx` — same `renderToString` + pre-seeded `QueryClient`
  pattern, no network mocking). E2e: `tests/e2e/settings-modules.spec.ts` asserts
  `getByText("Available modules")`; `tests/e2e/external-modules.spec.ts` asserts
  `getByText("External modules", { exact: true })` — both need copy updates for the merge.

## Tasks (each commits green)

1. **Row-action + capability-consequence helpers.** **Coordinator correction (2026-07-19):
   define `libraryAction` in `settings-module-registry-section.tsx`, NOT the pane file** —
   the pane already imports the section, so a pane→section import would be fine but a
   section→pane import (if `libraryAction` lived in the pane) would be circular. Export it
   from the registry section (or a new neutral view-model file if it grows) alongside
   `describeCapabilities`'s replacement. `libraryAction(row: ModuleRegistryRowDto): { label:
   string; kind: "install" | "switch" | "none"; reason?: string }` implementing decision 2's
   exact table (absent+compatible → "Download and install"; installed+disabled → "Enable";
   installed+enabled → "Disable"; update/failure/incompatible/pending-restart → existing
   truthful label/reason, unchanged). In `settings-module-registry-section.tsx` replace
   `describeCapabilities` with
   `describeCapabilityConsequences` (consequence sentence first, raw permission ids retained
   as a second sentence, not dropped). Unit tests: extend
   `tests/unit/instance-modules-dedup.test.tsx` (or a new colocated `*-row-model.test.ts`) —
   one case per state in decision 2's table, one case proving raw ids still appear in the
   confirm description alongside the consequence sentence.

2. **Merge into one `Group`.** `settings-module-registry-section.tsx`: drop its own
   `<section>/<h3>Available modules</h3>` wrapper and `<ul><li>` markup; render each row with
   the shared `Row`/`Switch`/button (`jds-btn`) primitives, using `libraryAction` for the
   primary control; keep Remove/Remove+purge/Cancel-purge as secondary controls (unchanged
   mutations/confirm dialogs) and the "Refresh from registry" control. `Row` becomes a plain
   fragment producer instead of owning outer layout. `settings-instance-modules-pane.tsx`:
   wrap the built-in optional rows AND the registry-row fragment in **one**
   `<Group title="Module library" desc="…">` (built-ins first, then registry rows). No new
   list/card abstraction — reuses `Group`/`Row` as-is.

3. **Trust-warning fix (decision 5).** In `settings-instance-modules-pane.tsx`, gate the
   "External modules" `Group` (including its `Note` warning) on
   `filterUndeclaredExternalModules(external.modules, registryIds).length > 0`, not merely
   `external?.enabled`. Extend `tests/unit/settings-instance-modules-pane-render.test.tsx`
   with a case seeding zero undeclared external modules and asserting the warning text is
   absent, alongside the existing present-case.

4. **E2e copy updates.** Update `tests/e2e/settings-modules.spec.ts` and
   `tests/e2e/external-modules.spec.ts` assertions for the new "Module library" heading /
   merged layout (mockExternalModules already seeds one undeclared module, so the warning
   assertion in `external-modules.spec.ts` still holds — just re-anchor if the surrounding
   markup moved). No new spec files; no selector/behavior changes beyond copy.

## Verification

- `pnpm format:check && pnpm lint && pnpm typecheck`
- `pnpm test:unit` (repo-root vitest — covers the new/changed `tests/unit/*.test.tsx`)
- `pnpm exec playwright test tests/e2e/settings-modules.spec.ts tests/e2e/external-modules.spec.ts`
- Full gate (`pnpm verify:foundation`) before wrap-up per CLAUDE.md.
- Exit criteria: spec's 6 acceptance boxes; security QA confirms admin-first auth + trusted
  download/hash path unchanged (no touch to those layers); Ben sign-off before merge.

## Explicit non-changes (guardrail)

No edits to `settings-page.tsx`, any route, schema, auth/RLS, hash/integrity, worker, or
lifecycle state derivation (`module-registry-rows.ts`, routes, repositories). If any of those
turn out to be required, stop and escalate to the coordinator before touching them.
