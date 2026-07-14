# Skills List-First Management and First Invocation (#994)

**Status:** approval-ready

**Issue:** #994

**Tier:** UX hardening; existing-contract repair

**Grounded against:** `origin/main` at `96d22ba0` on 2026-07-13

**Implementation plan:**
`docs/superpowers/plans/2026-07-13-994-skills-list-first-invocation.md`

## 1. Problem

The Skills pane currently leads with a large create/edit form, pushing the user's existing skills
below the fold. The invocation surface is visually unfinished and mouse-oriented: its CSS classes
have no matching styles, every option reports `aria-selected=false`, and Enter sends instead of
selecting an active suggestion. A stored name such as “Daily standup” is displayed as a command
with a space even though the bare slash parser stops at the first space.

The underlying #760 skill storage, upload, and single-turn instruction injection are already the
right contract. This slice makes that contract understandable and operable on first use without
creating another skill system.

## 2. Product Decisions

### 2.1 Existing skills come first

The Skills pane renders in this order:

1. pane title, concise explanation, and header actions;
2. the existing skills list or its empty state;
3. a focused create/edit or upload flow only when requested.

Header actions are **Create skill** and **Upload file**. **Create skill** opens the existing inline
form in create mode. Edit opens that same form populated for the selected record. Upload opens the
existing file-selection/import flow and its result. No modal, wizard, or reusable form framework is
introduced.

Each list row keeps its name, generated command, optional description, enabled state, Edit, and
confirmed Delete actions visible or readily reachable. The list remains the primary content after
create, edit, upload, cancel, or reload.

### 2.2 The form explains the single-turn contract

Rename **Body** to **Instructions**. Copy states that the instructions apply only to the invoked
turn and that the user's typed request is placed after them. Name and Instructions have visible and
programmatic required indicators. Description remains optional.

The form shows a read-only generated-command preview as the name changes. Save remains disabled
for blank required fields, while route validation independently enforces the same invariant.

### 2.3 One deterministic command name is derived, not persisted

Keep the existing stored `name`; do not add a `command`, slug column, migration, or DTO field.
Define one pure `skillCommandName(name)` helper and use it for list display, form preview,
autocomplete display/filtering, and typed bare-command resolution:

1. trim leading/trailing whitespace;
2. lowercase with JavaScript's locale-independent `toLowerCase()`;
3. replace each internal run of whitespace with one hyphen.

Example: `Daily   standup` becomes `/daily-standup`. Non-whitespace characters are otherwise
preserved so this UX hardening does not narrow the existing name contract. Route validation rejects
blank/whitespace names, so every accepted name produces a nonempty command.

Duplicate stored names and duplicate derived commands remain allowed. An autocomplete selection is
bound to its record ID. A manually typed command that matches more than one enabled record resolves
to the first match in the API's existing deterministic order; this preserves #760 behavior rather
than inventing a conflict-management system.

### 2.4 Invocation is compact, keyboard-complete, and accessible

When the composer contains only a leading slash query and no skill is already bound:

- enabled matches appear in a compact popover styled with existing chat tokens;
- filtering matches the derived command name and may also match the human-readable stored name;
- the first match is active when the menu opens;
- ArrowDown/ArrowUp move the active option and wrap at the ends;
- Enter selects the active option and does not send while the menu is open;
- Escape closes the menu for the current text;
- pointer selection remains available;
- ordinary Enter sends when autocomplete is not active.

Each option has a stable DOM id and truthful `aria-selected`. The textarea exposes the appropriate
combobox/listbox relationship and active descendant while the menu is open. Command is the primary
line; description is secondary. Disabled skills never appear or resolve.

Selecting a skill continues to bind its record ID. On send, the existing composition path submits:

```text
<skill instructions>

<user's typed request>
```

The instructions apply to that turn only. They do not rewrite the persona or persist as global
instructions.

### 2.5 Server validation is a real boundary

Create, update, and import reject a blank/whitespace `name` or `body`/Instructions with a clear 400
response. Validation occurs before repository writes, so invalid requests cannot create or mutate a
row. Keep the existing endpoints, request/response DTO fields, standard frontmatter-plus-markdown
upload format, 256 KB import cap, and byte-preserving valid import behavior.

## 3. Existing-Contract Reconciliation

- `app.chat_skills`, owner-only RLS, repository ordering, duplicate-name allowance, and the current
  REST endpoints remain unchanged.
- `apps/web/src/settings/settings-skills-pane.tsx` remains the management owner and reuses its one
  create/edit form and existing mutations.
