# Lane A handoff — module-onboarding seed route + module_control seam + attachment-read port

**Issue:** task #1194 (Part of feature #1193) · **Spec (source of truth):**
`docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md` — read it IN FULL, especially
§Seed route + prompt structure and §Architecture. Read `AGENTS.md` and the issue body first.

## Mission

Core chat groundwork so a module can hand its first-run setup conversation to Jarvis safely:

1. `POST /api/chat/module-onboarding` — mirrors the evening-interview seed route
   (`packages/chat/src/live-routes.ts:328-367` precedent) but emits **no visible opening turn**;
   gates: module installed + enabled for the actor + manifest declares `assistantOnboarding`, else
   404; chat-mutation rate limits; idempotent; returns `{ ok: true }`.
2. **Two-layer guidance defang** (Codex-review blocker fix): (a) promote the local
   `sanitizeExternalData` helper out of `live-routes.ts` into `packages/chat/src/live/prompt-safety.ts`
   as a shared export; (b) extend `neutralizeSeedFraming`'s reserved-tag list with
   `trusted_instructions`, `external_source`, `module_control`, `module_onboarding_state`. Both
   layers wrap manifest guidance in the seed.
3. **Per-turn `<module_control>` block** — server-composed from a validated, size-capped,
   key-allowlisted `controlContext` on turn submit; folded into engine-bound text only
   (`buildEngineText`, `packages/chat/src/live/chat-session-manager.ts:421` — mirrors the
   `<attachments>` manifest); **never persisted** in the stored turn.
4. **Manifest surface** — `assistantOnboarding.guidance` validated in `packages/module-registry`
   (length-capped, control chars rejected); author the job-search guidance in
   `external-modules/job-search/jarvis.module.json` from the spec's checkpoint/sub-step→tool map.
5. **Actor-scoped `attachments.readText` host port** provisioned to module workers via the gateway
   port seam — the attachment must belong to the acting user; deny otherwise.

## Exit criteria (from issue #1194)

Integration tests: disabled-module 404; both defang layers round-trip incl. a literal
`</trusted_instructions>` breakout attempt; control-block size cap; persisted turn text excludes
the control block; port denies non-owner attachments. Full gate green.

## Process

- Work ONLY in your assigned worktree/branch. Never touch the shared checkout `~/Jarv1s`
  (other sessions live there). Stage explicit paths only — never `git add -A`.
- First step: `pnpm install` (fresh worktree has no node_modules).
- Spec supersessions are ratified in the spec — do not re-litigate; everything NOT listed as
  superseded (confirm-gated writes, truth guard, module-web read-only tools, metadata-only
  payloads, provider-agnostic AI) still binds. No migrations expected in this lane — if you think
  you need one, stop and report instead.
- Generous why-comments citing issue #1194/#1193. 1–2 PRs, base `main`, each PR body carries a
  user-facing summary (this lane: "groundwork, no visible change") and "Part of #1193".
- `pnpm verify:foundation` green (real exit code, never piped through `tail`) before each PR.
- **Do NOT merge your PRs** — push, open PR, then report done; the coordinator runs independent
  QA and merges.

## Start

1. `pnpm install`
2. Read spec + issue #1194 + the precedent files listed above.
3. Write a short plan, then implement test-first.
