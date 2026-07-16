# PR #1117 exact-head live UAT evidence

- Verdict: **RED / BLOCKED**
- Target: `4420663551afa52ad6da05e9f5696fe0e8d3ab60`
- Date: 2026-07-16
- Environment: local live UAT stack, seeded `admin+data` and fresh `solo-admin`
- Viewports: desktop `1280×1800`; narrow `390×844`
- Successful Webwright run: `final_runs/run_2/`

`run_1` is diagnostic-only. `run_2` is the completed live run and contains 41 individually
inspected screenshots. The scripts used to seed and drive the run are intentionally excluded from
the evidence commit because they contain test credentials.

## Contents

- `uat-report.md` — verdict, defects, positive evidence, and explicit gaps
- `988-acceptance-ledger.md` — every #988 checkbox mapped to proof or a gap
- `983-source-matrix.md` — source-preserving finding matrix and recovery limitation
- `narrated-summary.md` — compact desktop/narrow walkthrough narrative
- `p0-p1-disposition.md` — closure-blocker disposition
- `release-note.md` — approved user-facing release note
- `plan.md` — self-verified Webwright critical-point outcomes
- `sanitized-action-log.txt` — credential-free action log
- `final_runs/run_2/screenshots/` — 41 sanitized screenshots
