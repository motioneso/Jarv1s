# Wellness Feedback Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 bugs and implement 5 feature improvements to the Wellness module surfaced during live agentation testing.

**Architecture:** All changes are frontend-only except Q1 (backend insights guard) and tests. No migrations. Items are ordered so B2 (simple filter bug) lands first, then Q1 (backend), then F3 (which also resolves B2 at a deeper level), then B1+F2 together (modal redesign), then Q2/Q3 (today-page inline modals), then D3 (radial picker).

**Tech Stack:** React, React Query v5 (@tanstack/react-query), Fastify, TypeScript, Vitest, shared JSON-schema DTOs in `@jarv1s/shared`.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/wellness/wellness-history.tsx` | Modify | B2+F3: remove today-exclusion filter, add timestamp display |
| `packages/wellness/src/insights.ts` | Modify | Q1: low-data guard before generating insights |
| `apps/web/src/wellness/wellness-today.tsx` | Modify | F3: multi-checkin today card (latest + "Check in again") |
| `apps/web/src/wellness/wellness-page.tsx` | Modify | F3: `openTodayCheckin` creates new; `openTodayEdit` edits latest |
| `apps/web/src/wellness/manage-meds-modal.tsx` | Modify | B1+F2: redesign frequency+time-of-day UI, fix PRN payload |
| `apps/web/src/wellness/radial-dial.tsx` | Create | D3: RadialDial SVG component |
| `apps/web/src/wellness/wellness-prefs.ts` | Create | D3: `useWellnessPrefs` hook (localStorage toggle for radial picker) |
| `apps/web/src/wellness/checkin-modal.tsx` | Modify | D3: wire pickerStyle to prefs, add Radial case |
| `apps/web/src/today/today-page.tsx` | Modify | Q2+Q3: inline meds log modal + inline checkin modal |
| `tests/integration/wellness.test.ts` | Modify | B2+F3 test coverage |
| `tests/integration/wellness-medications.test.ts` | Modify | B1+F2 test coverage |

---

### Task 1: B2 — Remove today-exclusion filter from WellnessHistory

**Root cause:** `wellness-history.tsx` filter on line ~150 explicitly strips today's entries before rendering.

```ts
// BUG: This filter removes today's check-ins from the list
.filter((c) => (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) !== today)
```

**Files:**
- Modify: `apps/web/src/wellness/wellness-history.tsx`
- Modify: `tests/integration/wellness.test.ts`

- [ ] **Step 1: Write a failing integration test**

Open `tests/integration/wellness.test.ts`. Find the existing checkin tests. Add this test in the `GET /api/wellness/checkins` block (or create a new `describe` for "today visibility"):

```ts
it("checkin created today appears in list", async () => {
  const { app, actor } = await buildTestApp();
  // Create a check-in for today
  const createRes = await app.inject({
    method: "POST",
    url: "/api/wellness/checkins",
    headers: actor.authHeaders,
    payload: {
      feelingCore: "joy",
      feelingSecondary: "content",
      sensations: [],
      intensity: 3,
      note: null,
      identifiedVia: "wheel"
    }
  });
  expect(createRes.statusCode).toBe(201);
  const created = JSON.parse(createRes.body) as { checkin: { id: string; checkedInAt: string } };

  // Immediately list and verify it appears
  const listRes = await app.inject({
    method: "GET",
    url: "/api/wellness/checkins",
    headers: actor.authHeaders
  });
  expect(listRes.statusCode).toBe(200);
  const list = JSON.parse(listRes.body) as { checkins: { id: string }[] };
  const ids = list.checkins.map((c) => c.id);
  expect(ids).toContain(created.checkin.id);
});
```

- [ ] **Step 2: Run to verify it fails (or passes — this is a backend test, should pass)**

```bash
vitest run tests/integration/wellness.test.ts 2>&1 | tail -20
```

Expected: the backend test passes (the API returns today's check-in). This confirms the bug is purely frontend.

- [ ] **Step 3: Fix the frontend filter in wellness-history.tsx**

Open `apps/web/src/wellness/wellness-history.tsx`. Find the `rows` construction and remove the today filter:

```tsx
// BEFORE (lines ~148-154):
let rows = checkins
  .filter((c) => (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) !== today)
  .slice()
  .sort(/* ... */);

// AFTER — remove the exclusion filter entirely:
let rows = checkins
  .slice()
  .sort((a, b) => {
    const da = a.checkedInAt ?? a.createdAt ?? "";
    const db = b.checkedInAt ?? b.createdAt ?? "";
    return db < da ? -1 : 1;
  });
```

Also add a time label to rows so today's entries show "Today, 2:34 PM" instead of just the date. Modify `isoToDisplayDate` to accept today's date and return a time label when the entry is from today:

```tsx
// Replace isoToDisplayDate with:
function formatHistoryDate(
  iso: string,
  todayStr: string
): { dow: string; mo: string; day: number; timeLabel?: string } {
  const isToday = iso === todayStr;
  const d = new Date(iso + "T12:00:00");
  const result = {
    dow: isToday ? "Today" : d.toLocaleDateString("en-US", { weekday: "long" }),
    mo: d.toLocaleDateString("en-US", { month: "short" }),
    day: d.getDate(),
    timeLabel: undefined as string | undefined
  };
  return result;
}
```

Then in the map, use the full ISO timestamp for today's entries to show time:

```tsx
// In the rows.map, replace:
const iso = (ck.checkedInAt ?? ck.createdAt ?? "").slice(0, 10);
const { dow, mo, day } = isoToDisplayDate(iso);
// With:
const fullIso = ck.checkedInAt ?? ck.createdAt ?? "";
const iso = fullIso.slice(0, 10);
const isToday = iso === today;
const dow = isToday
  ? "Today"
  : new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
