# Handoff — #988 closing acceptance planning

## Assignment

Draft the missing approved-spec candidate and executable acceptance plan for GitHub issue #988,
“Dogfood UX: finish visual polish and run the closing acceptance walkthrough.” This is the final
product lane in run `2026-07-12-ux-hardening`.

## Workspace and authority

- Worktree: `~/Jarv1s/.claude/worktrees/plan-988-closing-acceptance`
- Branch: `plan/988-closing-acceptance`
- Coordinator routing label: `UX Coordinator`
- Coordinator immutable Codex session: `019f6c1d-6044-7d51-8473-3e469192b324`
- You have planning authority only. You have no merge authority.

## Hard scope

- Read live GitHub issues #988 and parent #983 first; GitHub is the status source of truth.
- Produce a concise spec candidate under `docs/superpowers/specs/` and an executable plan under
  `docs/superpowers/plans/` that separate:
  1. evidence-only closing walkthrough work;
  2. already-landed behavior that only needs verification;
  3. any remaining code changes requiring their own locked decisions.
- Map every #988 checkbox to a proof method, deliberate deferral, or scoped implementation task.
- Reuse existing repo UAT/Webwright machinery and evidence where it actually applies. Do not
  invent another harness.
- Preserve issue #988's manual-acceptance character. The plan must cover desktop and narrow live
  walkthroughs, first-time onboarding, deeper News, microphone checks against #900/#901, and the
  final #983 narrated/release-note evidence.
- Identify any decision that Ben must approve before implementation. Do not silently decide
  product behavior that #988 or existing specs leave open.

## Prohibitions

- Do not edit feature code.
- Do not run a build implementation or merge anything.
- Do not edit `docs/coordination/2026-07-12-ux-hardening.md`; coordinator-only.
- Do not move or close GitHub issues/project items.
- Do not run repo-wide formatting or use broad staging; stage only your planning files.
- Do not touch review lanes E/F/G or primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.

## Finish

1. Verify the two planning documents against live #988/#983.
2. Commit only those documents and this handoff if needed, push the branch, and open a draft PR.
3. Message `UX Coordinator` with: PR number, commit SHA, concise locked-scope summary, and explicit
   open approval questions. Then stop; no implementation begins until Ben approves the spec.
