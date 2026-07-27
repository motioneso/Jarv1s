### Task 23: Full gate, prototype capture, and release notes

**Gate**

```bash
pnpm verify:foundation; echo "EXIT=$?"   # EXIT=0
```

**Never pipe it to `tail`** — a background command ending in `tail` reports exit 0 for a failing
gate. **Drop and recreate the gate DB first**: the gate's own `uat-seed` leaves durable rows that
fail the next run.

**Prototype capture.** The prototype is a primary source — it settled the UI, and its header
comments carry the reasoning. Push it to its own branch before deleting it:

```bash
git checkout -b prototype/job-search-ui
git add apps/web/src/job-search-prototype
git commit -m "chore: capture throwaway job search UI prototype"
git push -u origin prototype/job-search-ui
git checkout -
```

Then delete `apps/web/src/job-search-prototype/` and the DEV-guarded interception block in
`apps/web/src/main.tsx` from the working branch, and leave a pointer to the branch on the
implementation issue along with the verdict it settled.

**Registry and docs.** Add `job-search` to `scripts/publish-module-registry.ts`'s inputs so the
module is publishable. Note in the PR body which of the three spec §10 core changes shipped and
which deferred.

**User-facing summary.** Every commit and PR needs one, in release-note language:

> **Job Search.** Jarvis can now run job searches for you. Describe what you are looking for in a
> conversation, and it crawls public job boards on a schedule and reads every posting against two
> questions: could you do this job, and would you still want it a year in. Those two answers stay
> separate — there is no single "match score" — and each comes with the reasoning behind it. New
> matches show up as a notification, a badge, and a line in your briefing. When a board rate-limits
> us or asks for a login, it says exactly what happened and what it will do next.

---
