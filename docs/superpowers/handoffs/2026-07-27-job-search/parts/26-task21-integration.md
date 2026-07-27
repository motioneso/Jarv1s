## Phase 6 — Verification

### Task 21: Integration tests

Everything up to here was a unit test against a fake store, which proved the module's _logic_ and
nothing about its _isolation_. This task runs against a real Postgres with RLS on and is where the
security invariants are actually exercised.

**Depends on:** Task 3 (manifest, `JOB_SEARCH_TABLES`), Task 4 (DDL), Task 13 (`JobSearchStore`),
Tasks 15 and 16 (the handlers), Task 2 (`collectBriefingContributions`).

**Files**

- **Extend, do NOT create:** `tests/integration/job-search.test.ts` — Task 2 (#1282) already
  created this file at commit `b043f1d6` with four passing briefing-trust-gate cases. Append
  your describe blocks; writing it fresh silently destroys verified coverage of the briefing
  manifest re-emit path.
- Read first, and copy their setup rather than inventing one:
  `tests/integration/external-module-gateway.test.ts`, `tests/integration/module-install.test.ts`,
  `tests/integration/module-worker-queue-ai.test.ts`, `tests/integration/module-worker-rpc.test.ts`,
  `tests/integration/external-module-finance.test.ts`

**Harness**

One install, two `describe` blocks. **Tier A** is DB-level RLS with no worker process; **tier B**
drives the real gateway and a live worker child process. One file is defensible only because the
install is the expensive part and both tiers need the same one — but **tier A must never depend on
the worker being up**, so a broken worker fails tier B alone and the security assertions still run.

Setup order, every step load-bearing:

1. Build the module package — the same build the release path runs, not a hand-assembled directory.
2. Place it in the discovery directory the installer scans.
3. Install it.
4. Enable it. An installed-but-disabled module is silently skipped.
5. **Assert `manifest_hash` and `package_hash` match what was installed.** This is the step that
   gets left out. `apps/worker/src/external-module-job-handler.ts:52` gates on the enabled flag and
   these hashes and **returns silently** on a mismatch — no throw, no log line worth reading. A
   harness that skips this assertion produces a green suite that invoked nothing at all, which is
   strictly worse than a red one.
6. Start the worker runtime with injected AI and fetch providers.
7. Tear down the child processes and every row this file created.

Two owners and one admin, created once for the file.

**Constraints**

- **Every read goes through `createAppRuntimeRunner().withDataContext({actorUserId})`.** The
  migration-owner role is `NOBYPASSRLS`, so a raw query against a FORCE-RLS table silently returns
  zero rows and every assertion passes for the wrong reason.
- **`JOB_SEARCH_TABLES` is imported, never retyped.** A hand-copied list drifts from the migration
  the first time a table is added, and the drift is invisible.
- **Clean up in `finally`, including on a failing assertion.** `test:uat-seed` runs sequentially
  against one shared, non-reset database, so durable rows leak into whichever file runs next.
- `pnpm test:integration <file>` **does not narrow the run** — the script passes a directory — so
  expect the whole integration suite. Read to the end rather than trusting the last screen, and
  **never pipe to `tail`**: it masks the exit code.

**Tests — tier A** (no worker process)

1. **The database's tables are exactly the canonical list.** Query `information_schema.tables` for
   `app.job_search_%` and assert the set equals `JOB_SEARCH_TABLES`. Without this, a table added in
   a later migration and forgotten here is never checked for RLS by anything.
2. **Cross-owner isolation, both directions, on every table.** Loop `JOB_SEARCH_TABLES`; insert as
   owner A, assert owner B reads zero rows, then the reverse. Asserting one direction only is how a
   policy that is accidentally `USING (true)` on `SELECT` but correct on `INSERT` survives.
3. **An admin actor sees nothing** — same loop, admin context. Admin power is configuration power;
   there is no private-data bypass anywhere, and this is the assertion that says so.
4. **Every owned table actually has a policy** — assert a `pg_policies` row per table.
   `installModule()` Phase B generates RLS from `manifest.database.ownedTables`, so a table missing
   from that array gets a table with **no policy at all**, which fails open. Test 2 still passes if
   the row simply is not there, so this is not redundant with it.
5. **The stored embedding has the dimension the port reports** — `vector_dims(embedding)` equals
   `await ctx.embed.dimensions()`. A 768-column holding a 384-vector does not error on insert in
   every path, and the downstream symptom is "triage returns nonsense", which is very expensive to
   trace back to here.

**Tests — tier B** (real gateway, live worker)

6. **The queue payload carries metadata only.** Enqueue through the real path, read the row back out
   of pg-boss, and assert the serialized JSON against a **whitelist** rather than spot-checking
   absences: `Object.keys(job.data).sort()` equals
   `["actorUserId", "jobKind", "manifestHash", "moduleId", "params"]`, and
   `Object.keys(job.data.params)` equals `["profileId"]`. `manifestHash` is **required** by the
   payload contract (`packages/jobs/src/module-jobs.ts:7`, validated at `:75` as `sha256:` + 64
   hex, populated at `job-reconciler.ts:137`) — it is a content anchor for the trust gate, not
   forbidden content, and a whitelist that omits it fails against a correct implementation. Assert
   it is **this install's** hash, not merely a well-formed digest: the handler compares it and
   returns silently on a mismatch, so a stale hash is a module that never runs. Then a belt: the
   whitelist catches a new key, and asserting the serialized string contains neither a résumé marker
   nor a posting-body marker, and is under 512 bytes, catches an existing key whose value grew a
   body.
7. **The manual-run route is the enqueue path, and it works** —
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` via `app.inject`, asserting a job
   appears. This is the only production enqueue path that exists; if `allowManualRun` is missing
   from the manifest, nothing in the module can ever start a crawl and no unit test would notice.
8. **The schedule resolves to the sweep queue.** Read the reconciled schedule rows and assert the
   `job-search.crawl-sweep` schedule is bound to the `job-search.crawl-sweep` **queue**. This is not
   a typo net — `validateWorker` (`packages/module-registry/src/external/validate.ts:176`) already
   rejects an install whose schedule names an undeclared queue. What it verifies is that the binding
   survives **normalization and install**: the reconciler's `queueByName.get(schedule.queue)` miss is
   silent (`job-reconciler.ts:127`), so if normalization ever renames or reshapes a queue the module
   simply never runs on its own and nothing says so.
9. **A tool call survives the host's `actorUserId` envelope** — invoke each of the eight Task 16
   tools **through the real gateway**, not by calling the handler directly. The host spreads
   `actorUserId` onto every external tool input, last, and a strict `additionalProperties: false`
   validator that does not strip it rejects every call the module will ever receive. A unit test that
   calls the handler directly never sees this.
10. **A partial crawl persists both halves** — one portal succeeds, one returns `rate_limited`;
    assert the postings landed _and_ that `job_search_portals` holds the structured cause with its
    `lastOkAt` intact. A failure that erases the last-known-good timestamp destroys the only signal
    that tells the user how long a board has been down.
11. **The briefing contribution round-trips** — feed `contributeToBriefing` output through
    `collectBriefingContributions` (Task 2) and assert it is accepted and rendered. Also assert the
    `count` / `top` / `full` levels produce three different lengths; if they do not, Task 4's
    `briefing_detail` column is being read but not used.
12. **No response, at any level, contains a blended score** — walk every object returned in this file
    and assert no key matches `/^(score|overall|match|rank)$/i` and no string matches
    `/\b\d{1,3}%\s*(match|overall|fit and want)\b/i`. Two axes, never one number, enforced at the
    boundary as well as in the schema.

**Verify**

```bash
pnpm test:integration tests/integration/job-search.test.ts; echo "EXIT=$?"   # EXIT=0
```

---
