# Continuation — #1327 Task 6, write first RED test now

Worktree: this one, branch `build/1327-action-row-ui`. Coordinator: label `Coordinator`,
session `019fb9d9-8e73-7422-b7ff-67a7a5de94ec` — re-resolve pane via `herdr pane list` before
messaging. Zero feature code written yet. `node_modules` present, skip install. Tree clean
except handoff/plan commits. **Do NOT reread coordinated-build/plan-build/spec/plan — this doc
is complete. Begin the first RED test immediately, no discovery.**

## First action: create `tests/unit/today-briefing-action-rows.test.tsx`

Imports (will fail — expected RED, module doesn't exist yet):
```ts
import { BriefingActionRowsSection, joinActionRowsToTasks, buildReplyChatPrompt } from "../../apps/web/src/today/briefing-action-rows.js";
```
Render pattern: copy `tests/unit/today-evening-mode.test.tsx` conventions (renderToString +
`QueryClient`/`QueryClientProvider` with `client.setQueryData`, `ChatControlsProvider`,
`MemoryRouter` if needed). Render `<BriefingActionRowsSection>` directly, not full `TodayPage`.
Repo has NO jsdom/@testing-library (see `tests/unit/web-terminal-modal.test.tsx` #1059 comment) —
test interaction via pure functions, never simulated clicks.

4 tests (exact names):
1. `renders truthful count and accepted dismissed states` — 3 rows+tasks at
   suggested/todo/archived; count=1; other two show Accepted/Dismissed, no action buttons.
2. `Reply prompt never interpolates title or explanation` — call `buildReplyChatPrompt(cacheMessageId)`
   directly; assert it equals exactly
   `` `Draft a reply to the cached email ${cacheMessageId} using email.draftReply.` `` and that a
   title/explanation crafted to look like the template cannot change output (function takes only
   `cacheMessageId`).
3. `View uses sourceHref and never model text as a URL` — anchor `href === row.sourceHref` exactly;
   `sourceHref: null` renders no View control.
4. `renders authored loading empty stale and catch-up states` — loading: "Checking what needs
   you…"; empty (0 suggested): "You're caught up — nothing is waiting on you."; catch-up empty:
   subtree absent; stale: banner present when oldest suggested row's `computedAt` >24h old.

Also add to `tests/unit/today-evening-mode.test.tsx`: `day selects morning payload and evening
selects outstanding evening payload` calling `selectActionRowsRun(mode, morningRun, eveningRun)`
directly (pure fn) — day→morningRun, evening→eveningRun, by `===` identity.

## Then implement, in order

`apps/web/src/today/evening-mode.tsx` — add:
```ts
export function selectActionRowsRun(mode: TodayMode, morningRun: BriefingRunDto | null, eveningRun: BriefingRunDto | null): BriefingRunDto | null {
  return mode === "day" ? morningRun : eveningRun;
}
```

`apps/web/src/today/briefing-action-rows.tsx` (new) — exact contracts:
```ts
export interface BriefingActionRowsSectionProps {
  readonly run: BriefingRunDto | null;
  readonly loading: boolean;
  readonly tasks: readonly TaskDto[];
  readonly locale: LocaleSettingsDto;
  readonly chatAvailable: boolean;
  readonly onOpenTask: (taskId: string) => void;
}
export function BriefingActionRowsSection(props: BriefingActionRowsSectionProps): JSX.Element | null
export interface DisplayedActionRow {
  readonly row: BriefingActionRowDto;
  readonly liveStatus: "suggested" | "accepted" | "dismissed";
}
export function joinActionRowsToTasks(rows: readonly BriefingActionRowDto[], tasks: readonly TaskDto[]): readonly DisplayedActionRow[]
export function buildReplyChatPrompt(cacheMessageId: string): string {
  return `Draft a reply to the cached email ${cacheMessageId} using email.draftReply.`;
}
```
Join: match by `taskId`; suggested→"suggested"; todo|done→"accepted"; archived→"dismissed"; no
match→drop. Displayed count = suggested rows.

Category→control, exhaustive over 3 v1 categories, no default branch: `needs_reply`→Reply button
(disabled+authored copy when `!chatAvailable`; onClick calls
`useChatControls().openChatWith(buildReplyChatPrompt(primaryAction.cacheMessageId))` only when
`primaryAction.kind === "reply"`). `needs_action`|`time_sensitive_info`→View anchor only when
`row.sourceHref` non-null, `target="_blank" rel="noopener noreferrer"`. Accept/Dismiss always on
`liveStatus === "suggested"`: reuse `updateTask(row.taskId, {status: "todo"|"archived"})` +
invalidate `queryKeys.tasks.list` and `queryKeys.briefings.runs(props.run?.definitionId ?? null)`.

Never interpolate `title`/`explanation`/`sourceLabel` into a URL or chat prompt — only
`cacheMessageId` + `sourceHref` pass through.

Authored copy (verbatim): loading "Checking what needs you…"; empty "You're caught up — nothing
is waiting on you."; catch-up empty → omit block entirely. Stale: build a local
`SourceFreshnessV1`-shaped value from suggested rows
(`{capturedAt: new Date().toISOString(), sources: [{source: row.source, freshnessKind:
"connector_sync", asOf: <oldest computedAt>}]}`) and reuse existing `BriefingStaleBanner`
(`apps/web/src/today/briefing-freshness.tsx`) — reuse the *component*, not `parseBriefingFreshness`
(different input shape; plan ruling: deliberately not unified). Pre-briefing fallback: when
`run === null`, synthesize `DisplayedActionRow[]` from `tasks` where `status === "suggested"` and
`suggestionMetadata` matches `TaskSuggestionMetadataV1` shape (`version === 1`) — one comment line
explaining why two data paths exist.

Style: extend `jds-brief`/`loose`/`loose-row` primitives, same classes as
`apps/web/src/today/today-suggested-email.tsx` (being deleted): `jds-brief`, `jds-brief__head`,
`jds-brief__kicker`, `jds-brief__title`, `loose`, `loose-row`, `loose-row__ic`, `loose-row__main`,
`loose-row__title`, `loose-row__meta`, `loose-row__act`, `jds-btn jds-btn--sm
jds-btn--secondary`/`jds-btn--quiet`. No raw colors/mono/serif.

`apps/web/src/today/today-page.tsx`: remove `suggestedTasks` (~line 232), remove
`SuggestedFromEmailSection` import (~line 61) + call site (~lines 396-400); add
`selectActionRowsRun` to the `evening-mode` import; add
`const actionRowsRun = selectActionRowsRun(todayMode, latestMorningRun, latestEveningRun);` and a
`<BriefingActionRowsSection run={actionRowsRun} loading={/* mirror existing per-mode
*RunsQuery.isPending */} tasks={tasks} locale={locale} chatAvailable={true} onOpenTask={(id) =>
setDialog({id})} />` call site. Must stay near 958 lines (file-size gate trips at 1000).

Delete `apps/web/src/today/today-suggested-email.tsx` after the swap.

## Phase gate (each must be `EXIT=0`, never piped through tail/grep)
```bash
pnpm --filter @jarv1s/web test -- today-briefing-action-rows today-evening-mode > /tmp/t6-unit.log 2>&1; echo "EXIT=$?"
pnpm typecheck > /tmp/t6-typecheck.log 2>&1; echo "EXIT=$?"
pnpm check:file-size > /tmp/t6-filesize.log 2>&1; echo "EXIT=$?"
pnpm check:design-tokens > /tmp/t6-tokens.log 2>&1; echo "EXIT=$?"
```
Commit each task's files explicitly (never `git add -A`), `Co-Authored-By: Claude` trailer.

## Kill gate (binding)
After all 4 phase-gate commands are `EXIT=0`: STOP. Re-resolve `Coordinator` pane fresh
(`herdr pane list`, confirm exactly one match), message via `herdr-pane-message`: "Task 6 green:
<summary>. Ready for Task 7." Wait for go-ahead before writing
`tests/e2e/briefing-action-rows.spec.ts`.

## Relay again
At the next context-meter 70% warning: commit, write a new continuation (this format), spawn a
successor, message coordinator. Never end turn mid-procedure.
