# Relay 10 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, current).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve fresh via `herdr pane list` — don't trust the pane id
below past this line). As of relay-10: pane `w1:pBB`, session `7dbdd81d-fe53-43ba-aac2-1a9bb989efc1`.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status: Task 5/6 descope question RESOLVED — no code written yet, pure design/grounding done

Relay-9's open question is closed: **Coordinator confirmed build Task 5+6 now, then Task 7** (not a
descope; the earlier "continue to Task7" comment was scoped to an in-flight file-size-gate fix
only). Confirmed via direct pane read AND a mid-turn relay message — do not re-escalate this.

**No commits this session.** HEAD is still `d7a016a8` (relay-9's doc). Nothing to `git status`
clean up beyond the pre-existing `.claude/context-meter.log` noise (ignore it, not mine to touch).
This relay fired purely from the context-meter 70% warning, before any code/tests were written —
the whole session was spec/branch grounding + implementation design. That design is captured below
so the successor can go straight to writing the first failing test.

## Plan-vs-reality correction (confirmed, not a fork — no escalation needed)

The plan's Task 5 file map lists `apps/web/src/today/evening-mode.tsx` as a wire-in target. **This
file has no interview input component** — it's pure display (`EveningReviewSection`,
`EveningPrepCard`, `EveningSupportSections`). Confirmed via full read + grep:
- `apps/web/src/shell/app-shell.tsx:230` mounts **one global** `<ChatDrawer ... />`.
- `apps/web/src/today/today-page.tsx:95,153` — `useChatControls()` + `eveningInterviewMutation`
  (`startEveningInterview` → `onSuccess: chatControls.openChat()`) just **opens that same shared
  drawer**. There is no second composer instance for the evening interview.

**Conclusion: wiring `apps/web/src/chat/composer.tsx` (rendered inside `chat-drawer.tsx`) covers
the evening interview automatically.** Do not add a no-op edit to `evening-mode.tsx` just to match
the plan's file list — note this correction in the PR description instead. This is a file-map
correction, not a scope or product decision, so no re-escalation is needed.

## Task 5 design (grounded, ready to implement — TDD, write tests first)

