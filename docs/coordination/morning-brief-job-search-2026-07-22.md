# Morning brief — Job Search broad discovery + phase 1 (2026-07-22)

**TL;DR:** You said *the new path* (Track B) + *asap but functional*. Track B is now both
**green and functional** — I found and fixed the one thing that made it non-functional (the
onboarding never seeded the assistant). It's ready for your AC1 live UAT. Nothing pushed,
PR'd, or merged — those wait on your review + a UAT PASS.

**Deliverable:** branch `build/job-search-phase1-reland`, tip `cde5475d`
(0 behind / 2 ahead of `origin/main`). Reland worktree: `/tmp/jsp1r`.

---

## What "functional" needed — the gap I caught and closed

The build agent's candidate was **green but not functional, twice over**:

1. **Onboarding screen never mounted.** `root.tsx` rendered a `<FirstRunPlaceholder/>` stub; the
   real `OnboardingScreen` was defined but never wired. → Fixed: wired it into `root.tsx`.
2. **Onboarding never seeded the assistant.** This is the one that would have failed AC1. Track B
   flattened onboarding to delegate the chat to the host drawer (`openAssistant`), but in doing
   so it **dropped `assistantSurface`** — which is the *only* client trigger for the module
   onboarding **seed**. The seed (`POST /api/chat/module-onboarding`) is what teaches the
   assistant the checkpoint order and how to fire `job-search.monitor.save {kind:"broad"}`. The
   turn pipeline never auto-seeds (`live-routes.ts:404`). So "Continue with Jarvis" would have
   opened an un-seeded drawer and the broad monitor might never get enabled.
   → **Fixed:** re-threaded `assistantSurface` (the host already passes it — `app.tsx:356`) into
   `Root → OnboardingScreen`, which now fires `seedOnboarding()` once on mount (idempotent
   server-side, fire-and-forget, StrictMode-guarded, re-seeds per actor). This restores the exact
   seed behavior Track A always had, in the flat structure. The module renders **no** embedded
   surface — it uses the handle solely for the seed.

Everything else in Track B (Opportunities list + Opportunity-detail screens, provenance chips,
starter drafts) was already sound.

## Verified green (scoped, PG-free)

- `check:external-modules` tsc **0**
- job-search unit suites **580/580 (40 files)**
- `build:external:job-search` **0** (`worker.js` + `web/index.js` both emit)
- `eslint` on changed files **0**
- Behavioral fixes preserved: #1226 `needs_config` critique, #1213 `actorScopeKey` remount,
  freehire in the manifest. No conflict markers.

## Still open (needs you / a quiet box)

- **G1 — AC1 live UAT** (needs you + a seeded dev instance): fresh user → onboarding →
  "Continue with Jarvis" → assistant enables the broad monitor → real freehire matches, no
  company URL. This is the functional proof of the seed fix — the hermetic harness can't cover
  assistant-mediated turns. Checklist updated for Track B's flow:
  `docs/coordination/uat-ac1-job-search-broad-discovery.md`.
- **G2 — full `pnpm verify:foundation`** on a quiet box / isolated gate DB (the live dev
  Postgres is in use; `db:migrate`/`test:uat-seed`/`test:integration` deferred to avoid
  disturbing it).
- **G3 — push branch + open PR** (Part of #1229, epic #913), record AC1 PASS.
- **G4 — merge.**

## One process note (not a blocker to UAT)

Track B is a real restructure of the module's web layer (dedicated Opportunities/Detail + flat
onboarding) landing ~9.4k lines of previously-uncommitted work. Broad discovery itself has its
spec + task (#1229). Per our own phase-1 plan, the **restructure should get its scope recorded
as a spec + task issue** under epic #913 before merge, so spec-before-build is satisfied on
paper. I did not file it autonomously — say the word and I will.

## What I did NOT do (awaiting you)

- No push, no PR, no merge.
- No `verify:foundation` full gate yet (PG in use).

## Staged — ready for your AC1 instance ✅

The reland bundle (`cde5475d`, with the seed fix) is **built and staged** into the dev modules
discovery dir:

- **Path:** `~/Jarv1s/data/modules/job-search/` — `jarvis.module.json` + `package.json` +
  `dist/worker.js` + `dist/web/index.js` (all four parity-checked against the reland source).
- **packageHash:** `sha256:dd4611f674bf2d8cc6609dd8d939d80bc4523b737e07bbeaf0d115ef692a66d2`
  (self-consistent; drift-guard #917 won't disable it as long as the files aren't touched again).
- The staged dir is untracked/gitignored — staging did **not** dirty the shared tree.

**No dev instance is currently running** — the only live Jarvis is prod (`:1533`, untouched). To
run AC1 you need to launch dev yourself (fresh user + real chat model + freehire egress are all
intrinsically yours to drive). Recipe:

```
# from a checkout you control (dev PG jarv1s-postgres is already up on :55433)
JARVIS_ENABLE_EXTERNAL_MODULES=1 \
JARVIS_MODULES_DIR=~/Jarv1s/data/modules \
pnpm dev:api   # + pnpm dev:web  + pnpm dev:worker  (bind --host for LAN)
```

Then: boot-reconcile should discover `job-search`; if it isn't auto-enabled, enable via
**Settings → Admin → Instance modules**. Ensure the test user has a chat model configured (the
assistant must be able to fire `monitor.save`). Full step-by-step + PASS criteria in the UAT doc.

> Note: the shared main checkout `~/Jarv1s` is currently on another session's branch
> (`spec/964-module-distribution`) — don't switch its branch. The staged module bundle is
> self-contained/prebuilt, so the host can run from main or any branch ≥ `86b6bc2d` (which already
> passes `assistantSurface` to every module Root); the reland's changes are entirely inside the
> module bundle.

---

_Grounded on `origin/main` @ `86b6bc2d` (reland 0 behind / 2 ahead). Branches persist as git refs._
