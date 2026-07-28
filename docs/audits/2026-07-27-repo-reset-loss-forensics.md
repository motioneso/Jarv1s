# Forensic audit — what the 2026-07-26 repo reset actually lost

- **Run date:** 2026-07-27
- **Grounded on:** `main` @ `0b2db06d`
- **Method:** read-only. No checkout, stash, or reset of the shared tree; no bundle unpack.
- **Scope:** all 44 `archive/2026-07-26/*` tags, all 563 refs in
  `~/jarvis-branch-archive-2026-07-26.bundle`, and `~/jarvis-uncommitted-rescue-2026-07-26/`.

## Answer in one line

Two things were genuinely lost. Everything else I flagged traced back to squash merges or the
batch PR #1224 and is present on `main`.

## Confirmed lost

### 1. The 2026-07-19 settings/onboarding stack — 9 commits, no PR ever opened

Held on `archive/2026-07-26/coord/1179-pdf` and
`archive/2026-07-26/feedback/settings-profile-polish`. Every commit content-verified absent from
`main`.

| Commit     | What it did                                                        | Status now                    |
| ---------- | ------------------------------------------------------------------ | ----------------------------- |
| `bf8e80ad` | Settings provider login — new 342-line `settings-provider-login-dialog.tsx` | re-filed as open **#1270**    |
| `51ac7253` | Copy button + selection handling for the owner terminal            | re-filed as open **#1271**    |
| `977effdd` | Codex device-code handling in onboarding (`userCode` render)        | unfiled                       |
| `c2607105` | Surface all provider setup options (touched the loginable filter)   | unfiled                       |
| `12f421d5` | Align provider `HOME` with the auth volume (cli-runner)             | unfiled                       |
| `aeb5cb15` | Fix LAN attachment upload ids (chat composer)                       | unfiled                       |
| `351b74e1` | Keep module credentials visible                                     | unfiled                       |
| `678c29b1` | Remove unreliable onboarding finish choices                          | unfiled                       |
| `3414b6b9` | Profile-preferences polish                                          | unfiled                       |

`grep -rn userCode apps/web/src/` returns nothing on `main`, which is why this session's #1270 spec
was written on the false premise that the feature had never been built.

### 2. `915672f2` — external-module tool results in module UI (`surfacesResultToUi`)

2026-07-24, 256 insertions across `packages/ai/src/gateway/gateway.ts`,
`packages/module-sdk`, `module-registry` validate + tool-manifests, plus a 202-line test. Never
PR'd. `grep -r surfacesResultToUi` returns **zero** matches on `main`.

It was built on the `build/js-03-perms` job-search branch, so the deliberate job-search scrap took
generic platform work out with it. The job-search half was meant to go; the SDK/gateway half was
not. This one was already caught independently — the agentmemory note
`module-ui-needs-tool-result-allowlist.md` was corrected on 2026-07-27 from "FIXED `915672f2`" to
"does not exist," and it records the design well enough to rebuild from. Confirmed again here:
`grep -r surfacesResultToUi` over `packages/` and `apps/` returns nothing.

**Lesson worth generalizing:** platform capability built on a feature branch dies with the feature.
`surfacesResultToUi` is a module-SDK contract, not job-search code; it should have landed on its own
branch behind its own issue.

## Checked and NOT lost (false positives worth recording)

- #1182 embedding controls, #1185 news captions, #1187 module library, #1188 connector onboarding —
  all closed 2026-07-20; their PRs (#1205/#1211/#1202/#1206) were closed unmerged but the work
  **was** reworked into batch PR #1224, which is on `main`. Verified by content, not by PR state.
- #1239 one-shot engine, #671 wellness worker grants, #1166 finance module DDL, #508 thread
  ownership, #526 briefings — all present on `main`.
- 2026-07-14/07-16 UAT-branch commits (`today-closing-polish.test.tsx`,
  `today-narrow-layout.test.ts`, `settings-notes-people.spec.ts`, `mock-notes-people-api.ts`,
  `PUT /api/me/themes/mode`, news migration `0161`) — all present.
- 21 job-search commits (#1203, #1229, #1234) — lost **by decision**, not by accident.

## Root cause

The reset triaged branches by asking **"does this branch have a merged PR?"** That was the right
question for 197 squash-merged branches and it protected all 530 merged PRs. It is blind to work
that never had a PR.

The 2026-07-19 coordinator queue (recovered from
`archive/2026-07-26/coord/1179-pdf:docs/coordination/2026-07-19-1179-pdf-bundle.md`) shows one lane
whose tracking row reads:

> Approved input: **Direct user authorization** · Issue: **live feedback** · Branch:
> `feedback/settings-profile-polish` · PR: **—** · Status: **live-verified; comments resolved;
> awaiting user review**

So the chain was: authorized live in an annotation session, never given a GitHub issue, never given
a PR, live-verified on the dev instance (which is why it was remembered as working), left waiting
on owner review for seven days, then swept into the "43 UAT-evidence and coordination doc branches"
bucket and deleted with its tag as the only record.

Nothing was hidden and nothing was corrupted — the safety net was real (both commits were
recoverable from the archive tags in minutes). The gap is that **archived ≠ triaged**: unmerged
branch tips were preserved but their contents were never read before deletion.

## What this implies

1. **`#1270` is a recovery, not a build.** Same for `#1271`.
2. **The "verified no merged work was lost" check was sound but too narrow.** It answered
   "did every merged PR land?" and never asked "did any unmerged branch hold finished work?"
3. **The live-feedback lane bypasses the project's own gate.** CLAUDE.md requires a GitHub task
   issue before anything is built; this lane was tracked only in a coordinator table. That is
   exactly the work that becomes invisible to a name/PR-based sweep.
4. **Everything is still recoverable.** All 419 non-tag bundle tips are still present in the local
   object store — no `gc` has pruned them — so nothing above needs the 400 MB bundle to recover.

## Not covered by this audit

Uncommitted worktree diffs were rescued to `~/jarvis-uncommitted-rescue-2026-07-26/` (16
`worktrees/*.patch`, 5 `orphan-worktrees/*.tar.gz`, 4 stash patches) and have never been re-applied
or reviewed. Largest non-job-search item is `feedback-1182-embeddings.patch` (3.9 KB). Those live in
no ref and no tag; if they matter they need a separate pass.
