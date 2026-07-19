# Relay — #1187 module library (build lane)

**Spec:** `docs/superpowers/specs/2026-07-19-1187-module-inventory-feedback.md`
**Plan:** `docs/superpowers/plans/2026-07-19-1187-module-library.md` (written, matches Coordinator
pre-approval verbatim — plan not yet re-approved after grounding since it IS the pre-approved
scope; treat approval as granted, proceed straight to build unless something in the plan surprises
you).
**Worktree/branch:** this worktree, `feedback/1187-module-library` (based on `coord/1179-pdf`).
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9` — re-resolve
pane by label+session id at message time, never a baked `…-N`.
**Tier:** security.

## State

- Plan file committed? **NOT YET** — commit it first thing (explicit path, not `git add -A`):
  `git add docs/superpowers/plans/2026-07-19-1187-module-library.md`
- No implementation code written yet. Working tree otherwise clean.
- Coordinator already messaged: plan pointer + wrap-up override ack (see below). No reply needed
  before building — proceed under the pre-approval.

## Run-specific wrap-up override (from the user, this run only)

**Do NOT push or open a PR at wrap-up.** Stop after: clean local commits (all plan tasks) + a
compact verification report sent to the Coordinator. Coordinator will integrate this branch
itself for #1178 visual QA and later cut a clean main-based PR. This supersedes the normal
`coordinated-wrap-up` push+PR steps — everything else in that skill (full gate, evidence in the
report) still applies, just stop before push/PR.

## Next steps (in order)

1. Commit the plan file (explicit path).
2. Execute `docs/superpowers/plans/2026-07-19-1187-module-library.md` tasks 1-4 via
   `superpowers:test-driven-development`, one commit per green task, explicit-path `git add` only.
   Read the plan file itself (already grounded/short) and the spec BY SECTION, not front-to-back.
3. Pre-push trio before any push is even considered (it won't be, per the override) is not
   needed this run — skip push. Still run `pnpm format:check && pnpm lint && pnpm typecheck` and
   `pnpm test:unit` after each task/at the end to keep it green.
4. Run the two targeted e2e specs once code changes land:
   `pnpm exec playwright test tests/e2e/settings-modules.spec.ts tests/e2e/external-modules.spec.ts`
5. Run full gate `pnpm verify:foundation` before the final report.
6. Send the Coordinator a compact verification report (files touched, gate exit codes, spec
   acceptance-box status) per the wrap-up override above. Do not push/PR/merge/touch board.

## Coordinator correction (received after plan was written, 2026-07-19)

**APPROVED — no design fork.** One placement fix: define `libraryAction` in
`settings-module-registry-section.tsx`, not in `settings-instance-modules-pane.tsx` — the pane
already imports the section, so putting it in the pane would create a circular import. Already
applied to the plan file (task 1). Everything else in the plan stands as pre-approved.

## Key design judgment already made (flag if reconsidering)

Decision-4 capability translation: no hardcoded permission-id→phrase table (vocabulary is
open/module-extensible). Instead lead the confirm-dialog description with a consequence sentence
built from structured DTO fields (`fetchHosts`→network access, `tools[].risk`→side-effecting
tools, `ownsTables`→stored data), and keep raw permission ids as a secondary detail line (not
deleted — preserves the non-goal against weakening risk info).

## Guardrails (unchanged)

No edits to `settings-page.tsx`, routes, schema, auth/RLS, hash/integrity, worker, or lifecycle
state derivation. If any of those turn out necessary, stop and escalate to the Coordinator
(label `Coordinator`, re-resolve pane fresh) before touching them.