const mo = new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short" });
const day = new Date(iso + "T12:00:00").getDate();
const timeStr = isToday && fullIso.length > 10
  ? new Date(fullIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  : null;
```

And in the date display JSX, show the time for today entries:

```tsx
<span className="wl-hrow__date">
  <span className="dow">{dow}</span>
  {isToday && timeStr ? (
    <span className="md"> {timeStr}</span>
  ) : (
    <span className="md"> {mo} {day}</span>
  )}
</span>
```

Also remove the now-unused `todayIso()` function and `today` variable (if nothing else uses them — check first; `today` is defined at the top of the component body, and it's only used for the filter, so remove both).

- [ ] **Step 4: Verify the frontend compiles clean**

```bash
pnpm typecheck 2>&1 | grep -A3 "wellness-history"
```

Expected: no errors in wellness-history.tsx.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/wellness/wellness-history.tsx tests/integration/wellness.test.ts
git commit -m "fix(wellness): show today's check-ins in history (B2)

Removed today-exclusion filter that was hiding same-day check-ins.
Shows 'Today, HH:MM' label for same-day entries.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Q1 — Insights low-data guard

**Problem:** `computeInsights` generates adherence/pattern insights with near-zero data (e.g., 1 check-in → "0% adherence"). Must suppress all insights until ≥7 check-ins spanning at least 7 days.

**Threshold (documented):** Suppress all insights if:
- fewer than 7 total check-ins, OR
- the earliest check-in is less than 7 days before `_now`

**Files:**
- Modify: `packages/wellness/src/insights.ts`
- Modify: `tests/integration/wellness.test.ts` (or a unit test directly on `computeInsights`)

- [ ] **Step 1: Write a failing unit test for computeInsights**

At the top of `tests/integration/wellness.test.ts` (or in the existing unit test section), add a test that imports `computeInsights` directly:

```ts
import { computeInsights } from "../../packages/wellness/src/insights";

describe("computeInsights — low-data guard", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("returns empty array when fewer than 7 check-ins", () => {
    const checkins = [
      { feeling_core: "joy", intensity: 3, checked_in_at: "2026-06-14T10:00:00Z", note: null }
    ] as Parameters<typeof computeInsights>[0];
    const result = computeInsights(checkins, [], [], now);
    expect(result).toEqual([]);
  });

  it("returns empty array when 7 check-ins but all within last 6 days", () => {
    const checkins = Array.from({ length: 7 }, (_, i) => ({
      feeling_core: "joy",
      intensity: 3,
      checked_in_at: new Date(now.getTime() - i * 86400000).toISOString(),
      note: null
    })) as Parameters<typeof computeInsights>[0];
    const result = computeInsights(checkins, [], [], now);
    expect(result).toEqual([]);
  });

  it("returns insights when ≥7 check-ins spanning ≥7 days", () => {
    const checkins = Array.from({ length: 7 }, (_, i) => ({
      feeling_core: "joy",
      intensity: 3,
      checked_in_at: new Date(now.getTime() - (i + 7) * 86400000).toISOString(),
      note: null
    })) as Parameters<typeof computeInsights>[0];
    const result = computeInsights(checkins, [], [], now);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
vitest run tests/integration/wellness.test.ts -t "low-data guard" 2>&1 | tail -20
```

Expected: FAIL — computeInsights currently returns insights regardless of data count.

- [ ] **Step 3: Add the guard to insights.ts**

At the top of `computeInsights`, before any computation:

```ts
export function computeInsights(
  checkins: readonly WellnessCheckin[],
  logs: readonly MedicationLog[],
  meds: readonly Medication[],
  _now: Date,
  totalExpectedSlots?: number
): WellnessInsightDto[] {
  // Low-data guard: suppress all insights until there is at least a week's
  // worth of check-ins. Threshold: ≥7 check-ins AND earliest is ≥7 days ago.
  // Rationale: adherence/pattern insights derived from <7 data points produce
  // misleading numbers (e.g. "0% adherence" with 0 scheduled meds).
  const MIN_CHECKINS = 7;
  const MIN_DAYS = 7;
  if (checkins.length < MIN_CHECKINS) return [];
  const earliest = checkins
    .map((c) => (c.checked_in_at ? new Date(c.checked_in_at).getTime() : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  const daysSinceFirst = (_now.getTime() - earliest) / 86_400_000;
  if (daysSinceFirst < MIN_DAYS) return [];

  const results: WellnessInsightDto[] = [];
  // ... rest of function unchanged
```

- [ ] **Step 4: Run tests**

```bash
vitest run tests/integration/wellness.test.ts -t "low-data guard" 2>&1 | tail -20
```

Expected: all 3 low-data guard tests pass.

- [ ] **Step 5: Update empty-state message in wellness-insights.tsx**

The frontend already shows an empty-state when `insights.length === 0`. Update the message to be more informative:

```tsx
// In WellnessInsights, replace:
<span style={{ fontSize: 13, color: "var(--text-subtle)" }}>
  Keep checking in — insights appear once you have some history.
</span>

// With:
<span style={{ fontSize: 13, color: "var(--text-subtle)" }}>
  Insights appear after about a week of check-ins. Keep going.
</span>
```

- [ ] **Step 6: Commit**

```bash
git add packages/wellness/src/insights.ts apps/web/src/wellness/wellness-insights.tsx tests/integration/wellness.test.ts
git commit -m "fix(wellness): suppress insights until 7+ check-ins spanning 7+ days (Q1)

Low-data guard prevents misleading adherence/pattern insights from
appearing when there's insufficient history.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: F3 — Multiple check-ins per day

**Changes:** `CheckinToday` card shows latest check-in + "Check in again" action. History already fixed (Task 1). Wellness page's `openTodayEdit` targets the latest same-day check-in, leaving others editable via history.

**Files:**
- Modify: `apps/web/src/wellness/wellness-today.tsx`
- Modify: `apps/web/src/wellness/wellness-page.tsx`

- [ ] **Step 1: Update CheckinToday prop from single to array**

In `wellness-today.tsx`, find the `CheckinTodayProps` interface and `WellnessTodayProps`. Change `todayCheckin: CheckinDto | null` → `todayCheckins: readonly CheckinDto[]`.

```tsx
// BEFORE:
interface CheckinTodayProps {
  todayCheckin: CheckinDto | null;
  theme: Theme;
  streak: number;
  onStart: () => void;
  onSeed: (em: WellnessEmotionCore) => void;
  onEdit: () => void;
}

// AFTER:
interface CheckinTodayProps {
  todayCheckins: readonly CheckinDto[];
  theme: Theme;
  streak: number;
  onStart: () => void;
  onSeed: (em: WellnessEmotionCore) => void;
  onEdit: () => void;
}
```

And update `WellnessTodayProps` similarly, plus the call site inside `WellnessToday`.

- [ ] **Step 2: Update CheckinToday rendering**

In `CheckinToday`, derive `latestCheckin` from the array:

```tsx
function CheckinToday({ todayCheckins, theme, streak, onStart, onSeed, onEdit }: CheckinTodayProps) {
  const latestCheckin = todayCheckins.length > 0 ? todayCheckins[0] : null;
  // ... StreakChip same as before

  if (!latestCheckin) {
    // No check-in yet today — existing "Start check-in" UI unchanged
    return ( /* unchanged */ );
  }

  // Has at least one check-in — show it + "Check in again" button
  const core = latestCheckin.feelingCore;
  const c = emoColor(core, theme);
  const v = moodIndex(core, latestCheckin.intensity ?? 3);

  return (
    <div className="wl-card wl-checkin" style={{ "--em-tint": c.tint, "--em-soft": c.soft, "--em-ink": c.ink } as React.CSSProperties}>
      <div className="wl-card__hd">
        <span className="ic"><HeartPulseIcon /></span>
        <span className="t">Today&apos;s check-in</span>
        <span className="r" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {StreakChip}
          <button type="button" className="ghost-button"
            style={{ fontSize: 12, padding: "4px 10px", minHeight: "unset", gap: 5 }}
            onClick={onStart}
          >
            <PlusIcon />
            Check in again
          </button>
          <button type="button" className="ghost-button"
            style={{ fontSize: 12, padding: "4px 10px", minHeight: "unset", gap: 5 }}
            onClick={onEdit}
          >
            <PencilIcon />
            Edit
          </button>
        </span>
      </div>
      {/* existing wl-done content showing latestCheckin */}
      <div className="wl-done">
        {/* ... unchanged inner content, using latestCheckin instead of todayCheckin */}
      </div>
      {todayCheckins.length > 1 ? (
        <div style={{ fontSize: 12, color: "var(--text-subtle)", padding: "4px 16px 12px" }}>
          {todayCheckins.length} check-ins today
        </div>
      ) : null}
    </div>
  );
}
```

Add a `PlusIcon` SVG at the top of the file alongside the other icons:

```tsx
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
```

- [ ] **Step 3: Update WellnessToday to pass todayCheckins array**

In `WellnessToday`, derive the array and sort by timestamp descending:

```tsx
export function WellnessToday({ checkins, streak, theme, onManage, onModalOpen, onModalEdit }: WellnessTodayProps) {
  const todayStr = todayIso();
  const todayCheckins = checkins
    .filter((c) => (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) === todayStr)
    .sort((a, b) => {
      const da = a.checkedInAt ?? a.createdAt ?? "";
      const db = b.checkedInAt ?? b.createdAt ?? "";
      return db < da ? -1 : 1;
    });

  return (
    <div className="wl-today">
      <MedToday theme={theme} onManage={onManage} />
      <CheckinToday
        todayCheckins={todayCheckins}
        theme={theme}
        streak={streak}
        onStart={() => onModalOpen(null)}
        onSeed={(em) => onModalOpen(em)}
        onEdit={onModalEdit}
      />
    </div>
  );
}
```

- [ ] **Step 4: Update wellness-page.tsx openTodayEdit**

`openTodayEdit` currently finds "the" today check-in using `.find(...)`. With multiple, it should target the most recent one. Sort descending and take first:

```tsx
const openTodayEdit = () => {
  const todayCks = checkins
    .filter((c) => (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) === today)
    .sort((a, b) => {
      const da = a.checkedInAt ?? a.createdAt ?? "";
      const db = b.checkedInAt ?? b.createdAt ?? "";
      return db < da ? -1 : 1;
    });
  const latest = todayCks[0];
  if (latest) {
    setEditCheckin(latest);
    setSeedEmotion(null);
    setModalOpen(true);
  }
};
```

- [ ] **Step 5: Add integration test for multiple same-day check-ins**

In `tests/integration/wellness.test.ts`, add:

```ts
it("creates two check-ins in the same day and both appear in list", async () => {
  const { app, actor } = await buildTestApp();
  const payload = {
    feelingCore: "joy",
    feelingSecondary: "content",
    sensations: [],
    intensity: 3,
    note: null,
    identifiedVia: "wheel"
  };
  const r1 = await app.inject({ method: "POST", url: "/api/wellness/checkins", headers: actor.authHeaders, payload });
  const r2 = await app.inject({ method: "POST", url: "/api/wellness/checkins", headers: actor.authHeaders, payload });
  expect(r1.statusCode).toBe(201);
  expect(r2.statusCode).toBe(201);

  const list = await app.inject({ method: "GET", url: "/api/wellness/checkins", headers: actor.authHeaders });
  expect(list.statusCode).toBe(200);
  const { checkins } = JSON.parse(list.body) as { checkins: { id: string }[] };
  expect(checkins.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 6: Run tests**

```bash
vitest run tests/integration/wellness.test.ts 2>&1 | tail -20
pnpm typecheck 2>&1 | grep -A3 "wellness-today\|wellness-page"
```

Expected: tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/wellness/wellness-today.tsx apps/web/src/wellness/wellness-page.tsx tests/integration/wellness.test.ts
git commit -m "feat(wellness): allow multiple check-ins per day (F3)

CheckinToday shows latest check-in and a 'Check in again' action.
Backend already supports multiple timestamped rows per day.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: B1 + F2 — Medication frequency modal redesign

**Problem (B1):** PRN medications fail to be added. **Root (F2):** The dropdown conflates frequency with time-of-day (e.g., "Evening" implies "twice daily"). Redesign separates them.

**New UI flow:**
1. **Frequency** selector: `once_daily` | `times_per_day` (with a stepper 2–4) | `as_needed`
2. **Time(s)** section: shown only for `once_daily` (one time picker) and `times_per_day` (N time pickers). Hidden for `as_needed`.
3. PRN sends only `{name, dosage, frequencyType: "as_needed"}` — no scheduling fields. This fixes B1.

**Files:**
- Modify: `apps/web/src/wellness/manage-meds-modal.tsx`
- Modify: `tests/integration/wellness-medications.test.ts`

- [ ] **Step 1: Write failing test for PRN add**

In `tests/integration/wellness-medications.test.ts`:

```ts
it("POST a PRN medication with no scheduling fields succeeds", async () => {
  const { app, actor } = await buildTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/wellness/medications",
    headers: actor.authHeaders,
    payload: { name: "Ibuprofen PRN", frequencyType: "as_needed" }
  });
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body) as { medication: { frequencyType: string; scheduleTimes: null } };
  expect(body.medication.frequencyType).toBe("as_needed");
  expect(body.medication.scheduleTimes).toBeNull();
});

it("POST once_daily medication with a morning time succeeds", async () => {
  const { app, actor } = await buildTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/wellness/medications",
    headers: actor.authHeaders,
    payload: { name: "Once Med", frequencyType: "once_daily", scheduleTimes: ["08:00"] }
  });
  expect(res.statusCode).toBe(201);
});

it("POST times_per_day=2 with 2 schedule times succeeds", async () => {
  const { app, actor } = await buildTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/wellness/medications",
    headers: actor.authHeaders,
    payload: { name: "2x Med", frequencyType: "times_per_day", timesPerDay: 2, scheduleTimes: ["08:00", "20:00"] }
  });
  expect(res.statusCode).toBe(201);
});
```

- [ ] **Step 2: Run to verify backend tests pass**

```bash
vitest run tests/integration/wellness-medications.test.ts 2>&1 | tail -20
```

Expected: the backend tests pass (backend was not the bug — confirms it's frontend-only).

- [ ] **Step 3: Redesign manage-meds-modal.tsx state**

Replace the single `freq` state with split `freqType` + `timesPerDay` + `scheduleTimes` state:

```tsx
const [name, setName] = useState("");
const [dose, setDose] = useState("");
const [freqType, setFreqType] = useState<MedicationFrequencyTypeApi>("once_daily");
const [timesPerDay, setTimesPerDay] = useState(2);
const [scheduleTimes, setScheduleTimes] = useState<string[]>(["08:00"]);

