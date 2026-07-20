# Relay — #1188 connector onboarding (build agent self-relay)

Context meter hit the 70% warning during grounding/planning, before any code was written.
Relaying now per `coordinated-build` step 3, per the coordinator's own instruction ("relay
immediately if context meter warns").

**Spec:** `docs/superpowers/specs/2026-07-19-1188-connector-onboarding-feedback.md`
**Plan (approved, ready to build):** `docs/superpowers/plans/2026-07-19-1188-connector-onboarding.md`
**Branch/worktree:** `feedback/1188-connector-onboarding`, this worktree, based on live
`coord/1179-pdf`.
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9` (pane
`w1:pWH` at relay time — re-resolve by label+session, panes reflow).

## Approval status

Coordinator sent an in-chat PRE-APPROVAL matching this plan's scope exactly (equal
provider-card hierarchy; local provider-specific official help/steps; one-click consent via
sync blank popup + navigate/close-on-error + blocked-popup fallback; explicit add-account mode
overriding connected summary; focused unit/E2E with fake credentials only; no backend/auth
contract/secret-storage changes). **No further approval message is needed — proceed straight
to build (task 1) per the plan file.**

Coordinator also gave a **run-specific wrap-up override**: this branch integrates with live
`coord/1179-pdf` staging. Do **NOT** push or open a PR. Stop after a clean local commit history
(green gate) plus a compact verification report to the Coordinator. Coordinator integrates for
#5178 visual QA and later cuts a clean main-based PR. (This supersedes the normal
`coordinated-wrap-up` push/PR steps — everything else in that skill re: gate discipline and
report content still applies.)

## State: zero code written yet

Only these two docs exist on top of the branch. All grounding is done and captured in the plan
file (exact line numbers, confirmed bugs, verified provider doc URLs, tests that must keep
passing). Read the plan file in full — it is self-contained; do not re-read the spec/handoff
front-to-back.

## Next concrete steps

1. `[ -d node_modules ] || pnpm install` (should already exist — skip if present).
2. Read `docs/superpowers/plans/2026-07-19-1188-connector-onboarding.md` in full.
3. Build tasks 1-6 via TDD, one commit each, `Co-Authored-By: Claude` trailer, explicit-path
   staging only (never `git add -A` — this worktree is not shared, but keep the habit).
4. Self-monitor context; relay again the same way if the meter warns before task 6 completes.
5. On completion: run the full local gate (task 6 in the plan), then **stop** — commit only,
   no push/PR (see wrap-up override above) — and message the Coordinator a compact
   verification report (commands run + exit codes, what changed, plan-file link).
