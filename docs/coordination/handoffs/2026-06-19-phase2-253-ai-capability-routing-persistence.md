# Build Handoff — phase2-253-ai-capability-routing-persistence

**Spec (approved):** docs/superpowers/specs/2026-06-18-ai-capability-routing-persistence.md
**GitHub issue:** #253
**Risk tier:** `security`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/phase2-253-ai-capability-routing-persistence   **Branch:** phase2-253-ai-capability-routing-persistence
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019ee077-bf3e-7f60-90ff-6d811fd92ed7`
**Relay threshold:** observable, not felt — `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` on your OWN pane and relay when its context/usage indicator shows ~2/3-3/4 consumed, OR after plan-approval + ~5-8 committed tasks, OR immediately on a compaction summary in your own context.

## Start

1. Confirm you can invoke `coordinated-build`; if not, open the absolute build-skill path above.
2. `[ -d node_modules ] || pnpm install`.
3. Read the spec above IN FULL.
4. Invoke `coordinated-build`: write the plan, message `Coordinator` for approval, stop until approved, then build TDD/green and close out with `coordinated-wrap-up`.

## Your compact

- Work only in this worktree/branch. Stage only your files.
- Plan approval comes from the coordinator, not Ben.
- Escalate to the `Coordinator` label on blocker, plan ready, design fork, review request, or done. Before messaging, verify exactly one pane has that label.
- Never touch the project board, milestones, merge, or `docs/coordination/` except your own handoff if relaying.
- Honor CLAUDE.md invariants: no credential exposure, provider-agnostic AI, DataContextDb only, metadata-only payloads.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- #252/#329 just landed provider test/model discovery on `origin/main` (`3e526d1`). Build on that shape; do not undo it.
- #306 is blocked on missing `JARVIS_IMAGE_TAG`; do not touch deploy checkpoint work.
- Main shared tree has foreign edits in `README.md` and `docs/superpowers/specs/2026-06-18-wellness-adversarial-remediations.md`; your worktree is isolated, but never broad-stage from the shared tree.
- Use existing AI/settings patterns. `app.instance_settings` is acceptable for V1 if it is the smallest fit; add a dedicated table only if it is genuinely simpler or needed for constraints.
- Security focus: admin-only writes, non-admin metadata privacy, stale manual routes fail open to automatic routing, credentials never reach responses/logs/jobs/prompts.
- Gate note: use isolated `JARVIS_PGDATABASE`; retry `verify:foundation` once on cluster-global grant contention (`tuple concurrently updated`).
