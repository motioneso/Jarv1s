# Job Search adapter fixtures (JS-04, #933)

Live captures from public, keyless job-board APIs, taken **2026-07-11** and trimmed to the
**first 3 jobs** of each response (`jq`). Content is public job-posting data kept verbatim so
normalization tests exercise real payload shapes (including Greenhouse's entity-escaped HTML
`content` field).

| File                    | Source URL                                                                      |
| ----------------------- | ------------------------------------------------------------------------------- |
| `greenhouse-board.json` | `https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true`           |
| `lever-postings.json`   | `https://api.lever.co/v0/postings/leverdemo?mode=json` (Lever's own demo board) |
| `ashby-job-board.json`  | `https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true`   |

Trimming: `jq '{jobs: [.jobs[0],.jobs[1],.jobs[2]]}'` for Greenhouse/Ashby,
`jq '[.[0],.[1],.[2]]'` for Lever (top-level array). No other edits — treat the bodies as
untrusted external content, exactly like production responses.

## Broad discovery fixture (JS-10, #1229)

Live capture from the keyless broad-discovery source, taken **2026-07-21**.

| File                   | Source URL                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `freehire-search.json` | `https://freehire.dev/api/v1/jobs/search?q=backend%20engineer&limit=3&offset=0&sort=posted_at&order=desc&countries=us` |

Trimming: `jq '{data: [.data[0],.data[1],.data[2]], meta}'` (envelope is `{data:[...], meta:{...}}`).
No other edits. Note the employer `url` carries `?utm_source=freehire.dev`; the freehire adapter
strips `utm_*` params so url-path identity converges with the board adapters' bare canonical URLs.
