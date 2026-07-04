# Persona Settings Clarity Handoff

## Goal

Implement Ben's `/settings` feedback for the Assistant & AI/persona settings:

1. Make it clear whether the freeform persona description and the dials are alternatives or combined inputs.
2. If a downstream setting/card is locked to the instance default and the user cannot override it, hide that non-functional user control. If the user can override, keep it visible.

Keep this small. Do not redesign the whole settings page.

## Base

Worktree: `~/Jarv1s/.claude/worktrees/persona-settings-clarity`

Branch: `coord/persona-settings-clarity`

Base: `origin/main`

## Relevant Starting Points

- `apps/web/src/settings/settings-ai-pane.tsx`
- `apps/web/src/settings/settings-persona-preview.ts`
- `packages/shared/src/persona-api.ts`
- likely chat model override/default controls in `apps/web/src/settings/settings-ai-pane.tsx` or related AI settings components

Use codebase-memory MCP first for discovery if available, then file reads.

## Feedback Context

### Persona card

Page feedback says the persona section is not clear that users can either type a description or use the dials. The only visible clue is near the bottom ("use dials"). Decide from the existing data flow whether description and dials are combined or alternatives; then make the UI reflect that.

Preferred product direction unless code proves otherwise:

- Treat them as two ways to set Jarvis's style.
- Make the modes visually explicit and near the top of the card.
- Keep existing data model/API; do not add new persistence.
- Do not add long instructional copy. Use concise labels/local UI language.

### Locked/default card

Feedback says: if admin has set a value and locked to instance default, hide the user card/control. If the user can override, show it.

Find the actual setting/card in the AI settings pane. If the response/model already exposes lock/override capability, use that. If it does not, do the smallest truthful UI change possible and document any missing server signal.

## Guardrails

- Ponytail mode: shortest correct diff wins.
- No new dependency.
- No schema/API change unless the existing response lacks the lock/override signal and there is already an obvious field to expose.
- Preserve accessibility basics.
- Keep class names/styles minimal and token-based.

## Checks

Run at minimum:

```bash
pnpm --filter @jarv1s/web typecheck
pnpm vitest run <focused-test-file>
```

Use an existing settings/AI test if present; otherwise add one small focused test or explain why the existing checks are the practical coverage.

## Start

1. Run `pnpm install` if `node_modules` is missing.
2. Read `AGENTS.md`, `CLAUDE.md`, and this handoff in full.
3. Inspect the relevant code path before editing.
4. Implement the minimal change.
5. Run checks.
6. Commit the implementation.
7. Report commit SHA, checks, and caveats in the Herdr pane.