// Derived: when freqType changes, reset scheduleTimes to appropriate defaults
const handleFreqChange = (f: MedicationFrequencyTypeApi) => {
  setFreqType(f);
  if (f === "once_daily") setScheduleTimes(["08:00"]);
  else if (f === "times_per_day") setScheduleTimes(["08:00", "20:00"]);
  else setScheduleTimes([]); // as_needed: no times
};
```

- [ ] **Step 4: Update addMutation payload**

Replace the old `addMutation.mutationFn` with a clean, type-discriminated payload:

```tsx
const addMutation = useMutation({
  mutationFn: () => {
    const base = { name: name.trim(), dosage: dose.trim() || null, frequencyType: freqType };
    if (freqType === "as_needed") {
      return createMedication(base);
    }
    if (freqType === "times_per_day") {
      return createMedication({
        ...base,
        timesPerDay,
        scheduleTimes: scheduleTimes.slice(0, timesPerDay)
      });
    }
    // once_daily
    return createMedication({ ...base, scheduleTimes });
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
    void queryClient.invalidateQueries({ queryKey: ["wellness", "schedule"] });
    void queryClient.invalidateQueries({ queryKey: ["wellness", "adherence-summary"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
    setName("");
    setDose("");
    setFreqType("once_daily");
    setScheduleTimes(["08:00"]);
    setTimesPerDay(2);
  }
});
```

- [ ] **Step 5: Redesign the Add form UI**

Replace the single `<select>` with a two-section form inside `wl-modal__body`. Remove the old conflated `<select>`. Add:

```tsx
{/* Frequency selector — three options, no time conflation */}
<div style={{ marginTop: 10 }}>
  <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>Frequency</div>
  <div style={{ display: "flex", gap: 6 }}>
    {(["once_daily", "times_per_day", "as_needed"] as const).map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => handleFreqChange(f)}
        style={{
          flex: 1,
          padding: "7px 0",
          fontSize: 13,
          borderRadius: "var(--radius-md)",
          border: `1.5px solid ${freqType === f ? "var(--accent)" : "var(--border)"}`,
          background: freqType === f ? "var(--accent-subtle)" : "var(--surface)",
          color: freqType === f ? "var(--accent-fg)" : "var(--text)",
          cursor: "pointer"
        }}
      >
        {f === "once_daily" ? "Once daily" : f === "times_per_day" ? "Multiple/day" : "As needed"}
      </button>
    ))}
  </div>
