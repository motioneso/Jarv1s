# Job Search mockup source (from Claude Design)

Verbatim copies of the job-search mockup from the **Jarvis — Park Press Design System** project in
Claude Design (`projectId 0501fab4-7c60-457d-9a46-b717d55e16c9`), pulled 2026-07-28.

They live in the repo for one reason: **build agents have no DesignSync tool.** Only the coordinator
session can reach Claude Design, so anything an agent needs to read has to be copied here first. Do
not edit these files to make them match the code — they are the target, the code is what moves.

## What is here, and what is missing

| Screen / file    | Status                | Source path                              |
| ---------------- | --------------------- | ---------------------------------------- |
| `kit.jsx`        | **have** (verbatim)   | `ui_kits/job-search/kit.jsx`              |
| `JobsProfile.jsx`| **have** (verbatim)   | `ui_kits/job-search/JobsProfile.jsx`      |
| `JobsModule.jsx` | **have** (verbatim)   | `ui_kits/jarvis-app/JobsModule.jsx`       |
| `JobsMonitors.jsx` | **have** (verbatim) | `ui_kits/job-search/JobsMonitors.jsx`     |
| `JobsMatches.jsx`  | **UNREADABLE**      | `ui_kits/job-search/JobsMatches.jsx`      |
| `JobsOverview.jsx` | **UNREADABLE**      | `ui_kits/job-search/JobsOverview.jsx`     |

`JobsMatches.jsx` (19.0KB) and `JobsOverview.jsx` (5.6KB) come back from DesignSync `get_file` as an
opaque content reference — `<<ccr:HASH,html,SIZE>>` — instead of file content. That marker is **not**
the file and carries none of its content. Retries return the same marker, so this is deterministic
per file, not transient, and it is not purely about size (5.6KB fails, ~6KB succeeds). The
`design_handoff_job_search_onboarding/module/*.jsx.txt` copies are byte-identical and hash the same,
so they are no help.

**Nobody may describe, summarise, paraphrase or build against those two screens.** Matches is the
board — the main screen — so any board work is currently building against an unread design. Say so
explicitly rather than inferring it from `kit.jsx`.

To unblock: have Claude Design write those two screens out under new paths, split into halves small
enough to come back as content (different content ⇒ different hash ⇒ a fresh fetch), then copy them
in here and delete this paragraph.

## Two translations always apply

1. **No mono.** The kit sets `var(--font-mono)` on every label. Jarv1s retired mono on 2026-07-08
   (see `CLAUDE.md`) — use `--font-sans` with `tabular-nums`, which is what the host's `jds-eyebrow`
   already does.
2. **No tokens in module CSS.** The mockup inlines `style={{}}` with raw `var(--token)` values. A
   module may not carry design tokens in its own stylesheet — `grep -c 'var(--'
   external-modules/job-search/src/web/styles.css` must stay **0**. Colour reaches the module only
   through host `jds-*` classes, and an invented `jds-*` class renders as nothing. Where the mockup
   puts colour somewhere the host has no class for, that is a real platform gap to report (the same
   seam as issue #1343), not licence to inline a token.

## Rules the mockup states outright

From `kit.jsx`, in its own words:

- "Keyline-grid only: hairline rules + committed fields, **no floating cards, no score badges, no
  confidence meters**."
- Fit "reads as a keyline rail plus a mono word — **never a colored score pill**." The bands are
  `strong` / `good` / `fair` / `weak`, coloured accent / steel / line-strong / line.
- Meta is "plain text in the row's meta line, **no outline pill**."
- Chips are "**2px radius per the system, no 999px pills outside dots/avatars**." Tones: neutral,
  gold, amber; `dashed` marks an inferred value.

From `JobsModule.jsx` — the module inside the app shell, which outranks the standalone harness:

- Tab order is **Matches, Overview, Profile, Monitors**, and the module opens on **Matches**.
- The active tab is ink-coloured with a **3px gold underline**, inset 12px each side. The host's
  `jds-tab` draws a 2px accent (forest) underline instead — a real difference, not a detail.
- Module content is capped at `max-width: 1080px`, centred.

Screen composition, consistent across `JobsProfile.jsx` and `JobsMonitors.jsx`:

- Hero: gold eyebrow → 44px uppercase display `h1` (weight 800, `-0.03em`, `line-height 0.92`) → a
  gold strap → a lede paragraph capped near `54–56ch` with `text-wrap: pretty`, and the screen's one
  primary action pushed to the right.
- A **3px solid ink rule** closes the hero.
- Below that, `SectionHead` — an uppercase label, a hairline that fills the remaining width, and an
  optional trailing meta on the right.
- Rows are a `3px 1fr` grid: the leading 3px column is a full-height rail (accent when live, `--line`
  when not), never a border on the row.
- Facts sit in `Field`s — an uppercase label over a value, hairline-ruled above — laid out in an
  even column grid.

The host has no class for the 44px uppercase display heading, so that is the third known gap
alongside gold eyebrows and the per-row fit rail.
