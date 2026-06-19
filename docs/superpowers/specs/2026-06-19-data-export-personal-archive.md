# Spec — Data Export Personal Archive

**Status:** approved (Ben standing keep-moving directive + coordinator review, 2026-06-19). No open questions.
**Issue:** #238
**Tier:** sensitive

## Problem

Users need a way to export their personal data archive from the Jarv1s UI. Currently, exporting data requires an admin or operator to run `scripts/export-user-data.ts` on the server. To guarantee data portability, we need a self-serve mechanism that lets any user download a complete JSON representation of their data.

## Locked Decisions

- Add a self-serve endpoint `GET /api/settings/me/data-export` to stream/return the user's data as a downloadable JSON file.
- Reuse the existing data gathering logic in `scripts/export-user-data.ts` instead of rewriting it. The queries for fetching user tables, tasks, chat threads, connectors, and AI configurations are already written and verified.
- The exported JSON format remains identical to what the CLI script produces (`UserDataExport`).
- Refactor the core export functions out of the operator script and into a reusable package module (e.g., `packages/settings/src/data-export.ts`) so both the API and the CLI script can call the same underlying implementation.

## Contract / API shape

- **Endpoint:** `GET /api/settings/me/data-export`
- **Authentication:** Standard user session (requires authentication).
- **Behavior:**
  - Authenticates the user and retrieves their `userId`.
  - Calls the extracted `exportUserData` function.
  - Sets response headers to trigger a file download:
    - `Content-Type: application/json`
    - `Content-Disposition: attachment; filename="jarv1s-archive-<user_id>-<timestamp>.json"`
  - Returns the JSON payload.
- **Location:** Wire this route into `packages/settings/src/me-sessions-routes.ts` or a new `packages/settings/src/data-export-routes.ts` file, and register it in `packages/settings/src/manifest.ts`.

## Hard invariants honored

- **DataContextDb:** The export query logic will continue to rely on `DataContextRunner` or pass the `DataContextDb` correctly to respect request boundaries.
- **secrets-never-escape:** The existing script's queries (like `auth_accounts` and `ai_provider_configs`) safely omit secret values (only returning `hasAccessToken`, `hasSecret`, etc.). This invariant is preserved by reusing the script's `normalizeRow` and explicit column selection.
- **private-by-default & no admin RLS bypass:** The API endpoint implicitly restricts the export to the authenticated user's `userId` via session identity. A user cannot export another user's data.
- **module isolation:** While the export script natively breaks strict module isolation to gather all tables globally, it does so in an explicit, constrained "backup/export" context. Moving it to `packages/settings/src/data-export.ts` acknowledges this boundary exception for a specific cross-module capability.

## Verification

- **Integration test:** An authenticated user calls `GET /api/settings/me/data-export` and receives a 200 OK with `application/json` content type and a `Content-Disposition` header. The JSON body contains the expected `UserDataExport` schema.
- **Integration test:** Ensure the CLI script `pnpm export:user` still works and uses the extracted logic.
- **Unit/Sanity:** Ensure sensitive columns (passwords, plain text tokens) are not present in the API response.

## Acceptance Criteria

- A user can navigate to settings in the UI, click "Export my data", and immediately download a JSON file of their archive.
- The operator script `scripts/export-user-data.ts` continues to function.
- The `GET /api/settings/me/data-export` route correctly returns the current user's data without exposing another user's data.

## Out of Scope

- HTML or CSV formatting (JSON only for V1).
- Selective export (e.g., "only export tasks").
- Automatic scheduled exports.
- Direct integration with third-party storage providers (e.g., export to Google Drive).
- Data import functionality.