- `packages/chat/src/skills/routes.ts` and `frontmatter.ts` remain the route/import boundary.
- `apps/web/src/chat/skill-autocomplete.tsx` remains the pure parsing/resolution and presentation
  seam; the derived-command helper belongs there unless moving it to an existing shared web helper
  is required to avoid a dependency cycle.
- `apps/web/src/chat/composer.tsx` remains the selection state and single-turn composition owner.
- `apps/web/src/styles/kit-chat.css` receives the missing `chatd-skillac*` styles beside the composer
  styles.
- No new package, route family, database table, marketplace, module runtime, sharing model, or skill
  file format is added.

## 4. Scope and Ownership Locks

Expected implementation ownership:

- `~/Jarv1s/apps/web/src/settings/settings-skills-pane.tsx`
- `~/Jarv1s/apps/web/src/chat/skill-autocomplete.tsx`
- `~/Jarv1s/apps/web/src/chat/composer.tsx`
- `~/Jarv1s/apps/web/src/styles/kit-chat.css`
- `~/Jarv1s/packages/chat/src/skills/routes.ts`
- `~/Jarv1s/packages/chat/src/skills/frontmatter.ts` only if import validation must be centralized
- focused tests named in the implementation plan

Collision boundaries:

- #760's DB/API/file/invocation contract is authoritative.
- Skills remain personal, chat-module-owned instruction records; no marketplace, sharing, remote
  install, tool capability, or module activation work belongs here.
- Evening-mode integration beyond already-shared Composer behavior is not required by this issue.
- `tests/uat/**` and `docs/coordination/**` are explicitly out of bounds.

## 5. Non-Goals

- A skill marketplace, discovery service, templates catalog, sharing, teams, or permissions UI.
- New storage fields, migrations, endpoints, file formats, URL import, or watched directories.
- A separate command editor, uniqueness requirement, rename migration, or conflict UI.
- Multi-skill composition, nested commands, command arguments grammar, or persistent skill context.
- Tool permissions, approval-policy changes, sandbox changes, or skill-specific execution runtime.
- Rich text/Markdown authoring, live instruction rendering, version history, or autosave.
- General composer/autocomplete framework work.

## 6. Acceptance Criteria

### Skills settings — desktop and narrow layouts

- Existing skills or the empty state render before any create/edit/upload form.
- Create skill and Upload file are clear header actions and open focused inline flows.
- Create and Edit reuse one form; Cancel returns to the list without mutation.
- Name and Instructions are marked required; Description is optional.
- Copy explains single-turn instructions and user-request ordering.
- The generated command preview follows the specified helper, including
  `Daily   standup` → `/daily-standup`.
- Create, edit, enable/disable, confirmed delete, and valid upload survive a reload.
- Invalid create/update/import with blank name or Instructions returns a clear error and writes
  nothing.
- A valid standard uploaded file preserves its frontmatter/body contract.
- List rows and focused flows remain usable without horizontal scrolling at the supported narrow
  settings width.

### Chat invocation — desktop and narrow layouts

- `/` opens a compact styled list of enabled skills; disabled skills are absent.
- Display, filtering, and typed resolution use the same generated command.
- Arrow keys move a visible active option, Enter selects it, and Escape closes the list.
- Enter sends normally when no autocomplete list is active.
- Pointer selection and explicit record-ID binding still work with duplicate names/commands.
- Options expose stable ids and truthful selection state; the textarea/listbox relationship is
  announced to assistive technology.
- The selected command remains visible as a removable bound skill, using the generated command.
- Sending composes Instructions, a blank line, then the typed request through the existing turn
  path; persona and later turns are unchanged.
- The popover and bound-skill treatment fit the narrow composer without clipping or horizontal
  page scroll.

## 7. Live-Path Proof

The builder records a sanitized end-to-end proof using the real settings and chat routes:

1. Create a skill, reload, and show it first in the list.
2. Invoke it with keyboard-only selection and confirm the submitted turn contains its Instructions
   followed by the typed request.
3. Disable it and confirm it disappears from autocomplete and no longer resolves; re-enable only if
   needed to continue the proof.
4. Delete it through confirmation and verify it remains absent after reload.
5. Upload a valid standard skill file and verify preserved content; upload a missing-body file and
   show the clear rejection with no created row.

## 8. Approval Gate

This specification is ready for Coordinator approval. Implementation may begin only after approval
of this spec and its paired plan; no product or architecture decision above is left open.
