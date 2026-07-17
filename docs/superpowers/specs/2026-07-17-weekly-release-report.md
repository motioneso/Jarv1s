# Weekly release report

**Status:** Approved by Ben on 2026-07-17

## Goal

Publish a readable weekly record of Jarv1s delivery every Friday morning and make the latest report
discoverable from the app.

## Behavior

- At 09:00 America/Los_Angeles every Friday, generate a static report from GitHub pull-request data.
- Use a gap-free seven-day window ending at generation time.
- Record exact merged counts, category counts, the complete merged ledger, and every open PR with
  its current CI status.
- Commit the dated archive to `docs/releases/<date>-weekly/` and refresh `docs/releases/index.html`.
- Deploy `docs/releases` through GitHub Pages.
- Link “Weekly releases” from the authenticated app navigation to the stable Pages URL.
- Support manual workflow dispatch for recovery.

## Guardrails

- GitHub remains the source of truth; the generator must not invent metrics or delivery status.
- A PR counts as delivered only when `mergedAt` falls inside the report window.
- Failed or cancelled checks render as blocked; running checks render as validating.
- Generated HTML escapes all GitHub-provided text.
- No database, API, product route, runtime scheduler, or new package dependency.

## Verification

- Generator self-check covers HTML escaping, category classification, and CI-state classification.
- A fixture-free local generation must produce a report with the same merged count as `gh pr list`
  for the requested window.
- Generated HTML must render without horizontal overflow at 320, 375, 414, and 768 CSS pixels.
- The app link opens the stable report URL in a new tab with `noopener noreferrer`.
