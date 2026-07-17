# Critical Points — PR #1118 exact-head live UAT (00c43878c6ffada902f3955962f3f9101dc6e14b)

Reference (read-only, not executed): tests/uat/specs/1112-today-masthead-oneline.uat.spec.ts
Scope: real owner signup on a fresh **bare** #1000-harness instance (no seed), through
onboarding skip, to Today. Verify #1112 (one-line masthead @ desktop) survives on top of
#1117 (stacked masthead @ narrow, priority pill removal, etc.) at exact HEAD.

- [x] CP1: Fresh bare instance provisioned at exact commit 00c43878c6ffada902f3955962f3f9101dc6e14b;
      owner signup form appears (needsBootstrap=true → mode defaults to sign-up).
      Evidence: `final_runs/run_2/screenshots/final_execution_1_signup_form.png` — "Create owner
      account" form, Name/Email/Password labels, "Create account" button.
- [x] CP2: Real owner signup (name/email/password) succeeds; onboarding wizard appears; "Skip setup"
      → "Skip anyway" confirmation reaches AppShell/Today (`.jds-usermenu__trigger` or Today masthead
      visible). Evidence: `final_execution_2_onboarding_wizard.png`, `final_execution_3_skip_confirm.png`,
      `final_execution_4_appshell_reached.png` (Today masthead visible, log step 5).
- [x] CP3: Authenticated Today page loads — `.cmd-masthead`, `.cmd-eyebrow` (greeting), `.cmd-dateline`
      all visible. Evidence: `final_execution_5_today_desktop.png`, log step 6.
- [x] CP4: Desktop 1280x1800 — greeting (`.cmd-eyebrow`) and dateline (`.cmd-dateline`) bounding-box
      tops match within tolerance (same masthead line), per #1112. No visible overlap or truncation
      of either string. Evidence: `final_execution_6_cp4_oneline_desktop.png` — "GOOD EVENING, UAT"
      and "THURSDAY · JULY 16, 2026 · NO.197" share one visual line; log step 7: greeting.y=122.00,
      dateline.y=122.00, |dy|=0.00 (tolerance<=2) -> PASS.
- [x] CP5: Narrow 390x844 — #1117's responsive stack applies: `.cmd-masthead__row` is column-stacked
      (main block above aside/dateline), both greeting and date remain visible/readable, and the page
      has NO horizontal overflow (`document.documentElement.scrollWidth` <= viewport width). Evidence:
      `final_execution_7_cp5_narrow_stacked.png` — dateline visibly stacked below greeting, no
      horizontal scroll; log step 8: flex-direction=column, scrollWidth=390, clientWidth=390,
      no_overflow=True, stacked=True -> PASS.
- [x] CP6: Final desktop sanity — back at 1280x1800, masthead one-line state from CP4 still holds
      (no residual narrow-mode styling leaking after resize), page free of horizontal overflow.
      Evidence: `final_execution_8_cp6_final_desktop_sanity.png`; log step 9: greeting.y=122.00,
      dateline.y=122.00, |dy|=0.00, scrollWidth=1280, no_overflow=True -> PASS.

**RESULT: GREEN — all CP1-CP6 confirmed, both by script assertions and by visual read of every
screenshot.** Grounded on exact HEAD `00c43878c6ffada902f3955962f3f9101dc6e14b`. `run_1` failed on
a mechanical Playwright JS/Python API bug (`.toBeVisible`/`.getByRole`/`.getByLabel` camelCase vs
required `.to_be_visible`/`.get_by_role`/`.get_by_label` snake_case) before any browser interaction;
`run_2` is the corrected script and the one whose evidence backs this verdict — both are kept for
the record.

Evidence: one screenshot per CP (desktop + narrow), `final_script_log.txt` step lines + bounding-box
numbers, all under `final_runs/run_2/`.
