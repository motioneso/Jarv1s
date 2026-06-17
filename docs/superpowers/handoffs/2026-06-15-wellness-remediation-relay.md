# Build-agent relay — Wellness Codex remediation (continuation)

**You are a BUILD AGENT** continuing the Codex remediation for the Wellness design feature.
Coordinator: **`Wellness-Coordinator`** (Herdr pane label). Confirm it still exists via
`herdr pane list` before messaging.

## Worktree / branch

- CWD: `/home/ben/Jarv1s/.claude/worktrees/feat+wellness-design`
- Branch: `worktree-feat+wellness-design`
- **Do NOT `pnpm install`** — `node_modules` already present.
- **Do NOT push/PR/merge** — coordinator owns those steps.

## Original handoff (read for full context)

- `docs/superpowers/handoffs/2026-06-15-wellness-codex-remediation.md`
- `docs/superpowers/handoffs/2026-06-15-wellness-design-relay.md` (the 9-finding decisions)

## What the prior session completed (WIP — NOT YET COMMITTED)

All changes below are unstaged edits on disk. Verify with `git diff --stat`.

### `packages/shared/src/wellness-api.ts` ✅

- Added `UpdateCheckinRequest`, `UpdateCheckinResponse` DTOs
- Added `AdherenceDoseSummaryItemDto`, `DayAdherenceSummaryDto`, `MedicationAdherenceSummaryResponse` DTOs
- Added JSON schemas for all above
- Added `medicationAdherenceSummaryRouteSchema`, `updateCheckinRouteSchema` route schemas

### `packages/wellness/src/insights.ts` ✅ (H2)

- Added `totalExpectedSlots?: number` param to `computeInsights`; uses it as adherence denominator

### `packages/wellness/src/repository.ts` ✅ (H3)

- Added `UpdateCheckinInput` interface
- Added `updateCheckin(scopedDb, id, input)` method (feeling path enforced by route, tertiary always null)

### `packages/wellness/src/routes.ts` ✅ (H2+M5, H3, M4, insights)

- Imports: removed `medicationLogsRouteSchema`, added `medicationAdherenceSummaryRouteSchema`, `updateCheckinRouteSchema`, `UpdateCheckinInput`
- Added `PATCH /api/wellness/checkins/:id` route with 404 on not-found
- Updated therapy note POST: catches `P0001` (isRaisedException) OR `23503` (isFkViolation) → 404 "linked check-in not found"
- Updated insights route: computes `totalExpectedSlots` via `computeSchedule` per day → passes to `computeInsights`
- Replaced `/api/wellness/medications/logs` with per-day adherence summary (no dose/prnReason)
- Added `isRaisedException` helper + `parseUpdateCheckinBody` parser

### `packages/wellness/src/manifest.ts` ✅

- Added `PATCH /api/wellness/checkins/:id` route entry under `wellness.update`
- Updated logs route entry → `medicationAdherenceSummaryRouteSchema.response[200]`

### `packages/wellness/src/recall-context.ts` ✅ (L8)

- `select(["energy"])` only; `deriveEnergyTrend` narrowed to `Pick<WellnessCheckin, "energy">`

### `packages/wellness/src/index.ts` ✅

- Added `UpdateCheckinInput` export

## What you must complete (TODO)

Work through these in order. Typecheck after each group to catch problems early.

### Group A — Web API client layer

**`apps/web/src/api/client.ts`:**

