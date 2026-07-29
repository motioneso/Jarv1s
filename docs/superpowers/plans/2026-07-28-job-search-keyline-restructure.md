# Job Search — keyline-row restructure (Matches / Overview / Profile)

Plan for the UI restructure of the job-search module onto Claude Design's keyline-grid direction.
Branch `feat/job-search`, epic #1280. Written 2026-07-28.

**Scope stance:** UI only. Tasks K1–K5 add no handler, no tool, no migration, no wire field — every
screen is composed from reads that already exist. K6 is the one backend task and it is _optional and
last_; the Profile screen ships without it and gets richer with it.

---

## 1. Why this exists

The board is a list of floating cards. Claude Design's latest iteration moved past that, and its own
kit file states the direction verbatim:

> Keyline-grid only: hairline rules + committed fields, no floating cards, no score badges, no
> confidence meters.

Ben's standing complaint on the current build is "definitely bland still, not much info at all now".
The keyline grid is denser by construction: rules instead of card chrome buys back the vertical space
the cards were spending on borders and padding, and the freed space goes to facts.

## 2. Design source, and what could not be read

Read in full from the Claude Design project (`0501fab4-7c60-457d-9a46-b717d55e16c9`):

- `ui_kits/job-search/kit.jsx` — the shared presentational vocabulary.
- `ui_kits/jarvis-app/JobsModule.jsx` — the four-tab module shell.

**Not readable.** `JobsMatches.jsx`, `JobsOverview.jsx`, `JobsProfile.jsx` and `JobsMonitors.jsx` all
return opaque content references (`<<ccr:…>>`) through `DesignSync.get_file`, at every path including
the `.txt` mirrors — files above roughly 4 KB do not come back as content. **Nobody on this plan has
seen those four compositions.** The per-screen layouts below are therefore derived from the kit's
committed idioms plus the current implementation, not copied from a mockup. Do not claim mockup
fidelity for a screen in a commit message or a PR; say "built from the kit vocabulary".

### The kit's vocabulary (this is the design contract)

| Kit export              | What it is                                          | Host equivalent to use                       |
| ----------------------- | --------------------------------------------------- | -------------------------------------------- |
| `monoLabel` / `Eyebrow` | uppercase 10.5px tracked label                      | `jds-eyebrow`                                |
| `Strap`                 | 30×3px gold block                                   | `jds-strap`                                  |
| `SectionHead`           | label + flex hairline + trailing slot               | module layout + `jds-divider`                |
| `FitMark`               | keyline rail + a word, "never a colored score pill" | `jds-score` rail (see K2)                    |
| `Meta`                  | inline text meta, "no outline pill"                 | `jds-eyebrow` in `.jsm-meta` (already built) |
| `Field`                 | mono label over a value, hairline-ruled above       | `jds-fact` (host, already hairline-ruled)    |
| `Figure`                | display-font number, 300 weight, tabular-nums       | `jds-hero-figure`                            |
| `Chip`                  | flush 2px-radius chip, never a 999px pill           | `jds-chip` / `jds-badge--outline`            |
| `StatusDot`             | 7px dot                                             | `jds-indicator__dot`                         |

### Two deliberate deviations from the mockup — both already ruled, do not "fix" them

- **K-D1 — no blended fit band.** The kit's `FitMark` renders ONE word ("Strong fit"/"Good fit"/
  "Fair fit"/"Weak fit") from a single blended fit number. Fit and Want are two independent axes and
  are never blended (L9, structural in `domain/records.ts`). Adopt the _keyline rail_ treatment;
  keep two numbers. A single band would also read "Weak fit" on every row today, because Fit is null
  until a résumé is on file.
- **K-D2 — no mono.** The kit sets every label in `var(--font-mono)`. Mono was retired 2026-07-08.
  Every `monoLabel` maps onto the host's `.jds-eyebrow` (`--font-sans`, tracked caps). No module CSS
  may name a font.

## 3. Constraints every task inherits

