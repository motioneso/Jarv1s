# Build Handoff — 659-email-mime-crlf

**Source (approved fast-follow):** GitHub issue #659 — Harden email reply MIME headers against CRLF injection
**GitHub issue:** #659
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/659-email-mime-crlf` **Branch:** `coord/659-email-mime-crlf` off `origin/main` at `166a5618`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1e51-c431-7312-bab5-19718652375f`
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context.

## Start

1. Confirm `coordinated-build` is available; otherwise read the build skill path above in full.
2. `[ -d node_modules ] || pnpm install`.
3. Read issue #659 in full:
   `gh api repos/motioneso/Jarv1s/issues/659 --jq '.body'`
4. Verify the premise on your branch before planning:
   - `packages/email/src/reply-mime.ts` has `buildReplyMime`.
   - `buildReplyMime` currently interpolates `input.to` and `input.subject` into RFC822 headers.
   - Existing tests include `tests/unit/email-reply-mime.test.ts`.
5. Invoke `coordinated-build`: write the plan, escalate it to `Coordinator` for approval, then build only after approval.

## Scope

- Strip `\r` and `\n` from MIME header values before rendering `To:` and `Subject:`.
- Add negative tests proving sender/subject values containing CR/LF cannot inject additional headers such as `Bcc:`.
- Keep the body unchanged except for existing MIME formatting.
- Prefer one small helper in `packages/email/src/reply-mime.ts`; no new dependency.

## Required Checks

- Targeted unit test for reply MIME.
- `pnpm format:check && pnpm lint && pnpm typecheck`.
- Any additional focused test the plan justifies.

## Collision Notes

- Do not touch `docs/coordination/`; coordinator-only.
- No repo-wide `pnpm format`.
- No broad `git add .` or `git add -A`.
- No schema, RLS, connector credential, job payload, or UI expansion.
- Security-tier PR: coordinator will run security QA and Ben merge sign-off is required.
