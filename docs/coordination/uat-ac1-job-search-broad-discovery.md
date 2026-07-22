# AC1 live-UAT checklist — Job Search broad discovery (#1229)

**Exit gate. Run on a live dev instance before merge.** The hermetic `pnpm test:uat`
harness cannot cover this: the "Start my search" turn is assistant-mediated
(`submitTurn` → chat engine → `monitor.save`), and the UAT stack seeds no real chat
model by design. AC1 is therefore a live dev-instance run (spec §11 AC1: _"Live dev
module, fresh user, fresh assistant session, hitting the real chosen source"_).

Branch `build/job-search-broad-discovery`. Source under test: live `https://freehire.dev`
(keyless public read — courteous, low-volume, unauthenticated; consistent with the
scraping guardrails).

## Prerequisites

1. **Dev instance running THIS branch's job-search bundle.**
   - Build: `pnpm build:external:job-search` (emits `external-modules/job-search/dist/`).
   - Stage the built module into the dev modules dir the API discovers
     (`resolveModulesDir` → `<repo>/data/modules/job-search`, or point
     `JARVIS_MODULES_DIR` at a dir containing it), then start dev (api + web + worker).
   - If the module isn't auto-enabled after boot-reconcile, enable it via
     **Settings → Admin / Setup → Instance modules** (the proven install path).
2. **A chat model configured for the test user** — the per-user chat engine must be
   live, or the assistant can't fire `monitor.save`. (Onboarding needs a configured
   chat model; this is the whole reason the hermetic harness can't do it.)
3. **Network egress to `freehire.dev`** from the API/worker host.

## Steps (fresh user)

1. Sign up / sign in as a **fresh user** (no prior job-search data).
2. Complete onboarding through resume + profile:
   resume intake → critique → approve; then profile (titles, comp, work mode,
   locations, dealbreakers) → approve.
3. Reach the **Sources** step. The primary card reads eyebrow **`Broad search · Freehire`**
   with a one-line summary derived from your profile titles/locations.
   **Do NOT enter any company URL** (company watches are the collapsed/optional
   disclosure below — leave them untouched).
4. Click **`Start my search`**.
5. Let the broad monitor run (assistant fires `monitor.save {kind:"broad", enabled:true}`,
   worker runs the broad fetch against freehire.dev).

## PASS criteria

- ✅ Onboarding **completes with the broad card alone** — no company URL was ever entered.
- ✅ The matches feed (hero eyebrow **`Daily discovery · credible matches`**) shows
  **real freehire postings**, each carrying the **`Broad search`** provenance chip
  (gold-tone Meta pill).
- ✅ Postings link to **real employer ATS URLs** (canonical, not tracking redirects).

## Verification hooks (confirm the wiring, not just the pixels)

- **Assistant actually fired `monitor.save`:** onboarding advances past Sources to done /
  the `monitorEnabled` gate reads true; a monitor exists with `enabled:true` and
  `query.kind:"broad"`. If onboarding **stalls at Sources**, the assistant didn't make the
  call → chat-model or guidance problem, not a fetch problem.
- **Broad run hit freehire:** worker log shows an outbound fetch to the `freehire.dev`
  host; run record binds to the broad source key. Zero matches with a healthy run →
  egress blocked or the query is too narrow (widen profile titles / drop the remote-only
  flag and re-run).
- **AC5 spot-check (minimization):** the outbound search URL carries **only**
  `q` (titles), `countries`, `limit/offset/sort/order`, and `work_mode` iff remote —
  **never** salary, dealbreakers, excluded companies, or employment type.

## Record the result

Note PASS/FAIL + the commit SHA on the PR (Part of #1229, epic #913). PASS unblocks merge.
