# fix-397: PRN Reason Optional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "why I took it" reason field optional on PRN (as-needed) dose logging — blank persists as null with no validation error at DB, API, or UI layers.

**Architecture:** Three layers currently enforce the requirement. Remove it from each in landing order: (1) a new wellness SQL migration drops the DB CHECK constraint, (2) server-side route validation removes the 400 guard, (3) the React PRN panel removes the disabled-until-filled button logic and updates placeholder copy. TDD: flip the existing "required = 400" integration test to assert 201, then make code green.

**Tech Stack:** PostgreSQL (migration), TypeScript/Fastify (routes.ts), React (wellness-today.tsx), Vitest (integration tests).

## Global Constraints

- Never edit applied migrations — add a NEW file in `packages/wellness/sql/`; never modify `0084_wellness_medication_logs.sql`.
- Module SQL lives in `packages/wellness/sql/` — never in `infra/postgres/migrations/`.
- Migration number is assigned by the coordinator (current last = 0097; next candidate = 0098 — **confirm with coordinator before committing the migration file**).
- `git add` only task-specific files by explicit path — never `git add -A`.
- `git branch --show-current` must return `fix-397-prn-reason-optional` before every commit.
- Blank prnReason from the UI is sent as `null`, never as an empty string.
- The `medication_logs_scheduled_for_present` constraint is NOT touched — it is a separate constraint enforcing non-PRN logs have a `scheduled_for` slot.

---

### Task 1: Flip integration test to RED (TDD anchor)

**Files:**

- Modify: `tests/integration/wellness-medications.test.ts:91–110`

**Interfaces:**

- Produces: a failing test named `"PRN dose log without prn_reason is accepted (201)"` that will go GREEN once the server validation is removed.

- [ ] **Step 1: Open the existing test**

  Read `tests/integration/wellness-medications.test.ts` around line 91. The current test is:

  ```
  it("POST a PRN dose log without prn_reason is rejected 400", ...)
  ```

  It asserts `statusCode === 400`.

- [ ] **Step 2: Replace the test body**

  In `tests/integration/wellness-medications.test.ts`, replace lines 91–110 with:

  ```typescript
  it("PRN dose log without prn_reason is accepted (201) and persists null", async () => {
    const app = await buildApp(userId);
    try {
      const med = await app.inject({
        method: "POST",
        url: "/api/wellness/medications",
        payload: { name: "Ibuprofen", frequencyType: "as_needed" }
      });
      const medId = med.json().medication.id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/wellness/medications/${medId}/logs`,
        payload: { status: "prn" }
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().log.prnReason).toBeNull();
    } finally {
      await app.close();
    }
  });
  ```

- [ ] **Step 3: Run test to confirm it is RED**

  ```bash
  cd ~/Jarv1s/.claude/worktrees/fix-397-prn-reason-optional
  pnpm db:up
  pnpm db:migrate
  JARVIS_PGDATABASE=jarvis_dev vitest run tests/integration/wellness-medications.test.ts 2>&1 | grep -E "FAIL|PASS|Error|expect|received"
  ```

  Expected: test FAILS (server still returns 400).

- [ ] **Step 4: Commit the RED test**

  ```bash
  git add tests/integration/wellness-medications.test.ts
  git commit -m "test(wellness): PRN dose without reason must return 201 (currently fails — TDD red)"
  ```

---

### Task 2: New DB migration — drop the prn_reason CHECK constraint

**Files:**

- Create: `packages/wellness/sql/0098_wellness_medication_logs_prn_reason_optional.sql`
  _(Replace `0098` with the number confirmed by the coordinator before committing.)_

**Interfaces:**

- Produces: migration file that, when applied, allows `prn_reason IS NULL` for `status='prn'` rows.

**Context:**
The current constraint in `0084_wellness_medication_logs.sql:16` is:

```sql
CONSTRAINT medication_logs_prn_reason
  CHECK (status <> 'prn' OR (prn_reason IS NOT NULL AND length(btrim(prn_reason)) > 0))