- Remove import of `MedicationLogsResponse`
- Add imports: `MedicationAdherenceSummaryResponse`, `UpdateCheckinRequest`, `UpdateCheckinResponse`
- Remove function `listMedicationLogs`
- Add:
  ```ts
  export async function getMedicationAdherenceSummary(
    sinceDays: number
  ): Promise<MedicationAdherenceSummaryResponse> {
    return requestJson<MedicationAdherenceSummaryResponse>(
      `/api/wellness/medications/logs?sinceDays=${sinceDays}`
    );
  }
  export async function updateWellnessCheckin(
    id: string,
    input: UpdateCheckinRequest
  ): Promise<UpdateCheckinResponse> {
    return requestJson<UpdateCheckinResponse>(`/api/wellness/checkins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input
    });
  }
  ```

**`apps/web/src/api/query-keys.ts`:**

- Rename `logs: (sinceDays: number) => ["wellness", "logs", sinceDays] as const`
  → `adherenceSummary: (sinceDays: number) => ["wellness", "adherence-summary", sinceDays] as const`

### Group B — Chart + Trends (H2+M5)

**`apps/web/src/wellness/wellness-chart.tsx`:**

- Add import: `import type { AdherenceDoseSummaryItemDto } from "@jarv1s/shared";`
- Add `doses?: readonly AdherenceDoseSummaryItemDto[]` to `DayPoint` interface
- In the tooltip (after the "Medication X/Y taken" row), add dose names+status:
  ```tsx
  {
    d.doses && d.doses.filter((dos) => !dos.prn).length > 0
      ? d.doses
          .filter((dos) => !dos.prn)
          .map((dos, j) => (
            <div
              key={j}
              className="wl-tiprow"
              style={{ opacity: dos.status === "taken" ? 1 : 0.5 }}
            >
              <span>{dos.name}</span>
              <span style={{ textTransform: "capitalize" }}>{dos.status}</span>
            </div>
          ))
      : null;
  }
  ```

**`apps/web/src/wellness/wellness-trends.tsx`:**

- Remove imports: `listMedicationLogs`, `listMedications`; add `getMedicationAdherenceSummary`
- Remove imports from `@jarv1s/shared` that were only for `EMOTIONS` (keep EMOTIONS if still used)
- Replace `logsQuery` + `medsQuery` with:
  ```ts
  const adherenceQuery = useQuery({
    queryKey: queryKeys.wellness.adherenceSummary(range),
    queryFn: () => getMedicationAdherenceSummary(range)
  });
  ```
- Remove `logsByDate`, `denom`, `scheduledMeds` computation
- Build `summaryByDate: Record<string, DayAdherenceSummaryDto>`:
  ```ts
  const summaryByDate: Record<string, DayAdherenceSummaryDto> = {};
  (adherenceQuery.data?.days ?? []).forEach((d) => {
    summaryByDate[d.date] = d;
  });
  ```
- Update `DayPoint` construction:
  ```ts
  const summary = summaryByDate[iso] ?? null;
  return {
    date: iso,
    label: shortLabel(iso),
    isToday: iso === todayStr,
    checkin: checkinByDate[iso] ?? null,
    medFrac:
      summary && summary.scheduledCount > 0 ? summary.takenCount / summary.scheduledCount : 0,
    medTaken: summary?.takenCount ?? 0,
    medDenom: summary?.scheduledCount ?? 0,
    doses: summary?.doses ?? []
  };
  ```
- Add `isError` render state (L9 — trends): if `checkinsQuery.isError || adherenceQuery.isError`, render an error message instead of the chart.
- Import `DayAdherenceSummaryDto` from `@jarv1s/shared`

### Group C — Error states (L9)

**`apps/web/src/wellness/wellness-insights.tsx`:**

- After `insightsQuery.isLoading ? (...)` branch, add `insightsQuery.isError ? (<error state>) :` before the empty-state check.
  Error state: `<div className="wl-insight"><span style={{fontSize:13, color:'var(--text-subtle)'}}>Couldn't load insights — try refreshing.</span></div>`

**`apps/web/src/wellness/wellness-therapy-notes.tsx`:**

- After the `notesQuery` data lines, add error handling in the render: if `notesQuery.isError`, render an error notice in the notes list area.

**`apps/web/src/wellness/wellness-today.tsx` — `MedToday` component:**

- `scheduleQuery.isError` → in the `wl-medlist` div, before the `slots.length === 0` check, add:
  ```tsx
  {scheduleQuery.isError ? (
    <p style={{ fontSize: 13, color: "var(--text-subtle)", padding: "4px 0" }}>
      Couldn't load schedule — try refreshing.
    </p>
  ) : ...}
  ```
- `logMutation.onSuccess` (M7): **Add** schedule + adherenceSummary + insights invalidation:
  ```ts
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.schedule(date) });
    void queryClient.invalidateQueries({ queryKey: ["wellness", "adherence-summary"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
  };
  ```

### Group D — Page mutations (H3 + M7)

**`apps/web/src/wellness/wellness-page.tsx`:**

