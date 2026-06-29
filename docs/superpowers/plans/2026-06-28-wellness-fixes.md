# Wellness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs across two issues — expose check-in free-text notes to Jarvis AI (#505) and repair the wellness export modal (broken POST body encoding + missing CSS classes) (#509).

**Architecture:** Three isolated, non-overlapping fixes. #505 is one line in the AI tool response shape. #509a is one line in the API client function. #509b is a CSS-only gap (no HTML structure changes except checkbox pattern) — add missing CSS classes to wellness-3.css and switch `wl-check` → `jds-check` in the modal. No migrations. No DB changes. Consent gate untouched.

**Tech Stack:** TypeScript, Fastify, React, @tanstack/react-query, jds-\* design system, custom wellness CSS (wellness-3.css).

## Global Constraints

- No migrations (confirmed in handoff — no DB schema changes needed)
- Consent gate (`resolveEffectiveWellnessConsent`) MUST remain enforced — do not weaken or bypass
- Only expose `note` under the existing consent check (no new gate)
- Checkboxes MUST use `jds-check` + `jds-check__box` pattern from components-core.css
- No raw CSS colors — use design token vars only (`var(--border)`, `var(--accent)`, etc.)
- File-size cap: 1000 lines per CSS file — wellness-3.css is currently 121 lines (safe)
- `requestJson` accepts `body?: unknown` and calls `JSON.stringify(body)` internally — NEVER pre-stringify before passing to it
- `git add` only the specific files for each task — never `git add -A`

---

### Task 1: Expose check-in free-text note in Jarvis AI tool response (#505)

**Files:**

- Modify: `packages/wellness/src/tools.ts` (lines 26–38)
- Modify: `packages/wellness/src/manifest.ts` (line 245)

**Interfaces:**

- Consumes: `serializeCheckin(c)` which returns `CheckinDto` — already includes `note: string | null` (line 21 of serialize.ts). No new imports needed.
- Produces: `wellnessRecentCheckInsExecute` return value gains `note: string | null` field and `"note"` in columnOrder.

- [ ] **Step 1: Add `note` field to tools.ts**

In `packages/wellness/src/tools.ts`, update the return block of `wellnessRecentCheckInsExecute` (the `return` starting at line 24):

Before (lines 25–38):

```ts
return {
  data: {
    items: checkins.map((c) => {
      const dto = serializeCheckin(c);
      return {
        checkedInAt: dto.checkedInAt,
        feelingCore: dto.feelingCore,
        feelingSecondary: dto.feelingSecondary,
        intensity: dto.intensity,
        moodIndex: dto.intensity != null ? moodIndex(dto.feelingCore, dto.intensity) : null
      };
    })
  },
  columnOrder: ["checkedInAt", "feelingCore", "feelingSecondary", "intensity", "moodIndex"]
};
```

After:

```ts
return {
  data: {
    items: checkins.map((c) => {
      const dto = serializeCheckin(c);
      return {
        checkedInAt: dto.checkedInAt,
        feelingCore: dto.feelingCore,
        feelingSecondary: dto.feelingSecondary,
        intensity: dto.intensity,
        moodIndex: dto.intensity != null ? moodIndex(dto.feelingCore, dto.intensity) : null,
        note: dto.note
      };
    })
  },
  columnOrder: ["checkedInAt", "feelingCore", "feelingSecondary", "intensity", "moodIndex", "note"]
};
```

- [ ] **Step 2: Update tool description in manifest.ts**

In `packages/wellness/src/manifest.ts` at line 244–245, update the `wellness.recentCheckIns` description:

Before:

```ts
      description:
        "List the actor's recent feelings check-ins (most recent first): timestamp, core feeling, secondary feeling, and intensity. Read-only.",
```

After:

```ts
      description:
        "List the actor's recent feelings check-ins (most recent first): timestamp, core feeling, secondary feeling, intensity, and free-text note (may be null). Read-only.",
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/wellness-fixes
pnpm typecheck 2>&1 | tail -15
```

Expected: 0 errors in `packages/wellness/`.

- [ ] **Step 4: Commit**

