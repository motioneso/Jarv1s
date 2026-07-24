# AC1 live-UAT checklist — Job Search broad discovery (#1229)

**Exit gate. Run on a live dev instance before merge.** The hermetic `pnpm test:uat`
harness cannot cover this: the onboarding turn is assistant-mediated (drawer chat →
chat engine → `monitor.save`), and the UAT stack seeds no real chat model by design.
AC1 is therefore a live dev-instance run (spec §11 AC1: _"Live dev module, fresh user,
fresh assistant session, hitting the real chosen source"_).

**Branch under test: `build/job-search-phase1-reland`** (tip `cde5475d`) — the Track B
restructure (dedicated Opportunities/Detail screens + flat, assistant-delegated onboarding)
with broad discovery landed on top. Source under test: live `https://freehire.dev` (keyless
public read — courteous, low-volume, unauthenticated; consistent with the scraping guardrails).

> **Why this UAT is the functional gate for the seed fix.** Track B delegates onboarding to
> the host chat drawer via `hostActions.openAssistant`. The assistant only knows how to enable
> the broad monitor if the module **onboarding guidance seed** fired (`POST /api/chat/module-
> onboarding`). Track B originally dropped that seed; #1229 restored it by firing
> `assistantSurface.seedOnboarding()` on the onboarding screen's mount. This UAT proves the seed
> lands and the assistant acts on it — it cannot be verified hermetically.

## Prerequisites

1. **Dev instance running THIS branch's job-search bundle.**
   - Build: `pnpm build:external:job-search` (emits `external-modules/job-search/dist/`).
   - Stage the built module into the dev modules dir the API discovers
     (`resolveModulesDir` → `<repo>/data/modules/job-search`, or point
     `JARVIS_MODULES_DIR` at a dir containing it), then start dev (api + web + worker).
   - If the module isn't auto-enabled after boot-reconcile, enable it via
     **Settings → Admin / Setup → Instance modules** (the proven install path).
2. **A chat model configured for the test user** — the per-user chat engine must be
   live, or the assistant can't fire `monitor.save`. (This is the whole reason the
   hermetic harness can't do it.)
3. **Network egress to `freehire.dev`** from the API/worker host.

## Steps (fresh user)

1. Sign up / sign in as a **fresh user** (no prior job-search data).
2. Open the **Job Search** module. Onboarding is a **flat checklist** (Set up your job search)
   with per-step status badges — not an embedded chat. It should render immediately (no error
   state). On mount it silently seeds the assistant's onboarding guidance.
3. Work through the checkpoints by clicking **`Continue with Jarvis`** at each step. This opens
   the **host chat drawer** pre-filled with an editable starter prompt (never auto-sent — edit
   if you like, then send). Complete: resume intake → critique → approve; profile (titles, comp,
   work mode, locations, dealbreakers) → approve; then the sources/enable checkpoint.
4. At the sources/enable checkpoint, ask Jarvis to set up monitoring. **Do NOT provide any
   company URL** — broad discovery is the profile-derived default. The assistant should enable
   the broad monitor on its own (`monitor.save {kind:"broad", enabled:true}`).
5. Let the broad monitor run (worker runs the broad fetch against freehire.dev).

## PASS criteria

- ✅ Onboarding **completes with no company URL ever entered** — broad discovery is the default.
- ✅ The **Matches** tab (Opportunities screen) shows **real freehire postings**, each carrying
  the **`Broad search`** provenance chip (a solid `jds-badge--solid` pill, not the retired gold
  Meta pill).
- ✅ Opening a posting routes to the **Opportunity-detail** screen (`/opportunities/:bucket/:hash`)
  with the full posting.
- ✅ Postings link to **real employer ATS URLs** (canonical, not tracking redirects).

## Verification hooks (confirm the wiring, not just the pixels)

- **Seed fired:** the assistant, once you reach the sources checkpoint, knows the job-search
  onboarding flow and offers/enables the broad monitor without being told the mechanics. If it
  behaves like a generic assistant with no job-search onboarding context, the seed didn't land
  (check the `POST /api/chat/module-onboarding` call succeeded on onboarding-screen mount).
- **Assistant actually fired `monitor.save`:** onboarding advances to done / the `monitorEnabled`
  gate reads true; a monitor exists with `enabled:true` and `query.kind:"broad"`. If onboarding
  **stalls** at the sources checkpoint, the assistant didn't make the call → chat-model or seed
  problem, not a fetch problem.
- **Broad run hit freehire:** worker log shows an outbound fetch to the `freehire.dev` host; the
  run record binds to the broad source key. Zero matches with a healthy run → egress blocked or
  the query is too narrow (widen profile titles / drop the remote-only flag and re-run).
- **AC5 spot-check (minimization):** the outbound search URL carries **only** `q` (titles),
  `countries`, `limit/offset/sort/order`, and `work_mode` iff remote — **never** salary,
  dealbreakers, excluded companies, or employment type.

## Record the result

Note PASS/FAIL + the commit SHA on the PR (Part of #1229, epic #913). PASS unblocks merge.
