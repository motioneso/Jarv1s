# Build Handoff — #643 IMAP Onboarding UI

**Spec (approved):** `git show 4bfa0221:docs/superpowers/specs/2026-06-30-generic-imap-email-connector-design.md` (Slice E / §11)
**GitHub issue:** #643
**Risk tier:** `security` until premise verification proves this is UI-only. The work may touch connector credential onboarding and auth/test-connection surfaces, so build and plan to the security bar.
**Worktree:** `~/Jarv1s/.claude/worktrees/643-imap-onboarding-ui`
**Branch:** `coord/643-imap-onboarding-ui` off `origin/main`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows exactly one pane with this label. Never guess or reuse a `w...:p...` pane id — they reflow.)
**Coordinator session id:** `019f2305-7128-7723-9d5f-f1a8b7b11e65`
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own context, then relay immediately.

## Start

1. Confirm `coordinated-build` is available. If not, open the build skill path above and follow it directly.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read this handoff, issue #643, and the approved spec snapshot in full:
   `git show 4bfa0221:docs/superpowers/specs/2026-06-30-generic-imap-email-connector-design.md`
4. Verify the premise against this branch before planning. Slices B/C are merged and IMAP preset definitions exist, but onboarding/settings still appear to treat Proton/iCloud/Yahoo/Fastmail as coming-soon placeholders.
5. Write a compact plan and escalate it to the coordinator for approval before code.

## Scope

- Flip Yahoo Mail, Proton Mail (Bridge), iCloud Mail, and Fastmail from "Soon" placeholders to active IMAP connect flows.
- Keep Outlook / Microsoft 365 "Soon"; do not add XOAUTH2.
- Use existing IMAP preset registry and API contracts where possible:
  - `packages/connectors/src/imap-presets.ts`
  - `packages/shared/src/connectors-api.ts`
  - existing `/api/connectors/imap/test` and `/api/connectors/imap/connect` routes if present on branch
- Proton must include paid-plan plus Bridge-running prerequisite copy.
- Preserve the authored `jds-*` / onboarding patterns. Do not introduce a new design system.
- Secrets never reach frontend logs, pg-boss payloads, exports, AI prompts, or docs.

## Likely Files

- `apps/web/src/onboarding/google-connector-step.tsx` — current onboarding provider picker.
- `apps/web/src/settings/settings-google-connect.tsx` and nearby settings connector panes — current settings connect flow.
- `apps/web/src/api/connectors-client.ts` — currently only feature grants; likely needs narrow IMAP test/connect client wrappers if absent.
- `packages/shared/src/connectors-api.ts` — IMAP request/result contract already exists.
- `tests/e2e/onboarding.spec.ts`, connector/settings e2e or unit tests as appropriate.

## Plan Requirements

- Start with a red test that proves the four IMAP providers are active and Outlook remains soon.
- Include a credential/test-connection path test if the implementation wires a form to `/api/connectors/imap/test` or `/api/connectors/imap/connect`.
- Explicitly state whether the diff remains UI/client-only. If it touches credential/auth/route behavior, keep `security` tier.
- Keep changes narrow; do not implement Outlook, new provider registry entries, migrations, or connector sync/send behavior.

## Gates

- Relevant focused tests first, then `pnpm format:check && pnpm lint && pnpm typecheck`.
- Run `pnpm verify:foundation` and `pnpm audit:release-hardening` before wrap-up unless the coordinator explicitly narrows the gate.
- Rebase on `origin/main` before push.

## Coordination Rules

- Work only in this worktree/branch. Commit green per task and stage only your files.
- Never touch `docs/coordination/`, project board status, milestones, or merges.
- Escalate plan ready, blockers, design forks, review-ready, and done to the `Coordinator` label.
- Caveman mode for coordinator status messages: terse, exact, full technical accuracy.