```bash
git add packages/wellness/src/tools.ts packages/wellness/src/manifest.ts
git commit -m "fix(wellness): expose check-in free-text note in AI tool response (#505)

wellnessRecentCheckInsExecute mapped check-in fields but silently dropped
note, which serializeCheckin() already provides. Add note to the returned
item shape and columnOrder, and update the tool description to match.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Fix wellness export POST body double-encode (#509)

**Files:**

- Modify: `apps/web/src/api/wellness-export.ts` (line 19)

**Interfaces:**

- `requestJson<T>(url, opts)` — `opts.body?: unknown`. It calls `JSON.stringify(opts.body)` internally. Passing `JSON.stringify(body)` causes double encoding: server receives the string `'"{\\"from\\":\\"...\\"}"'`, which fails Fastify body parsing → 400 → `onSuccess` never fires → `setJobId` never called → status query disabled → silent no-op in UI.

- [ ] **Step 1: Remove the pre-stringify**

In `apps/web/src/api/wellness-export.ts`, change line 19:

Before:

```ts
export async function requestWellnessExport(body: WellnessExportRequest): Promise<ExportJobStatus> {
  return requestJson<ExportJobStatus>("/api/wellness/export", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
```

After:

```ts
export async function requestWellnessExport(body: WellnessExportRequest): Promise<ExportJobStatus> {
  return requestJson<ExportJobStatus>("/api/wellness/export", {
    method: "POST",
    body
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -15
```

Expected: 0 errors in `apps/web/`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/wellness-export.ts
git commit -m "fix(wellness): remove double JSON.stringify in wellness export client (#509)

requestJson() stringifies body internally. Passing JSON.stringify(body)
as the body caused a 400 from Fastify body parsing — the server received
a JSON-encoded string literal rather than an object. This meant setJobId
was never called, the status query never enabled, and the UI appeared to
do nothing on click.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Fix export modal checkboxes (jds-check pattern) + add missing CSS (#509)

**Files:**

- Modify: `apps/web/src/wellness/export-modal.tsx`
- Modify: `apps/web/src/styles/wellness-3.css`

**Interfaces:**

- `jds-check` pattern from `components-core.css` (already loaded in app): requires `<label className="jds-check"> <input type="checkbox" /> <span className="jds-check__box">{svg}</span> label text </label>`. CSS hides the native input via `position:absolute; opacity:0; width:0; height:0`. Checked state: `input:checked + .jds-check__box { background: var(--accent) }` — the SVG inside is revealed.
- Existing usage: `apps/web/src/today/today-page.tsx` lines 634–647 (pattern reference).
- `wl-field`, `wl-field__label`, `wl-fieldset`, `wl-input`, `wl-modal__desc`, `wl-modal__note`, `wl-modal__note--error`, `wl-modal__progress`, `wl-modal__ready` — all referenced in the modal but absent from wellness CSS. Add to wellness-3.css.

- [ ] **Step 1: Add missing CSS to wellness-3.css**

Append to `apps/web/src/styles/wellness-3.css` (currently ends at line 121):

```css
/* ── Export modal form utilities (#509) ── */

.wl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wl-field__label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.wl-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wl-fieldset > legend {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 6px;
}

.wl-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  line-height: 1.4;
}

.wl-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--pine-soft);
}

.wl-modal__desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

.wl-modal__note {
  font-size: 13.5px;
  color: var(--text-subtle);
  line-height: 1.5;
}

.wl-modal__note--error {
  color: var(--danger-fg);
}

.wl-modal__progress,
.wl-modal__ready {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
}
```

- [ ] **Step 2: Add CheckIcon to export-modal.tsx**

In `apps/web/src/wellness/export-modal.tsx`, add a `CheckIcon` component after the existing `DownloadIcon` function (around line 40). This keeps the file self-contained — consistent with the existing `XIcon` and `DownloadIcon` pattern in the file:

```tsx
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 13 13"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,7 5,10 11,3" />
    </svg>
  );
}
```

- [ ] **Step 3: Switch checkboxes from `wl-check` to `jds-check` in export-modal.tsx**

Two places use `wl-check`. Replace both with the `jds-check` + `jds-check__box` pattern:

**Place 1** — category checkboxes (lines 184–193). Before:

```tsx
{
  WELLNESS_EXPORT_CATEGORIES.map((cat) => (
    <label key={cat} className="wl-check">
      <input
        type="checkbox"
        checked={categories.includes(cat)}
        onChange={() => toggleCategory(cat)}
      />
      {CATEGORY_LABELS[cat]}
    </label>
  ));
}
```

After:

```tsx
{
  WELLNESS_EXPORT_CATEGORIES.map((cat) => (
    <label key={cat} className="jds-check">
      <input
        type="checkbox"
        checked={categories.includes(cat)}
        onChange={() => toggleCategory(cat)}
      />
      <span className="jds-check__box">
        <CheckIcon />
      </span>
      {CATEGORY_LABELS[cat]}
    </label>
  ));
}
```

**Place 2** — sensitive-data acknowledgement checkbox (lines 196–203). Before:

```tsx
<label className="wl-check wl-check--sensitive" style={{ marginBottom: 14 }}>
  <input
    type="checkbox"
    checked={acknowledged}
    onChange={(e) => setAcknowledged(e.target.checked)}
  />
  <span>{SENSITIVE_COPY}</span>
