## Self-Review

**Spec coverage.** Every numbered spec section maps to a task: §2 two axes → Tasks 9, 20;
§3.1 crawler → 11, 12, 14; §3.2 no paywalls → 11 (`statusToKind`), 12 (LinkedIn interstitial);
§3.3 résumé → 4, 16; §3.4 open conversation → 17; §3.5 profiles → 4, 16; §3.6 render from records →
10, 19, 20; §3.7 structured failures → 5, 11, 20; §3.8 recall → 8; §3.9 module owns everything →
Phase 0 confined to additive core files. §5 architecture → 3, 4, 13. §6 surfacing → 15. §7 UI →
18–20. §8 thread scoping → 17, and Task 22 phase 11. §9 résumé → 16. §10 core changes → 1, 2, and
the flagged deferral. §11 security → 13, 21. §12 testing → 21, 22.

**Known gaps, stated rather than hidden:**

- **§10.1 dynamic fetch hosts is deferred**, so "add your own job portal" does not ship in v1.
  Flagged at the top for Ben's decision; if he wants it, this plan gains a Phase 0 task.
- **Chat thread plumbing is a Phase 0 dependency, not an assumption.** Tasks 17 and 22 depend on
  Task 2c's module-scoped chat surface. The implementer must confirm Task 2c has landed and that the
  drawer's thread resolution honours the surface key **before starting Phase 5**, and stop and
  report if the seam is not there — the alternative is a Phase 5 that builds against a surface
  nothing binds.
- **The real-stack harness already exists** — `pnpm test:uat`, with external-module precedent in
  `tests/uat/specs/finance-*.uat.spec.ts` (K8). Task 22 ships a spec into it plus one provisioner
  delta (a container-reachable fixture origin and `JARVIS_E2E_MODULE_FETCH_BASE` written before
  boot), not a harness.
- Sports and news are not migrated onto the Task 2 briefing seam. Separate cleanup, separate issue.

**Type consistency.** `FailureCause`, `SearchCriteria`, `Posting`, `Match`, `PortalState`,
`JobSearchStore`, `Portal`, `CrawlResult`, `ScoreResult`, `TriageInput`/`TriageResult`, and
`BriefingContribution` are each defined once — in Task 5, 11, 13, 9, 8, or 2 respectively — and
referenced by name thereafter. `completedSteps`, `isReadyToCrawl`, `parseScoreResult`,
`applyHardExcludes`, `dedupePostings`, `postingIdentity`, `triage`, `describeFailure`,
`stripEnvelope`, `runCrawl`, `runScore`, and `contributeToBriefing` keep the same names in every
task that mentions them.
