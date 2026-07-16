# PR #1117 final live UAT report

## Verdict

**RED / BLOCKED** on exact head `4420663551afa52ad6da05e9f5696fe0e8d3ab60`.

The live route and appearance work are broadly present, but the finish destination, bounded
Activity state, and narrow Today layout do not meet closing acceptance. Platform/configuration
dependent paths remain explicitly unproven.

## Confirmed blockers

1. **Onboarding finish destination:** the visible `Go to settings` action lands on `/today`, not
   `/settings`. See `final_execution_09_onboarding-settings-destination-failure.png` and onboarding
   log step 10.
2. **Activity does not settle:** Activity still visibly says `Loading…` after a bounded 3.1-second
   wait. See `final_execution_21_settings-activity-desktop.png` and admin log step 22.
3. **Narrow Today layout collapses:** at `390×844`, the lead copy wraps into a one-word-per-line
   column despite unused horizontal space. See `final_execution_47_today-narrow-dark-dusk.png`.

## Lower-severity residual

- Sports' desktop hero title truncates with an ellipsis despite available width. See
  `final_execution_11_sports-desktop.png`.

## Positive exact-head evidence

- Real login reaches Today and the actual Settings/module routes.
- Desktop Today, Tasks, Calendar, News, Sports, and Wellness render.
- Ordinary chat, private-chat disclosure, and history surfaces render truthfully.
- Forest, Sage, Canyon, Teal, and Dusk each preserve both Light and Dark mode: all 10 combinations
  matched `data-theme` and `data-color-mode` in log step 27.
- Desktop Dark+Dusk Today and Appearance are readable.
- News reached its real configuration route; curated Technology topic add/remove worked via Enter;
  invalid publisher feedback retained its input; excluded-publisher add/remove worked; the empty
  state persisted after refresh; and an article opened through a real UI link.
- The fresh-owner onboarding path covered desktop/narrow Welcome, skip consequence, Back/Continue,
  unavailable provider state, optional connector skip, and Finish.
- Admin/Setup and personal Settings destinations were visually inspected, including Account,
  Assistant, Priorities, Memory, Connected accounts, Data sources, Modules, Skills, People & access,
  provider setup, instance modules, connector oversight, audit, and host setup.

## Explicitly unproven

- **Microphone end to end:** Firefox permission grant was unsupported; localhost was a secure
  context; and the microphone was disabled because no transcription model was configured. The UI
  title correctly directed setup to Settings → Assistant & AI. No recording or transcript success
  is claimed.
- **News freeform topic add/edit/remove:** gated by missing web search; Add topic was disabled.
- **News feedback:** the live page exposed zero feedback controls.
- **News graceful image failure:** the attempted route block did not remove visible imagery,
  probably because images were cached or CSS backgrounds. Image success is visible; failure is not.
- **Export/download and account deletion:** destructive actions were not performed.
- **End-to-end email/calendar grants, model switching, and skill upload/invocation:** surfaces were
  reached, but full action consequences were not proven.
- **Original 37-item recovery:** #983 says 37 findings, while exposed child issues contain 40
  timestamp-bearing bullets and additional untimestamped bullets. The retained local transcript and
  video were unavailable, so no fabricated one-to-one numbering is supplied.

## Evidence integrity

All 41 `run_2` screenshots were individually inspected. Product code and the PR target commit were
not changed. The durable evidence commit contains only reports, the sanitized action log, the plan,
and screenshots; credential-bearing browser scripts are excluded.
