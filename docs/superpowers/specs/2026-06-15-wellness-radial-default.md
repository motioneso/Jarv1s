# Spec — Wellness radial feeling-wheel as default + center fix (feedback pass 3)

**Status:** approved (owner-directed feedback, 2026-06-15). Refinement of merged wellness work
(#256, #261). Routine tier — frontend-only (wellness web), no schema/auth/secret/RLS surface.

## Source — two owner agentation annotations (2026-06-15, `/wellness`)

1. **Radial by default (`mqflamxi-hg6ud9`)** — on the "Feeling wheel" toggle in `<WellnessPage>`
   hero: _"I don't want this AS a tweak, I want the radial by default. Please make sure you use the
   prototype design for it."_
2. **Center oval bug (`mqflb9g2-a5esw6`)** — on `<RadialDial> svg` inside `<CheckinModal>`: _"The
   center of the radial looks odd. It's a tall slim oval instead of filling the space."_

## Background

Pass 2 (#261, spec `2026-06-15-wellness-feedback-pass.md` D3/#8) wired the radial feeling-wheel
picker into `CheckinModal` but **gated it behind the existing "radial" tweak flag** (`prefs.radial`,
default off). Ben now wants the radial to be the **default** presentation, matched to the prototype,
and the center rendering fixed.

## Prototype (match this — do NOT invent design)

- **`docs/brand/mockups/feelings-wheel-modal.html`** — the canonical feeling-wheel modal prototype.
- **`apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md`** — companion mockup notes.

Open both and match the radial's geometry, colors, center treatment, and labels to the prototype.

## Decisions (locked)

- **D1 — Radial is the default check-in picker.** Remove the "radial" tweak as a *gating* mechanism
  so the feeling-wheel renders by default in `CheckinModal` (and anywhere the check-in picker
  appears) without the user enabling any tweak. Current gate: `prefs.radial` checkbox in
  `apps/web/src/wellness/wellness-page.tsx:247` ("Feeling wheel" label). Remove the toggle and the
  `prefs.radial` flag plumbing (and any dead `wellness-prefs.ts` field / non-radial fallback branch)
  in the same pass — no stale tweak vocabulary left behind. If removing the toggle would break a
  non-trivial dependency, ESCALATE to the coordinator instead of leaving it half-gated.
- **D2 — Center fills the space (circular), per prototype.** `radial-dial.tsx` uses a square
  `viewBox="0 0 300 300"` with `width:100%` and no height pin; the center element distorts to a tall
  slim oval. Fix so the dial + its center render as a true circle filling the available space (e.g.
  enforce `aspect-ratio:1` / explicit height on the svg, and a circular center element), matched to
  the prototype center treatment. Verify visually against the prototype.

## Acceptance criteria

- On `/wellness`, opening a check-in shows the **radial feeling-wheel by default** — no tweak toggle
  required, and the "Feeling wheel" tweak toggle is gone (not just defaulted-on).
- The radial center renders as a filled circle (not a tall oval) and matches
  `docs/brand/mockups/feelings-wheel-modal.html`.
- Check-in submission still works end-to-end (sensations + intensity + optional energy + note →
  `POST /checkins` / `createWellnessCheckin`) — radial selection maps to the same payload.
- No stale "radial"/"Feeling wheel" tweak vocabulary remains in code, prefs, or settings.
- `pnpm verify:foundation` green (REAL exit 0). Existing wellness tests pass; add/adjust a unit test
  if the prefs shape changes.

## Out of scope

- Backend taxonomy / insights / therapy-notes changes (already merged).
- New check-in fields or API changes.
