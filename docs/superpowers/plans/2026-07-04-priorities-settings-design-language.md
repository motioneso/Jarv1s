# Priorities Settings Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Priorities settings pane match the existing Settings design language without changing priority API, schema, or scoring behavior.

**Architecture:** Refactor the existing `PrioritySettings` JSX to use the already-exported settings primitives from `@jarv1s/settings-ui`: `PaneHead`, `Group`, `Row`, `Field`, `Select`, `Switch`, `Badge`, and `Note`. Keep the existing React Query keys, fetch/PATCH endpoints, model mutations, anchor editing, muted-source toggles, and error/success callbacks unchanged. Add no dependencies and avoid CSS unless the existing primitives cannot express the anchor editor layout.

**Tech Stack:** React 19, TypeScript, TanStack Query, lucide-react, existing JDS CSS (`jds-*`, `pane__*`, `set-row`, `fld`).

---

## Current-State Verification

- `packages/settings-ui/src/priority/index.tsx` still renders raw local classes (`priority-settings`, `priority-mode`, `anchor-row`, `source-checkbox`, `add-anchor`, `remove-anchor`, `saving`, `error`) instead of the shared settings pane primitives.
- `apps/web/src/settings/settings-page.tsx` mounts the pane as `<PrioritySettings />`; no routing change is needed.
- `packages/settings-ui/src/index.tsx` already exports the primitives needed for this refactor.
- No `priority-*` CSS rules exist in `apps/web/src/styles`; the raw classes are effectively unstyled compared with adjacent settings panes.

## Files

- Modify: `packages/settings-ui/src/priority/index.tsx`
- Possibly modify only if needed after JSX pass: `apps/web/src/styles/settings-panes.css`
- No backend, schema, API, Email, Calendar, Chat, notifications, or `docs/coordination/` changes.

### Task 1: Refactor PrioritySettings Markup

**Files:**

- Modify: `packages/settings-ui/src/priority/index.tsx`

- [ ] **Step 1: Confirm behavior-only baseline**

Run:

```bash
pnpm --filter @jarv1s/settings-ui typecheck
```

Expected: PASS before changes, or only unrelated pre-existing failures. If it fails in this file, stop and fix the baseline before refactoring.

- [ ] **Step 2: Replace raw pane shell with shared primitives**

In `packages/settings-ui/src/priority/index.tsx`, update imports:

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Badge, Field, Group, Note, PaneHead, Row, Select, Switch } from "../index.js";
```

Replace loading/error returns with existing settings language:

```tsx
if (isLoading) {
  return (
    <>
      <PaneHead title="Priorities" desc="Teach Jarvis what deserves attention first." />
      <Group title="Priority model">
        <Row name="Loading priority settings" desc="Fetching your current priority model." />
      </Group>
    </>
  );
}

if (!model) {
  return (
    <>
      <PaneHead title="Priorities" desc="Teach Jarvis what deserves attention first." />
      <Group title="Priority model">
        <Row name="Unavailable" desc="Failed to load priority settings." />
      </Group>
    </>
  );
}
```

Replace the outer return with a fragment that starts with:

```tsx
<>
  <PaneHead
    title="Priorities"
    desc="Tune the model Jarvis uses to rank projects, people, domains, goals, and obligations."
  />
```

- [ ] **Step 3: Convert priority mode to `Field` + `Select`**

Replace the native raw `priority-mode` block with:

```tsx
<Group
  title="Priority mode"
  desc="Choose the default weighting style Jarvis uses before anchors and muted sources are applied."
>
  <Field label="Mode">
    <Select
      value={model.mode}
      aria-label="Priority mode"
      disabled={mutation.isPending}
      onChange={(event) => {
        mutation.mutate({
          ...model,
          mode: event.currentTarget.value as PriorityModelPreferenceV1["mode"],
          updatedAt: new Date().toISOString()
        });
      }}
    >
      <option value="balanced">Balanced</option>
      <option value="deadline_first">Deadline first</option>
      <option value="energy_protective">Energy protective</option>
    </Select>
  </Field>
</Group>
```

- [ ] **Step 4: Convert anchors to a settings card**

Use a `Group` with a JDS add button in `action`. Keep `addAnchor`, `updateAnchor`, and `removeAnchor` behavior unchanged:

```tsx
<Group
  title="Anchors"
  desc="Entities and patterns that should consistently move work up or down."
  action={
    <button
      type="button"
      onClick={addAnchor}
      className="jds-btn jds-btn--secondary jds-btn--sm"
      disabled={mutation.isPending}
    >
      <span className="jds-btn__icon">
        <Plus size={16} aria-hidden="true" />
      </span>
      Add anchor
    </button>
  }
