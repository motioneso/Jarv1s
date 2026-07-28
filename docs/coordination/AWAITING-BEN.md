# Awaiting Ben

Decisions parked because they are product calls, not implementation calls. Each entry names both
sides and a recommended reading, so confirming one line is enough to unblock.

---

## 1. Does the core chat drawer show a module's thread while you are inside that module?

**Status:** blocking the job-search UAT's drawer phase (#1306) and the disposition of #1332.
**Raised:** 2026-07-27, epic #1280.

Two approved sources say opposite things.

- `apps/web/src/shell/app-shell.tsx:194` — _"#1284 — Ben's ruling: a module's thread must never
  appear in the main drawer."_
- `docs/superpowers/specs/2026-07-26-job-search-module-design.md:183-184` — _"Chat after onboarding
  is the existing core header chat control — the module does not add its own chat button. **Opening
  it inside a profile gives that profile's thread.**"_

The job-search spec requires exactly what the #1284 ruling forbids.

**What the code does today, which is neither.** `app-shell.tsx:426` renders
`<ChatDrawer records={recordsForSurface(DEFAULT_CHAT_SURFACE)} />`. Once a module claims the stream
via `setSurfaceKey`, `activeSurface` becomes the module's surface id, so
`"drawer" === activeSurface` is false and the drawer renders `[]` — an **empty** drawer. Not the
profile's thread, and not the default thread either. That outcome serves neither ruling's intent,
which is the strongest evidence that it is an unintended third state rather than a deliberate
compromise.

**Recommended reading — the two are reconcilable, scoped by location.** `useProfileThread`
(`external-modules/job-search/src/domain/seed-prompt.ts`) claims the surface on mount and releases it
with `setSurfaceKey(null)` on unmount. So:

- **Inside a profile** → the header control shows that profile's thread (job-search spec §7).
- **Anywhere else** → the claim is released and the drawer shows the default thread, with no module
  content visible (#1284's concern, which reads as a **leakage** rule).

Under that reading #1332 is a real one-line bug — `recordsForSurface(activeSurface)` at
`app-shell.tsx:426` — and #1284 stays satisfied, because `activeSurface` reverts to `"drawer"` the
moment the module lets go.

**The alternative reading** is that "never" is absolute: the drawer stays empty inside a module and
job-search spec §7 must be rewritten instead. That is a coherent position — it makes the drawer
strictly a core-only surface — but it means the module's chat is reachable **only** through its own
embedded surface, and spec §7's "the module does not add its own chat button" would need revisiting
at the same time, or there is no way in at all.

**What we need:** which reading is right. If the recommended one, #1332 proceeds as a bug fix. If the
alternative, spec §7 needs an amendment and the job-search UAT's drawer phase changes shape.

**Not guessed in the meantime.** The UAT phase is being written against the spec's contract with the
conflict cited inline, so whichever way it goes the assertion is one edit, not a rewrite.