</div>

{/* Times per day stepper — only for times_per_day */}
{freqType === "times_per_day" ? (
  <div style={{ marginTop: 10 }}>
    <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>Times per day</div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button type="button" className="ghost-button"
        style={{ fontSize: 14, padding: "4px 12px", minHeight: "unset" }}
        disabled={timesPerDay <= 2}
        onClick={() => {
          const n = timesPerDay - 1;
          setTimesPerDay(n);
          setScheduleTimes((t) => t.slice(0, n));
        }}>−</button>
      <span style={{ fontSize: 15, minWidth: 20, textAlign: "center" }}>{timesPerDay}</span>
      <button type="button" className="ghost-button"
        style={{ fontSize: 14, padding: "4px 12px", minHeight: "unset" }}
        disabled={timesPerDay >= 6}
        onClick={() => {
          const n = timesPerDay + 1;
          setTimesPerDay(n);
          setScheduleTimes((t) => {
            const copy = [...t];
            while (copy.length < n) copy.push("12:00");
            return copy;
          });
        }}>+</button>
    </div>
  </div>
) : null}

{/* Time slot inputs — hidden for PRN */}
{freqType !== "as_needed" ? (
  <div style={{ marginTop: 10 }}>
    <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>
      {freqType === "once_daily" ? "Time of day" : "Times of day"}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {scheduleTimes.slice(0, freqType === "once_daily" ? 1 : timesPerDay).map((t, i) => (
        <input
          key={i}
          type="time"
          value={t}
          onChange={(e) =>
            setScheduleTimes((prev) => {
              const copy = [...prev];
              copy[i] = e.target.value;
              return copy;
            })
          }
          aria-label={`Dose time ${i + 1}`}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "7px 12px",
            fontSize: 14,
            background: "var(--surface)",
            color: "var(--text)"
          }}
        />
      ))}
    </div>
  </div>
) : (
  <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-subtle)", fontStyle: "italic" }}>
    As-needed medications have no fixed schedule.
  </div>
)}
```

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep -A3 "manage-meds-modal"
```

