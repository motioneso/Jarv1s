# UX #995 — Connected Accounts Cleanup: UAT Evidence

Manual real-dev-instance UAT (per the #1000 UAT harness rule for UI/UX features), run against
live API (`:3901`) + web (`:5175`) dev servers and the shared dev Postgres, on PR #1063
(HEAD `e5d18ad0`). Checklist item → screenshot:

| Checklist item                                                             | Screenshot                                              |
| ---------------------------------------------------------------------------| --------------------------------------------------------|
| Admin approve of a pending signup succeeds                                 | `01-admin-approve-pending-user.png`                     |
| Picker copy: Google / Email (IMAP) / GitHub disabled "Coming soon · #1061", no Apple/other-OAuth | `02-picker-copy-google-imap-github-comingsoon.png` |
| IMAP provider-select renders (Fastmail option visible)                     | `03-imap-provider-select-fastmail.png`                  |
| Test connection / Connect disabled until both fields filled — empty state  | `04-imap-form-empty-test-connect-disabled.png`          |
| Same form after filling both fields — buttons enabled                      | `05-imap-form-filled-test-connect-enabled.png`          |
| Bogus IMAP credentials → clean inline error, no crash/blank screen         | `06-imap-bogus-cred-clean-error.png`                    |
| Narrow viewport (390×844) — IMAP form                                      | `07-narrow-390x844-imap-form.png`                       |
| Narrow viewport (390×844) — picker                                         | `08-narrow-390x844-picker.png`                          |

**Reconnect-path coverage (decision, not a screenshot):** `AccountRow.onReconnect` and
`ServicePicker.onImap` both route to the identical `<ImapConnect onBack={...} />` call site with
no `initialProvider` ever passed
(`apps/web/src/settings/settings-personal-data-panes.tsx`) — confirmed by direct read. The
existing mocked `tests/e2e/connect-imap.spec.ts:57` is relied on as evidence for the Reconnect
routing click itself; no throwaway connector-account row was seeded for it.

Ran via a throwaway local script (`tests/uat-scratch/uat-manual.mjs`, Playwright-driven), deleted
after this evidence was captured — it was never intended to be committed.
