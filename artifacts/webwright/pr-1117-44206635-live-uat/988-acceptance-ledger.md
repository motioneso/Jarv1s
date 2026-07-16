# #988 checkbox-to-proof ledger

Target: `4420663551afa52ad6da05e9f5696fe0e8d3ab60`
Evidence root: `final_runs/run_2/`

| #988 checkbox | Outcome | Exact-head proof or gap |
| --- | --- | --- |
| Today redundant ranking/due labels | UNPROVEN | Today was captured on desktop/narrow (03, 29, 47), but the live fixtures do not unambiguously prove the original label-removal requirement. Narrow Today additionally has a blocking wrap regression (47). |
| News/Sports imagery | PARTIAL | News imagery renders and a real article link opened (06; log 8). The image-failure simulation was invalid because imagery remained visible (09; logs 9–10). Sports renders, but its hero title truncates (11). |
| Appearance independence | PASS | All 10 Forest/Sage/Canyon/Teal/Dusk × Light/Dark combinations matched runtime attributes (log 27); desktop and narrow Dark+Dusk are visible (28, 49). |
| Shared wrapping, spacing, typography, contrast, hierarchy | FAIL | Narrow Today collapses copy one word per line (47); Sports truncates its hero title (11); Activity never settles (21). |
| Your data and account deletion | UNPROVEN | Account/data controls are visible (17), but export/download and destructive deletion were not executed. |
| Email/calendar access | UNPROVEN | Connected accounts and connector oversight render (23, 33); actual grant consequences were not exercised. |
| Model switching | UNPROVEN | Personal/admin Assistant surfaces render (18, 31); no end-to-end model switch consequence was proven. |
| News feedback | UNPROVEN | Live feedback-control count was zero (log 43). |
| Skill upload | UNPROVEN | Skills Settings renders (26); upload/validation/invocation were not executed. |
| Activity | FAIL | Activity remained `Loading…` after 3.1 seconds (21; log 22). |
| Microphone vs #900/#901 | UNPROVEN | Attempt recorded: secure context true, Firefox permission grant unsupported, control disabled without transcription model (log 14). No end-to-end audio claim. |
| Separate first-time onboarding | FAIL | Welcome through Finish, narrow state, skip consequence, Back/Continue, and optional skip were exercised (onboarding 03–08). `Go to settings` misrouted to `/today` (09; log 10). |
| Deeper News walkthrough | PARTIAL | Configure route, curated topic Enter add/remove, validation retention, excluded publisher add/remove, empty refresh persistence, real article navigation, and narrow layout passed (36, 38, 44, 46; logs 36–46). Freeform topics, feedback, and image failure remain unproven. |
| Complete desktop/narrow walkthrough | FAIL / PARTIAL | Desktop primary and Settings routes plus narrow News/Today/Tasks/Appearance were recorded (03–49). Activity, destructive flows, several end-to-end settings consequences, and narrow Today prevent completion. |
| Light/dark independent and readable | PASS for independence/contrast | Runtime 5×2 matrix passed (log 27); desktop/narrow Appearance and desktop Today are readable (28, 29, 49). This does not waive the separate narrow Today layout failure. |
| Appropriate safe images | UNPROVEN | Visible News image success exists (06), but the log found no same-origin image routes and graceful failure was not demonstrated (logs 7, 10). |
| No unresolved P0/P1 | FAIL | No P0 privacy leak was confirmed, but the finish misroute, non-settling Activity, and narrow Today regression are unresolved P1-equivalent acceptance blockers. |
| Every #983 finding disposed | UNPROVEN | See `983-source-matrix.md`. Source material exposes 40 timestamp bullets, not a recoverable one-to-one 37-item list, and multiple flows lack direct proof. |
| Narrated pass and release note | PASS as artifacts | See `narrated-summary.md` and `release-note.md`; the narrated verdict is RED, not a release approval. |

Screenshot numbers refer to `final_execution_<number>_<action>.png`. Because onboarding and
admin phases use independent step sequences, the descriptive suffix is authoritative where a
number is reused.
