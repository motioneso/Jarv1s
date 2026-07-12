# Relay 11 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, current).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator`, pane `w1:pBJ`, session `d3c0adce-dee1-41d6-aa91-5a89181ca575`
(re-resolve via `herdr pane list` before messaging — don't trust past this line).
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.
**Predecessor:** `Build-760i` (this relay), pane `w1:pBH`, session
`534081bf-4b00-4ffc-9561-ac2ee1aa16cf`. Lineage: `Build-760h` (killed pre-code, wrong model,
no salvage needed) ← `Build-760g`/`f`/`e`.

## Status: Task 5 DONE + committed. Task 6 not started. Task 7 open.

Coordinator already confirmed (relay-10): build Task 5+6 this pass, then Task 7. No re-escalation
needed for that scope.

**Commits this session (HEAD is `0f251f6a`):**
- `a556c42e` — `apps/web/src/chat/skill-autocomplete.tsx` + `tests/unit/chat-skill-autocomplete.test.ts`:
  all 7 pure functions (`activeSlashQuery`, `filterEnabledSkills`, `resolveSkillByName`,
  `resolveBoundSkill`, `splitBareNameToken`, `resolveTurnInvocation`, `composeTurnText`) exactly per
  relay-10's design, 30 unit tests, thin `SkillAutocomplete` popover (`role="listbox"`/`option`).
- `0f251f6a` — `apps/web/src/chat/composer.tsx` wired: `boundSkillId` state, `skillsQuery` via
  `listChatSkills`/`queryKeys.chat.skills`, popover rendered when `activeSlashQuery(text) !== null`,
  a small bound-skill chip (`chatd-skillac__bound`) with a clear ("x") button, `send()` reworked to
  gate on `composeTurnText(...)` result (not raw `text`) so a bound skill with empty remainder still
  sends, resets `boundSkillId` alongside `setText("")` on send/queue.

**Verified green (this session):** full `pnpm typecheck` (root + web), full `pnpm vitest run
tests/unit/` — **287 files / 1970 passed, 2 skipped**, `pnpm check:file-size` (composer.tsx 289
lines, skill-autocomplete.tsx 104 lines — nowhere near the 1000-line gate), `pnpm lint` (0
warnings), `pnpm format:check` clean (both new/changed files prettier-applied).

**Not yet done, confirmed correct per relay-10's plan-vs-reality correction:** no edit to
`apps/web/src/today/evening-mode.tsx` — it has no interview input component; the shared
`Composer` (mounted once in `app-shell.tsx:230`, opened by `chatControls.openChat()`) already covers
the evening interview. Note this correction in the PR description at wrap-up, don't add a no-op
edit there.

## Task 6 — next (unbuilt, integration tests only, no gateway code changes expected)

Acceptance (plan + relay-10, unchanged):
1. Skill body instructing a destructive-risk tool call still produces a pending `action_requests`
   row for a confirm-gated user (never silent execution).
2. Yolo-mode user → skill-triggered tool call executes exactly like an ordinary chat-triggered call
   (inherited posture, no special path).
3. Persona file bytes identical before/after a skill invocation (prompt-cache discipline).

**Grounding done this session, ready to use:**
- `tests/integration/mcp-gateway.test.ts` (735 lines) is the right pattern source —
  `AssistantToolGateway` already has near-exact fixtures: `it("blocks a write until approved, emits
  a card, then executes"` (~line 255) and `it("auto-runs destructive tools under YOLO and records
  yolo audit mode"` (~line 366, `yoloMode: async () => true`, asserts
  `audit.some(row => row.tool_name === "example.destroy" && row.approval_mode === "yolo")`). Task 6's
  tests 1+2 are these same gateway fixtures but with the tool-call originating from **skill-body
  text passed as ordinary chat turn text** — the point of the test is that there is NO special
  server-side path for skill-originated calls (invocation is 100% client-side composition per the
  spec's pinned design), so reusing the exact same gateway call shape with skill-sourced text as the
  input is the correct proof, not a new mechanism.
- Persona-file mechanism found: `packages/chat/src/live/persona.ts` `renderPersona(fs, input)` writes
  the persona text verbatim to a per-user per-provider context file (`CLAUDE.md`/`AGENTS.md`/
  `GEMINI.md`) under the neutral chat-home dir, via an injected `PersonaFs` seam
  (`createRealPersonaFs()` for real disk). For test 3, the cleanest proof: call `renderPersona`
  (or exercise whatever chat-turn path triggers a skill invocation) with a fake `PersonaFs` that
  records file content bytes on every `writeFile`, invoke a turn with a skill-sourced compose body,
  and assert `writeFile` for the persona path was either not called again post-render, or called
  with byte-identical content — i.e. skill invocation must not cause any persona-file rewrite/drift.
  Check `tests/unit/chat-runtime-persona.test.ts` for the `resolveChatPersona` unit-test pattern
  (fake `DataContextRunner`/`PreferencesPort`, no real disk) — likely reusable style for an
  integration-level variant, or find wherever `packages/chat` has an existing persona-file
  integration test (not yet located — search before assuming none exists).
- **Test Traps (from CLAUDE.md / MEMORY.md, MCP recall returned empty again this session — use this
  as the fallback source):** `action_requests` INSERT policy trap exists — check how
  `mcp-gateway.test.ts`'s existing "blocks a write until approved" test sets up its confirm-gated
  actor/DB fixtures and reuse that setup rather than inventing new fixture wiring.

## Task 7 (after Task 6)

Acceptance sweep vs spec, `pnpm verify:foundation` (real exit code, never piped through `tail`) +
full `pnpm test:integration` (foundation migration list assertion — extend if Task 6 needs new
integration-only setup, though no schema change is expected), plan's Self-Review checklist
(persona-file-touch check, non-deliberate-promotion check, pg-boss metadata-only check,
module-isolation check).

## Close out

`coordinated-wrap-up` when Exit Criteria are genuinely met — PR + report to Coordinator only, never
merge/board/close. Flag `security` tier for Opus adversarial QA + Ben sign-off. Mention the
evening-mode.tsx file-map correction in the PR description.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio (`format:check && lint && typecheck` + fetch/rebase `origin/main`) before every push
  — not yet pushed this branch this session, do it before opening the PR at wrap-up.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
- Identify Herdr panes by **label + `agent_session.value`**, never a bare `w…-N` pane id from a
  doc — pane numbers reflow. Re-resolve via `herdr pane list` at read time.
