# 707 Dead DB Row-Type Aliases — Implementation Plan

**Spec:** GitHub issue #707 · **Source:** `docs/audits/2026-07-02-dead-code-audit.md` §7 / Agent B (commit `9cc00803`, 2nd-pass CONFIRMED).
**Risk tier:** `routine` (handoff). No RLS, no migrations (types.ts is handwritten per audit), no AccessContext/DataContextDb impact — pure type-alias removal.

## Goal

Remove the 12 dead row-type aliases in `packages/db/src/types.ts`. Each is a `Selectable<…Table>` (or `JsonColumn` for `JsonObject`) alias with zero name-importers repo-wide; the corresponding `*Table` interfaces are live (used in the `Database` schema) and are untouched.

## Premise Verification (grounded on `coord/707-dead-db-aliases` = `origin/main` + untracked handoff)

Re-confirmed via `grep -rnE "\b<Alias>\b"` across all `*.ts`/`*.tsx`/`*.mts` (excluding `packages/db/src/types.ts`):

| #   | Alias                      | Line | Definition                                   | Consumers outside types.ts                                                                           |
| --- | -------------------------- | ---- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `MemberOnboarding`         | 923  | `Selectable<MemberOnboardingTable>`          | 0                                                                                                    |
| 2   | `NotificationRead`         | 935  | `Selectable<NotificationReadsTable>`         | 0                                                                                                    |
| 3   | `ConnectorAccount`         | 937  | `Selectable<ConnectorAccountsTable>`         | 0                                                                                                    |
| 4   | `ConnectorOauthPending`    | 938  | `Selectable<ConnectorOauthPendingTable>`     | 0                                                                                                    |
| 5   | `AiProviderConfig`         | 941  | `Selectable<AiProviderConfigsTable>`         | 0                                                                                                    |
| 6   | `AiConfiguredModel`        | 942  | `Selectable<AiConfiguredModelsTable>`        | 0                                                                                                    |
| 7   | `UsefulnessFeedbackTarget` | 950  | `Selectable<UsefulnessFeedbackTargetsTable>` | 0                                                                                                    |
| 8   | `Preference`               | 954  | `Selectable<PreferencesTable>`               | 0 (`\bPreference\b` standalone; `TaskPreferences`/`UserPreferences` are distinct tokens, unaffected) |
| 9   | `SportsFollow`             | 956  | `Selectable<SportsFollowsTable>`             | 0                                                                                                    |
| 10  | `ProactiveMonitorState`    | 961  | `Selectable<ProactiveMonitorStateTable>`     | 0                                                                                                    |
| 11  | `ProactiveCard`            | 962  | `Selectable<ProactiveCardsTable>`            | 0                                                                                                    |
| 12  | `JsonObject`               | 951  | `JsonColumn` (pointless alias)               | 0                                                                                                    |

**Barrel check:** `types.ts` is re-exported via `export * from "./types.js"` in `packages/db/src/index.ts`, so the aliases are nominally on the db package's public surface — but with zero name-importers anywhere (incl. tests, apps, all packages) they are dead per the audit's false-positive guard for barrel symbols. No drift from spec; all 12 present at cited lines.

## Files

- Modify: `packages/db/src/types.ts` (remove exactly 12 `export type` lines).

No other files touched. The corresponding `*Table` interfaces and the `Database` shape are preserved.

## Hard-Invariant Impact (CLAUDE.md L14-41)

None. No RLS, no `BYPASSRLS`, no `DataContextDb`/`VaultContext` signatures, no `AccessContext`, no migrations (types.ts is handwritten, not codegen), no provider/AI pinning, no module isolation boundary. Removing unreferenced type aliases cannot affect runtime.

## Task 1: Remove the 12 dead aliases

- [ ] **Step 1: Delete the 12 lines** from `packages/db/src/types.ts`: 923, 935, 937, 938, 941, 942, 950, 951, 954, 956, 961, 962. Keep all neighboring live aliases (`User`, `Share`, `Notification`, `Task`, etc.) and every `*Table` interface.
- [ ] **Step 2: Re-confirm zero new references** — `grep -rnE "\b(MemberOnboarding|NotificationRead|ConnectorAccount|ConnectorOauthPending|AiProviderConfig|AiConfiguredModel|UsefulnessFeedbackTarget|Preference|SportsFollow|ProactiveMonitorState|ProactiveCard|JsonObject)\b" --include=*.ts --include=*.tsx` returns only `019f…`-unrelated leftover matches (expected: none, since these were already zero-consumer).
- [ ] **Step 3: `git add packages/db/src/types.ts` only**, commit `chore(db): remove 12 dead row-type aliases (#707)` with `Co-Authored-By: Claude` trailer.

## Task 2: Verify gate

- [ ] **Step 1: typecheck** — `pnpm typecheck` (proves no consumer broke; expected green since all 12 were zero-importer).
- [ ] **Step 2: db package tests** — `pnpm --filter @jarv1s/db test` (covers generated/live type imports; the package has no codegen but its tests import types).
- [ ] **Step 3: lint + format** — `pnpm lint && pnpm format:check`.
- [ ] If any check red: STOP, escalate coordinator with exact command + exit code. Do not "fix" by re-adding aliases blindly.

## Exit Criteria

- 12 lines removed, no other file changed.
- `pnpm typecheck` green, `pnpm --filter @jarv1s/db test` green, `pnpm lint` + `pnpm format:check` green.
- Re-grep confirms zero residual name-importers of any removed alias.
- Single commit on `coord/707-dead-db-aliases`, tree clean, pushed after pre-push trio + rebase.
