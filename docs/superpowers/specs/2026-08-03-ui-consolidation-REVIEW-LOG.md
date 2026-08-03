# Plan Review Log: UI consolidation

Act 1 (grill) complete — spec locked with Ben on 2026-08-03, decisions D1–D8 in
`2026-08-03-ui-consolidation.md`. MAX_ROUNDS=5. Codex reviews read-only in the Herdr Codex tab.

Keep every finding here, including ones judged invalid, so nobody re-derives them.

## Round 1 — Codex

No `VERDICT:` line emitted; nine findings, treated as REVISE. Each was re-verified against the tree
before acceptance.

1. **Confinement "at the host injection point" is impossible as written.** The host hands the module a
   React root; the module itself creates the global `<style>` (`apps/web/src/external-modules/loader.ts`,
   `external-modules/finance/src/web/root.tsx:38`). Fix: module supplies CSS separately to a host-owned
   boundary; module-created `<style>` banned.
2. **Leaving the confinement mechanism undecided leaves foundation underspecified.** Prefixing and
   `@scope` cannot contain global at-rules; shadow DOM contains them but blocks the host stylesheet.
   Fix: lock the mechanism now with tests.
3. **Re-exporting `@jarv1s/ui` via the module SDK does not make it usable.** Finance builds with
   `jsxFactory: h`, no React, no SDK dependency. Fix: specify a JSX shim, build aliases, and a
   single-React-copy bundle assertion.
4. **Third-party modules cannot "get the components".** `@jarv1s/module-web-sdk` is `private: true`;
   `external-modules/` is not in `pnpm-workspace.yaml`. Fix: narrow the promise to in-repo modules.
5. **Moving `components-*.css` into `packages/ui` deletes the styles current screens depend on.**
   `apps/web/src/styles/index.css:10-11` imports them at a fixed cascade position. Fix: export one
   `@jarv1s/ui/styles.css` and swap both imports in place, same commit.
6. **The inventory is wrong.** `packages/settings-ui` already exports 8 primitives (Switch, Segmented,
   Badge, Avatar, Select, Group, Row, Field); `jds-btn--ghost` appears 8× outside finance, in settings.
   Fix: correct the table; treat those primitives as extraction candidates.
7. **The class gate cannot merge as ordered.** It reds the tree on day one, foundation promises no
   screen changes, and settings — the source of most violations — migrates last. Fix: foundation maps
   every undefined class to an approved class or a temporary compat definition.
8. **A class-set diff cannot see dynamically built names** (`jds-bubble--${row.role}`,
   `jds-drift--${drift}`). Fix: ban dynamic `jds-*` construction outside `packages/ui`.
9. **`check:ui-classes` does not enforce component use** — a valid hand-typed class still passes. Fix:
   per-section guard rejecting raw `jds-*` once that section migrates.

### Claude's response

Verified all nine against the working tree. Accepted 1, 3, 4, 5, 6, 7, 8, 9 as written.

**Finding 2 accepted, its fix rejected.** Shadow DOM is the one mechanism that defeats the epic's own
goal: it blocks the host `jds-*` stylesheet, so a confined module could no longer use our components —
the reason for the epic. Locked instead as **D9**: build-time selector prefixing by
`scripts/build-external-module.ts` plus a restricted CSS grammar (no `:root`, `html`, `body`, or
escaping at-rules). Modules keep the host cascade; only their own rules are confined.

**Finding 3 is real but cheaper than stated.** `loader.ts` already publishes React and ReactDOMClient
on `window.__JARVIS_MODULE_RUNTIME__` — finance opts out via `jsxFactory: h`. The shim seam exists; the
spec now names it rather than inventing one.

**Finding 8 is narrower than stated.** Most template literals carry a full literal class
(`jds-btn--secondary` inside the interpolation), so a literal scan does find them. Only suffix
interpolation is opaque. The ban is scoped to that shape.

Spec revised: D2 tightened, D3 narrowed to in-repo modules, D9 added, inventory table corrected,
foundation gains an undefined-class mapping step as its first task, guards restated.

## Round 2 — Codex

Model switched from `gpt-5.6-sol` to `gpt-5.6-luna` mid-round: sol hit its weekly quota and offered the
swap. The substantive round-1 critique came from sol; luna verified the response.

Findings 4, 5, 6, 7, 8, 9 confirmed addressed. Findings 1 and 3 partial. Finding 2 not safely
addressed, plus three new D9 problems.

