# Task

Final live evidence lane for PR #1117 at exact head
`4420663551afa52ad6da05e9f5696fe0e8d3ab60`, following
`docs/superpowers/handoffs/2026-07-16-pr-1117-final-live-uat.md` and the approved #988 closing
acceptance spec/plan.

# Critical Points

- [x] CP1 — **PASS:** a seeded owner signed in through the real login UI and reached Today and the
  real Settings/module routes. Proof: log steps 2–3, 17–26, and 36; screenshots 03, 17, 25, and 36.
- [x] CP2 — **FAIL:** the 5×2 accent/mode matrix passed and desktop/narrow Appearance states matched,
  but narrow Today collapses its lead copy into a one-word-per-line column despite available width.
  Proof: log steps 27–29 and 47–49; screenshots 28, 29, 47, and 49.
- [x] CP3 — **FAIL:** first-time onboarding was exercised through Finish, including Back/Continue,
  optional skip, truthful unavailable state, and skip consequence. The visible `Go to settings`
  action landed on `/today`, not `/settings`. Proof: onboarding log steps 3–10 and screenshots 03–09.
- [x] CP4 — **PARTIAL / UNPROVEN:** Configure News, curated-topic Enter add/remove, validation-value
  retention, excluded-publisher add/remove, empty-state refresh persistence, article navigation, and
  narrow layout were exercised. Freeform topic actions were gated by missing web search, feedback
  controls were absent, and the attempted image-failure simulation did not remove visible images;
  those claims remain unproven. Proof: log steps 6–10 and 36–46; screenshots 06, 36, 38, 44, and 46.
- [x] CP5 — **UNPROVEN:** the path was attempted, localhost was a secure context, Firefox permission
  grant was unsupported in this environment, and the microphone remained disabled because no
  transcription model was configured. No recording/transcription claim is made. Proof: log step 14.
- [x] CP6 — **FAIL / PARTIAL:** the recorded route/settings walkthrough completed across desktop and
  narrow views, but Activity stayed `Loading…` after 3.1 seconds; destructive export/deletion,
  end-to-end grant/model/skill flows, and some approval/People interactions were not safely proven.
  Proof: log steps 3–35 and 46–49; screenshots 03–35 and 46–49.
- [x] CP7 — **COMPLETE AS A LEDGER, ACCEPTANCE BLOCKED:** `988-acceptance-ledger.md` maps every
  checkbox to exact-head proof or an explicit failure/unproven reason.
- [x] CP8 — **COMPLETE WITH SOURCE-RECOVERY LIMITATION:** the exposed child issues contain 40
  timestamp-bearing bullets plus untimestamped supporting bullets, while #983 states 37 findings.
  Without the retained local transcript/video, an honest one-to-one 37-item reconstruction is not
  possible. `983-source-matrix.md` preserves all 40 source bullets without inventing numbering;
  the narrated summary, P0/P1 disposition, and approved release note are also attached.

# Evidence policy

- Target SHA: `4420663551afa52ad6da05e9f5696fe0e8d3ab60`.
- Desktop viewport: `1280x1800`; narrow viewport: `390x844`.
- Prior `adf41915` screenshots are historical context only and cannot prove this exact head.
- Never expose passwords, tokens, private messages, connector contents, export contents, or
  deletion confirmation values in durable screenshots/logs.

# Final verdict

**RED / BLOCKED.** Exact-head live evidence is complete for the states reached. Do not reinterpret
missing prerequisites, absent controls, cached/background images, or destructive actions not taken
as passes.
