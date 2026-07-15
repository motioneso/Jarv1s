# Critical Points — PR #1065 live UAT (host-truth, issue #993)

Target: http://localhost:5176 (web) proxying http://localhost:3010 (api), isolated
JARVIS_PGDATABASE=jarv1s_uat1065, api PATH scrubbed of the real `herdr` binary so
this dev instance genuinely starts in a not-installed state (JARVIS_CLI_TOOLS_PREFIX
points at a scratch dir; the real install script downloads+verifies the pinned
GitHub release for real, into that scratch dir only).

- [x] CP1: Fresh owner account created via real signup UI (no seeded fixtures).
      Evidence: final_runs/run_2/screenshots/final_execution_1_signup_form.png
      (real "Create owner account" form) + final_execution_4_app_home.png
      (lands as "UAT Owner", uat1065.owner@example.com, after real onboarding
      skip flow).
- [x] CP2: Navigated through real UI to Settings → Advanced host setup.
      Evidence: final_execution_6_host_pane_before_install.png — sidebar shows
      Admin/Setup → Advanced host setup selected, breadcrumb "Settings & permissions".
- [x] CP3: Host-health summary captured BEFORE action — "herdr" shows Not installed /
      available=No, "Install Herdr" button visible.
      Evidence: final_execution_6_host_pane_before_install.png — "herdr available: No",
      "Herdr — Not installed on this host.", visible "Install Herdr" button.
- [x] CP4: Clicked Install Herdr; UI shows an in-progress state
      ("Installing…"/disabled button).
      Evidence: final_execution_7_install_in_progress.png — button reads
      "Installing…" and is disabled.
- [x] CP5: UI displays the structured install result (Installed) with no raw
      installer stdout/stderr/secrets anywhere in the DOM.
      Evidence: final_execution_8_host_pane_after_install.png — Install row is
      gone, "herdr available: Yes"/"Herdr is usable on this host."; network
      response body was exactly `{"state":"installed","herdrInstalled":true}`
      (no paths/stdout/stderr). Real install independently verified: on-disk
      binary sha256 matched the pinned hash in scripts/install-herdr.sh and
      `herdr --version` printed 0.7.3.
- [x] CP6: Resulting host-health summary captured AFTER install — herdr row now
      reflects installed state (herdr available Yes, i.e. Usable — since this
      process already has a resolvable Root workspace via HERDR_PANE_ID) OR shows
      the Root-workspace configuration guidance note if not resolvable. Confirm
      via the real API response (network) that no secret/path/stdout content is
      exposed.
      Evidence: final_execution_9_health_summary.png — Status: Healthy, Database
      connectivity/Job queue/Session multiplexer all Pass, herdr available: Yes.
      Diagnostics network response body is fully structured JSON (uptimeSeconds,
      checks[], available{tmux,herdr}, etc.) with no paths/stdout/secrets.
      Automated secret scan across both response bodies and both DOM snapshots:
      SECRET_SCAN: PASS (see final_runs/run_2/final_script_log.txt).