Expected: no errors.

- [ ] **Step 7: Check file size**

```bash
wc -l apps/web/src/wellness/manage-meds-modal.tsx
```

Expected: under 1000 lines. If over, extract the "Add medication form" as a sub-component `AddMedForm` in a new file `apps/web/src/wellness/add-med-form.tsx`.

- [ ] **Step 8: Run medication tests**

```bash
vitest run tests/integration/wellness-medications.test.ts 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/wellness/manage-meds-modal.tsx tests/integration/wellness-medications.test.ts
git commit -m "feat(wellness): separate frequency from time-of-day in med modal; fix PRN add (B1, F2)

Redesigns add-medication form: frequency type (once/multiple/PRN) and
time-of-day are now independent. PRN sends no scheduling fields, which
is the correct payload the backend expects.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Q2 — Today "Meds" widget → inline log modal

**Change:** The "Meds" button in `TodayPage`'s wellness aside opens an inline modal with today's medication schedule instead of navigating to /wellness.

**Files:**
- Modify: `apps/web/src/today/today-page.tsx`

Note: `MedToday` from `wellness-today.tsx` already provides the full schedule + log interaction as a self-contained card. We'll render it inside a modal scrim.

- [ ] **Step 1: Add modal state and MedToday import**

At the top of `today-page.tsx` add:

```tsx
import { WellnessToday } from "../wellness/wellness-today";
// We need MedToday, which is not exported. Instead, import ManageMedsModal for the manage action
// and render WellnessToday's MedToday via a wrapper or just reproduce the schedule inline.
```

Actually, `MedToday` is a local function inside `wellness-today.tsx` — not exported. The cleanest approach: add `export function MedTodayCard(props)` to `wellness-today.tsx` that wraps `MedToday`.

Open `wellness-today.tsx` and add an export wrapper at the bottom:

```tsx
// New export — used by TodayPage for inline modal
export { MedToday as MedTodayCard };
```

Wait — `MedToday` is a function with specific props. Instead, let's export it directly:

```tsx
// At the end of wellness-today.tsx, add:
export type { MedTodayProps };
```

And change `function MedToday` to `export function MedToday`.

Then in `today-page.tsx`:

```tsx
import { MedToday } from "../wellness/wellness-today";
import { ManageMedsModal } from "../wellness/manage-meds-modal";
```

- [ ] **Step 2: Add inline modal state**

In `TodayPage`, add:

```tsx
const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
const [medsModalOpen, setMedsModalOpen] = useState(false);
const [manageMedsOpen, setManageMedsOpen] = useState(false);
```

- [ ] **Step 3: Update the Meds button**

```tsx
// BEFORE:
<button className="well__btn well__btn--meds" onClick={() => navigate("/wellness")}>
  Meds
