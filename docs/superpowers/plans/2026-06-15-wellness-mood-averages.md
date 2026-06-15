# Wellness Daily-Average Mood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface daily-average mood in the today card and chart tooltip, and add outside-click dismissal to the chart tooltip.

**Architecture:** Pure client-side aggregation over already-fetched check-ins. `DayPoint` gains a `checkins` array for per-day averages; `wellness-trends.tsx` groups all check-ins by date instead of keeping only the most-recent. No API, schema, or auth changes.

**Tech Stack:** React 18 (hooks: useState, useRef, useEffect), @jarv1s/shared (moodIndex, moodBand, CheckinDto), Vitest for unit tests, pnpm for gate.

---

## File Map

| File                                        | Change                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web/src/wellness/wellness-today.tsx`  | Add `moodBand` import; compute daily average; rework heading + stats display                          |
| `apps/web/src/wellness/wellness-chart.tsx`  | Add `checkins` to `DayPoint`; average-based dot + tooltip; outside-click dismiss via useRef/useEffect |
| `apps/web/src/wellness/wellness-trends.tsx` | Group checkins by date (all per day, not just most-recent); populate `checkins` in DayPoint           |
| `apps/web/src/styles/wellness-2.css`        | Remove dead `.wl-radial` rule and `.wl-dial__hub .lbl/.val` child selectors                           |

---

### Task 1: D1 — Today card: heading rework + current + daily-average mood

**Files:**

- Modify: `apps/web/src/wellness/wellness-today.tsx`

#### Context

`CheckinToday` (line 376) currently shows a single check-in's `moodIndex` as "Mood +N". It needs to show **current mood** (latest check-in) and **daily average mood** (mean across all today's check-ins). The heading "Today's check-in" becomes "Today's mood" in both the empty and filled states.

`moodBand` is not yet imported — add it alongside `moodIndex`.

Daily average formula: `Math.round((sum_of_moodIndex_values / count) * 10) / 10`.

- [ ] **Step 1: Add `moodBand` to the import**

In `wellness-today.tsx` line 2, change:

```tsx
import { EMOTIONS, moodIndex, type CheckinDto } from "@jarv1s/shared";
```

to:

```tsx
import { EMOTIONS, moodIndex, moodBand, type CheckinDto } from "@jarv1s/shared";
```

- [ ] **Step 2: Compute daily average in `CheckinToday`'s filled branch**

After line 462 (`const v = moodIndex(core, latestCheckin.intensity ?? 3);`), add:

```tsx
const avgV =
  todayCheckins.length > 1
    ? Math.round(
        (todayCheckins.reduce((sum, ck) => sum + moodIndex(ck.feelingCore, ck.intensity ?? 3), 0) /
          todayCheckins.length) *
          10
      ) / 10
    : v;
const avgBandLabel = moodBand(avgV);
```

- [ ] **Step 3: Rework the heading in the empty (no-checkin) branch**

Around line 400, change `Today&apos;s check-in` (inside the `<span className="t">`) to `Today&apos;s mood`:

```tsx
<span className="t">Today&apos;s mood</span>
```

- [ ] **Step 4: Rework the heading in the filled branch**

Around line 479, same change in the filled branch heading:

```tsx
<span className="t">Today&apos;s mood</span>
```

- [ ] **Step 5: Replace the single Mood stat with current + average**

Replace the existing `.wl-done__mood` block (lines 509–516):

```tsx
<span className="wl-done__mood">
  <span className="k">Mood</span>
  <span className="v">
    {v > 0 ? "+" : ""}
    {v}
  </span>
</span>
```

With (current mood always shown; average shown only when >1 check-in):

```tsx
<span className="wl-done__mood">
  <span className="k">{todayCheckins.length > 1 ? "Now" : "Mood"}</span>
  <span className="v">
    {v > 0 ? "+" : ""}
    {v}
  </span>
</span>;
{
  todayCheckins.length > 1 ? (
    <span className="wl-done__mood">
      <span className="k">Avg</span>
      <span className="v">
        {avgV > 0 ? "+" : ""}
        {avgV} · {avgBandLabel}
      </span>
    </span>
  ) : null;
}
```

- [ ] **Step 6: Run typecheck to verify**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm typecheck 2>&1 | tail -10
```

Expected: no errors in wellness-today.tsx.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/wellness/wellness-today.tsx
git commit -m "$(cat <<'EOF'
feat(wellness): today card shows current + daily-average mood

