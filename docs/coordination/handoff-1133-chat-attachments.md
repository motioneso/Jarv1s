# Checkpoint — #1133 chat attachments build (task issue #1154)

Worktree: `~/Jarv1s/.claude/worktrees/chat-attachments-1133`, branch `feat/1133-chat-attachments` (base origin/main 222c162f).
Plan (authoritative): `docs/superpowers/plans/2026-07-18-chat-attachments.md` (9 tasks). Spec: `docs/superpowers/specs/2026-07-18-chat-attachments-design.md`.

## Done (committed)

- Task 1 e7a9c713 — shared DTOs in `packages/shared/src/chat-api.ts`.
- Task 2 2f64dddf — vault byte helpers `readVaultFileBytes`/`writeVaultFileBytes` + tests.
- Task 3 987b0c3e — `ToolResultMedia` media pass-through (module-sdk → gateway → mcp-transport image block) + tests.

## In flight (Task 4, uncommitted)

- `packages/vault/src/vault-ops.ts` + index: new `deleteVaultDir` (refuses vault root, rm recursive force). NO test yet — add to `tests/integration/vault.test.ts` (~line 143 area).
- `packages/chat/src/attachments-service.ts` WRITTEN (full service: whitelist/sniff/caps, sanitizeFileName, ChatAttachmentUploadError, save/getMeta/markSent/readContent, lazy GC sweep, pdf-parse v2 `PDFParse` dynamic import).
- `packages/chat/package.json`: +`@jarv1s/vault workspace:*`, +`pdf-parse ^2.4.5`; lockfile updated.
- TODO: `tests/integration/chat-attachments-service.test.ts` (tmpdir vault base via `new VaultContextRunner(tmp)`, NO DB reset so vitest-direct works), run tests + `pnpm --filter @jarv1s/chat exec tsc --noEmit`, commit all Task 4 files.

## Remaining tasks (see plan for full detail)

5. Upload route POST /api/chat/attachments (octet-stream parser + `x-jarvis-mime-type`/`x-jarvis-file-name` headers — supersedes spec wording; permissionId `chat.message`).
6. Turn wiring: attachmentIds validate ≤5/UUID/exist → manifest via new `live/attachments-manifest.ts` → prompt-safety `attachments` tag → toolMetadata.attachments persist + serializeMessage readback → markSent.
7. `attachment-tool.ts` chat.readAttachment (manifest assistantTools, risk read, chat.view) + buildChatToolServices.chatAttachments.
8. Frontend: client.ts upload + sendChatTurn attachmentIds; `apps/web/src/chat/attachments.ts`; composer paperclip/paste/chips; chat-drawer threading (999/1000-line gate — extract message-row.tsx if over).
9. e2e `tests/e2e/chat-attachments.spec.ts` (#1000 harness), spec wording update, `pnpm verify:foundation` w/ exit code, push, PR "Part of #1133" closes #1154, poll VF green then manual merge (VF not required check).

## Traps

- DB-backed integration suites refuse direct vitest ("Refusing to reset the shared \"jarv1s\" database") — full run only via `pnpm test:integration`.
- Formatter hook rewrites files post-edit → "modified after read" notices are benign.
- node_modules reads denied; probe deps via `node -e`.
- foundation.test.ts asserts FULL migration list (no migrations in this feature — fine).