- **1 (partial).** The CSS-string contract is stated, but the host API that receives, validates,
  installs and removes it is unspecified.
- **2 (not addressed).** Build-time prefixing cannot confine a module built outside the repo, yet D3
  claims every module is confined regardless of origin. Fix: host rejects or rewrites unprefixed CSS.
- **3 (partial).** Shim and aliases are named, but no export shape, alias target or runtime test.
- **New:** `build-external-module.ts` has no CSS stage and finance's CSS is a TypeScript template
  string, so "prefix every selector" is not implementable from the described build.
- **New:** rejecting `:root`/`html`/`body` is insufficient — `@media`, `@supports`, `@keyframes`,
  comma lists, pseudo-elements and nested rules all need defined transformation semantics.
- **New:** `ExternalWebContribution` still does not declare the CSS field or its lifecycle.

`VERDICT: REVISE`

### Claude's response

All accepted. Finding 2 is the one that mattered: it is an internal contradiction in the spec, not a
matter of taste — D3 promised origin-independent confinement while D9 delivered it only at our own
build. Resolved by moving enforcement to the host: it parses incoming CSS and rejects or rewrites any
rule not scoped to the module's own root, and the build-time transform is demoted to a convenience for
in-repo modules.

The other five are underspecification rather than error, and all land inside foundation, so the spec now
names the decisions instead of deferring them: the contract field and its install/dedupe/teardown
lifecycle, `textContent` over `innerHTML`, a real CSS parser rather than a regex, explicit grammar
semantics for the six cases a naive prefixer breaks, adversarial fixtures including a `@keyframes`
collision, and finance's produced bundle as the shim's acceptance test.

## Round 3 — Codex

All nine original findings confirmed addressed. D9's host-enforcement choice endorsed: "this is the
right architectural choice". Three residual details, which Codex itself classes as foundation
implementation criteria that the epic should still record because they decide whether D9 guarantees
anything:

- The scope root must be host-owned and unique — if a module can supply or duplicate
  `[data-module="…"]`, its rewritten selectors still reach another matching subtree or a portal.
- Namespacing `@keyframes` must rewrite every reference (`animation`, `animation-name`, shorthand,
  nested declarations), not just the at-rule name.
- The forbidden at-rule grammar is incomplete: `@import`, `@font-face`, `@property`, `@namespace`,
  `@page`, `@counter-style` and unscoped `@layer` all affect the document without a selector.

`VERDICT: REVISE`

### Claude's response

All three accepted verbatim and recorded under D9's transform bullet. The first is the only one that
changes existing code: finance sets its own `data-module="finance"`, so host ownership of the scope
root is a contract change, now noted as such.

## Round 4 — Codex

All nine findings addressed at epic level. Rejecting shadow DOM confirmed sound — host-side selector
confinement preserves access to the host JDS stylesheet while making origin irrelevant. The host-owned
scope root closes the duplicate-marker and portal escape. Parser requirements now cover selector lists,
nesting, pseudo selectors, keyframe declaration and use rewriting, and global at-rule categories.
Remaining choices (exact parser, alias implementation, host integration code, fixture structure) belong
in the foundation task. No material contradiction or missing epic-level acceptance criterion.

`VERDICT: APPROVED`

Converged in 4 of 5 rounds.

## Round 5 — Fable (second model, different lens)

Codex spent all four rounds on module-CSS confinement, so Fable was pointed at what nobody had
stress-tested: section ordering against live epics, whether the catalogue is actually usable, whether
build-against-demand yields a coherent API, and whether the guards survive contact with the tree.
Eight findings, `VERDICT: REVISE`. All re-verified here before acceptance.

1. **The Today surface is missing from the epic entirely.** 2,089 lines of CSS across five files plus 9
   TSX files (`today-page.tsx` alone is 900) — larger than the calendar pilot, and it is the front
   page. Notifications and the command palette were also unplaced. D1 claims the whole vocabulary is in
   scope; the section list silently dropped the most-seen surface. **Confirmed by direct count.**
2. **Foundation contradicts D7's own live-epic avoidance.** Settings and chat go last because #983 and
   #1238 are live in those files — but foundation's day-one mapping edits `settings-people-pane.tsx`,
   `settings-skills-pane.tsx` and `chat/assistant-surface/surface.tsx`, because that is where the
   undefined and interpolated classes live. **Confirmed.**
