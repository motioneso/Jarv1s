# Relay — #1187 QA-RED remediation, continuation (2026-07-20, context 70%)

**Read first:** `docs/superpowers/handoffs/2026-07-20-1187-qa-red-remediation.md` (full root-cause
+ fix plan, still authoritative). This doc only tracks what's done vs left.

**Branch/worktree:** this worktree, `feedback/1187-module-library-clean`. PR #1202 (OPEN, do not
merge). `[ -d node_modules ] || pnpm install` (should already be present).

## Done (committed `70efae3f`)

1. `tests/uat/specs/job-search-install.uat.spec.ts` — rewritten for the new Group/Row DOM:
   scoped to `.pane__card` "Module library" → `.set-row` "Job Search"; clicks "Download and
   install"; dropped the never-rendering "Not installed"/"Installed" text assertions; proof of
   state change is now the enable switch's `toBeChecked()` + the install button becoming
   `not.toBeVisible()`.
2. `apps/web/src/settings/settings-feedback.tsx` — `FeedbackProvider` now accepts an optional
   `initialDialog?: ConfirmOptions | null` prop (defaults preserve current behavior exactly).

## Left to do

1. **Render test proving capability-consequence copy renders** (fix plan item 2, NOT started):
   - File: `tests/unit/settings-instance-modules-pane-render.test.tsx` (existing file, read it —
     has the `renderWithQuery`/`FeedbackProvider` import pattern already).
   - Add a new `describe` block that imports `describeCapabilityConsequences` from
     `../../apps/web/src/settings/settings-module-registry-section.js` and the `row()`-style
     fixture helper pattern from `tests/unit/module-registry-row-model.test.ts` (construct a
     `ModuleRegistryRowDto` with non-null `capabilities`, e.g. `fetchHosts: ["api.acme.example"]`).
   - Render: `createElement(FeedbackProvider, { initialDialog: { title: "Install X?",
     description: describeCapabilityConsequences(rowWithCaps), confirmLabel: "Download",
     onConfirm: () => {} } }, createElement("div"))` via `renderToString` (no QueryClient needed
     for this specific assertion — plain `FeedbackProvider` render is enough since the dialog
     seeds directly).
   - Assert: `html.includes('jds-dialog__desc')` and the consequence sentence text (e.g. "This
     module can connect to the internet") appears in that markup.
   - Do NOT alter `describeCapabilityConsequences` output/semantics — reserved for Ben's sign-off.

2. **Run the fixed UAT spec against a real provisioned stack** until green (`pnpm test:uat` or
   the project's UAT runner — check `package.json` scripts; the spec needs
   `JARVIS_UAT_PROJECT_NAME`/`JARVIS_UAT_BASE_URL` set by the runner, don't set manually).

3. **Pre-push trio**: `pnpm format:check`, `pnpm lint`, `pnpm typecheck` — all must be green.
   Plus `pnpm test:unit` scoped to the changed/new test files (at minimum
   `settings-instance-modules-pane-render.test.tsx`).

4. **Rebase onto `origin/main`** (fetch first, target was `97b5bd52`+ per the QA-RED doc — check
   for newer). Resolve conflicts if any.

5. **Push to PR #1202. Never merge.** Report verified evidence (UAT spec pass, gate green,
   rebase clean) back to the user.

## Explicit non-goals (unchanged)

- Do NOT alter capability-disclosure semantics (host/tool/table specificity) — reserved for Ben.
- No merge, under any circumstance.

## Guardrails (unchanged, carried from prior relays)

- Never `git add -A` — explicit paths only.
- `.claude/context-meter.log` is hook-managed — don't stage/commit it.
- Isolate any DB-touching gate step via a throwaway `JARVIS_PGDATABASE`, never the shared `jarv1s`
  DB (create via `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE <name>;"`, drop
  when done).
- Another worktree (`feedback-1188-connector-onboarding`) sometimes runs vite on port 4173 —
  check `ss -ltnp | grep 4173` before assuming it's free.

## Coordination

No coordinator pane tracked for this remediation — this is a direct user-assigned task (Ben asked
directly, no `coordinate` run in force). Report completion straight back to the user, not to a
Coordinator pane.
