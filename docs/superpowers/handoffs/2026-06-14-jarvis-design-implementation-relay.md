# Relay — Jarvis Design System implementation (web)

**Date:** 2026-06-14 · **Branch:** `phase2-portable-deploy` · **All work UNCOMMITTED** (same working tree — successor sees it via `git status`; commit only when Ben asks).

## Task

Bring the **Jarvis Design System prototype** into the real web app (`apps/web`) screen by screen, as close to **1:1 visual** as practical. Ben separates functionality from design; during this pass build functional defaults and ship live — he annotates the look via agentation.

## Source of truth (the prototype)

- Claude Design project **"Jarvis Design System"**, `projectId = 82a2256f-ea39-4ae5-9b94-4aec68cdaa56`.
- Read it with the **`DesignSync`** tool — it's a deferred tool: `ToolSearch` → `select:DesignSync`, then `DesignSync({method:"get_file", projectId, path})`. **Only the main session can call it; subagents cannot.**
- Key prototype files: `ui_kits/jarvis-app/*.jsx` (screen structure), `components.css` (the `jds-*` classes), `kit.css` (the `tk-*`/`cmd-*`/`brief`/`cal-*` screen layouts), `tokens/*.css`, `readme.md`, `ui_kits/jarvis-app/README.md`.
- Large files (`_ds_bundle.js`, `kit.css`) auto-persist to `tool-results/*.txt`; extract with `jq -r '.content' <path> > dest`.

## Foundation (DONE)

- **`apps/web/src/styles/tokens.css`** — adopts the **full DS token vocabulary verbatim** (DS semantics: `--surface` = white card, `--bg` = paper page, `--surface-2/3`, `--pine*/amber*/red*/steel*`, type/space/radius/shadow/motion) PLUS an **APP BRIDGE** block mapping the web shell's legacy aliases (`--surface-raised`, `--panel`, `--muted`, `--state-*`, `--priority-*`, `--bucket-*`, etc.) onto DS tokens so existing stylesheets keep working. Warm dark theme included.
- **`apps/web/src/styles/components.css`** — ported `jds-*` component classes (incl. the rail/user-menu section: `jds-usermenu`, `jds-badge-count`, `jds-miniswitch`).
- **`apps/web/src/styles/kit.css`** — ported screen layouts (`tk-*`, `cmd-*`, `brief`, `wx`, `np-*`, `cal-*`, `well`, `sched-*`, etc.).
- Imported in **`main.tsx`** in order: `tokens → components → kit → styles → tasks`.

### Hard conventions (keep)

- **`tokens.css` is the ONLY file allowed hex/rgb literals.** Ported CSS swapped `#fff → var(--white)`.
- **Bake the prototype tweak DEFAULTS as the fixed design — no tweak UI.** From the prototype's `index.html` `TWEAK_DEFAULTS`: `weather=Header`, `taskLayout=Panels`, `taskEffort=Fill` (single dot), `taskDensity=Comfortable`, `heroImages=true`, **`calBlockStyle=Ghost`**, **`calDensity=Comfortable`** (the last two apply when building Calendar).
- **Verification without auth:** the app needs login, so verify screens with **static harness HTML** in `$CLAUDE_JOB_DIR/tmp` linking the real CSS + lucide CDN, screenshotted via Playwright (resolve `@playwright/test` by absolute path: `PW=$(node -e "console.log(require.resolve('@playwright/test'))")`; require it in a `.cjs`; `data-theme` toggles light/dark). Reuse the harness pattern from this session's tmp.
- Communication: terse, no closing recap+offer (see memory `feedback-concise-dev-agent`).

## Screens

| # | Screen | Status |
| - | ------ | ------ |
| 1 | Foundation (tokens + components.css + kit.css) | ✅ |
| 2 | **Tasks** | ✅ |
| 3 | **Today / briefing** | ✅ |
| 4 | **Settings** | ⏳ NEXT |
| 5 | **Calendar + Wellness** | ⏳ |

### Tasks (done) — `apps/web/src/tasks/`

