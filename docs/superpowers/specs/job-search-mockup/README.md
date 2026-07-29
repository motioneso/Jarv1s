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
| `JobsMatches.jsx`  | **have** (verbatim) | `ui_kits/job-search/JobsMatches.jsx`      |
| `JobsOverview.jsx` | **have** (verbatim) | `ui_kits/job-search/JobsOverview.jsx`     |

All five are here. Two of them took a second route worth writing down.

### If DesignSync `get_file` returns `<<ccr:HASH,type,SIZE>>` instead of content

That marker is **not** the file and carries none of its text — treat the file as unread and never
describe or build against it. It is deterministic per file (retries return the same marker) and
content-hash-keyed, so copying the file to another path in the same project does not help. It is not
purely about size: 5.6KB was blocked while ~6KB came through.

Claude Design has a second door that does not have this problem — an MCP endpoint at
`https://api.anthropic.com/v1/design/mcp`, separate from the DesignSync tool. Its `read_file` takes
`offset`/`limit` line ranges, which DesignSync's `get_file` does not. Call it with the claude.ai
OAuth token from `~/.claude/.credentials.json` (`.claudeAiOauth.accessToken` — read it into a shell
variable, never print it) as a JSON-RPC `tools/call`. It requires the account-level
`agent_design_projects` consent, toggled by the user at `claude.ai/design/settings`; without it every
call returns `{"error":"needs_consent"}`. That consent is the user's to give — surface it, never
grant it on their behalf.

Responses are wrapped in an `<untrusted-project-content path=… etag=…>` tag with a trailing warning
line, and the body is HTML-entity-escaped (`&lt; &gt; &amp;`). Strip the first line, everything from
the closing tag onward, and decode the three entities.

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

## The board (`JobsMatches.jsx`) — the screen that matters most

- A match row is a `3px 1fr auto` **button**, hairline-ruled on top, hover-tinted `--oat-lo`. The
  leading 3px column is the **fit rail**, coloured by band. There are no cards.
- The row's right edge carries `FitMark` (the fit word) and a chevron — nothing else.
- Row content is two lines: title (20px display, 800) + company, then a meta line of
  location · comp · source · when, separated by **1px × 9px vertical hairline separators**, not
  bullets or slashes. A stale posting appends an amber `Stale` to that same line.
- Buckets are **New / Saved / Passed / Stale**, rendered as an uppercase nav with the count beside
  each label (gold when active) and a **3px gold underline** on the active one. `gap: 22`, no
  background, no pills. The count is part of the label, not a badge.
- Hero: gold eyebrow (weekday · date · "New today") → a **72px** display count baseline-aligned with
  a small accent-coloured "credible matches" label → gold strap → lede. The right column carries an
  accent `Card` for the next run plus a 2×2 `Field` grid of the overnight run's figures.
- Each bucket has its own empty-state sentence; they are written in Jarvis's voice and say what will
  put something there. Do not write a generic one.
- Detail view replaces the list (it is not a drawer): back link → eyebrow → 46px display title →
  a meta line, then a `1.35fr 1fr` split — the posting on the left, "Jarvis's read" on the right.
- The read is wrapped in `GovernorWrapper` until the user decides, and closes with a
  `Profile rev … · resume rev …` provenance line. Evidence, blockers, gaps, preference matches,
  preference conflicts and unknowns are each their own `Field`; amber marks the negative ones.
- The decision block sits under a **3px ink rule**, and the copy says decisions are confirmed in
  conversation.

## Overview (`JobsOverview.jsx`)

- Hero is a two-line **62px** display headline with the second line in `--accent`, over a
  `1.35fr 1fr` split whose right column is a "Readiness gates" list — label, status dot, status word.
- Setup checkpoints are `3px 1fr auto` rows; the rail is accent when done, **gold when current**,
  `--line` when still to do. The trailing column is one word: Done / Now / To do.
- Monitor health is a 2×2 `Field` grid of `Figure`s, closed by a status line.
