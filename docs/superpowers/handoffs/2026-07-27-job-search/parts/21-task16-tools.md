### Task 16: Conversation, profile, résumé, and settings tools

The nine tools the conversation and the settings screen read and write through. Every one returns
**records, never prose**.

**Depends on:** Task 10 (`parseCriteria`, `parseContextSummary`, `CONTEXT_SUMMARY_MAX`,
`completedSteps`, `isReadyToCrawl`), Task 13 (`validateProfileInput`, `JobSearchStore`).

**Files**

- Create: `external-modules/job-search/src/worker/handlers/{profile.ts,resume.ts,portal.ts}`
  — `portal.ts` holds both `portal.set-enabled` and the `portal.list` read added per ruling
  N6. `portal.list` returns each portal's id, label, enabled flag, state, and — when the state
  is degraded or self-disabled — the structured `cause` Task 20 renders verbatim. It reads the
  same worker-internal store method Task 13 defines (`listPortals(profileId)`); the point of
  the tool is that the browser has no other way to reach it.
- Modify: `external-modules/job-search/jarvis.module.json` — nine tools
- Test: `tests/unit/job-search-profile-handler.test.ts`

**Contracts**

| Tool                                     | Handler                       | Risk  |
| ---------------------------------------- | ----------------------------- | ----- |
| `job-search.profile.create`              | `profile.create`              | write |
| `job-search.profile.list`                | `profile.list`                | read  |
| `job-search.criteria.set`                | `criteria.set`                | write |
| `job-search.profile.set-context`         | `profile.set-context`         | write |
| `job-search.profile.set-briefing-detail` | `profile.set-briefing-detail` | write |
| `job-search.resume.set`                  | `resume.set`                  | write |
| `job-search.resume.get`                  | `resume.get`                  | read  |
| `job-search.portal.set-enabled`          | `portal.set-enabled`          | write |
| `job-search.portal.list`                 | `portal.list`                 | read  |

`set-enabled`, **not `toggle`**: the tool names the state it writes rather than the transition, so a
retry or a double-click is idempotent instead of flipping the portal back off. Task 20's settings UI,
the seed prompt, and the Task 21/22 tests all call this exact name.

**Constraints**

- Each handler is the same four steps: validate the input, call the store, shape a record, return it.
  No handler builds a sentence and no handler decides policy — `isReadyToCrawl` and `completedSteps`
  live in Task 10's domain layer and are **called, not reimplemented**.
- **`profile.set-context` runs `parseContextSummary` and is the only writer of `context_summary`.**
  That is what makes the stored value something the user approved: the tool call is visible and
  confirmable like any other. **Raw transcript is never stored.**
- **`resume.get` is `risk: "read"` and returns résumé text to the _assistant_** — that is intended;
  the point is letting the user talk about their own résumé. What it must never do is reach an
  adapter. Keep it out of `ports.ts`'s crawl dependency set entirely, so the wiring makes the mistake
  impossible rather than merely discouraged.
- Every `inputSchema` here is **JSON Schema** with `additionalProperties: false` — unlike the queue
  `paramsSchema` in Task 15, which is the platform DSL. Two languages, one manifest file.

**Tests** (`tests/unit/job-search-profile-handler.test.ts`)

1. **`criteria.set` on a now-complete `in_conversation` profile flips `state` to `active` and
   enqueues nothing**, returning `readyToCrawl: true`. The absence is asserted explicitly: a handler
   cannot enqueue, and the first crawl is started by the browser calling
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` after this tool returns. A handler
   that tried to enqueue would have nothing to call.
2. **An incomplete profile stays `in_conversation`** and returns `readyToCrawl: false` with its
   `completedSteps`, so the UI's progress readout comes from the record.
3. **`profile.list` returns `completedSteps`** — a screen must never compute progress from prose.
4. **`resume.set` bumps `version` and keeps the prior row.**
5. **The crawl path never reads the résumé.** It is scoring input only; a résumé must never leave the
   instance inside an outbound HTTP request.
6. **Every handler strips `actorUserId` via `validateProfileInput`, and none accepts a genuinely
   unknown key.**
7. **`profile.set-context` rejects an over-length summary rather than truncating it** — a
   `CONTEXT_SUMMARY_MAX + 1` string throws and the stored value is unchanged. Truncation feeds a
   half-sentence to the scorer on every posting in the batch.
8. **`profile.set-context` replaces wholesale and never appends** — set twice, the second value is
   the whole stored value.
9. **`profile.set-briefing-detail` accepts exactly `count | top | full`** and rejects a fourth value,
   matching the column's check constraint from Task 4.
10. **No handler returns a blended score.** Walk every handler's result object and assert no key
    matches `/^(score|overall|match|rank)$/i` — a cheap structural guard against the one thing the
    design forbids.
11. **The manifest's declared tool handlers and the registration keys are the same set**, compared
    both ways so a name declared with no handler and a handler with no declaration both fail. Nothing
    else in the stack cross-checks these: a tool declared as `job-search.portal.toggle` and
    registered as `portal.set-enabled` installs cleanly, appears in the assistant's tool list, and
    fails only when a user asks for it.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-profile-handler.test.ts \
  tests/unit/job-search-manifest.test.ts && pnpm check:external-modules   # exit 0
```
