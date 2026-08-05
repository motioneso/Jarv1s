---
name: design-system
description: The authored Jarv1s design language — jds-* primitives, tokens.css typography, and the audit that catches invented classes. Use before any UI, CSS, or component work — building or styling a page, section, or module UI, adding empty/loading states, or reviewing frontend changes.
---

# The authored design system

The design system is **authored, not generated**. Match the live
`apps/web/src/styles/tokens.css`; never invent a look per surface.

## Typography

- `--font-display` for headings, `--font-sans` for body.
- **No mono** (retired 2026-07-08). Eyebrows, labels and data use `--font-sans` with
  `tabular-nums`.
- **No serif** — the sports nameplate is the only exception.

## Primitives and colour

- Extend the `jds-*` primitives; don't build parallel one-off components.
- Before adding a variant/size/tone string to a `@jarv1s/ui` component, check
  `packages/ui/catalogue.json` (or the human-readable `packages/ui/OPTIONS.md`) for one that
  already covers it — both are generated from the components' own types by
  `pnpm build:ui-catalogue` and gated by `check:ui-catalogue`, so they're always current.
- Raw CSS colours belong in `tokens.css` alone — nowhere else, and never inside a module. Module
  CSS is layout-only by contract; if a primitive is missing, add it to `apps/web/src/styles/`,
  never work around it in the calling surface.
- Empty and loading states use the existing authored patterns — find one in the live app and
  match it.
- No curved accent left-border on cards or panels — it reads as an AI tell.

## The invented-class audit

A `jds-*` class the design system never defined still renders — as nothing, silently. Run this
before any UI design pass (adjust the first path to the surface you're auditing):

```bash
grep -rhoE "jds-[a-zA-Z0-9_-]+" <surface-src-dir> | sort -u > /tmp/used.txt
grep -rhoE "\.jds-[a-zA-Z0-9_-]+" apps/web/src/styles/ | sed 's/^\.//' | sort -u > /tmp/defined.txt
comm -23 /tmp/used.txt /tmp/defined.txt
```

Anything it prints is a defect, not a style opinion. Module-local class hooks fail the same way —
audit them against their own stylesheet too.