Rework CheckinToday heading to "Today's mood". When there is more than
one check-in today, show both the current (latest) mood index and the
daily average (mean moodIndex across all today's check-ins, labeled by
moodBand). Single-check-in days show one stat labeled "Mood" as before.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: D2 — Chart: DayPoint multi-checkin shape + tooltip daily average

**Files:**

- Modify: `apps/web/src/wellness/wellness-chart.tsx`
- Modify: `apps/web/src/wellness/wellness-trends.tsx`

#### Context

`DayPoint` currently has `checkin: CheckinDto | null` (most-recent only). The tooltip shows that single check-in's moodIndex. We need:

1. Add `checkins: readonly CheckinDto[]` to `DayPoint` for per-day average computation.
2. Keep `checkin: CheckinDto | null` (first/most-recent) for dot color and feeling label.
3. Chart dot y-position and tooltip mood value both use the daily average.
4. `wellness-trends.tsx` must group ALL check-ins by date (not just first).

- [ ] **Step 1: Add `checkins` field to `DayPoint`**

In `wellness-chart.tsx`, modify the `DayPoint` interface (line 12):

```tsx
export interface DayPoint {
  date: string;
  label: string;
  isToday: boolean;
  checkin: CheckinDto | null; // most-recent (color + feeling label)
  checkins: readonly CheckinDto[]; // all check-ins this day (for average)
  medFrac: number;
  medTaken: number;
  medDenom: number;
  doses?: readonly AdherenceDoseSummaryItemDto[];
}
```

- [ ] **Step 2: Add `avgMood` helper and update `pts` to use it**

In `WellnessChart` (line 68), add a helper after the state declarations:

```tsx
const avgMood = (cks: readonly CheckinDto[]): number | null =>
  cks.length === 0
    ? null
    : Math.round(
        (cks.reduce((s, ck) => s + moodIndex(ck.feelingCore, ck.intensity ?? 3), 0) / cks.length) *
          10
      ) / 10;
```

Then replace the `pts` computation (lines 94–105) to use `d.checkins`:

```tsx
const pts = days
  .map((d, i) => {
    const v = avgMood(d.checkins);
    return v != null ? { i, xPos: x(i), v, d } : null;
  })
  .filter((p): p is NonNullable<typeof p> => p !== null);
```

- [ ] **Step 3: Update tooltip to show daily average**

In the tooltip IIFE (around line 234), replace:

```tsx
const hasCk = !!d.checkin;
const v = hasCk ? moodIndex(d.checkin!.feelingCore, d.checkin!.intensity ?? 3) : null;
const c = hasCk ? emoColor(d.checkin!.feelingCore, theme) : null;
const band = v != null ? moodBand(v) : null;
const tipY = hasCk && v != null ? moodY(v) : moodTop + 10;
```

With:

```tsx
const hasCk = !!d.checkin;
const v = avgMood(d.checkins);
const c = hasCk ? emoColor(d.checkin!.feelingCore, theme) : null;
const band = v != null ? moodBand(v) : null;
const tipY = v != null ? moodY(v) : moodTop + 10;
```

The tooltip body already uses `v`, `c`, `band`, `d.checkin!.feelingCore`, and `d.checkin!.feelingSecondary` — those all still work. No other changes to the tooltip JSX needed.

- [ ] **Step 4: Update `wellness-trends.tsx` to group checkins by date**

Replace the `checkinByDate` build (lines 81–86):

```tsx
const checkinByDate: Record<string, (typeof checkins)[0]> = {};
checkins.forEach((c) => {
  const d = (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10);
  if (d && !checkinByDate[d]) checkinByDate[d] = c;
});
```

With:

```tsx
const checkinsByDate: Record<string, typeof checkins> = {};
checkins.forEach((c) => {
  const d = (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10);
  if (!d) return;
  (checkinsByDate[d] ??= []).push(c);
});
```

Then in the `days` construction (line 90), replace:

```tsx
checkin: checkinByDate[iso] ?? null,
```

With:

```tsx
checkin: (checkinsByDate[iso] ?? [])[0] ?? null,
checkins: checkinsByDate[iso] ?? [],
```

