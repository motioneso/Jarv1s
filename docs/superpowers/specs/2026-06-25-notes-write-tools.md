# Notes Create/Edit/Delete Assistant Tools

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s` notes source settings, notes ingestion/search module, and existing assistant action confirmation flow.

## 1. Decision

Jarv1s should be able to create and edit Markdown notes in the user's configured notes source.
Deleting a note must require explicit user approval.

Use the existing assistant tool/action system:

- `notes.create` is a write tool with `executionPolicy: "auto"`.
- `notes.edit` is a write tool with `executionPolicy: "auto"`.
- `notes.delete` is a destructive tool and therefore uses the existing Approve/Deny flow.

This keeps approval behavior in the existing gateway instead of adding a notes-specific confirmation
system.

## 2. Scope

The first version is filesystem-backed and limited to the user's linked notes source:

- Create a new `.md` note under the linked notes folder.
- Edit an existing `.md` note by exact-match replacement.
- Delete an existing `.md` note only after approval.
- Re-sync notes after successful create, edit, or delete so search catches up.

The linked notes source remains the source of truth. The memory index is a derived search cache.

## 3. Path Rules

Every operation must resolve paths through the same safety boundary as notes ingestion:

- Require a configured notes source preference.
- Require `JARVIS_NOTES_ROOTS`.
- Resolve the linked source path and requested file path.
- Reject paths outside the linked source.
- Reject paths outside allowed notes roots.
- Accept only Markdown files for this version.
- Do not follow symlinks to write or delete outside the allowed roots.

Tool input paths are relative to the linked notes source. Absolute paths are rejected at the tool
boundary.

## 4. Tool Behavior

### `notes.create`

Inputs:

- `path`: relative Markdown path, such as `ideas/new-note.md`
- `content`: full note content
- `overwrite`: optional boolean, default `false`

Behavior:

- Create parent directories as needed.
- Fail if the file already exists and `overwrite` is not true.
- Write UTF-8 text.
- Enqueue notes sync after success.

### `notes.edit`

Inputs:

- `path`: relative Markdown path
- `oldText`: exact text to replace
- `newText`: replacement text

Behavior:

- Read the existing file.
- Replace only when `oldText` appears exactly once.
- Fail when `oldText` is missing or appears multiple times.
- Enqueue notes sync after success.

This deliberately avoids freeform whole-file rewrites. Exact-match editing is easier to audit and
prevents broad accidental rewrites.

### `notes.delete`

Inputs:

- `path`: relative Markdown path

Behavior:

- Manifest risk is `destructive`.
- Gateway creates an assistant action request and waits for approval.
- After approval, delete the file.
- Enqueue notes sync after success.

The action summary should include the relative file path.

## 5. Permissions

Add module permissions:

- `notes.create`: create notes files.
- `notes.edit`: update notes files.
- `notes.delete`: delete notes files.

Existing module enablement and assistant tool availability rules apply. No admin bypass or cross-user
access is introduced.

## 6. User-Facing Copy

Settings should stop presenting notes as read-only once write tools exist.

Use copy that matches behavior:

- Jarv1s can create and edit notes in this folder.
- Deleting notes requires approval.
- The folder must be writable by the server process.

## 7. Non-Goals

- Browser local folder access.
- Rich note editor UI.
- Full-file rewrite tool.
- Moving or renaming notes.
- Writing non-Markdown files.
- Version history or trash recovery.
- Conflict resolution across multiple editors.

## 8. Verification

Minimum checks:

- Unit tests for path validation, create no-overwrite behavior, exact-match edit ambiguity, and delete.
- Gateway/tool tests proving create/edit auto-run while delete creates an approval request.
- A notes sync enqueue assertion after each successful mutation.
- Typecheck and focused unit tests.

Manual dev check:

- Link a writable notes source under `JARVIS_NOTES_ROOTS`.
- Ask Jarv1s to create a note.
- Ask Jarv1s to edit a unique sentence.
- Ask Jarv1s to delete the note and verify the approval prompt appears before deletion.