```

This is a NAMED constraint — it can be dropped with `ALTER TABLE … DROP CONSTRAINT`. The separate `medication_logs_scheduled_for_present` constraint is untouched.

- [ ] **Step 1: Confirm migration number with coordinator**

  Before writing the file, message the coordinator:

  > "fix-397: need migration number. Current last = 0097. Proposing 0098 — confirm?"

  Wait for the reply. Use the confirmed number in the filename and SQL below.

- [ ] **Step 2: Write the migration file**

  Create `packages/wellness/sql/<CONFIRMED_NUMBER>_wellness_medication_logs_prn_reason_optional.sql`:

  ```sql
  -- prn_reason is now optional; logged doses may omit the reason (persists as NULL).
  -- Drops only the reason-required half of the original dual-purpose check.
  -- The scheduled_for presence rule (medication_logs_scheduled_for_present) is unchanged.
  ALTER TABLE app.medication_logs
    DROP CONSTRAINT IF EXISTS medication_logs_prn_reason;
  ```

- [ ] **Step 3: Apply the migration**

  ```bash
  pnpm db:migrate 2>&1 | tail -10
  ```

  Expected: migration runs without error; no output from `pnpm db:migrate` for previously-applied migrations.

- [ ] **Step 4: Commit the migration**

  ```bash
  git add packages/wellness/sql/<CONFIRMED_NUMBER>_wellness_medication_logs_prn_reason_optional.sql
  git commit -m "feat(wellness/db): drop medication_logs_prn_reason constraint — prn_reason now optional (#397)"
  ```

---

### Task 3: Remove server-side validation in routes.ts

**Files:**

- Modify: `packages/wellness/src/routes.ts:608–611`

**Interfaces:**

- Consumes: `parseLogDoseBody` function, already parses `prnReason` via `optionalNullableString` (nullable by default — no type change needed).
- Produces: `parseLogDoseBody` no longer throws 400 when `status === "prn" && !prnReason`.

**Context — current code at routes.ts:608–611:**

```typescript
const prnReason = optionalNullableString(value["prnReason"], "prnReason");
if (status === "prn" && !prnReason) {
  throw new HttpError(400, "prnReason is required when status is prn");
}
```

- [ ] **Step 1: Remove the validation block**

  Edit `packages/wellness/src/routes.ts`. Delete lines 609–611 (the `if` block). The result should be:

  ```typescript
  const prnReason = optionalNullableString(value["prnReason"], "prnReason");
  const scheduledFor = optionalNullableString(value["scheduledFor"], "scheduledFor");
  // Non-PRN logs satisfy a scheduled slot — reject at the route (friendly 400) rather than
  // letting the DB CHECK surface a 500 (Codex R2).
  if (status !== "prn" && !scheduledFor) {
    throw new HttpError(400, "scheduledFor is required for taken/skipped doses");
  }
  ```

- [ ] **Step 2: Run the TDD test — expect GREEN**

  ```bash
  JARVIS_PGDATABASE=jarvis_dev vitest run tests/integration/wellness-medications.test.ts 2>&1 | grep -E "FAIL|PASS|✓|×"
  ```

  Expected: `"PRN dose log without prn_reason is accepted (201)"` now PASSES.

- [ ] **Step 3: Run the full wellness-medications suite**

  ```bash
  JARVIS_PGDATABASE=jarvis_dev vitest run tests/integration/wellness-medications.test.ts 2>&1 | tail -20
  ```

  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/wellness/src/routes.ts
  git commit -m "fix(wellness): remove mandatory prnReason server validation — PRN reason is optional (#397)"
  ```

---

### Task 4: Frontend — make PRN reason input optional

**Files:**

- Modify: `apps/web/src/wellness/wellness-today.tsx` (lines ~225–244, ~348, ~375)

**Interfaces:**

- Consumes: `logMutation.mutate` with `prnReason?: string | null` — already accepts null (no type change needed).
- Produces: submit button enabled even when reason is blank; blank reason sent as `null`; placeholder updated; guard comment updated.

**Context — current code:**

```typescript
// Line 225-228 comment (stale after fix):
// PRN ("as needed") dose entry. The DB requires a non-empty prn_reason and we MUST NOT fabricate
// it: a hardcoded/placeholder reason would write false clinical data into the health audit trail.
// So logging a PRN dose captures a user-acknowledged reason (quick-pick chip or free text) before
// submit — never blank, never silent. PRN doses are repeatable: each submit inserts a new log.

// Line 232-244: logPrnDose — currently guards on empty reason
function logPrnDose(medicationId: string) {
  const reason = prnReason.trim();
  if (!reason) return;                                          // ← REMOVE this guard
  logMutation.mutate(
    { medicationId, status: "prn", scheduledFor: null, prnReason: reason },  // ← reason || null

// Line 348 placeholder:
placeholder="Reason for this dose (required)"                  // ← "(optional)"

// Line 375 disabled:
disabled={!prnReason.trim() || logMutation.isPending}          // ← remove !prnReason.trim() ||
```