- **Panel layout** (`tasks--panels`): priority groups as `tk-panel` cards.
- **Single-dot effort** (`EffortDot`): empty=quick, left-half=medium, full=large. Effort labels relabeled **Small/Medium/Large** (`task-format.ts effortLabels.quick="Small"`).
- **Control bar:** status segmented · prototype **tri-state ListFilterMenu** (include→solo→exclude) · **TagFilter** field + active chips · List/Matrix view toggle. List/tag *creation* removed from the bar (prototype has none); tags created inline in the modal.
- **`tk-add` quick-add** (`task-capture.tsx`): Add task (creates) + Details (opens modal).
- **Details modal** (`task-details-dialog.tsx`): editable title at top of header; **Activity/comment stream first** (filtered to `activityType==="comment"` — hides "Broken into N steps"); Notes; Assigned-to (display-only "You" — no backend assignee); List/Priority; Due/Reminder(=doAt); Effort segmented; **Repeats + conditional Ends**; **Tags** type-to-add + suggestion chips; **Subtasks** (toggle/add via breakdownTask); **Status split-button in the FOOTER** (Complete + caret→Archive/Reopen) styled as the **accent CTA**. Wired to real task/subtask/tag/activity APIs.
- **Today→Tasks focus filters** (`tasks/focus.ts`): `?focus=priorities|atrisk|donetoday` → clearable "Focus" chip; status click clears it.
- Caveats (backend gaps, flagged): assigned-to display-only; repeat not read-back (starts "Never"); reminder = `doAt` date.

### Today (done) — `apps/web/src/today/`

- `today-page.tsx` — editorial `cmd-*` layout: serif hero (greeting uses **`me.user.name`** first word) + lede from real counts; **stat cards** (Priorities=**Do First**/important+urgent, At risk=due today/soon or overdue, Events, Done today=completed today) that **link to filtered Tasks** via `?focus=` (or `/calendar`); reading column (Start here w/ source lead-in + ranking rationale chip · Overnight · Walking the day · Sports desk · News desk · Loose ends); sticky aside rail (agenda timeline locked below topbar · wellness widget).
- Real data: tasks + calendar (`listTasks`, `listCalendarEvents`). **Demo feeds** (weather/overnight/sports/news) isolated in **`today/demo-data.ts`** — the single wiring point for real sources.
- **Header weather** = `today/header-weather.tsx`, **demo only** (shows city). Real weather is **issue #217** (server-side IP-geo default + manual Settings override; browser geolocation unfit for plain-HTTP self-hosts).
- Route: index → `/today`; "Today" (house) pinned to nav top.

### Shell / nav (done) — `apps/web/src/shell/app-shell.tsx`

- 252px rail: Strata brandmark + grouped nav (Today / Plan: Tasks,Calendar / You: Wellness). **Briefings, Settings, Notifications, Chat filtered out of the spine** (`groupNavigation`). **Briefings page + route deleted** (`briefings/briefings-page.tsx` removed, `/briefings` route gone) — a briefings section under Settings is future.
- **Account user-menu** in rail foot (`RailUserMenu`, `jds-usermenu` popover): Notifications (unread badge) · Settings & permissions · Dark-mode toggle (miniswitch) · Log out. No "Private workspace".
- Top bar: serif title + mono eyebrow **with time** for Today (`resolvePageHeading` + `timeEyebrow`); header weather (Today only); chat toggle. Notifications bell removed.

## Agentation

Ben drops notes via the agentation MCP (`mcp__agentation__agentation_get_all_pending` / `_resolve` / `_reply`). **Replies aren't visible to him in the UI — discuss in chat instead.** Resolve notes as addressed so his pending list stays clean. All nav-pass notes from this session are resolved; weather → issue #217.

## Next steps (successor)

1. **Settings** (#4): fetch prototype `ui_kits/jarvis-app/Settings.jsx` + `Knowledge.jsx`; rebuild `apps/web/src/settings/settings-page.tsx` to the prototype — **`jds-perm` permission rows separating data-access (CRUD) from action authority**, switches, form-heavy proof; wired to real settings/connectors/AI data. (Manual weather "Location" field belongs here per #217.) Verify via harness.
2. **Calendar + Wellness** (#5): Calendar `cal-*` day/month grid with **Ghost** Jarvis blocks + **Comfortable** density; Wellness cards. Real data.
3. Run `pnpm --filter @jarv1s/web typecheck && lint`, format with prettier, harness-screenshot each.

## Environment

- Dev servers live: **web :5173** (LAN `http://192.168.x.x:5173`, `--host`), API :3000. Vite HMR picks up edits. Started with `pnpm dev:web` (backgrounded).
- Verify gate per file: `pnpm --filter @jarv1s/web typecheck`, `… lint`, `npx prettier --write <files>`.
- **ALSO run `pnpm check:file-size` + `pnpm format:check` before committing** — these are part of the enforced gate and were missed early. **No source file (CSS included) may exceed 1000 lines.** The ported `kit.css`/`components.css` bundles were split into `kit-*.css` (today / today-feeds / chat / today-misc / tasks / tasks-modal / calendar) and `components-core.css` + `components-jarvis.css`; **`main.tsx` imports them in the original concatenation order so the cascade is unchanged.** Keep new CSS under the limit — split by section, don't grow a bundle.
- `node_modules` present — successor must NOT re-run `pnpm install`.
