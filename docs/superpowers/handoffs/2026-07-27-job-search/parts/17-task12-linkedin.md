### Task 12: LinkedIn guest adapter

**Indeed is cut from v1 — do not write an adapter, a fixture, or a manifest host for it.** Probed
live on 2026-07-27: `GET https://www.indeed.com/jobs?q=…&l=…` returns **HTTP 403** with a 27 KB
`<title>Security Check - Indeed.com</title>` body carrying Cloudflare markers. It is not a
User-Agent or header problem — it wants a real browser, and v1 has none. Anyone revisiting this must
re-probe rather than trusting a stale note that says Indeed works. (JobSpy's
`apis.indeed.com/graphql` static-key path was never probed here; it is a research task, not a v1
task.)

That leaves LinkedIn guest as the second source, and it is the clean one: no auth, no key, no cookie.

**Depends on:** Task 11 (`Portal`, `FetchLike`, `statusToKind`, `PAGE_CAP`).

**Files**

- Create: `external-modules/job-search/src/adapters/linkedin.ts`
- Create: `tests/fixtures/job-search/linkedin-guest.html` (captured, trimmed to three cards)
- Test: `tests/unit/job-search-adapter-linkedin.test.ts`

**Contracts**

```ts
export const linkedinPortal: Portal;
```

**Probed shape**

`GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&start=0`
→ 200, ~28 KB of HTML fragment, 30 `base-card` entries per page. Pagination is the `start` offset.
Capture with the module's own User-Agent; trim to three cards; strip cookies, session ids and `trk=`
or other tracking parameters from extracted URLs. The fixture is committed — treat it as public.

**Constraints**

- Parse the fragment with a small tolerant extractor over `base-card` elements. The module bundle
  has no DOM dependency and must not gain one for this.
- The guest fragment does **not** carry the job description, so `body` is the card's snippet text.
  Task 8's triage therefore has less signal from this source than from freehire. Say so in a
  comment: it is a real asymmetry, not an oversight.
- Guest endpoint only. Honour `PAGE_CAP`, return partial results alongside a `FailureCause`, and use
  the same plain `Jarvis-JobSearch/0.1 (personal use)` User-Agent — no browser impersonation, no
  identity rotation.

**Tests** (`tests/unit/job-search-adapter-linkedin.test.ts`)

Mirror every freehire case against this fixture — map to `Posting`, `rate_limited` on 429 keeping
partials, `login_required` + disabled on 403, `parse_failed` on an unrecognised body, `PAGE_CAP`
respected, and **both deadline cases**. Declare the same `FAR_FUTURE` constant and pass it on every
non-deadline case; `deadlineAt` is required, so a call that omits it does not compile.

Plus the two that are the reason this adapter is not a copy:

1. **An auth-wall interstitial is `login_required` even though it returns 200.** LinkedIn answers
   200 with a sign-in page rather than 401. Asserts `kind === "login_required"` and
   `disabled === true`. Fails against a status-only mapping, which would classify the wall as
   `parse_failed` and retry it forever.
2. **Stops paging when a page comes back with no cards.** The guest endpoint reports no total and no
   next cursor — an empty fragment **is** the end-of-results signal. Asserts exactly two fetches, a
   null failure, and three postings. Fails against an implementation that walks `start` to
   `PAGE_CAP` every time and spends nine requests learning nothing.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-adapter-linkedin.test.ts   # exit 0
```

Then hit the live endpoint once by hand and confirm the parser survives the real shape. Fixtures
rot; that check is the whole reason `parse_failed` is a first-class cause.
