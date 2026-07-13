# #986 settings shell/navigation — halted for Codex handoff (Task 5 not started)

Per UX Coordinator mid-turn stop order: no more Claude edits/successors this lane. Tree is
**clean** — only Task 5 research done, zero code/test changes written.

Spec: `docs/superpowers/specs/2026-07-12-settings-shell-navigation-ia-hardening.md`
Plan: `docs/superpowers/plans/2026-07-12-settings-shell-navigation.md` (Task 5 = lines ~294-319)
Prior relay doc (still current, read first): `docs/superpowers/handoffs/2026-07-13-986-settings-shell-relay3.md`

## State

- Last commit: `3dd927b7` (Task 4, merge General into Account & preferences) + doc commit
  `45b671d9`. Nothing since.
- `git status --short`: only `.claude/context-meter.log` (auto-tracking, not feature work).
- No uncommitted edits to `settings-admin-panes.tsx`, `settings-page.tsx`, or any test file.

## Task 5 research already done (save yourself the re-read)

Merge `IdentityPane`'s registration `Group` into `PeoplePane`, delete `IdentityPane`:

- `PeoplePane` and `IdentityPane` are both in `apps/web/src/settings/settings-admin-panes.tsx`
  (849 lines — near the 1000-line file-size gate, watch it).
  - `PeoplePane` at line 345, returns `PaneHead` + (conditionally) "Pending approval" Group +
    "Members" Group + a closing `Note`.
  - `IdentityPane` at line 490 (`/* --- Identity & registration --- */` comment above), has one
    `Group title="Registration"` with two `Row`+`Switch` controls wired to `regQuery`
    (`getRegistrationSettings`) / `putMutation` (`putRegistrationSettings`), then a closing `Note`
    about auth provider config living in operator env setup.
  - Plan: add the Registration `Group` (with its own `useQuery`/`useMutation` hooks) as the
    **first** Group in `PeoplePane`'s return, before "Pending approval". Keep the Identity `Note`
    too (it's still relevant content) — plan doesn't say to drop it, just to relocate the Group.
  - Then delete the `IdentityPane` function entirely.
- **`Terminal` icon import is NOT dead after deletion** — verified via
  `grep -n "Terminal" apps/web/src/settings/settings-admin-panes.tsx`: used in `IdentityPane`'s
  Note (line 537) AND six times in `HostPane` (lines 659-722). **Do not delete the `Terminal`
  import** — this is the same "relay doc oversimplified the cleanup" trap Task 4 hit. `Terminal`
  stays.
- `getRegistrationSettings`/`putRegistrationSettings` are already imported in the shared
  top-of-file import block (used only by `IdentityPane` today) — no import changes needed, they
  just get consumed by `PeoplePane` instead.
- `settings-page.tsx` has 3 `IdentityPane` references to remove (confirmed via
  `grep -rn "IdentityPane" apps/web/src apps/web tests`):
  - line 63: `"identity"` in the `AdminSectionId` union — remove.
  - lines 109-111: the `lazyPane` const `IdentityPane` — remove.
  - line 142: `{ id: "identity", icon: Fingerprint, label: "Identity & registration", Pane: IdentityPane }`
    in `ADMIN_SECTIONS` — remove the row. Check if `Fingerprint` (icon import, line 12) is then
    unused elsewhere in the file before deleting that import — grep it, don't assume.
  - `grep -rn "IdentityPane" apps/web/src tests` must return zero when done.
- Test file `tests/unit/settings-admin-panes.test.tsx` currently imports `{ HostPane, IdentityPane }`
  (line 7) and has one `IdentityPane`-rendering test (lines 22-29, "hides sign-in methods...").
  That test's assertions (`Identity &amp; registration`, `Registration`, no `Sign-in methods`) need
  to move onto a `PeoplePane` render, seeded via `client.setQueryData` (pattern used throughout this
  file and in `tests/unit/settings-people-pane.test.tsx` — no `vi.mock`, just seed the cache before
  `renderToString`, since SSR is synchronous and the async `queryFn` never resolves before the
  string is returned). Needed query keys: `queryKeys.settings.adminUsers` (seed `{ users: [] }` to
  avoid "Loading people…") and `queryKeys.settings.registrationSettings` (seed
  `{ registrationEnabled, requiresApproval }` per `RegistrationSettingsDto`).
- Commit message per plan: `feat(settings): merge Identity registration into People & access` +
  `Co-Authored-By: Claude <noreply@anthropic.com>` trailer (swap trailer author if a Codex agent
  actually authors it) — explicit `git add` on the two touched files only.

## Then Tasks 6-10

Unchanged from `2026-07-13-986-settings-shell-relay3.md` — re-read that doc's "Then Tasks 6–10"
section, still accurate.
