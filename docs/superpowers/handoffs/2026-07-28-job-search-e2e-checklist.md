# Job Search — e2e checklist (2026-07-28)

Ten minutes. Written against `0f24a2bd`, deployed and confirmed live on the dev instance.

**What this is and isn't.** Every data claim below was verified over HTTP against the running dev
API. **No one has looked at the rendered UI yet** — that is exactly what this walkthrough is for.
So treat the expectations as "what the wire says should appear", not as observed behaviour. If the
screen disagrees with this document, the screen is the truth and the gap is a finding.

## Setup

- URL `http://192.168.50.36:5197`, sign in as `ben@ben.com`.
- Open **Job Search** from the left rail.
- Dev data as of this writing: 3 saved searches, 25 matches on "My job search", 2 job boards
  enabled (LinkedIn, freehire.me), both healthy, **no résumé uploaded**.

## 1. Masthead and search switcher

1. A masthead sits above everything: eyebrow + the module title, with a status on the right.
2. Status should read **Monitoring on** with a green dot — the active search is ready to crawl.
3. Below it, the search switcher should offer **three** searches, not one. Switch between them.

Known weak point, already flagged: the masthead title is smaller and lighter than the mockup's.
The design system has no uppercase display-heading class for a module to use, so this cannot be
fixed inside the module. It is a one-class host addition, same seam as issue #1343. Judge whether
it bothers you enough to do now.

## 2. Matches

4. Each result is a full-width keyline row, not a card and not a table.
5. Under the title and company there should be a meta line: **source · location · posted date** —
   e.g. `LinkedIn · Culver City, CA · Jul 24`. This was blank until `0f24a2bd`; all 25 rows now
   carry all three fields with no blanks.
6. **Fit will be empty on every row. That is expected, not a bug** — Fit is scored against a
   résumé and this profile has none. Want is scored and should be populated on all 25. Worth
   deciding: should the UI say why Fit is blank rather than just showing nothing?
7. Sorting: the sort arrows are literal `▲`/`▼` text characters, not a drawn chevron. Cosmetic,
   noted, not fixed.
8. Open a row. Detail should carry the reasoning prose that the list row deliberately omits.

## 3. Monitors

9. One row per job board with an accent rail, a status dot, and **Last success** as a date.
10. The summary line is computed live, not hardcoded — it should currently read along the lines of
    *2 enabled · all healthy*. Pause a board and it should recount.
11. **Run now** queues a crawl. It reports *Run queued*, not *finished* — the queue resolves on
    acceptance, so a queued state is correct behaviour, not a hang.
12. Each board shows exactly **one** fact (last success). The mockup shows four — schedule, last
    checked, found today. Those three have no storage anywhere in the schema, so showing them
    needs a migration plus crawl-side writes. Deliberately not faked.

## 4. Profile

13. Your actual criteria as chips: titles, seniority, locations, remote preference, pay floor,
    must-haves, nice-to-haves, dealbreakers — not a checkbox list.
14. Live values on this profile: titles *Senior Product Designer* / *Staff Product Designer*,
    seniority *senior* / *staff*, remote *no preference*, no locations, no pay floor, and no
    must/nice/dealbreaker entries. **The empty ones should render a graceful empty state, not a
    blank gap or a dash.** That is the main thing to look at here.
15. A prose line under "What I understand you're after" appears only when a summary exists. This
    profile's is currently null, so **the whole section should be absent** — if you see an empty
    heading, that is a finding.
16. The free-text want narrative should render as prose: *"Small product-led companies where
    design has real influence…"*

## What a failure looks like

- Blank meta line under a title → the manifest/handler drift regressed; check
  `jarvis.module.json`'s `matches.list` `outputSchema`.
- **Zero rows** rather than a short list → the render cap threw the whole result away. Payload is
  currently 9,136 chars against a 12,800 budget, so there is real headroom, but that is the
  failure mode to recognise.
- Module missing from the rail → it was rebuilt without being re-enabled. See the deploy recipe in
  `2026-07-28-job-search-keyline-handoff.md`; the re-enable step is mandatory after every build.