</label>
```

After:

```tsx
<label className="jds-check" style={{ marginBottom: 14, alignItems: "flex-start" }}>
  <input
    type="checkbox"
    checked={acknowledged}
    onChange={(e) => setAcknowledged(e.target.checked)}
  />
  <span className="jds-check__box">
    <CheckIcon />
  </span>
  <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>
    {SENSITIVE_COPY}
  </span>
</label>
```

- [ ] **Step 4: Also expose startMutation.isError in the error note + call reset() on startMutation**

The error note (line 205–209) currently only shows when `isFailed` (status-query result = failed). But if the POST itself fails (before any jobId is set), `startMutation.isError` is true and currently nothing is shown. Expose it.

Also update `reset()` to call `startMutation.reset()` so error state is cleared when the user starts fresh.

Change the `reset()` function (lines 111–114):
Before:

```tsx
function reset() {
  setJobId(null);
  setAcknowledged(false);
}
```

After:

```tsx
function reset() {
  setJobId(null);
  setAcknowledged(false);
  startMutation.reset();
}
```

Change the error note (lines 205–209):
Before:

```tsx
{
  isFailed ? (
    <div className="wl-modal__note wl-modal__note--error" style={{ marginBottom: 10 }}>
      Export failed. Please try again.
    </div>
  ) : null;
}
```

After:

```tsx
{
  isFailed || startMutation.isError ? (
    <div className="wl-modal__note wl-modal__note--error" style={{ marginBottom: 10 }}>
      Export failed. Please try again.
    </div>
  ) : null;
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -15
```

Expected: 0 errors in `apps/web/`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/wellness/export-modal.tsx apps/web/src/styles/wellness-3.css
git commit -m "fix(wellness): align export modal checkboxes to jds-check, add missing CSS (#509)

The modal used wl-check/wl-field/wl-input/wl-modal__* CSS classes that
were never defined, rendering native unstyled browser checkboxes and bare
form fields. Replaced checkbox treatment with jds-check + jds-check__box
(consistent with the rest of the product) and added the missing utility
classes to wellness-3.css. Also surfaces startMutation.isError so POST
failures before job creation are visible to the user.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**

- ✅ #505: Free-text note included in AI tool response under existing consent gate (Task 1)
- ✅ #505: Tool description updated to mention note field (Task 1, Step 2)
- ✅ #509: Export action actually runs — double-encode removed so POST succeeds (Task 2)
- ✅ #509: Progress state displayed — `wl-modal__progress` CSS added (Task 3)
- ✅ #509: Ready state displayed — `wl-modal__ready` CSS added (Task 3)
- ✅ #509: Checkbox treatment aligned to jds-\* design system (Task 3)
- ✅ No migrations (confirmed)
- ✅ Consent gate untouched
- ✅ No new AccessContext/DataContextDb fields

**2. Placeholder scan:** None. All steps have complete code.

**3. Type consistency:**

- Task 1: `dto.note` is `string | null` from `CheckinDto` — matches what columnOrder extension expects ✅
- Task 2: `body` passed as `WellnessExportRequest` (plain object), matches `requestJson` `body?: unknown` ✅
- Task 3: `startMutation.reset()` is on `UseMutationResult` from `@tanstack/react-query` ✅
- Task 3: `jds-check` + `jds-check__box` pattern matches components-core.css definition ✅
- Task 3: `CheckIcon` SVG viewBox 13×13 matches existing jds-check CSS (`width:13px; height:13px`) ✅
