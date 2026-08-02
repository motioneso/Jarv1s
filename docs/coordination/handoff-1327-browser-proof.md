# #1327 dedicated browser-proof handoff

## Scope

Own only the remaining live proof for PR #1379 at exact head `9cd537f5`.

- Live Today URL: `http://100.64.98.99:5198/today`.
- Initial sync job: `6e7701fd-1b2d-4cfc-bc79-1d69ea835349`.
- Sanitized prior artifacts:
  `/tmp/webwright-1327-live-9cd537f5/final_runs/run_2/`.
- Coordinator label: `Coordinator`; session authority:
  `019fbfe1-d2ed-7531-b332-27c74cda6f3f`.

## Boundaries

- Do not message, read, or use the paused Job Search pane/session.
- Do not obtain credentials from terminal scrollback or repeat the exposed DEV password.
- Do not inspect private email content, provider/model identity, secrets, or raw job payloads.
- Do not install packages, edit code/config, restart services, enqueue another sync, run QA, merge,
  delete, or mutate DEV.
- Use system `python3`/Playwright only; no `pnpm install`.

## Start

1. Verify the initial job and every continuation using sanitized queue aggregates only.
2. Prove the chain is bounded to eight emails, deterministic/idempotent, non-overlapping, and
   eventually terminal; report retries/timeouts and evaluated counts.
3. Prove whether a genuine suggested Today row exists without reading its content.
4. If browser authentication is unavailable, stop at that exact boundary and ask the Coordinator
   for a secure credential mechanism; never source the exposed scrollback value.
5. If authenticated browser state becomes securely available, exercise View, Reply, Accept, and
   Dismiss on genuine rows, save sanitized screenshots/video, and report artifact paths.
6. Send compact state changes and the final verdict to the Coordinator label.
