# People Notes as Source of Truth (#727)

**Status:** approved
**Issue:** #727
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

People & context is backed by structured APIs, but Ben's workflow uses a People folder in Notes.
Jarv1s should not maintain a separate source of truth that drifts from those notes.

## 2. Decisions

- The user explicitly selects/configures the People folder. Jarv1s may suggest likely folders, but
  does not auto-adopt one.
- For linked People, notes are the source of truth.
- Structured People records are projections/indexes of canonical People notes.
- One person maps to one canonical People note.
- Creating a person in the UI creates a People note.
- Editing a person in the UI writes the People note first, then refreshes the structured
  projection.
- Existing structured People records without notes are migrated through review, not silent batch
  note creation.
- Canonical People notes use Markdown with stable frontmatter for machine-safe fields and
  user-owned body text.
- Jarv1s only edits frontmatter and a clearly marked Jarv1s-managed section. Human-written
  sections are preserved.
- Archive notes; do not hard-delete notes from People UI.
- People sync runs automatically as part of notes sync once configured, plus manual refresh.
- Ambiguous external edits produce review candidates.
- Jarv1s updates to People notes use the shared `off | suggest | auto` automation mode.

## 3. Scope

- Add People folder configuration under Memory & context / People & context.
- Define canonical People note format:
  - frontmatter with `jarvisPersonId`, aliases, emails, phones, status, and other stable identity
    fields.
  - human-owned Markdown body.
  - optional delimited Jarv1s-managed context section.
- Build note-to-person projection/indexing from the configured folder.
- Write People UI create/edit/archive operations through VaultContext note operations first.
- Add review flow for:
  - existing People rows without notes.
  - ambiguous note edits.
  - proposed Jarv1s updates when mode is `suggest`.
- Preserve DataContextDb-only database access and VaultContext-only vault I/O.
- Keep job payloads metadata-only.

## 4. Non-Goals

- Treating structured People DB rows as canonical for linked People.
- Silent migration of all existing rows to notes.
- Hard-deleting user notes.
- Raw filesystem access.

## 5. Acceptance

- User can explicitly configure a People notes folder.
- Existing People notes seed/update structured People projections.
- Creating/editing a person in UI changes the canonical note and then the projection.
- Jarv1s-managed updates preserve user-written note content.
- Ambiguous edits surface review candidates.
- Archiving a person does not hard-delete the note.
- Tests cover 1:1 note/person projection, UI write-to-note path, and conflict/review behavior.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/settings/settings-people-pane.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-memory-pane.tsx`
- `~/Jarv1s/apps/web/src/api/people-client.ts`
- `~/Jarv1s/packages/people`
- `~/Jarv1s/packages/memory`
- `~/Jarv1s/packages/vault`
- `~/Jarv1s/packages/shared/*people*`