3. **Guard 2 reds the tree on day one** — the identical defect round-1 finding 7 fixed for guard 1, left
   unfixed for the interpolation ban. 9 sites exist, including `packages/settings-ui/src/index.tsx`,
   foundation's own extraction source. **Confirmed, count corrected from 7 to 9.**
4. **`check:ui-classes` has no defined CSS-definition scope.** Fable's cause was correct and my first
   rejection of it was wrong: `Jarvis Design System/components.css:124` really does define
   `.jds-badge--pine`, so a repo-wide glob counts one of the six as defined and the acceptance test
   silently weakens. I first reported the opposite because `rg` honours `.gitignore` and the design
   folder is gitignored (`.gitignore:33`) — both of my checks skipped the file without saying so.
   Re-verified with `rg --no-ignore --hidden`. That gap is also why the guard must **enumerate its
   files explicitly rather than glob a directory**: `fast-glob` sees the gitignored folder, `ripgrep`
   does not, so an unpinned implementation answers differently depending on which tool it reaches for.
   Two further reasons hold independently: `.claude/worktrees/` holds 13 full copies of the tree, and
   D4 makes the design folder generated _from_ `packages/ui`, which is circular.
5. **Inline styles evade every guard.** 36 files under `apps/web/src` use `style={{…}}`, 50 lines
   carrying a visual property; a class scan cannot see them and `check:design-tokens` reads CSS files.
   A migrated section could pass all five guards with hex colours in JSX. `ui/card.tsx` is named in the
   problem table but had no retirement owner. **Confirmed.**
6. **The catalogue repeats the failure the spec documents.** The registry shape carries file lists, not
   the option schemas the Goal promises, and nothing points an agent at the artifact — the exact
   position `_ds_manifest.json` is in, cited in the spec's own problem table. Staleness was the only
   acceptance criterion.
7. **Guards 4 and 5 — the only two enforcing the stated goal — had no test cases,** and the banned
   property list was unenumerated.
8. **D8 has no API-coherence mechanism.** Existing primitives already disagree (`Badge`/`tone`,
   `Indicator`/`status`) and invented classes name colours (`--pine`); per-section task issues plus
   visible-change-only review means option naming is reviewed by nobody.

### Claude's response

All eight accepted. Finding 4 I first accepted on a rationale that rejected Fable's cause; Fable's
re-review showed the cause was right and mine was the error, and the entry above now records that.
Findings 1, 2, 3 and 5 were material and none of them surfaced in four Codex rounds — Codex verified
the mechanism it had been arguing about and did not re-examine scope.

Spec revised: today added as a section and the order re-cut (9 task issues, not 8); D7's live-epic
rationale corrected to say foundation touches #983/#1238 files on day one by necessity and coordinates
those edits; guard 2 given guard 1's mapping-first treatment; the definition scope for guard 1 pinned to
`packages/ui` styles plus `apps/web/src/styles/`; a sixth guard added for inline visual properties;
`ui/card.tsx` retirement assigned to the calendar section; the catalogue extended with per-component
option schemas plus a `CLAUDE.md` consumption hook as a foundation deliverable; the banned-property
list enumerated including the four contested cases; failing-case tests required for guards 4–6; and a
one-page option vocabulary linted by `check:ui-catalogue`.

## Round 6 — Fable (re-review)

`VERDICT: APPROVED`. All eight findings confirmed addressed in the revised spec, with two corrections
that carry no design impact:

1. The wrong-cause paragraph for finding 4 was itself wrong. `Jarvis Design System/components.css:124`
   defines `.jds-badge--pine`. Delete the false claim from the spec and fix the log so nobody
   re-derives the wrong wrong-cause.
2. Three section numbers went stale when today was inserted: spec lines 152, 210 and 243 still
   referred to the pre-insert numbering.

### Claude's response

Both accepted and applied. Correction 1 verified independently before acceptance —
`rg -n --no-ignore --hidden` finds the definition, plain `rg` does not, because `.gitignore:33`
excludes the folder. The spec sentence was replaced with the corrected version, and strengthened: the
guard must enumerate its definition files rather than glob, since a Node/`fast-glob` scan and a
`ripgrep` scan disagree about a gitignored directory. Correction 2 applied as three line edits.

## Resolution

Converged. Codex: 4 rounds, 9 findings, `VERDICT: APPROVED` — one fix rejected with a logged reason
(shadow DOM), and Codex endorsed the alternative in round 3. Fable: 2 rounds, 8 findings,
`VERDICT: APPROVED`. Awaiting Ben's sign-off before any GitHub issue or code.