</button>

// AFTER:
<button className="well__btn well__btn--meds" onClick={() => setMedsModalOpen(true)}>
  Meds
</button>
```

- [ ] **Step 4: Render the inline meds modal**

After the `</div>` that closes the main `cmd-wrap`, add:

```tsx
{medsModalOpen ? (
  <div
    className="wl-modal-scrim"
    onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setMedsModalOpen(false); }}
  >
    <div className="wl-modal" role="dialog" aria-modal="true" aria-labelledby="today-meds-title"
      style={{ maxWidth: 480 }}>
      <div className="wl-modal__head">
        <div className="hm">
          <div className="wl-modal__eyebrow">Today</div>
          <div className="wl-modal__title" id="today-meds-title">Medications</div>
        </div>
        <button type="button" className="wl-modal__x" aria-label="Close" onClick={() => setMedsModalOpen(false)}>
          <XIcon />
        </button>
      </div>
      <div className="wl-modal__body" style={{ padding: "0 0 8px" }}>
        <MedToday theme={theme} onManage={() => { setMedsModalOpen(false); setManageMedsOpen(true); }} />
      </div>
      <div className="wl-modal__foot">
        <span className="spacer" />
        <button type="button" className="primary-button" onClick={() => setMedsModalOpen(false)}>Done</button>
      </div>
    </div>
  </div>
) : null}

<ManageMedsModal open={manageMedsOpen} onClose={() => setManageMedsOpen(false)} theme={theme} />
```

Add `XIcon` SVG component local to `today-page.tsx` (or import from a shared location if one exists):

```tsx
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
```

- [ ] **Step 5: Check imports and typecheck**

```bash
pnpm typecheck 2>&1 | grep -A3 "today-page\|wellness-today"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/today/today-page.tsx apps/web/src/wellness/wellness-today.tsx
git commit -m "feat(today): Meds widget opens inline log modal without nav (Q2)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Q3 — Today "Check in" widget → inline modal

**Change:** The "Check in" button opens `CheckinModal` inline in today-page, wired to the same create-checkin mutation as the wellness page.

**Files:**
- Modify: `apps/web/src/today/today-page.tsx`

- [ ] **Step 1: Import CheckinModal and mutation dependencies**

In `today-page.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWellnessCheckin } from "../api/client";
import { CheckinModal, type CheckinFormValue } from "../wellness/checkin-modal";
```

