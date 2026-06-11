# Security & Foundational-Strength Audits — 2026-06-10

This directory preserves the audit reports produced during the 2026-06-10 review night.
Four independent runs are captured here:

| Run | Path | Scope |
| --- | --- | --- |
| **Fable** (8-phase) | `docs/audits/2026-06-10-fable-phase*.md` | Security + foundational strength, 8 phases (DB/RLS → cross-cutting). Driven by `2026-06-10-fable-security-audit-instructions.md`. |
| **PLO** | `docs/audits/PLO Audit/` | Per-module + security deep-dive, with a `verification/` supplement. |
| **PLOO** | `docs/audits/PLOO Audit/` | Phase summaries + triage rollup. |
| **otnr** | `docs/audit/otnr/` (note: singular `audit/`) | 29-phase per-module/cross-cutting pass + `revalidate-workflow.js`. |

## ⚠️ Stale-branch caveat — findings require re-verification

> **These audits ran against a stale local `main` (8 commits ahead / 34 behind
> `origin/main` @ `240de7e`), not the real tip.** Code may have changed underneath the
> findings. **Do not action any finding before re-verifying it against current `origin/main`.**

A verification pass against live `origin/main` is pending. GitHub issues were already filed
for many of these findings during the review — cross-reference issues before opening new ones.

This README and the reports are documentation only; no code or config is changed by this branch.
