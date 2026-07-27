# Job Search UI prototype — THROWAWAY

Delete this whole directory, plus the marked block in `apps/web/src/main.tsx`, once the layout
question is answered. Nothing here is production code: no tests, no persistence, no API calls,
no auth. All data is in `fake-data.ts`.

## Run it

```
pnpm dev:web
```

Then open `/prototype/job-search`. Switch variants with the floating bar at the bottom, or the
`?v=` search param: `?v=desk`, `?v=broadsheet`, `?v=console`, `?v=flow`.

**`?v=flow` is the answer.** The other three are the exploration that produced it; they are kept
only so the reasoning is reviewable, and they go away with the rest of this directory.

## The question it answers

Given the design we settled on — a coaching conversation that produces search profiles, a crawler
that finds postings, and a model that scores each one on two axes — **what should the screen
actually be?** Four postures, deliberately far apart rather than four shades of the same card
grid:

| Variant        | Posture                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| **Desk**       | The conversation is the page. Matches ride in a right-hand rail.                   |
| **Broadsheet** | A dated edition: lede story, printed rubric, briefs in columns. Chat slides in.    |
| **Console**    | Dense operator table. Sort each axis independently. Chat is docked, secondary.     |
| **Flow**       | **Picked.** Chat-only onboarding → Console once criteria exist. Chat = the drawer. |

## The verdict

Ben's read on the first three: Desk was appealing because it contained the conversation, not
because of its layout. Console is the right steady state. So:

- **Onboarding is a full chat interface.** A profile with no criteria has nothing to put in a
  table, so it shows no table — conversation, full width, plus a progress readout so the
  interview has a visible end.
- **Once the profile has criteria it is Console, permanently.** No mode flip and no continuum:
  the board is the profile view from then on.
- **Chat afterwards is the Jarvis drawer**, not a second in-page panel.

The one thing that needed resolving: the earlier ruling that a job-search thread must never
appear in the main drawer transcript. Resolution in this prototype — the drawer is the chat
_surface_. Opened inside a profile it carries that profile's thread (note the scope pill in its
header); opened anywhere else it carries the main one. Same chrome, same implementation,
separate transcripts. **Discuss** on a match opens the drawer with the posting already in it as a
record card, so nothing has to be re-typed.

## What to look at beyond the happy path

Every variant renders the states that will actually decide whether this is usable:

- **A profile with no criteria yet** (third tab, "Product Engineering") — the conversation has not
  produced anything to crawl.
- **A degraded portal with a structured cause** — LinkedIn 429 at page 8, 112 of ~190 retrieved,
  retrying in four hours. Never a bare "failed".
- **A disabled portal** — hit a login wall, so Jarvis stopped rather than sign in.
- **An unscored posting** — crawled and saved but the model queue backed up. Visible as pending,
  not silently missing.
- **A posting outside the stated frame** — the recall case the whole product exists for.

Two things hold across all four: the two axes are never collapsed into one number, and every
screen renders from records rather than from model prose.