Existing infra already built (Task 4, don't re-touch): `listChatSkills()` in
`apps/web/src/api/client.ts:665`, `queryKeys.chat.skills` in `apps/web/src/api/query-keys.ts`,
`ChatSkillDto` in `packages/shared/src/chat-skills-api.ts`. Server-side ordering is authoritative —
`packages/chat/src/skills/repository.ts:49-58` `list()` returns rows
`.orderBy("enabled","desc").orderBy("updated_at","desc")` already. **The client does NOT need to
re-sort — just filter/find over the array in the order the API already returns it** for the
bare-name-fallback resolution to be correct.

**No test file or `apps/web/src/chat/skill-autocomplete.tsx` exists yet.** Repo test convention
(confirmed via `tests/unit/settings-skills-pane.test.tsx`, `tests/unit/settings-appearance-pane.test.tsx`,
`tests/unit/chat-model-pill.test.ts`): no jsdom/`@testing-library/react` anywhere — SSR-only
`renderToString` + `client.setQueryData(...)` to seed React Query state + string `.toContain()`
assertions. **All interactive/parsing logic MUST be pure exported functions**, unit-tested directly
with plain fixtures — the popover component itself only gets a thin SSR presence/absence check
(pattern: `settings-appearance-pane.test.tsx`'s comment on why interactive state can't be exercised).

Design worked out this session (not yet written to disk) for
`apps/web/src/chat/skill-autocomplete.tsx`:

```ts
// Query text extracted from a leading "/token" the user is actively composing —
// null once a space is typed (leaves compose mode) or the text doesn't start with "/".
export function activeSlashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1] : null;
}

export function filterEnabledSkills(
  skills: readonly ChatSkillDto[], query: string
): readonly ChatSkillDto[] {
  const needle = query.trim().toLowerCase();
  return skills.filter(s => s.enabled && (needle === "" || s.name.toLowerCase().includes(needle)));
}

// Deterministic bare-name fallback: first enabled match in the list's existing
// (already enabled-first, most-recent) order — matches repository.ts ordering.
export function resolveSkillByName(
  skills: readonly ChatSkillDto[], name: string
): ChatSkillDto | undefined {
  const needle = name.trim().toLowerCase();
  return needle ? skills.find(s => s.enabled && s.name.toLowerCase() === needle) : undefined;
}

export function resolveBoundSkill(
  skills: readonly ChatSkillDto[], boundSkillId: string | null
): ChatSkillDto | undefined {
  return boundSkillId ? skills.find(s => s.id === boundSkillId && s.enabled) : undefined;
}

// Splits "/name rest" into token (sans slash) + remainder. null = not slash-prefixed at all.
export function splitBareNameToken(
  text: string
): { readonly name: string; readonly remainder: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return match ? { name: match[1], remainder: match[2] ?? "" } : null;
}

// Bound (explicit autocomplete pick, tracked by id) wins; else a still-slash-prefixed
// message resolves by bare name; anything unresolved is sent as plain, unmodified text
// — including a literal lone "/" (escape/no-match must degrade to plain send).
export function resolveTurnInvocation(
  text: string, boundSkillId: string | null, skills: readonly ChatSkillDto[]
): { readonly skill: ChatSkillDto | undefined; readonly remainder: string } {
  const bound = resolveBoundSkill(skills, boundSkillId);
  if (bound) return { skill: bound, remainder: text };
  const split = splitBareNameToken(text);
  if (!split) return { skill: undefined, remainder: text };
  const named = resolveSkillByName(skills, split.name);
  return named ? { skill: named, remainder: split.remainder } : { skill: undefined, remainder: text };
}

export function composeTurnText(skill: ChatSkillDto | undefined, remainder: string): string {
  const trimmed = remainder.trim();
  if (!skill) return trimmed;
  return trimmed ? `${skill.body}\n\n${trimmed}` : skill.body;
}
```

Plus a thin presentational `SkillAutocomplete` component (popover list, `role="listbox"`/`role="option"`,
renders `null` when `filterEnabledSkills(...)` is empty) — SSR presence-only tested.

**Composer wiring plan** (`apps/web/src/chat/composer.tsx`):
- Add `boundSkillId` state (`useState<string | null>(null)`).
- Fetch skills: `useQuery({ queryKey: queryKeys.chat.skills, queryFn: listChatSkills })` (same
  pattern as other client fetches in this file — no `enabled` guard needed, matches existing
  `transcriptionRouteQuery`-style calls).
- Derive `const slashQuery = activeSlashQuery(text)`; render `<SkillAutocomplete>` above the
  textarea when `slashQuery !== null`.
- `onSelect`: `setBoundSkillId(skill.id); setText("");` (clears the typed query; user then types
  their message plain, no visible "/" prefix — matches "selection binds a concrete record id").
- Rework `send()`: compute `resolveTurnInvocation(text, boundSkillId, skillsQuery.data?.skills ?? [])`
  → `composeTurnText(...)` → gate on the **composed** text being non-empty (not the raw `text`), so
  a bound skill with no typed remainder still sends (body alone). Reset `boundSkillId` on send
  alongside `setText("")`. Preserve existing `isSending` → `setQueuedText` queuing behavor, just
  queue the **composed** text.
- Small "x" chip to clear `boundSkillId` before send (cheap, avoids a stuck-binding footgun; not
  explicitly required by acceptance criteria but low-cost — keep minimal, don't over-build).

**Acceptance criteria to test against** (plan's own wording, still the bar):
typing `/` at input start opens filtered autocomplete of **enabled-only** skills; selection binds a
concrete record id; disabled skills never listed; bare-name text fallback resolves by the
deterministic ordering; escape/no-match degrades to plain text (a literal `/` message must still be
sendable).

## Task 6 (unchanged from relay-9 — still fully unbuilt)

Integration tests only, no gateway code expected to change. Check the `action_requests` INSERT
policy trap first (agentmemory "Test Traps" / `memory_smart_search "jarv1s integration test trap"`
— MCP recall calls returned empty last relay, MEMORY.md system-context entry is the fallback
source). Three required assertions:
1. Skill body instructing a destructive-risk tool call still produces a pending `action_requests`
   row for a confirm-gated user (never silent execution).
2. Yolo-mode user → skill-triggered tool call executes exactly like an ordinary chat-triggered call
   (inherited posture, no special path).
3. Persona file bytes identical before/after a skill invocation (prompt-cache discipline) — read
   the persona file, invoke a skill-bearing turn, re-read, assert byte-identical.

## Task 7 (unchanged — after 5/6)

Acceptance sweep vs spec, `pnpm verify:foundation` (real exit code, never piped through `tail`) +
full `pnpm test:integration` (foundation migration list assertion), plan's Self-Review checklist
(persona-file-touch check, non-deliberate-promotion check, pg-boss metadata-only check, module-
isolation check).

## Close out

`coordinated-wrap-up` when Exit Criteria are genuinely met — PR + report to Coordinator only, never
merge/board/close. Flag `security` tier for Opus adversarial QA + Ben sign-off.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio (`format:check && lint && typecheck` + fetch/rebase `origin/main`) before every push.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
- Identify Herdr panes by **label + `agent_session.value`**, never a bare `w…-N` pane id from a
  doc — pane numbers reflow. Re-resolve via `herdr pane list` at read time.
- This relay's predecessor was `Build-760g` (pane `w1:pBF`, session
  `17508733-4483-4f2b-a102-db8bda778ac4`) — same lineage as `Build-760f`/`Build-760e` before it.