- Add `updateWellnessCheckin` to client imports
- Add `UpdateCheckinRequest` to shared imports (or inline)
- Add `updateCheckinMutation`:
  ```ts
  const updateCheckinMutation = useMutation({
    mutationFn: (val: CheckinFormValue) =>
      updateWellnessCheckin(editCheckin!.id, {
        feelingCore: val.emotion,
        feelingSecondary: val.feeling || null,
        feelingTertiary: null,
        sensations: val.sensations,
        intensity: val.intensity,
        note: val.note || null
      } satisfies UpdateCheckinRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.checkins });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
    }
  });
  ```
- Update `handleSave`:
  ```ts
  const handleSave = (val: CheckinFormValue) => {
    if (editCheckin) {
      updateCheckinMutation.mutate(val);
    } else {
      createCheckinMutation.mutate(val);
    }
  };
  ```
- Update `createCheckinMutation.onSuccess` to also invalidate insights:
  ```ts
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.checkins });
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
  };
  ```

### Group E — Manage meds modal (M6 + M7)

**`apps/web/src/wellness/manage-meds-modal.tsx`:**

- Fix `addMutation.mutationFn` to build valid `CreateMedicationRequest` per freq type:
  ```ts
  mutationFn: () => {
    const isTPD = freq === "times_per_day";
    const isPRN = freq === "as_needed";
    return createMedication({
      name: name.trim(),
      dosage: dose.trim() || null,
      frequencyType: freq,
      timesPerDay: isTPD ? 2 : null,
      scheduleTimes: isPRN ? null : isTPD ? ["08:00", "20:00"] : ["08:00"],
      intervalHours: null,
      weekdays: null,
      cycleAnchorDate: null,
      cycleDaysOn: null,
      cycleDaysOff: null
    });
  };
  ```
- `addMutation.onSuccess` → also invalidate schedule + adherenceSummary + insights:
  ```ts
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.schedule(todayIso()) });
    void queryClient.invalidateQueries({ queryKey: ["wellness", "adherence-summary"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
    setName("");
    setDose("");
  };
  ```
  Note: `manage-meds-modal.tsx` doesn't have a `todayIso()` function yet — you can either import one, inline it, or just invalidate all schedule queries: `void queryClient.invalidateQueries({ queryKey: ["wellness", "schedule"] })`.
- `deactivateMutation.onSuccess` → same invalidations.

### Group F — Spec doc (H1)

**`docs/superpowers/specs/2026-06-14-p5-wellness-design-taxonomy-insights.md`:**

- Append to "Open Risks" section (currently 5 items):
  ```
  6. **`0088` fails on non-empty `wellness_checkins`.** The enum-swap migration uses `ALTER COLUMN … TYPE … USING` with a `CASE` that aborts if any existing row maps to an unrecognized value. This is intentional fail-loud behavior — silent data corruption is worse than a failed migration. For a first deploy to a populated env, a forward-remap migration must be authored first (map old values → new enum values row by row, then run `0088`). No `0088` edit is needed; the solution is a new migration added before it in the apply order. Dev-only data means blast radius is zero today.
  ```

### Group G — Tests (L10 + new tests)

**`tests/integration/wellness-phase2.test.ts`:**

Extend the "wellness insights — owner-scoped" describe block. Replace the existing shallow test with a deeper one:

```ts
it("GET /api/wellness/insights returns ONLY actor-owned data (not other user's)", async () => {
  const repo = new WellnessRepository();
  // Seed other user with a med + taken dose so their adherence takenCount > 0
  await dataContext.withDataContext(ctx(otherUserId), async (db) => {
    await repo.createCheckin(db, { feelingCore: "happy", intensity: 5 });
    const med = await repo.createMedication(db, {
      name: "OtherMed",
      frequencyType: "once_daily",
      scheduleTimes: ["08:00"]
    });
    await repo.logDose(db, med.id, {
      status: "taken",
      scheduledFor: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    });
  });
  const app = Fastify();
  registerWellnessRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:insights-scope" }),
    dataContext
  });
  await app.ready();
  try {
    const res = await app.inject({ method: "GET", url: "/api/wellness/insights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.insights)).toBe(true);
    expect(body.insights.some((i: { key: string }) => i.key === "adherence")).toBe(true);
    // adherence insight lead should NOT reflect other user's "taken" log — actor has 0 taken
    const adh = body.insights.find((i: { key: string }) => i.key === "adherence");
    // actor has no meds, so adherence = 0% (not 100% from other user's taken log)
    expect(adh?.lead).toContain("0%");
  } finally {
    await app.close();
  }
});
```

