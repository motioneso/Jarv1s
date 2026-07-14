# ⏳ Awaiting Ben — decision parking lot

Coordinator holding pen for decisions that need Ben's call. **Rule:** anything that needs Ben goes
here the moment it arises (not buried in a digest), stays until he rules, and the Coordinator
**leads every status report with this list while it's non-empty.** Cleared items drop to the log
at the bottom.

Lock: Coordinator session `58a78927-385c-4b1d-8fa0-94db20255d6f`.

## Open

- **#1040 / PR #1051** dev/UAT seed logs owner/admin creds — **SECURITY-tier merge sign-off.**
  Raised 2026-07-13. Build DONE (Codex gpt-5.6-sol, `f6be3991`, rebased on origin/main@`8f9da394`);
  **Opus adversarial security QA = GREEN, 0 blocking** (verdict on PR #1051). Fence = existing
  `JARVIS_UAT_SEED_CONFIRM=1` opt-in token (sole setter `provisioner.ts:188`; `cli.ts:16`
  fail-closes; prod default empty + seed svc `profiles:["ops"]` inert; log line `admin.ts:97` has
  own token re-check). Only the public throwaway fixture email+password is logged — never a real
  secret/hash. **This is epic #1000's LAST child — merging it closes #1000.** **CI now FULLY GREEN**
  (VF 15m57s + both compose smokes + image build all pass; `mergeable=CLEAN`, head `f6be3991`).
  **Council complete: Opus security QA GREEN + Fable cross-model QA GREEN (MERGE-READY: YES, 0
  blocking; PR #1051 comment 4966065450)** — Fable independently re-proved all 4 fence claims with
  file:line. One NON-blocking follow-up (file at merge): `admin.test.ts` fence tests run in no CI
  lane (VF=unit+integration; run-uat.ts Playwright-only) → move the DB-free describe to `tests/unit`
  so it doesn't rot. **Only thing left = your merge sign-off.** On your OK I merge MANUALLY
  (`gh pr merge 1051 --squash --delete-branch`, never --auto), close #1040 + epic #1000, file the
  test-placement follow-up.

## Cleared (log)

- **#984 / PR #1015** private-history — Raised 2026-07-13 (resume-vs-defer + merge sign-off).
  Ben ruled **resume** ("do those things yes please") and then **delegated the merge decision to
  Opus** (2026-07-13): Opus's adversarial security re-QA verdict IS the sign-off — auto-merge on
  Opus APPROVE, back to the lane on any blocker. No Ben gate for this PR.