>
  {model.anchors.length === 0 ? (
    <Row
      name="No anchors"
      desc="Add one when a project, person, domain, goal, or obligation needs a standing bias."
    />
  ) : (
    model.anchors.map((anchor, index) => (
      <div key={anchor.id} className="set-row">
        <div className="set-row__main">
          <div className="set-row__name">
            {anchor.label || "Untitled anchor"}{" "}
            <Badge tone={anchor.enabled ? "pine" : "steel"}>
              {anchor.enabled ? "Enabled" : "Muted"}
            </Badge>
          </div>
          <div className="set-row__desc">
            Configure how this anchor influences priority scoring.
          </div>
          <div className="fld">
            <div className="fld__row">
              <Switch
                ariaLabel={`Enable ${anchor.label || "anchor"}`}
                checked={anchor.enabled}
                disabled={mutation.isPending}
                onChange={(enabled) => updateAnchor(index, { enabled })}
              />
              <Select
                value={anchor.kind}
                aria-label="Anchor kind"
                disabled={mutation.isPending}
                onChange={(event) =>
                  updateAnchor(index, { kind: event.currentTarget.value as PriorityAnchor["kind"] })
                }
              >
                {VALID_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {titleCase(kind)}
                  </option>
                ))}
              </Select>
              <Select
                value={anchor.weight}
                aria-label="Anchor weight"
                disabled={mutation.isPending}
                onChange={(event) =>
                  updateAnchor(index, {
                    weight: Number(event.currentTarget.value) as PriorityAnchor["weight"]
                  })
                }
              >
                {VALID_WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight > 0 ? `+${weight}` : weight}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Field label="Label">
            <input
              className="jds-input"
              type="text"
              placeholder="Label"
              value={anchor.label}
              disabled={mutation.isPending}
              onChange={(event) => updateAnchor(index, { label: event.currentTarget.value })}
              maxLength={120}
            />
          </Field>
          <Field label="Aliases">
            <input
              className="jds-input"
              type="text"
              placeholder="Comma-separated aliases"
              value={anchor.aliases.join(", ")}
              disabled={mutation.isPending}
              onChange={(event) =>
                updateAnchor(index, {
                  aliases: event.currentTarget.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                })
              }
            />
          </Field>
        </div>
        <div className="set-row__control">
          <button
            type="button"
            onClick={() => removeAnchor(index)}
            className="jds-iconbtn jds-iconbtn--sm"
            aria-label="Remove anchor"
            disabled={mutation.isPending}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    ))
  )}
</Group>
```

If the inline `fld__row` is cramped on mobile after visual/type review, add only the smallest CSS rule needed in `apps/web/src/styles/settings-panes.css`, using token variables and a `prio-*` class.

- [ ] **Step 5: Convert muted sources to `Row` + `Switch`**

Replace raw checkbox labels with settings rows:

```tsx
<Group title="Muted sources" desc="Sources excluded from priority ranking until turned back on.">
  {VALID_SOURCES.map((source) => (
    <Row
      key={source}
      name={titleCase(source)}
      desc="Exclude this source from priority ranking."
      control={
        <Switch
          ariaLabel={`Mute ${source}`}
          checked={model.mutedSources.includes(source)}
          disabled={mutation.isPending}
          onChange={() => toggleMutedSource(source)}
        />
      }
    />
  ))}
</Group>
```

- [ ] **Step 6: Keep save/error state in existing pane language**

At the end of the fragment, render:

```tsx
{mutation.isPending ? <Note>Saving priority settings...</Note> : null}
{mutation.error ? <Note>{mutation.error.message}</Note> : null}
</>
```

Add this helper near the constants if used:

```tsx
function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
pnpm --filter @jarv1s/settings-ui typecheck
pnpm --filter @jarv1s/web typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit task**

Stage only touched files:

```bash
git add packages/settings-ui/src/priority/index.tsx
git add apps/web/src/styles/settings-panes.css
git commit -m "fix(settings): align priorities pane design language"
```

If no CSS file changed, omit that `git add`.

### Task 2: Final Verification

**Files:**

- No new code files.

- [ ] **Step 1: Run required full local checks**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Inspect diff for scope**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: only the plan file, `packages/settings-ui/src/priority/index.tsx`, and optional `apps/web/src/styles/settings-panes.css`.

- [ ] **Step 3: Pre-push checks from coordinated-build**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: checks PASS, rebase succeeds or reports branch is current.

## Self-Review

- Spec coverage: the plan updates the Priorities pane visual structure, reuses settings primitives and `jds-*`, preserves all controls and mutations, and avoids backend/API/schema/scoring changes.
- Placeholder scan: no TODO/TBD/fill-later steps.
- Type consistency: uses existing `PriorityModelPreferenceV1`, `PriorityAnchor`, `VALID_*` constants, and exported settings primitives.