Add a new `describe("PATCH /api/wellness/checkins/:id", ...)` block:

```ts
describe("PATCH /api/wellness/checkins/:id", () => {
  it("updates own checkin and returns 200", async () => {
    const repo = new WellnessRepository();
    let checkinId = "";
    await dataContext.withDataContext(ctx(userId), async (db) => {
      const c = await repo.createCheckin(db, { feelingCore: "sad" });
      checkinId = c.id;
    });
    const app = Fastify();
    registerWellnessRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:patch-ck" }),
      dataContext
    });
    await app.ready();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/wellness/checkins/${checkinId}`,
        payload: { feelingCore: "happy", feelingSecondary: "Joy" }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checkin.feelingCore).toBe("happy");
      expect(body.checkin.feelingSecondary).toBe("Joy");
      expect(body.checkin.feelingTertiary).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("returns 404 for non-existent or other-user checkin", async () => {
    const app = Fastify();
    registerWellnessRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:patch-404" }),
      dataContext
    });
    await app.ready();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/wellness/checkins/00000000-0000-4000-8000-000000000999",
        payload: { feelingCore: "happy" }
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
```

Add a `describe("GET /api/wellness/medications/logs — adherence summary", ...)` block:

```ts
describe("GET /api/wellness/medications/logs — adherence summary", () => {
  it("returns per-day summary without dose/prnReason fields", async () => {
    const app = Fastify();
    registerWellnessRoutes(app, {
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:adh-summary" }),
      dataContext
    });
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/wellness/medications/logs?sinceDays=7"
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.days)).toBe(true);
      expect(body.days.length).toBe(7);
      // verify structure — no raw dose/prnReason on any dose item
      for (const day of body.days) {
        expect(typeof day.date).toBe("string");
        expect(typeof day.scheduledCount).toBe("number");
        expect(typeof day.takenCount).toBe("number");
        expect(Array.isArray(day.doses)).toBe(true);
        for (const dos of day.doses) {
          expect(dos).not.toHaveProperty("dose");
          expect(dos).not.toHaveProperty("prnReason");
          expect(typeof dos.medicationId).toBe("string");
          expect(typeof dos.name).toBe("string");
          expect(typeof dos.prn).toBe("boolean");
        }
      }
    } finally {
      await app.close();
    }
  });
});
```

Add M4 route-level test in the "WellnessRepository — therapy notes" describe:

```ts
it("POST therapy note with cross-owner linkedCheckinId → 404 (not 500)", async () => {
  let otherCheckinId = "";
  await dataContext.withDataContext(ctx(otherUserId), async (db) => {
    const c = await new WellnessRepository().createCheckin(db, { feelingCore: "happy" });
    otherCheckinId = c.id;
  });
  const app = Fastify();
  registerWellnessRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:m4-test" }),
    dataContext
  });
  await app.ready();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/wellness/therapy-notes",
      payload: { body: "test note", linkedCheckinId: otherCheckinId }
    });
    expect(res.statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
```

## Verification

After ALL edits:

1. `pnpm typecheck` — fix any type errors before running full gate
2. `pnpm verify:foundation` — read the **actual exit code** (never tail/wrap). DB is up on `localhost:55433` (`postgres:postgres`, db `jarv1s`); migrations `0088`/`0089` already applied.
3. Run stale-vocabulary cleanup: `rg -l "listMedicationLogs\|MedicationLogsResponse" apps/ packages/ --include="*.ts" --include="*.tsx"` — should find nothing (we removed/replaced these).
4. Commit with Sonnet trailer, staging ONLY changed paths.
5. Report to `Wellness-Coordinator` pane: commit SHA, real gate exit code, per-finding status.

## Hard constraints

- Never edit migrations `0088`/`0089`
- No push/PR/merge — coordinator owns those
- 1000-line file limit (`pnpm check:file-size` is part of `verify:foundation`)
- Stage only your own files

## Coordinator

Label: **`Wellness-Coordinator`** (re-resolve pane ID via `herdr pane list` — don't hardcode).