- [ ] **Step 5: Run typecheck**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm typecheck 2>&1 | tail -10
```

Expected: no errors in wellness-chart.tsx or wellness-trends.tsx.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/wellness/wellness-chart.tsx apps/web/src/wellness/wellness-trends.tsx
git commit -m "$(cat <<'EOF'
feat(wellness): chart tooltip shows daily-average mood

DayPoint gains a `checkins` array (all check-ins per day). WellnessChart
computes the daily average moodIndex (mean over all day's check-ins) for
both dot y-position and tooltip display. wellness-trends groups all
check-ins by date instead of keeping only the most-recent.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: D2 — Chart: outside-click dismiss for pinned tooltip

**Files:**

- Modify: `apps/web/src/wellness/wellness-chart.tsx`

#### Context

The pinned tooltip (shown after clicking a day column) has no dismiss path other than clicking the same column again. Add a `pointerdown` listener that clears `pinned` when the click lands outside the chart container. Per project invariant: **no side effects inside a `setState` updater** — register/teardown in `useEffect` only.

- [ ] **Step 1: Add `useRef` import**

`useRef` is not currently imported. Change line 8:

```tsx
import { useState } from "react";
```

to:

```tsx
import { useState, useRef, useEffect } from "react";
```

- [ ] **Step 2: Add container ref and outside-click effect to `WellnessChart`**

After the state declarations (`useState` lines), add:

```tsx
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (pinned === null) return;
  const handler = (ev: PointerEvent) => {
    if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
      setPinned(null);
    }
  };
  document.addEventListener("pointerdown", handler);
  return () => document.removeEventListener("pointerdown", handler);
}, [pinned]);
```

- [ ] **Step 3: Attach ref to chart container**

Change the return's outer div (line 134):

```tsx
<div className="wl-chart__plot">
```

to:

```tsx
<div className="wl-chart__plot" ref={containerRef}>
```

- [ ] **Step 4: Run typecheck**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/wellness/wellness-chart.tsx
git commit -m "$(cat <<'EOF'
feat(wellness): chart tooltip dismisses on outside click

Add a pointerdown listener (registered in useEffect, removed in cleanup)
that clears pinned when the user clicks outside the wl-chart__plot
container. No side effects in setState updater (StrictMode safe).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CSS cleanup — remove dead radial selectors

**Files:**

- Modify: `apps/web/src/styles/wellness-2.css`

#### Context

The #262 radial pass replaced the old dial picker. Three dead CSS rules remain: `.wl-radial` (line 713), `.wl-dial__hub .lbl` (line 754), `.wl-dial__hub .val` + `.wl-dial__hub .val.is-empty` (lines 761, 769). `.wl-dial__hub` itself is still used by `radial-dial.tsx:78` — do NOT remove it.

- [ ] **Step 1: Remove `.wl-radial` rule**

Delete lines 712–718 (the comment and rule):

```css
/* ---- RADIAL picker (original dial) ---- */
.wl-radial {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
```

Wait — the comment "RADIAL picker (original dial)" applies to the entire `.wl-dial*` section, not just `.wl-radial`. Remove only the `.wl-radial` rule block (lines 713–718), leave the comment and the `.wl-dial` / `.wl-dial__hub` rules intact.

Remove exactly:

```css
.wl-radial {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
```

- [ ] **Step 2: Remove dead `.wl-dial__hub .lbl` and `.wl-dial__hub .val` rules**

Remove these three rule blocks:

```css
.wl-dial__hub .lbl {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.wl-dial__hub .val {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  margin-top: 4px;
  line-height: 1.1;
}
.wl-dial__hub .val.is-empty {
  color: var(--text-subtle);
  font-size: 15px;
  font-weight: 500;
}
```

- [ ] **Step 3: Run format:check on the CSS file**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm exec prettier --write apps/web/src/styles/wellness-2.css
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/wellness-2.css
git commit -m "$(cat <<'EOF'
chore(wellness): remove dead radial CSS left by #262

Drop .wl-radial and .wl-dial__hub .lbl/.val/.val.is-empty selectors
that are no longer referenced after the radial picker redesign.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verify foundation gate

**Files:** (none — verification only)

- [ ] **Step 1: Run pre-push trio**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all green, no warnings.

- [ ] **Step 2: Rebase onto latest origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: clean rebase (no conflicts — this branch owns only wellness/styles files).

- [ ] **Step 3: Run full foundation gate**

```bash
cd ~/Jarv1s/.claude/worktrees/wellness-mood-averages && pnpm verify:foundation
```

Expected: exit 0. All lint / format / file-size / typecheck / migrate / integration tests green.

- [ ] **Step 4: Close out with `coordinated-wrap-up` skill**

Invoke `coordinated-wrap-up` to push, open PR, and report to the coordinator.
