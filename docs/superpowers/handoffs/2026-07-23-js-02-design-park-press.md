# JS-02 design handoff — résumé review artifact (pulled from Park Press)

Applies to task **#1233** (JS-02: résumé intake + critique). This is the visual contract for the
**résumé-review artifact** and the intake/confirm flow around it, pulled verbatim-in-intent from
Ben's own claude.ai/design project **"Jarvis — Park Press Design System"**
(`design_handoff_job_search_onboarding/JobsOnboarding.jsx`, `ui_kits/job-search-onboarding/`).
It **supersedes** the stale type language in the spec/plan and layers onto
`docs/superpowers/handoffs/2026-07-22-js-01-design-revision.md` (still authoritative for layout).

Build to this + the live `apps/web/src/styles/tokens.css`. Token vars only — no hex.

---

## ⚠ TYPE CORRECTION (the kit source uses retired tokens — remap on the way in)

The design kit was authored with a mono label style and kit-local token names. The live app retired
mono (2026-07-08) and uses different token names. **Do the mapping when you port; do not copy kit
token names verbatim.**

| Kit token / style        | Use in repo build                                            |
| ------------------------ | ----------------------------------------------------------- |
| `monoLabel`, `--font-mono` | `--font-sans` + `font-variant-numeric: tabular-nums`, uppercase, letter-spacing ~0.08em |
| `--font-text`            | `--font-sans`                                               |
| `--font-display`         | `--font-display` (already correct — Neue Haas/Helvetica)    |
| `--gold-hover`           | `--gold-strong`                                             |
| `--accent-ink`           | light text on forest — reuse the primary-button fg pattern (`--btn-primary-bg` is forest; its fg is the paper/oat light) |
| `--oat-lo`               | `--surface-2`                                               |
| `--surface-sunken`       | `--surface-2` (bridge `--bg-sunken`)                        |
| `--accent`               | `--accent` (= `--forest`) ✓                                 |
| `--gold`, `--amber`, `--ink`, `--ink-2`, `--ink-3`, `--surface`, `--line`, `--line-strong` | same names exist ✓ |

**NO serif** (sports nameplate only). **NO mono.** Verify every ported color/font resolves against
`tokens.css` and passes contrast in light + dark.

---

## The résumé-review artifact — visual grammar (authoritative)

From the kit's `CritiqueCard`. This is the honesty spine of the whole module: **cite only what the
résumé can back; flag everything else as "source before citing" — never invent a strength.**

- **Container:** dashed border in `color-mix(in srgb, var(--gold) 55%, transparent)`, radius 10,
  padding `16px 18px`, background `color-mix(in srgb, var(--gold) 4%, var(--surface))`.
  The gold-dashed frame = "draft / working copy", distinct from a solid approved card.
- **Eyebrow:** tabular-nums uppercase label, `--gold-strong`, e.g. `Read your résumé · draft`.
- **Summary line:** one honest paragraph, `--ink`, ~14px/1.55, `text-wrap: pretty`. States what was
  led with, tightened, cut — in Jarvis's voice ("I led with it, tightened your summary, cut two
  dated skills").
- **Two columns** (`grid-template-columns: 1fr 1fr`, gap 16):
  - **Left — "Strengths I'll cite":** header in `--accent` (forest). Bulleted list, **forest dots**
    (4px). Each = a verifiable strength. In the real build, each strength carries its `evidence`
    string and only renders if that evidence is present in source (structural truth-guard).
  - **Right — "I'd source before citing":** header in `--gold-strong`. Bulleted list, **amber dots**
    (`--amber`). Each = an unbacked claim / metric-without-evidence, quoted from the résumé.
- **Confirm control** (renders below the card, as a chat action — NOT a form): primary
  **"Looks right — use it"** (Check icon) + quiet **"Let's refine it"** (MessageSquare icon).
  Approve/"revise this" are **chat actions**, per plan Task 4. Refine keeps the working copy and
  says so; it does not block progress.

### ProfileAside "Resume" row states (the live-fill mirror)
- Before: `Not yet`.
- After read (draft): `Draft — 18/21 claims verifiable` (real build: actual verifiable/total count).
- After approve: `Approved · rev <shortRev>`.

### Plan's richer structure maps onto this same grammar
The plan (Task 4) asks for tracked-change **revisions** (forest-add / struck `--ink-3` removal),
strengths on **gold straps** citing evidence, and **gaps as amber "go-learn" chips**. Those are the
same three signals as the kit card — verifiable(forest) / changed / unbacked(amber) — just expanded:
- Revisions → tracked-changes list: additions in forest, removals struck in `--ink-3`.
- Strengths → gold-strapped rows, each showing its `evidence` quote.
- Gaps → amber chips ("go-learn"), each the quoted unbacked claim.
Keep the gold-dashed draft frame and the honest summary line as the shared container.

---

## Intake — three doors, no standalone dropzone

Per plan Task 2 + JS-01 layout: intake rides the **host chat attachment seam** (JS-00). The kit
shows a `resume`-kind control ("Drop your résumé, or browse") **inside the chat flow** — in the real
build the upload is the host composer's attachment, the worker reads the actor-scoped extracted
text. The three doors: **upload** (host attachment) · **paste** (chat text) · **build-from-
interview**. No separate full-width dropzone module; artifacts render inline in the embedded
two-column chat.

## Non-negotiables carried from spec/plan
- **Structural truth-guard:** after the single `generateStructured` critique call
  (`tierHint:"reasoning"`), drop any strength/revision whose `evidence` string is not literally
  present in the source résumé text. Model may not manufacture evidence.
- **Metadata-only job payloads:** the `job-search.resume-revise` queue carries `revisionId` only —
  never résumé content or prompts.
- **Provider-agnostic:** request the reasoning capability; the router picks the model.
- Manifest → v2 on this slice.

## Source of truth
Full kit (chips, straps, aside, sources) lives in the design project
`Jarvis — Park Press Design System` → `design_handoff_job_search_onboarding/JobsOnboarding.jsx`.
JS-02 needs only the résumé-review + intake/confirm portions above; chips/sources are JS-03/JS-04.