(Note: `useQuery` and `useQueryClient` may already be imported — check and don't duplicate.)

- [ ] **Step 2: Add check-in modal state and mutation**

```tsx
const [checkinModalOpen, setCheckinModalOpen] = useState(false);
const queryClient = useQueryClient(); // may already exist

const createCheckinMutation = useMutation({
  mutationFn: (val: CheckinFormValue) =>
    createWellnessCheckin({
      feelingCore: val.emotion,
      feelingSecondary: val.feeling,
      feelingTertiary: null,
      sensations: val.sensations,
      intensity: val.intensity,
      note: val.note || null,
      identifiedVia: "wheel"
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["wellness", "checkins"] });
    void queryClient.invalidateQueries({ queryKey: ["wellness", "insights"] });
    setCheckinModalOpen(false);
  }
});
```

- [ ] **Step 3: Update the "Check in" button**

```tsx
// BEFORE:
<button className="well__btn" onClick={() => navigate("/wellness")}>
  Check in
</button>

// AFTER:
<button className="well__btn" onClick={() => setCheckinModalOpen(true)}>
  Check in
</button>
```

- [ ] **Step 4: Render CheckinModal**

Add after the meds modal block:

```tsx
<CheckinModal
  open={checkinModalOpen}
  onClose={() => setCheckinModalOpen(false)}
  onSave={(val) => createCheckinMutation.mutate(val)}
  initial={null}
  seedEmotion={null}
  theme={theme}
/>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -A3 "today-page"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/today/today-page.tsx
git commit -m "feat(today): Check-in widget opens inline modal without nav (Q3)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: D3 — Radial feeling-wheel picker

**D3** ports the `RadialDial` SVG picker from the design bundle into the real app, gated by a localStorage `radial` preference toggle.

**Design reference:** `/home/ben/.claude/jobs/914af5c0/tmp/design/jarvis-design-system/project/ui_kits/jarvis-app/WellnessCheckin.jsx` — `RadialDial` component (lines ~18–57).

**Files:**
- Create: `apps/web/src/wellness/radial-dial.tsx`
- Create: `apps/web/src/wellness/wellness-prefs.ts`
- Modify: `apps/web/src/wellness/checkin-modal.tsx`
- Modify: `apps/web/src/wellness/wellness-page.tsx` (add toggle)

- [ ] **Step 1: Create wellness-prefs.ts**

```ts
// apps/web/src/wellness/wellness-prefs.ts
import { useState, useEffect } from "react";

const PREFS_KEY = "jarvis.wellness.prefs";

export interface WellnessPrefs {
  radial: boolean;
}

const DEFAULTS: WellnessPrefs = { radial: false };

function readPrefs(): WellnessPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WellnessPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: WellnessPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable; prefs stay in-memory
  }
}

export function useWellnessPrefs(): [WellnessPrefs, (patch: Partial<WellnessPrefs>) => void] {
  const [prefs, setPrefs] = useState<WellnessPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  const update = (patch: Partial<WellnessPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writePrefs(next);
      return next;
    });
  };

  return [prefs, update];
}
```

- [ ] **Step 2: Create radial-dial.tsx**

Port the `RadialDial` from the design bundle. The design uses `KD.EMOTIONS` — in the real app that's `EMOTIONS` from `@jarv1s/shared`, using `e.core` as the key and `coreLabel(e.core)` for the label.

```tsx
// apps/web/src/wellness/radial-dial.tsx
import { EMOTIONS } from "@jarv1s/shared";
import { emoColor, coreLabel, type WellnessEmotionCore, type Theme } from "./emotion-taxonomy";