1. **Module CSS is layout-only.** `grep -c 'var(--' src/web/styles.css` must stay **0**. No colour,
   no font, no border colour, no shadow. `currentColor` and `opacity` are allowed (existing
   precedent: `.jsm-card--outside`, `.jsm-meta__pill::before`).
2. **Therefore the module cannot draw a keyline.** A hairline is a colour. Use the host's:
   `jds-fact` (has `border-top: hairline` built in) or a `<div className="jds-divider" />` sibling —
   `settings.tsx`'s `PortalRowView` is the existing precedent for the sibling form.
3. **Never invent a `jds-*` class.** An invented one renders as nothing. The complete host list is in
   `apps/web/src/styles/*.css`; verify with `comm -23` before using any class not named in this plan.
4. **The 16 000-char render cap.** `matches.list` returns at most `MATCHES_LIST_MAX_LIMIT = 25` rows
   and the row is spending ~476 of a ~512-char budget. **No task here may add a field to
   `BoardMatch`.** Over the cap the board renders zero rows, not short ones.
5. **No ambient clock.** No `Intl.DateTimeFormat`, no `toLocale*`, no `new Date()` for display. Date
   formatting is string arithmetic — `formatPostedOn` in `board.tsx` is the pattern to copy.
6. **File-size gate: 1000 lines, CSS included.** `board.tsx` is at 697 and `styles.css` at 560. K2
   and K3 must extract rather than append; see each task for where.
