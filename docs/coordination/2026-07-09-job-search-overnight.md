# Job Search Overnight Run — 2026-07-09

**Coordinator lock:** label `Coordinator`, session `c99d19d5-be17-4ce5-a7c9-d6ce4b9f0fec`,
pane `w1:pCM`, tab `w1:t15`. (Same lock as `2026-07-09-next-wave.md` — that manifest's wave is
fully merged; this is a fresh manifest for the new overnight initiative per Ben's handoff.)

## Ben's directive (verbatim intent)
Build everything needed for the Intelligent Job Search module tonight. Fable 5 ("Fable 5: Job
Search Spec Review") drafts/approves plans first. Adopt overnight fleet under single Coordinator
lock. **Do not spawn any build lane until its spec AND implementation plan are approved.**
Suggested order #917→#914→#918→#919→#915→#916 — **explicitly told to revalidate, not trust.**
Ready lanes → Codex `gpt-5.6-sol` high reasoning, isolated worktrees, then independent
security-tier QA + Ben sign-off where required.

**Mid-turn addendum (2026-07-09, this checkpoint):** Ben: "any approvals can be escalated to a
fresh gpt-5.5-sol extra-high and a fable 5 high. Not everything needs that, just the ones that
would surface to me." → For judgment calls that would otherwise need to page Ben (design forks,
readiness verdicts, tier calls), spin up a Codex `gpt-5.6-sol`-class agent at extra-high reasoning
+ a Fable 5 (Claude) agent at high effort as a two-model adjudication panel **instead of** paging
Ben — but only for calls that would actually have surfaced to him; routine mechanical stuff still
resolves inline, no escalation needed.

## Revalidation results (read-only recon, this checkpoint)

| Issue | Labels | Spec status (ground truth) | Plan status |
|---|---|---|---|
| #913 (epic) | epic | Drafted+"approve" commit in `/tmp/jarv1s-913-spec` (branch `spec/913-intelligent-job-search`) but **NOT merged to main** — no spec PR found via `gh pr list`. Spec file: `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md` (local to that worktree only). | Not found. Root-level `PLAN.md`/`PLAN-REVIEW-LOG.md` in that worktree are **stale leftovers from an unrelated prior Wellness-module task** — ignore, not the job-search plan. |
| #914 | task, RFA | **MERGED** — PR #920, `docs/superpowers/specs/2026-07-09-module-data-plane.md`, merged to main 2026-07-10T04:49:35Z. Spec is real and landed. | Not yet located — needs check for an implementation plan doc/PR. |
| #915 | task, needs-spec (GitHub label stale) | In progress in `review-913-job-search-spec` worktree: "revision 2 — incorporate adversarial review round" on top of "external worker capabilities — queues/schedules, structured-AI RPC, pinned fetch". **Not merged**, no spec PR yet. | Not found. |
| #916 | task, needs-spec | No spec activity found anywhere. | Not found. |
| #917 | task, RFA | **No spec PR, no spec commits found anywhere** — despite being first in Ben's relayed dependency order. | Not found. |
| #918 | task, RFA | No spec activity found. | Not found. |
| #919 | task, RFA | No spec activity found. | Not found. |

**Verdict: only #914 currently has a genuinely approved (merged-to-main) spec. None have an
approved implementation plan yet.** The relayed order #917→#914→... does not match actual
readiness — #917 (meant to be first) has no spec at all yet; #914 (meant to be second) is the
only one actually spec-complete. **Do not spawn any build lane yet.** This contradicts "approved
mapping" framing in the handoff — flag to Ben/Fable 5, don't silently reorder.

Epic #913 body confirms hard dependency: job-search module is blocked by / must target the
pluggable-module runtime in **epic #860** (see `[[pluggable-modules-epic]]` memory — migrations
coupling, install=privileged-ops, two-bundle runtime load, supply-chain signing, phases 0→3).
#914/#917/#918/#919 read as pieces of that #860 module-system runtime (module data plane,
privileged install, module system slices) — i.e. this "job search" overnight wave and epic #860
are the same collision surface. Collision map still needs a proper one-shot Opus pass before any
dispatch (Phase 0 step 3) — not yet done.

## Live fleet (job-search-relevant panes, from `herdr pane list` this checkpoint)
- `w1:pCK` "Codex: Job Search Spec" — codex agent, session `019f49ed-b7eb-7693-9460-0151efe99769`, idle, cwd `/home/ben/Jarv1s`.
- `w1:pCR` "Fable 5: Job Search Spec Review" — claude agent, session `d2661a6c-e15e-4e42-8b27-71c99bb70423`, working, cwd `.claude/worktrees/review-913-job-search-spec`.
- Not part of this task (do not touch): `w1:pCP` "Fable: sports-fed spec+plan", `w1:pCQ` "Fable: PR review 908/909/910" (worktree already deleted).

**Do-not-reap:** `/tmp/jarv1s-913-spec` (branch `spec/913-intelligent-job-search`) — Codex's draft
spec worktree, awaiting Ben approval. Exempt from any repo-hygiene sweep.

## Next actions for successor coordinator
1. Message `w1:pCR` (Fable 5) directly with this table — ask for its current verdict on #915's
   spec-approval state and whether #913's epic spec is ready to open as a PR against main.
2. Send a short status ping to `w1:pCK` (Codex) — keep it informed per Ben's instruction, ask
   status on #917 (first in the relayed order, currently spec-less).
3. Do the Phase-0 collision map (one-shot Opus subagent) cross-referencing #860's pluggable-module
   blockers against #914/#917/#918/#919.
4. For any readiness/tiering/design-fork judgment call that would otherwise page Ben: use the
   two-model panel (Codex gpt-5.6-sol extra-high + Fable 5/Claude high) per his mid-turn addendum
   above, reserving direct escalation to Ben for calls that genuinely need his sign-off (security
   tier merges, non-mechanical scope decisions).
5. **Still do not spawn any build lane** until spec-merged-to-main AND an approved plan exist for
   that specific issue. #914 is closest (spec merged) but has no plan yet — check with Fable 5
   whether one is in progress.
6. Once ready lanes exist: spawn via Codex `gpt-5.6-sol` high reasoning, isolated worktrees, then
   independent security-tier QA (likely tier for all of these — privileged install, module data
   plane, external-worker RPC/fetch all hit the security-tier triggers) + Ben sign-off.

## Relay note
This manifest was written at a 72%-context checkpoint immediately after completing the
revalidation above. No build lane has been spawned; no panes have been messaged yet. Coordinator
is about to self-relay (spawn successor in tab `w1:t15`, same pane) per the coordinate skill's
context-meter trigger.
