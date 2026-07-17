# Task

Final exact-head live UAT for PR #1117 at
`f05d977c186b82b31b42b0d6cff3b98bb1d91b47`, following
`docs/superpowers/handoffs/2026-07-17-pr-1117-final-live-uat.md`.

# Critical Points

- [x] CP1 — **PASS.** Finish and the exact `/settings` destination are visible in screenshots 20–21 and recorded in log steps 20–21.
- [x] CP2 — **FAIL / release blocker.** Screenshots 04–06 and log steps 4–6 show the normal path still loading, no truthful error or `Try again` after the controlled delay, and no recovery after delay removal.
- [x] CP3 — **PASS.** Separately labeled `1280x1800` and `390x844` proof is in screenshots 03 and 09; the narrow masthead and lead copy are readable and stacked.
- [x] CP4 — **PASS.** Screenshot 07 and log steps 7–8 prove independent Teal plus Dark selection and subsequent Teal plus Light selection through the document attributes.
- [x] CP5 — **BLOCKED WITH DIRECT PROOF.** Screenshot 10 and log step 10 show a disabled microphone with the transcription-model prerequisite; Firefox permission grant also returned an error on a secure localhost context.
- [x] CP6 — **COVERED WITH DIRECT BLOCKERS.** Screenshot 11 shows freeform topics gated by missing web search. Screenshot 12 and log step 12 show zero feedback controls and failed images with article text still readable.
- [x] CP7 — **PARTIAL PASS WITH DIRECT BLOCKERS.** Export completed with nonzero bytes (screenshot 22; log steps 22–23). Deletion reached both confirmations but the instance-owner rule blocked completion (screenshots 24–26; log steps 24–26). Calendar grant remove/restore and model actions succeeded (screenshots 13–14). No email grant control was exposed. Skill creation succeeded, while invocation was blocked by the live no-provider chat state (screenshots 15–16).
- [x] CP8 — **DEFERRED RESIDUAL REPRODUCED.** Screenshot 17 visibly retains the truncated Sports hero title.
- [x] CP9 — **PASS.** All `run_1` screenshots were individually inspected across the uninterrupted predecessor/current verification, and only this plan, the report, sanitized log, README, and cited screenshots are included in the evidence commit.

## Verdict

**RED** at exact head `f05d977c186b82b31b42b0d6cff3b98bb1d91b47` because CP2 remains a release blocker.
