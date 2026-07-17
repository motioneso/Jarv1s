# PR #1117 QA-red repair

- **Grounded:** branch `ux/988-closing-acceptance`, head `adf41915`; QA verdict comment `4997119318`.
- **Scope:** approved #988 D2 regression repair plus exact-head acceptance evidence. No broad gate reruns.

## Repair

1. Update the shared Today/Wellness color-mode read to consume `data-color-mode`, while leaving
   `data-theme` as the selected accent contract. Add focused tests proving dark mode survives with
   Forest and a non-Forest accent.
2. Make local color-mode fallback derive `dark` from legacy `jarvis.theme:v1=dark` when the new
   mode key is absent. Preserve existing explicit mode values.
3. Reuse the already-read `themes.active` preference in `GET /api/me/themes`; add or update the
   smallest route test if needed.

## Evidence

4. Run only focused tests for shell/theme consumers, theme storage, and theme routes. Do not rerun
   GitHub CI or broad local gates.
5. Resolve exact-head #988 evidence against existing artifacts: record what is proven, what remains
   missing, and link the durable UAT artifacts. Do not fabricate first-time, deeper-News,
   microphone, or full walkthrough proof; leave those as explicit acceptance gaps for Coordinator.

## Exit

- Shared mode contract no longer renders dark Today/Wellness palettes as light.
- Legacy Dark fallback and duplicate preference read fixed with focused coverage.
- Exact-head evidence status reported to `UX Coordinator`; no issue/board/merge changes.
