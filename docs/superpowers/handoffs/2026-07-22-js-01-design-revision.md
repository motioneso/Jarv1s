# Handoff Addendum — JS-01 design revision (supersedes plan/spec UI language)

Applies to task **#1232**. **Supersedes** the "full-screen chat / serif headings / mono
eyebrows / slim progress rail" language in the plan and spec for the UI tasks (4–6). Everything
else in `2026-07-22-js-01-build.md` and the plan still stands. Ben confirmed 2026-07-22.

## Why
Ben's own **Park Press design system** (his claude.ai/design project "Jarvis — Park Press Design
System", `design_handoff_job_search_onboarding/`) is the authoritative visual contract. The plan
copied stale type language that already contradicts the live app. Two corrections + one confirmed
phasing decision.

## Correction 1 — Type (match the live `apps/web/src/styles/tokens.css`)
The plan/spec/old handoff say "serif headings / mono eyebrows." **Ignore that — it is stale.**
The live app (Ben's own past calls, in `tokens.css`):
- Headings/display: `--font-display` (Neue Haas Grotesk; interim Helvetica stack until the
  self-hosted OTFs land).
- Body: `--font-sans`.
- **NO mono** — retired 2026-07-08 ("kill mono anywhere in the app"). For eyebrows / labels /
  timestamps / numeric data use `--font-sans` + `font-variant-numeric: tabular-nums`.
- **NO serif** anywhere in the module (serif is the sports nameplate only).
- Token vars only, no hex literals. The Park Press palette (forest / gold / oat) already lives in
  `tokens.css`.

## Correction 2 — Layout (embedded, not full-screen)
Job Search onboarding is a route-**state inside the app frame** (NavRail + topbar), NOT a
full-screen takeover. Two-column:
- **Left:** conversation column — host chat on `surface: "job-search"` (the JS-00 seam),
  seeded once with the résumé-first opener.
- **Right:** sticky **ProfileAside** "Building your profile" panel — 8 labeled field rows that
  fill in live as the conversation progresses.

## Phasing — shell first (Ben chose this over collapsing the slices)
**JS-01 builds the SHELL only:**
- Embedded two-column onboarding route + first-run entry.
- **ProfileAside skeleton:** 8 labeled field rows in authored empty/skeleton state (no spinners).
- Chat column wired to the **job-search surface** (JS-00 seam), seed-once, résumé-first opener.
- Inline-control **slots present but empty** — no résumé dropzone/critique, no chips, no sources
  switches yet.

Later slices fill the controls, each filling more of ProfileAside, each with its own Ben UAT gate:
- **JS-02:** résumé dropzone + critique card.
- **JS-03:** profile chips (titles / comp / work-mode / locations / dealbreakers).
- **JS-04:** sources config switches.

## Tasks 4–6 — revised
- **Task 4 (web skeleton + landing):** first-run hero → "Start a new search" enters the
  onboarding route. Returning/configured user → configured landing (module tabs — built later).
  Authored skeletons while loading.
- **Task 5 (onboarding shell):** the two-column route above. Chat on `surface: "job-search"`.
  ProfileAside skeleton. **NOT** full-screen. **NOT** serif/mono.
- **Task 6 (run-now plumbing):** unchanged from the plan.

## Design reference for later slices
The full inline-control design (dropzone, critique card, chip toggles, sources switches, live
summary) is specified in Ben's Park Press handoff and will be pulled **into the repo** before
JS-02. For the JS-01 shell you do **not** need it — build the frame to this addendum + `tokens.css`.

## Exit / gate (unchanged intent, restated)
JS-01 UAT gate = first **visible isolation** test (open Job Search onboarding chat, then the
drawer, confirm mutual invisibility). Plus: two-column shell renders; ProfileAside skeleton shows
the 8 field rows; first-run entry works. STOP at the gate; comment on #1232; JS-02 waits for Ben.