- [ ] **Step 1: Update the comment at lines 225–228**

  Replace the stale "DB requires" comment block with:

  ```typescript
  // PRN ("as needed") dose entry. Reason is optional — the user may log a dose without
  // a reason (persists as null). PRN doses are repeatable: each submit inserts a new log.
  ```

- [ ] **Step 2: Update `logPrnDose` to remove guard and send null for blank**

  Replace the `logPrnDose` function (lines 232–244):

  ```typescript
  function logPrnDose(medicationId: string) {
    const reason = prnReason.trim() || null;
    logMutation.mutate(
      { medicationId, status: "prn", scheduledFor: null, prnReason: reason },
      {
        onSuccess: () => {
          setPrnOpenFor(null);
          setPrnReason("");
        }
      }
    );
  }
  ```

- [ ] **Step 3: Update placeholder text (line ~348)**

  Change:

  ```tsx
  placeholder = "Reason for this dose (required)";
  ```

  To:

  ```tsx
  placeholder = "Reason for this dose (optional)";
  ```

- [ ] **Step 4: Remove reason-empty disabled guard (line ~375)**

  Change:

  ```tsx
  disabled={!prnReason.trim() || logMutation.isPending}
  ```

  To:

  ```tsx
  disabled={logMutation.isPending}
  ```

- [ ] **Step 5: Typecheck to confirm no type errors**

  ```bash
  pnpm typecheck 2>&1 | grep -E "error|wellness-today"
  ```

  Expected: no errors (the mutation type already accepts `prnReason?: string | null`).

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/src/wellness/wellness-today.tsx
  git commit -m "fix(wellness/ui): make PRN dose reason optional — remove required guard, update placeholder (#397)"
  ```

---

### Task 5: Update foundation.test.ts migration list

**Files:**

- Modify: `tests/integration/foundation.test.ts` (around line 193–201)

**Context:**
`foundation.test.ts` asserts the FULL migration list with `toEqual`. Every new migration must be added or the test breaks latently (a focused module test won't catch it).

- [ ] **Step 1: Add the new migration row**

  In `tests/integration/foundation.test.ts`, find the line:

  ```typescript
  { version: "0097", name: "0097_chat_memory_corrections_update_grant.sql" },
  ```

  Add the new row **after** it (use the confirmed migration number from Task 2):

  ```typescript
  { version: "0098", name: "0098_wellness_medication_logs_prn_reason_optional.sql" },
  ```

- [ ] **Step 2: Run the full integration suite to confirm GREEN**

  ```bash
  JARVIS_PGDATABASE=jarvis_dev pnpm test:integration 2>&1 | tail -30
  ```

  Expected: all tests pass including foundation.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/integration/foundation.test.ts
  git commit -m "test(foundation): add 0098 wellness prn_reason migration to expected list (#397)"
  ```

---

### Task 6: Pre-push gate + final verify

**Files:** none new — gate verification only.

- [ ] **Step 1: Pre-push fast checks**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

  Expected: all exit 0. If `format:check` fails, run `pnpm format` on the specific changed files only, then re-stage.

- [ ] **Step 2: Fresh rebase onto origin/main**

  ```bash
  git fetch origin main && git rebase origin/main
  ```

- [ ] **Step 3: Run full integration suite one last time**

  ```bash
  JARVIS_PGDATABASE=jarvis_dev pnpm test:integration 2>&1 | tail -30
  ```

  Expected: all tests pass.

- [ ] **Step 4: Invoke `coordinated-wrap-up`**

  Invoke the `coordinated-wrap-up` skill to open the PR and report to the coordinator.

---

## Self-Review

**Spec coverage:**

- DB constraint relaxed ✓ (Task 2)
- Server validation removed ✓ (Task 3)
- Frontend required-field removed ✓ (Task 4)
- Blank persists as null ✓ (Task 4 step 2, Task 1 asserts `.prnReason === null`)
- `scheduled_for` constraint untouched ✓ (migration only drops `medication_logs_prn_reason`)
- TDD: failing test first ✓ (Task 1 before Task 3)
- Foundation migration list updated ✓ (Task 5)
- Migration number confirmed before committing ✓ (Task 2 step 1)

**Placeholder scan:** No TBDs, TODOs, or "similar to" references found.

**Type consistency:** `prnReason?: string | null` used consistently across mutation type (line 211) and `logPrnDose` return value.