7. **A write from the browser must go through a declared queue**, never `invokeTool` — a `risk:
"write"` tool 403s with `confirmation_required` before it executes. Reads go through `invokeTool`.
8. `.tsx` test files are **not** typechecked (#1335). A fixture missing a field fails at runtime
   only, and `pnpm typecheck` will say EXIT=0. Run the unit suites.

## 4. What data actually exists (the answer to "ideally just a UI change")

Every browser-callable read, and its full result shape:

| Tool                      | Returns                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `job-search.profile.list` | `profileId, name, state, briefingDetail, completedSteps[], readyToCrawl, surfaceKey`          |
| `job-search.matches.list` | ≤25 × `{id, title, company, fit, want, outsideFrame, state, url, location, source, postedAt}` |
| `job-search.match.get`    | one match, untruncated, `+ fitReason, wantReason`                                             |
| `job-search.portal.list`  | `sourceId, label, enabled, lastOkAt, cause{summary, nextAction, disabled, …}`                 |
| `job-search.resume.get`   | `version, content, updatedAt` (`null` when none)                                              |

**Overview needs nothing new** — it is entirely derived from those four reads.

**Profile is the gap.** No read tool returns `SearchCriteria` (titles, seniority, locations, remote,
compFloorCents, mustHave, niceToHave, dealbreakers, wantNarrative) or `contextSummary`, even though
`store.getProfile` already has both in hand. Without K6, Profile can only show _completeness_
(which of the five onboarding steps are done) — not _what you told it_. K4 ships that honest version;
K6 upgrades it.

**Counting honesty.** Every count on Overview is computed over the ≤25 rows `matches.list` returns,
which is also exactly what the board shows. Label them as board counts ("12 new on your board"),
never as totals. Do not add a count field to the wire to fix this — see constraint 4.

---

## 5. Tasks

Numbering is frozen. Never renumber; reject a renumbering finding on sight.

### K1 — Keyline primitives (foundation; everything else depends on it)

**Files:** `src/web/keyline.tsx` (new, ~90 lines), `src/web/styles.css`.

Build the four presentational helpers the other tasks share. Presentational only — no fetching, no
state, no `invokeTool`.

- `<KeyRow>` — one hairline-ruled row. Renders a `jds-divider` sibling above itself when `divided`,
  then a `.jsm-krow` flex container. This is the atom the Matches list and both new screens are made
  of. It replaces `.jsm-card` everywhere.
- `<FitRail value label>` — the kit's `FitMark` treatment under deviation K-D1: a `jds-score` rail
  plus the number, with `jds-eyebrow` for the axis name. `null` renders the rail empty and the value
  as `—`; it must never render `0`. Reuse `Score` from `src/web/score.tsx` for the bar itself rather
  than drawing a second one.
- `<FieldPair label>` — the kit's `Field`: an eyebrow above a value, hairline-ruled above, on the
  host's `jds-fact`. Used by Overview and Profile for every stat.
- `<SectionHead>` — eyebrow, a `jds-divider` filling the remaining width, an optional trailing slot.

CSS: add `.jsm-krow`, `.jsm-krow__main`, `.jsm-krow__aside`, `.jsm-fields`, `.jsm-sechead`. Layout
only. Keep the existing `.jsm-meta` / `.jsm-meta__pill` rules — the meta line survives the
restructure unchanged.

**Tests** (`tests/unit/job-search-keyline.test.tsx`, new):

1. `FitRail` with `value={null}` renders no digit anywhere in its subtree — specifically not `0`.
2. `FitRail` with `value={0}` renders a `0` and a zero-width fill (a real score of zero is a score).
3. `KeyRow` with `divided` renders exactly one `jds-divider`; without it, none.
4. `SectionHead` renders its trailing slot children.
5. `grep -c 'var(--' src/web/styles.css` is still 0 (assert in the existing CSS-contract test if one
   exists; otherwise add it here).

### K2 — Matches: cards → keyline rows

**Files:** `src/web/screens/board.tsx`, `src/web/styles.css`, `tests/unit/job-search-web-board.test.tsx`.

`board.tsx` is at 697/1000 lines. Extract the row component into `src/web/screens/match-row.tsx`
before adding to it. `board.tsx` already imports `inspector.tsx`, so anything both need goes in a
third file (`score.tsx` is the existing precedent).

Row anatomy, left to right, one `KeyRow` per match:

```
├─ title (jds-card-title button, opens inspector)   company
│  source · location · Posted Jul 15        ← .jsm-meta, unchanged from today
└─ FIT ▓▓▓▓▓░ 80   WANT ▓▓▓░░░ 70          Dismiss   ← right aside, tabular-nums
```

Changes:

- Delete `.jsm-card`, `.jsm-card__head`, `.jsm-card__axes`, `.jsm-card__axis`, `.jsm-card__value`,
  `.jsm-card__foot`, `.jsm-card__pending`, `.jsm-card--outside` from `styles.css` and every use.
  Removing dead vocabulary is part of this task, not a follow-up.
- `.jsm-list` becomes the rule-separated container: no gap between rows, `KeyRow divided={i > 0}`.
- Outside-frame rows keep their distinction, but as a `jds-badge--outline` chip in the meta line
  rather than a whole-row opacity change — a dimmed row reads as disabled, which it is not.
- Unscored rows keep the "Not read yet" sentence in place of the axes. Do not regress to two dashes.
- The hero (`.jsm-hero`) stays for now — it is the only thing telling the user a crawl is running.
  It gets its Overview counterpart in K3; do not delete it here.
- **Bucket tabs** (New / Saved / Passed) across the top of the list, counts on `jds-tab__count` —
  the host class already exists. Filtering is client-side over the ≤25 rows already fetched, so this
  costs no extra read. "Saved" maps to `state: "seen"`, "Passed" to `"dismissed"`.

**Tests** (extend the existing board suite):

1. An unscored row renders no element carrying the score-value class, and no `0`. (Today's
   `scoreBars).toEqual([])` assertion, retargeted at the new class name.)
2. A scored row renders both axis labels and both numbers.
3. Exactly `n-1` dividers render for `n` rows.
4. Bucket tab counts equal the number of rows in each state, and clicking a bucket filters the list.
5. No element in the tree carries a class matching `/^jsm-card/` — the old vocabulary is gone.
6. The meta line still renders source, location and the formatted posted date (existing test, must
   not regress).

### K3 — Overview screen (new)

**Files:** `src/web/screens/overview.tsx` (new), `styles.css`, `tests/unit/job-search-overview.test.tsx` (new).

Answers "what is this search doing for me". Composed from reads that already exist: `matches.list`
(the board's own 25, fetched once and shared — do not fetch twice), `portal.list`, `profile.list`
(passed down as the `Profile` prop, already in hand), `resume.get`.

Sections, top to bottom:

1. **Figures row** — four `FieldPair`s using `jds-hero-figure` for the number: _On your board_
   (row count), _Read and scored_ (rows with a non-null want), _New_ (state `new`), _Passed_
   (state `dismissed`). Label them as board counts, per §4.
2. **Where it's looking** — one `KeyRow` per portal from `portal.list`: label, a `jds-indicator__dot`
   for enabled, and `lastOkAt` rendered by the same string-arithmetic date helper as the row
   (hoist `formatPostedOn` out of `board.tsx` into `keyline.tsx` so there is one). A portal with a
   `cause` renders `cause.summary` + `cause.nextAction` verbatim — never a sentence this screen
   composes.
3. **What's missing** — the honest blocker list, and the reason this screen earns its place:
   - no résumé on file → "Fit stays empty until there is one" + point at chat;
   - `readyToCrawl === false` → name the incomplete steps from `completedSteps`;
   - every portal disabled → say so.
     Render nothing at all when nothing is missing. An empty "all good" panel is filler.

No new tool. No new wire field.

**Tests:**

1. Figures equal the fixture's counts; a fixture with zero matches renders `0`, not a blank.
2. A portal with `cause.disabled` renders `cause.summary` and `cause.nextAction` verbatim, and no
   composed sentence of the screen's own.
3. `resume: null` renders the missing-résumé blocker; a résumé present renders no blocker.
4. With a résumé, `readyToCrawl: true` and portals enabled, the "What's missing" section does not
   render at all.
5. No `toLocale*` / `Intl` call in the file (grep assertion).

### K4 — Profile screen (new)

**Files:** `src/web/screens/profile.tsx` (new), `styles.css`, `tests/unit/job-search-profile.test.tsx` (new).

Answers "what does it know about me". **This is a move, not an invention** — the "About you" and
"Briefing detail" halves of `settings.tsx` come here; the "Job boards" half stays behind as Monitors
(K5). Do not leave a duplicate copy in `settings.tsx`.

Sections:

1. **Résumé** — `FieldPair`s: on file yes/no, version, saved-on (string arithmetic, **fix
   `settings.tsx:193`'s `toLocaleDateString()` while moving it**), length in characters. Read-only,
   with the existing explanation that chat is the write path — the manifest params vocabulary has no
   free-text type, so there is no queue that could carry a résumé.
2. **What it's looking for** — without K6 this is the five onboarding steps from `completedSteps`
   as a checked list (role / want / where / comp / sources) plus `readyToCrawl`. With K6 it becomes
   the actual criteria; write the section so the K6 upgrade is a data swap, not a rewrite.
3. **Briefing detail** — the existing `jds-segmented` control and its `profile-set-briefing-detail`
   queue write, moved verbatim. It already works; do not re-engineer it.

**Tests:**

1. The résumé date renders from a fixed ISO string with no locale dependence (assert the exact
   string, and that the file contains no `toLocale`).
2. `resume: null` renders the "None yet" state and no version number.
3. Every one of the five onboarding steps renders, marked from `completedSteps`.
4. Changing briefing detail calls `runQueue` with `job-search.profile-set-briefing-detail` and the
   selected level (existing settings test, moved).

### K5 — The four-tab shell

**Files:** `src/web/root.tsx`, `styles.css`, `tests/unit/job-search-root.test.tsx`.

`JobsModule.jsx` specifies four tabs — Matches / Overview / Profile / Monitors — with a 3px gold
underline on the active one and a 1080px max-width column. The host's `jds-tabs` / `jds-tab` already
draws exactly that (`aria-selected` carries the underline), so this is a rename and an extension of
`ActiveProfilePanel`'s existing two-tab switcher, not new chrome.

- `ActiveView` becomes `"matches" | "overview" | "profile" | "monitors"`. Default `"matches"`.
- `Board` → `Matches`. `Settings` → `Monitors`, rendering the trimmed `SettingsScreen` (job boards
  and custom sources only, after K4 takes the other two sections).
- `ProfileBar` (the search switcher + "New search") stays **above** the tabs and stays outside the
  branch — a search created from it starts `in_conversation`, and a switcher living inside the
  active-profile branch would vanish exactly when the user needs it. That reasoning is already in
  `root.tsx`'s comments; keep it.
- View state stays separate from profile selection: switching search must not reset the tab, and
  switching tab must not reset the search. Already true; hold it.
- **#1343 caveat:** module settings placement is a platform question with its own issue. Do not build
  a global header template here. Renaming this module's settings tab to "Monitors" is inside this
  plan; changing how any _other_ module reaches settings is not.

**Tests:**

1. All four tabs render for an `active` profile; `matches` is selected on mount.
2. Selecting each tab renders that screen and unmounts the previous one.
3. Switching profile preserves the selected tab; switching tab preserves the selected profile.
4. An `in_conversation` profile still renders onboarding and not the tab bar.

### K6 — OPTIONAL, LAST: `job-search.profile.get` read tool

Only after K1–K5 are green. Ben's ask was "ideally just a UI change" — this is the one place the UI
alone cannot answer its own question, and it is small.

**Files:** `src/worker/handlers/profile.ts`, `jarvis.module.json`, `src/worker/register.ts` (or
wherever handlers are registered), `src/web/screens/profile.tsx`, `tests/unit/job-search-profile-handler.test.ts`.

- `risk: "read"`, input `{profileId}` and nothing else (`requireNoUnknownKeys`), returns
  `{profileId, criteria: SearchCriteria, contextSummary}`.
- **One record, not 25** — this shape is exempt from the render-cap arithmetic, the same way
  `MatchDetail` is. State that in the handler comment so a later reader does not "helpfully"
  truncate it.
- `contextSummary` is model-written prose persisted to a record. It is rendered as text, never
  interpreted; it must not be concatenated into any prompt this screen builds (it isn't building
  one). Cap what the screen displays.
- K4's "What it's looking for" section switches from `completedSteps` to real criteria: titles,
  seniority and locations as `jds-chip`s, remote preference, comp floor formatted by integer
  arithmetic from `compFloorCents` (no `Intl.NumberFormat`), must-have / nice-to-have / dealbreakers
  as three chip groups, `wantNarrative` as prose.

**Tests:** unknown-key rejection; missing-profile behaviour matching the file's existing idiom;
exact-keys assertion on the returned shape; manifest conformance (the tool is declared, `risk:
"read"`, matching the literal the screen imports).

---

## 6. Sequencing and agents

K1 is the foundation and blocks everything. K2/K3/K4 are independent of each other once K1 lands.
K5 needs K4 (it renders the trimmed settings screen). K6 needs K4.

```
K1 ──┬── K2 (Matches)
     ├── K3 (Overview)
     └── K4 (Profile) ── K5 (shell) ── K6 (optional tool)
```

One Sonnet agent per task. K2/K3/K4 may run concurrently after K1 — they touch disjoint files except
`styles.css`, which every one of them appends to. **`styles.css` is the collision point:** each agent
appends its own block at the end of the file under a comment naming its task, and never reformats or
reorders anything above. K2 is the only task permitted to _delete_ from it.

## 7. Definition of done

- `pnpm typecheck` EXIT=0 — and remember it does not see `.tsx` tests.
- The job-search unit suites green, run explicitly (not inferred from a green typecheck).
- `pnpm exec prettier --check` clean on every touched file.
- File-size gate: no file over 1000 lines.
- `grep -c 'var(--' src/web/styles.css` → **0**.
- `grep -rn 'toLocale\|Intl\.' src/web/` → no hits.
- No class matching `/^jsm-card/` remains anywhere in `src/web/`.
- `pnpm build:external:job-search` succeeds; then `pnpm db:reconcile`, restart API, re-enable the
  module through the admin REST route, restart the worker — the deploy order matters.
- **Live-path proof.** This is a user-facing UI change, so CI-green is not done: install it on the
  dev instance, drive all four tabs through the real UI, and record the proof. Until then the honest
  status is _code-complete, unverified_.
