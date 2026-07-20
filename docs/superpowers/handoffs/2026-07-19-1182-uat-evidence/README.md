# #1182 — Hide embedding provider controls: live UAT evidence

Live visual QA for PR #1205 (issue #1182), run against a real isolated dev instance built from
this branch (per the #1000 UAT harness rule for UI/UX features). Grounded on branch commits
`9cfe766b` (fix) + `e00d78ba` (spec), rebased onto `origin/main@46fd5596`.

**Why this rerun exists:** the earlier QA run referenced by the original handoff
(`outputs/agentation-5178-visual-qa/final_runs/run_5`) does not exist anywhere on disk — a
search of the original worktree and `/home/ben/Jarv1s/outputs` found only `run_1`, which was
auth-only and contained 1 FAIL. Since that evidence was not reusable, the full visual QA was
re-executed from scratch and committed here so it can never go missing again.

## Instance

| Component | Detail                                                                  |
| --------- | ----------------------------------------------------------------------- |
| Web       | Vite dev server `http://127.0.0.1:5192`, built from this branch          |
| API       | `http://127.0.0.1:3021`, built from this branch                          |
| DB        | `jarvis_uat_1182` — dropped, recreated, and fully migrated before the run |
| Account   | Fresh bootstrap owner signup (throwaway `qa-1182-owner-<ts>@jarv1s.local`) |

Driven by a throwaway Playwright (Python, sync API) script that signs up the owner, skips
onboarding, opens `/settings?section=aiproviders`, and exercises the pane — mirroring the
`2026-07-15-995-uat-evidence` pattern, the runner script itself is not committed.

## Results

**59 PASS / 0 FAIL / 2 INFO** across both widths (full matrix in `results.json`, screenshots in
`screenshots/`, numbered in execution order; `_1280` / `_375` suffix = viewport width).

### Absence assertions (spec acceptance line 41–42, re-proven live)

At both 1280px and 375px:

- No `embedding` text anywhere in the rendered pane.
- No `stub` text anywhere in the rendered pane.
- Zero DOM matches for embedding-labelled selects/inputs
  (`[aria-label*='mbedding'], select[name*='embedding'], input[name*='embedding']`).
- No read-only replacement card — the pane goes straight from User chat override to Providers
  (see `03_aiproviders_pane_top_1280.png` / `20_aiproviders_pane_top_375.png`).

### Interactive-control sweep (spec acceptance lines 46–47)

Every remaining interactive control in the assembled Assistant & AI pane was clicked at **both
1280px and 375px**, and each had to produce its real effect (toast, dialog, rendered fields, or
state change) to pass — a no-op control records FAIL. Controls exercised per width:

| Control                        | Action proven                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| Allow user override switch     | Toggle → "Chat override setting updated" toast; restored            |
| Add provider button            | Opens provider picker                                                |
| Provider picker (Anthropic)    | Creates provider → toast + card renders                              |
| Set as default                 | Default badge/toast                                                  |
| Terminal button (CLI provider) | Opens terminal modal; Cancel dismisses it                            |
| Edit button                    | Opens edit panel with auth segmented control                         |
| Auth segmented: API key        | Key + base-URL fields render                                         |
| Credential Save button         | Disabled empty → enabled after input                                 |
| Execution mode segmented       | Select Non-interactive                                               |
| Auth segmented: CLI            | CLI panel renders                                                    |
| Re-authenticate button         | Click → toast                                                        |
| Per-model override switch      | Toggle → "override access updated" toast; restored                   |
| Model edit (pencil)            | Opens model edit form                                                |
| Model disable (minus)          | "Model disabled" toast; re-enabled                                   |
| Chat service binding select    | Change to Economy → "Service updated" toast; restored                |
| Voice config fields + Save     | Save disabled empty → enabled after URL/model/key filled (see INFO)  |
| Chat lock select               | Lock to model → "Chat model locked"; clear → "Chat lock cleared"     |
| Brave Search key input         | Accepts input                                                        |
| YOLO instance master switch    | Toggle on → danger confirm dialog → "YOLO settings updated"; restored |
| Remove provider + confirm      | Confirm dialog → "Provider removed" toast                            |

### INFO rows (2 — genuinely inapplicable, not no-ops)

The voice **Enabled** switch renders only once a voice endpoint is configured
(`settings-voice-config-group.tsx` gates the row on `configured`); a fresh instance has none, so
at each width the switch is legitimately absent and the always-rendered voice config fields +
Save-button gating were exercised instead (PASS).

## Acceptance mapping

- **Line 41–42** (no `stub` / embedding select / embedding-model input in any normal Settings
  route): re-proven live by the absence assertions above; the focused pane test
  `tests/unit/settings-ai-admin-pane.test.tsx` covers it at the unit level (line 45).
- **Lines 46–47** (visual QA of the assembled pane clicking every remaining interactive control,
  any no-op control fails): satisfied by the sweep above — 59 PASS, 0 FAIL, both widths, with
  the two INFO rows documented honestly as inapplicable rather than skipped.
