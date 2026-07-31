# Handoff — spec author for #1327 (briefing action rows)

**Role:** spec author only. Model: Codex `gpt-5.6-sol` at `high` reasoning.
**You write a design spec and stop. You do not write feature code.**
**Coordinator:** label `Coordinator`, Claude session `43e5f5e2-0deb-4ab5-9237-436e8795b611`.
Re-resolve the pane fresh via `herdr pane list` before messaging — never trust a written pane number.

**Worktree:** `~/Jarv1s/.claude/worktrees/spec-1327` (you are in it), branch
`spec/1327-briefing-action-rows`, based on `origin/main` at `d984879c`.

## Deliverable

One file: `docs/superpowers/specs/2026-07-29-1327-briefing-action-rows.md`.

Commit it (message: `docs(specs): design spec for briefing action rows (#1327)`) and push the
branch. Do **not** open a PR. Do **not** write any code outside `docs/superpowers/specs/`. Do
**not** touch `docs/coordination/` — that is coordinator-only.

Then report back to the `Coordinator` pane with: the spec path, the commit sha, and a **five-line
maximum** summary — the design fork you resolved, anything you had to decide that the issue did not
settle, and any open question you want Ben to rule on. The coordinator takes it to Ben; **the spec
is not approved until Ben says so, and no build lane opens before that.**

## Read first, in this order

1. `gh issue view 1327` — read it **in full**. It is long and it is the requirements document. It
   already contains Ben's locked decisions (`## Decided (Ben, 2026-07-27)`), a list of things the
   code already does (`## Already answered by the code`), and a `## Where to draw the line for v1`
   section that fixes the v1 scope. **Those three sections are settled. Do not re-open them, do not
   re-litigate them, and do not "improve" on them** — if you think one of them is wrong, say so in
   your report to the coordinator instead of quietly speccing something else.
2. `docs/DEVELOPMENT_STANDARDS.md` — especially the LLM field-exfiltration rules.
3. `CLAUDE.md` in the repo root — the hard invariants apply to this spec.
4. Two recent approved specs, for shape and depth:
   `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` and
   `docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md`.

## Verify before you build on it

The issue's code claims were checked on **2026-07-27** and this branch is from **2026-07-29**.
Re-verify each file:line reference you rely on against the current tree before you spec against it.
A spec grounded on a stale citation is the failure mode here. Name the commit you grounded on in
the spec's header.

The seams the issue names, all worth reading yourself:

- `packages/briefings/src/compose.ts` — `composeBriefing`, the prose-only bottleneck. **This is the
  actual work.**
- `packages/briefings/src/trust-boundary.ts` and the trusted preamble in `compose.ts`.
- `packages/briefings/src/freshness.ts`.
- `packages/connectors/src/email-extract.ts` — extraction, actionability categories, and the
  `safeSignalStr` body-echo guard.
- `packages/connectors/src/source-context/email-tasks.ts` — `effectiveConfidence()`,
  `emailTaskExternalKey()`, the confidence floors.
- `packages/connectors/src/monitor-jobs.ts` — rows are computed continuously here, not at briefing
  time.
- `packages/db/src/types.ts` — `TaskStatus`, including `"suggested"`.
- `packages/shared/src/tasks-api.ts` — `TaskDto.source` / `sourceRef`.
- `packages/email/src/tools.ts` — `email.draftReply` / `email.sendReply`.
- `apps/web/src/today/today-suggested-email.tsx` — the existing row UI, in the wrong place.
- `packages/memory/src/graph-recall-service.ts` — `GraphMemoryRecallService.recall()`.
- The #1282 module→briefing seam.

## Constraints that are not negotiable

- **Spec before build** is a hard gate. Your spec is what unblocks the build; it must be
  executable by a builder who has not read the issue.
- **Module isolation** — modules collaborate only through declared public APIs/events.
- **Provider-agnostic AI** — request a capability, never name a model or provider.
- **Metadata-only job payloads** — if any of this moves to a worker, the pg-boss payload carries
  actor/resource ids, job kind, idempotency key and small command params only. No message content,
  no prompts, no secrets.
- **Any new stored model-written field needs the same body-echo guard** as `email-extract.ts`. Say
  explicitly, per field, which guard applies.
- **`DataContextDb` only** for repositories; `VaultContext` for vault I/O.
- **RLS applies to every actor.** Classify any new table or column: owner-only / owner-or-share /
  recipient-only.
- **Never edit an applied migration.** If you need schema, spec a *new* migration file and say
  where the number comes from (numbers are global and assigned by landing order — do not hardcode
  one; say "next free number at build time").
- **Design system:** extend the existing `jds-*` and `loose-row` primitives. No new raw colours
  outside `apps/web/src/styles/tokens.css`. No mono, no serif. Empty and loading states use
  existing authored patterns — requirement 10 in the issue is a real deliverable, not a footnote.
- **"vault" means two different things in this repo.** Ruling 4 in the issue means the **ingested
  Obsidian notes** (a knowledge source) and the **memory graph** — never the `@jarv1s/vault`
  package, which is file-access plumbing. A spec that confuses them builds against the wrong seam.

## What the spec must actually contain

Enough that a Sonnet builder can execute it task-by-task without re-deriving anything:

1. **The structured-payload channel out of `composeBriefing`.** This is the centre of the spec —
   how discrete rows travel alongside the prose, how the two are kept from contradicting each other
   or saying the same thing twice, and what the contract looks like in
   `packages/shared/`. Everything else in the issue is comparatively easy.
2. **The row contract** — fields, provenance, which button each actionability category gets, and
   the accept/dismiss transitions it reuses.
3. **Suppression and resurfacing** — the normalised-subject key (issue says reuse the
   `createMemoryFactSignature()` pattern from `packages/memory/src/fact-signature.ts`), the
   two-dismissals-and-it's-gone rule, and the two comeback triggers. Volume is explicitly not a
   trigger. Say where the state lives and how it is read on the hot path.
4. **The catch-up summary** — email only for v1.
5. **Task breakdown** — dependency-ordered, each task independently committable, naming the exact
   files, symbols, and test names. Flag which tasks are user-facing.
6. **Risk tier** for the build, with your reasoning. Read the tiering table in
   `.claude/skills/coordinate/SKILL.md`. Given stored model-written text and a new trust-boundary
   surface, expect at least `sensitive`.
7. **Exit criteria**, including the live-path gate: this is user-facing, so it needs live proof on
   a real dev instance recorded on the PR, plus an e2e test, before anyone calls it done.

## Escalation

If you hit a genuine product or architecture fork the issue does not settle, **stop and ask the
coordinator** — tag the message `[DESIGN-FORK]`. Do not guess and do not silently pick. Message via
`herdr pane run <coordinator-pane> "<msg>"` after resolving the pane by label.

Ben is asleep. Nothing goes to him directly; everything routes through the coordinator.
