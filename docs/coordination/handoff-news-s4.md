# Build Handoff — News Slice 4: chat actions, revalidation & notifications

**Spec (approved):** `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`
→ section **Slice 4 — Chat actions, revalidation, and notifications** (within the already-approved
Personalized-News epic spec, #954). Read that section BY SECTION for your current task — never the
full spec (a full read bloats context toward a premature relay).
**GitHub issue:** #975 (Part of epic #954). Follows Slice 3 (#972, merged `41a47486`, in `main`).
**Risk tier:** `security` — owner-private, RLS-scoped news selection; chat-driven WRITE actions
(source/topic add/remove) through the confirm-gated assistant path; user notifications. Build to
that bar: adversarial review + full named council gate the merge.

**Worktree:** this directory (`.claude/worktrees/news-s4`) **Branch:** `news-s4` off `origin/main`
(`ba4ed180`).
**Build skill (absolute):**
`/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/news-s4/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; verify `herdr pane list`
shows EXACTLY ONE `Coordinator` pane, resolved fresh (never a cached pane number).
**Coordinator session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f` (immutable authority).
**Relay trigger:** context-meter 70% warning OR a compaction summary in your own context → message
the coordinator, then use the `relay` skill immediately. **Your relay successor MUST be Fable**
(`claude --model fable`) — News/plan authoring is Fable by Ben's hard policy (no Sonnet authoring
plans or specs).

## Spec-before-build status (why you can build now)

Slice 4 is an explicitly-scoped section of the **already-approved** epic #954 spec — not new unspec'd
product. The hard "spec-before-build" gate is satisfied at the epic level. **STEP 1 of your build is
still to verify the Slice-4 spec section against your actual branch** (`coordinated-build` step 1):
if the Slice-4 section does NOT actually cover what you're about to build (chat actions /
revalidation / notifications) or contradicts the merged S1–S3 surface, **STOP and escalate to the
coordinator — do not build.**

## Pre-build path (per #975 — follow in order)

1. `[ -d node_modules ] || pnpm install`.
2. `pnpm audit:preflight` FIRST and re-ground — confirm the tree is current (`ba4ed180`), not behind.
3. **Re-grounded plan** of the Slice-4 section → **coordinator approval** (do NOT write code before
   it) via `coordinated-build`.
4. **Fable adversarial review of the Slice-4 section** (self, before build) — surface gaps in the
   spec's chat-action confirm-gating, revalidation idempotency, and notification privacy.
5. TDD build, commit per task → **`coordinated-wrap-up`** (PR + report to coordinator).

## Build scope (per Slice-4 spec section — extend existing News machinery, do not create new)

- **Chat-driven source/topic actions:** add/remove a news source or topic, and add a domain
  exclusion, via the assistant tool path. These are WRITE actions → **confirm-gated** through the
  existing `AssistantToolGateway`; after confirm, a real worker executes and writes an
  owner-attributed audit row (`approval_mode=confirmed`, `outcome=success`). No write action fires
  without confirmation. Reuse the S1–S3 repositories/contracts — do not re-implement selection.
- **Revalidation of curated sources:** re-check that owner-selected sources are still reachable/valid
  on a schedule; idempotent (run-twice = no duplicate state); metadata-only pg-boss payload (no
  fetched article bodies, no secrets). Availability surface reflects revalidation outcome.
- **User notifications for news changes:** owner-private notifications when a curated source changes
  availability or new matching items appear. Notifications carry NO private article content beyond
  what the owner already sees; no cross-owner leakage; RLS-scoped like every other News surface.

## Security invariants to hold (verify in tests, not just prose)

- **Owner-only isolation with positive controls:** every new read/write returns only the requesting
  owner's rows; a cross-owner AND admin read → 0 rows or 42501, EACH paired with a positive control
  that the owner reads their own. RLS applies to admins; no `BYPASSRLS` on runtime/worker roles.
- **Secrets/private content never escape:** no article bodies, prompts, credentials, or owner
  free-text in logs, pg-boss payloads, AI prompts, exports, or any other-owner-visible surface.
- **Metadata-only job payloads** for revalidation/notification jobs.
- **Response-schema:** every newly returned field is declared in the shared REST contract
  (`packages/shared/src/*-api.ts`) — Fastify `additionalProperties:false` silently strips undeclared
  fields, so an undeclared field is a real defect. Test via `app.inject`, not the service directly.
- **External content as text:** any source-supplied strings render as literal plain text
  (decode-after-strip ordering correct); outbound links scheme-guarded (`javascript:`/`data:`
  dropped).
- **Provider-agnostic:** no hardcoded provider/model anywhere in the chat-action or notification
  path; capabilities requested through the router.

## Merge gate (SECURITY tier — News named-unanimous, NO fallback)

The coordinator owns the merge. Gate = **named unanimous**: adversarial **Opus** QA + independent
**Codex** + **Gemini**, all APPROVE. **NO 2-provider substitution fallback** (distinct from the Job
Search tier). If a named provider refuses or is unreachable and cannot be obtained via neutral
boundary-review reframing → **HOLD the PR for Ben**, do not merge. State your sentinel/privacy-test
approach in the PR body so each council lens can re-run it. Build to green + document any
manual-acceptance steps for Ben; do not merge yourself.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only — you may READ this handoff but do NOT
  `git add` it), the project board, milestones, or merge.
- No secrets / no private article content in any doc, payload, log, prompt, or notification.
- **Zero new migrations unless the Slice-4 spec section calls for one.** If you think you need one
  the spec doesn't name, STOP and escalate — it means scope crept. Module SQL lives in the owning
  module's `sql/` dir, never `infra/`.

## Collision notes

- News touches `packages/news/*` (and its module surface) only. No parallel News lane is live
  (S1–S3 merged; S4 is the last slice, one-in-flight).
- Job Search lane PR #976 (JS-09) is separate and HELD for Ben's manual acceptance — no overlap.
- Ben's own idle agent authoring the #964 module-distribution spec is isolated in the main tree —
  do not touch it; you are isolated in this worktree.