function pol(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function sector(
  cx: number, cy: number, ri: number, ro: number, a0: number, a1: number
): string {
  const [x0o, y0o] = pol(cx, cy, ro, a0);
  const [x1o, y1o] = pol(cx, cy, ro, a1);
  const [x0i, y0i] = pol(cx, cy, ri, a0);
  const [x1i, y1i] = pol(cx, cy, ri, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0o} ${y0o} A${ro} ${ro} 0 ${large} 1 ${x1o} ${y1o} L${x1i} ${y1i} A${ri} ${ri} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

interface RadialDialProps {
  value: WellnessEmotionCore | null;
  onPick: (core: WellnessEmotionCore) => void;
  theme: Theme;
}

export function RadialDial({ value, onPick, theme }: RadialDialProps) {
  const cx = 150, cy = 150, ri = 92, ro = 130, pad = 2.4;
  const n = EMOTIONS.length;

  return (
    <div className="wl-dial">
      <svg viewBox="0 0 300 300" className="wl-dial__svg" style={{ width: "100%", maxWidth: 300 }}>
        {EMOTIONS.map((e, i) => {
          const a0 = i * (360 / n) + pad;
          const a1 = (i + 1) * (360 / n) - pad;
          const mid = (a0 + a1) / 2;
          const c = emoColor(e.core, theme);
          const on = value === e.core;
          const [lx, ly] = pol(cx, cy, (ri + ro) / 2, mid);
          return (
            <g key={e.core} className="wl-dial__seg" onClick={() => onPick(e.core)}
               style={{ cursor: "pointer" }}>
              <path
                d={sector(cx, cy, ri, ro, a0, a1)}
                fill={on ? c.tint : c.soft}
                stroke="var(--surface)"
                strokeWidth="2.5"
              />
              {on ? (
                <path d={sector(cx, cy, ro + 3, ro + 5, a0, a1)} fill={c.tint} />
              ) : null}
              <text
                x={lx} y={ly + 3.5}
                textAnchor="middle"
                fontSize="11"
                fontFamily="inherit"
                style={{ fill: on ? "#fff" : c.ink, userSelect: "none", pointerEvents: "none" }}
              >
                {coreLabel(e.core)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="wl-dial__hub">
        <span style={{ fontSize: 11, color: "var(--text-subtle)", display: "block" }}>
          {value ? "Feeling" : "Choose"}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          {value ? coreLabel(value) : "How do you feel?"}
        </span>
      </div>
    </div>
  );
}
```

Add CSS to `apps/web/src/styles/wellness-2.css` (the existing wellness CSS file — find the right one via `grep -l "wl-dial\|wl-modal" apps/web/src/styles/`):

```css
/* Radial dial */
.wl-dial { position: relative; display: flex; flex-direction: column; align-items: center; }
.wl-dial__svg { display: block; }
.wl-dial__hub {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  width: 80px;
}
```

- [ ] **Step 3: Wire radial into checkin-modal.tsx**

In `checkin-modal.tsx`, change the static picker state:

```tsx
// BEFORE:
const [pickerStyle] = useState<PickerStyle>("Guided");

// AFTER:
import { useWellnessPrefs } from "./wellness-prefs";
import { RadialDial } from "./radial-dial";

// Inside CheckinModal:
const [prefs] = useWellnessPrefs();
const pickerStyle: "Guided" | "Palette" | "Radial" = prefs.radial ? "Radial" : "Guided";
```

Add the `Radial` case to the picker:

```tsx
// Add as third branch in the if/else:
} else if (pickerStyle === "Radial") {
  body = (
    <div>
      <div className="wl-q">What are you feeling?</div>
      <div className="wl-qsub">Tap your core emotion on the wheel.</div>
      <RadialDial value={emotion} onPick={(k) => { pickEmotion(k); setStep(1); }} theme={theme} />
      {emotion && feeling ? (
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: "1px solid var(--border-subtle)", ...emVars(emotion, theme) }}>
          <CheckinDetailFields
            emotion={emotion} feeling={feeling} sensations={sensations}
            intensity={intensity} note={note}
            onSensation={toggleSensation} onIntensity={setIntensity} onNote={setNote}
            theme={theme}
          />
        </div>
      ) : emotion ? (
        <div style={{ marginTop: 18 }}>
          <div className="wl-q" style={{ fontSize: 15 }}>
            Which shade of {coreLabel(emotion)}?
          </div>
          <FeelingChips />
        </div>
      ) : null}
    </div>
  );
  foot = (
    <>
      <span className="spacer" />
      <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
      <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
        {initial ? "Update check-in" : "Save check-in"}
      </button>
    </>
  );
}
```

- [ ] **Step 4: Add radial toggle to wellness page**

In `wellness-page.tsx`, add the toggle near the top of the page (e.g., in the hero or below the streak stats). Import `useWellnessPrefs`:

```tsx
import { useWellnessPrefs } from "./wellness-prefs";

// Inside WellnessPage:
const [prefs, updatePrefs] = useWellnessPrefs();
```

Add a small toggle below the streak stat in the hero:

```tsx
{/* Feeling-wheel toggle — below wl-hero__stat */}
<div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
  <label style={{ fontSize: 12, color: "var(--text-subtle)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
    <input
      type="checkbox"
      checked={prefs.radial}
      onChange={(e) => updatePrefs({ radial: e.target.checked })}
      style={{ accentColor: "var(--accent)" }}
    />
    Feeling wheel
  </label>
</div>
```

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck 2>&1 | grep -A3 "checkin-modal\|radial-dial\|wellness-prefs\|wellness-page"
pnpm lint 2>&1 | grep -A3 "checkin-modal\|radial-dial"
```

Expected: no errors.

- [ ] **Step 6: Check file sizes**

```bash
wc -l apps/web/src/wellness/checkin-modal.tsx apps/web/src/wellness/radial-dial.tsx apps/web/src/wellness/wellness-prefs.ts apps/web/src/wellness/wellness-page.tsx
```

All must be under 1000 lines.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/wellness/radial-dial.tsx apps/web/src/wellness/wellness-prefs.ts apps/web/src/wellness/checkin-modal.tsx apps/web/src/wellness/wellness-page.tsx apps/web/src/styles/wellness-2.css
git commit -m "feat(wellness): radial feeling-wheel picker gated by 'feeling wheel' toggle (D3)

RadialDial SVG picker ported from design bundle. Stored in localStorage
under jarvis.wellness.prefs.radial. Toggle exposed as a checkbox in the
wellness page hero.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Full gate verification

- [ ] **Step 1: Run the full foundation gate**

```bash
pnpm verify:foundation
echo "EXIT: $?"
```

Expected: `EXIT: 0`. If any failure, fix before proceeding.

- [ ] **Step 2: Report to coordinator**

Send SHA + gate result to `Wellness-Coordinator` via `herdr-pane-message` skill.

---

## Spec Coverage Check

| Item | Task |
|---|---|
| B1 — PRN add broken | Task 4 (payload fix + test) |
| B2 — today's check-in not in history | Task 1 (filter removal) |
| Q1 — insights low-data empty state | Task 2 (backend guard + frontend message) |
| Q2 — Today Meds inline modal | Task 5 |
| Q3 — Today Check-in inline modal | Task 6 |
| F2 — frequency separate from time-of-day | Task 4 (modal redesign) |
| F3 — multiple check-ins per day | Task 3 (today card + history) |
| D3 — radial feeling-wheel picker | Task 7 |

All 8 spec items covered. Tests for B1, B2, F2, F3 as required by spec. ✓
