# Critical Points — PR #1065 live UAT (host-truth, issue #993)

Re-grounded on exact PR #1065 remote head SHA `9976ab6b`. UAT branch
`uat/1065-host-truth`. Feature code is byte-identical to the earlier `13e6352c`
run (only the UAT harness files differ); this run (run_3) captures FRESH live
evidence on the current PR head — no reuse of prior screenshots.

Target: http://localhost:5176 (web) proxying http://localhost:3010 (api), isolated
JARVIS_PGDATABASE=jarv1s_uat1065. The api PATH is scrubbed of the real `herdr`
binary (PATH = <cli-tools-1065-run2>/bin:/usr/bin:/bin), and the prefix bin was
reset to empty before this run, so the dev instance genuinely starts in a
not-installed state. The one-click Install re-runs the real
scripts/install-herdr.sh, which downloads+SHA256-verifies the pinned Herdr
v0.7.3 release into JARVIS_CLI_TOOLS_PREFIX/bin for real (host-status probe is
resolved fresh per request from PATH, so the flip is genuine, not cached).

- [x] CP1: Fresh owner account created via real signup UI (no seeded fixtures).
      UAT DB was reset (needsBootstrap flipped true) so the real "Create owner
      account" form appeared for UAT Owner Run3 / uat1065.run3.owner@example.com.
      Evidence: final_runs/run_3/screenshots/final_execution_1_signup_form.png +
      final_execution_4_app_home.png.
- [x] CP2: Navigated through real UI to Settings → Advanced host setup as owner
      ("You have owner access").
      Evidence: final_execution_6_host_pane_before_install.png.
- [x] CP3: Host-health summary captured BEFORE action — "herdr available: No",
      "Herdr — Not installed on this host.", "Install Herdr" button visible.
      Evidence: final_execution_6_host_pane_before_install.png.
- [x] CP4: Clicked Install Herdr; UI shows an in-progress state — button reads
      "Installing…" and is disabled.
      Evidence: final_execution_7_install_in_progress.png.
- [x] CP5: UI displays the structured install result (Installed) — Install row
      gone, "herdr available: Yes" / "Herdr is usable on this host." No raw
      installer stdout/stderr/secrets in the DOM. Install network response body
      was exactly {"state":"installed","herdrInstalled":true}. Real install
      independently verified: reinstalled binary sha256 = 043ef43e… matches the
      pinned x86_64 checksum in scripts/install-herdr.sh (genuine download+verify).
      Evidence: final_execution_8_host_pane_after_install.png + final_script_log.txt.
- [x] CP6: Host-health summary captured AFTER install — Status: Healthy;
      Database connectivity / Job queue (pg-boss) / Session multiplexer all Pass;
      herdr available: Yes. Diagnostics network response is fully structured JSON
      (uptimeSeconds, checks[], available{tmux,herdr}, …) with no paths/stdout/
      secrets (host/port are bind config, not secrets). Automated secret scan
      across both response bodies and both DOM snapshots: SECRET_SCAN: PASS
      (see final_runs/run_3/final_script_log.txt).
      Evidence: final_execution_9_health_summary.png.
