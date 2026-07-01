# Relay handoff — #656 sports module (r10 → r11)

**Continuation of a coordinated build.** Successor to `Build-656-sports-r10`. Same worktree, same
branch, under the Coordinator. Read this IN FULL, then resume via `coordinated-build`. Resume at
**Task 14**. r10 did investigation/design only — **zero files written**; you are implementing from
scratch using the design below (skip re-deriving it).

Run: `2026-06-30-rfa-fleet` · Issue: #656

## Coordinates

- **Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
- **Branch:** `coord/656-sports-module`, HEAD **`01feb958`** (do NOT branch off; keep committing here)
- **Bootstrap:** `[ -d node_modules ] || pnpm install` — exists now; you WILL need one sanctioned
  `pnpm install` after editing `packages/sports/package.json` (see Task 14 below).
- **Coordinator:** Herdr label **`Coordinator`** = pane `w1:p10` (as of this writing), session
  `019f1f70-fb27-7cb1-9ce0-2af0329763a8` (codex). Re-resolve by label each time; confirm EXACTLY ONE
  holds it before messaging.
- **Plan:** `docs/superpowers/plans/2026-07-01-sports-module.md` — Task 14 at L1324, Task 15 at L1364.

## r10's two corrections to the r9 handoff (verified by reading code, not assumed)

The r10 (prior) handoff claimed "no package exports entry needed" — **this is wrong**. Verified by
reading `packages/settings-ui/src/scanner.ts` (generates
`lazy(() => import("${pkg.name}/${entry}"))`, i.e. `import("@jarv1s/sports/settings")`) and by
grepping `packages/{wellness,tasks,calendar}/package.json`, which ALL declare
`"exports": {..., "./settings": "./src/settings/index.tsx"}`. `packages/sports/package.json` has no
such entry — add it, or the auto-mount import will fail to resolve at runtime.

Second: the new follow-picker CSS (`sports-2.css`) must be imported from
`apps/web/src/settings/settings-page.tsx` (which already imports `settings-panes.css`,
`settings-panes-2.css`, `settings-panes-3.css`), **not** from inside `packages/sports` — packages
never import their own CSS in this codebase (confirmed: no package settings pane imports a `.css`
file), and `settings-panes-2.css` is at 990/1000 lines with zero headroom for new classes.

## Task 14 — settings follow-picker pane (fully scoped; build this)

### 1. `packages/sports/package.json` — two edits, then install

Add to `exports`:

```json
"./settings": "./src/settings/index.tsx"
```

Add to `dependencies` (copy wellness's versions):

```json
"react": "^19.0.0",
"@tanstack/react-query": "^5.0.0",
"@jarv1s/settings-ui": "workspace:*"
```

Then run `pnpm install` (worktree-isolated, sanctioned — r9/r10 already flagged this to Coordinator).

### 2. `packages/sports/src/settings/index.tsx` — default export `SportsSettings`

Mirror `packages/wellness/src/settings/index.tsx` structure (local `requestJson`, same shape as
wellness's/calendar's — copy verbatim, don't reinvent) but **module isolation**: do NOT import
`apps/web/src/api/sports-client.ts` or `apps/web/src/sports/sports-parts.tsx` (Hard Invariant —
packages can't depend on apps/web). Write fully local fetchers and a local tiny
crest/initials renderer instead (a small intentional duplication of the idiom in
`apps/web/src/sports/sports-parts.tsx:6-31`, acceptable per module-isolation).

**Design (drafted, ready to type in):**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Group, Note, PaneHead } from "@jarv1s/settings-ui";
import type {
  CompetitionRef,
  CreateSportsFollowRequest,
  SportsCatalogResponse,
  SportsFollowDto,
  SportsFollowsResponse,
  TeamRef
} from "@jarv1s/shared";

const CATALOG_KEY = ["sports", "catalog"] as const;
const FOLLOWS_KEY = ["sports", "follows"] as const;

async function requestJson<T>(path: string, init?: RequestInit & { body?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "include",
    headers
  });
  if (!response.ok) throw new Error(response.statusText || "Request failed");
  return (await response.json()) as T;
}

function getCatalog() {
  return requestJson<SportsCatalogResponse>("/api/sports/catalog");
}
function getFollows() {
  return requestJson<SportsFollowsResponse>("/api/sports/follows");
}
function createFollow(body: CreateSportsFollowRequest) {
  return requestJson<{ follow: SportsFollowDto }>("/api/sports/follows", { method: "POST", body });
}
function deleteFollow(id: string) {
  return requestJson<{ ok: boolean }>(`/api/sports/follows/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

function initials(name: string, shortName?: string | null): string {
  if (shortName && shortName.trim().length > 0) return shortName.slice(0, 3).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? name;
  const last = parts[parts.length - 1] ?? name;
  const letters = parts.length >= 2 ? (first[0] ?? "") + (last[0] ?? "") : name.slice(0, 2);
  return letters.toUpperCase();
}

function PickCrest(props: { name: string; shortName?: string | null; crestUrl?: string | null }) {
  if (props.crestUrl) {
    return (
      <span className="sp-pickcrest">
        <img src={props.crestUrl} alt="" width={22} height={22} />
      </span>
    );
  }
  return <span className="sp-pickcrest">{initials(props.name, props.shortName)}</span>;
}

// composite key: teamKey null (whole league) -> "" sentinel
function followKey(competitionKey: string, teamKey: string | null): string {
  return `${competitionKey}::${teamKey ?? ""}`;
}

function CompetitionGroup(props: {
  competition: CompetitionRef & { teams: readonly TeamRef[] };
  followsByKey: Map<string, SportsFollowDto>;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) {
  const { competition, followsByKey, onToggle, pending } = props;
  const wholeActive = followsByKey.has(followKey(competition.competitionKey, null));
  return (
    <Group
      title={
        <span className="sp-pickhead">
          {competition.label}
          {competition.marquee ? <Badge tone="pine">Marquee</Badge> : null}
        </span>
      }
    >
      <button
        type="button"
        className={`sp-whole${wholeActive ? " is-active" : ""}`}
        disabled={pending}
        onClick={() => onToggle(competition.competitionKey, null)}
      >
        <span className="sp-whole__lbl">Follow all of {competition.label}</span>
        <span className="sp-whole__state">{wholeActive ? "Following" : "Follow"}</span>
      </button>
      <div className="sp-teamgrid">
        {competition.teams.map((team) => {
          const active = followsByKey.has(followKey(competition.competitionKey, team.teamKey));
          return (
            <button
              key={team.teamKey}
              type="button"
              className={`sp-team${active ? " is-active" : ""}`}
              disabled={pending}
              onClick={() => onToggle(competition.competitionKey, team.teamKey)}
            >
              <PickCrest name={team.name} shortName={team.shortName} crestUrl={team.crestUrl} />
              <span className="sp-team__name">{team.shortName || team.name}</span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

export default function SportsSettings() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: CATALOG_KEY, queryFn: getCatalog });
  const followsQuery = useQuery({ queryKey: FOLLOWS_KEY, queryFn: getFollows });

  const invalidateFollows = () => void queryClient.invalidateQueries({ queryKey: FOLLOWS_KEY });
  const followMutation = useMutation({ mutationFn: createFollow, onSuccess: invalidateFollows });
  const unfollowMutation = useMutation({ mutationFn: deleteFollow, onSuccess: invalidateFollows });

  const followsByKey = new Map(
    (followsQuery.data?.follows ?? []).map((follow) => [
      followKey(follow.competitionKey, follow.teamKey),
      follow
    ])
  );
  const pending =
    catalogQuery.isLoading ||
    followsQuery.isLoading ||
    followMutation.isPending ||
    unfollowMutation.isPending;
  const error =
    catalogQuery.isError ||
    followsQuery.isError ||
    followMutation.isError ||
    unfollowMutation.isError;

  function toggle(competitionKey: string, teamKey: string | null) {
    const existing = followsByKey.get(followKey(competitionKey, teamKey));
    if (existing) unfollowMutation.mutate(existing.id);
    else followMutation.mutate({ competitionKey, teamKey });
  }

  return (
    <>
      <PaneHead
        title="Sports"
        desc="Follow competitions or teams to see them on your Sports page and in briefings."
      />
      {(catalogQuery.data?.competitions ?? []).map((competition) => (
        <CompetitionGroup
          key={competition.competitionKey}
          competition={competition}
          followsByKey={followsByKey}
          onToggle={toggle}
          pending={pending}
        />
      ))}
      {error ? <Note>Could not load or save sports follows. Try again.</Note> : null}
    </>
  );
}
```

Verify against `packages/shared/src/sports-api.ts` field names before typing in (this was read in
full by r10 — `TeamRef{teamKey,competitionKey,name,shortName,crestUrl}`,
`CompetitionRef{competitionKey,label,kind,marquee}`,
`SportsFollowDto{id,competitionKey,teamKey:string|null,createdAt}`). `Group`'s `title` prop accepting
a `ReactNode` (not just string) needs a quick check against `packages/settings-ui/src/index.tsx` —
if it's typed `string`-only, render the Badge as a sibling row instead (e.g. `Group` title = plain
string, put the marquee `Badge` inline next to the whole-league button label).

### 3. `apps/web/src/styles/sports-2.css` — new file, `sp-*` prefix, tokens only

```css
/* Sports settings follow-picker (packages/sports/src/settings/index.tsx). Separate file from
   sports-1.css purely for the 1000-line file-size gate (sports-1.css has no headroom); imported
   by the settings shell since packages don't import their own CSS. */

.sp-pickhead {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sp-whole {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 9px 12px;
  margin-bottom: 10px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: var(--transition-control);
}
.sp-whole:hover {
  background: var(--surface-2);
}
.sp-whole.is-active {
  background: var(--pine-soft);
  border-color: var(--pine-soft-2);
}
.sp-whole__lbl {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.sp-whole.is-active .sp-whole__lbl {
  color: var(--pine-ink);
}
.sp-whole__state {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.sp-whole.is-active .sp-whole__state {
  color: var(--pine-ink);
}

.sp-teamgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.sp-team {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 7px 10px;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  transition: var(--transition-control);
  text-align: left;
}
.sp-team:hover {
  background: var(--surface-2);
}
.sp-team.is-active {
  background: var(--pine-soft);
  border-color: var(--pine-soft-2);
  color: var(--pine-ink);
}
.sp-team:disabled,
.sp-whole:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.sp-team__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-pickcrest {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: -0.01em;
  background: var(--surface-2);
  color: var(--text-subtle);
}
.sp-pickcrest img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

Confirm every token name against `apps/web/src/styles/tokens.css` before committing (r10 catalogued
these as in-use elsewhere in sports-1.css/settings-panes CSS, but verify, don't assume).

Then add one import line in `apps/web/src/settings/settings-page.tsx` next to the existing three:

```ts
import "../styles/sports-2.css";
```

### 4. `tests/unit/settings-sports-pane.test.tsx` — SSR convention (no RTL/jsdom in this repo)

Mirror `tests/unit/settings-people-pane.test.tsx` exactly (read in full by r10 — uses `createElement`

- `renderToString` + `QueryClientProvider`, primes via `client.setQueryData`, asserts via
  `html.toContain`). Import path: `../../packages/sports/src/settings/index.js` (relative, `.js`
  extension per this repo's ESM import convention — the root vitest config aliases react/
  react-query/@jarv1s/settings-ui already, verified in `vitest.config.ts`, so no new alias needed).

```tsx
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import SportsSettings from "../../packages/sports/src/settings/index.js";

const CATALOG_KEY = ["sports", "catalog"] as const;
const FOLLOWS_KEY = ["sports", "follows"] as const;

function renderWithQuery(client: QueryClient): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(SportsSettings))
  );
}

describe("SportsSettings", () => {
  it("renders competition labels and marquee tag on the World Cup", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "fifa.world",
          label: "FIFA World Cup",
          kind: "tournament",
          marquee: true,
          teams: [
            {
              teamKey: "team.bra",
              competitionKey: "fifa.world",
              name: "Brazil",
              shortName: "BRA",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("FIFA World Cup");
    expect(html).toContain("Marquee");
    expect(html).toContain("BRA");
  });

  it("marks a followed team active", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          teams: [
            {
              teamKey: "team.ars",
              competitionKey: "epl",
              name: "Arsenal",
              shortName: "ARS",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("is-active");
  });

  it("shows a whole-league follow button per competition", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          teams: []
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("Follow all of Premier League");
  });
});
```

Adjust exact assertions once the component is typed in and field names double-checked (this is a
draft to save re-derivation time, not a locked contract).

### Commit (explicit staging — never `git add -A`/`.`)

```
git add packages/sports/src/settings/ packages/sports/package.json pnpm-lock.yaml \
  tests/unit/settings-sports-pane.test.tsx apps/web/src/styles/sports-2.css \
  apps/web/src/settings/settings-page.tsx
```

Message: `feat(sports): settings follow-picker pane (auto-mounted via manifest)`. Mention in the
commit body or your Coordinator report that you corrected two stale premises from the r10/r9 handoff
(exports subpath was in fact required; CSS import lives in settings-page.tsx) — a parity fix, not an
architecture fork, so no escalation gate was needed per `coordinated-build` step ½.

## Task 15 — README ledger + full-gate close-out (plan L1364)

Create `packages/sports/README.md` listing the 6 loader-seams (grep-verify each
`// LOADER-SEAM(sports)` tag across the tree). Note accepted deviation (briefing-only chat-visible
tool, §4.8) + deferred fast-follows (§9). Then `pnpm verify:foundation` (full gate incl.
`foundation.test.ts` migration-list `toEqual` — sports migration row should already be present from
an earlier task; if red, add the row). Then `coordinated-wrap-up` (PR + report to Coordinator).
**Coordinator owns QA/merge/board — do not do those yourself.**

## Constraints (Ben + Coordinator, verbatim intent — KEEP)

- **Explicit staging only.** Never `git add -A`/`.`. **Do NOT stage** `.claude/context-meter.log`,
  `docs/coordination/…` copies, or `docs/superpowers/plans/2026-07-01-sports-task11-briefing-section.md`
  (untracked by design). This handoff doc IS an intentional commit (stage it with the doc-commit,
  same as r9/r10 did for their own handoffs).
- No repo-wide format (single-file `prettier --write` on your own new/edited files is fine). Single
  chat-visible tool `sports.followedFactsToday` — no new tools. RLS/DataContextDb/AccessContext
  untouched (`AccessContext = {actorUserId, requestId}`). Tests only in `tests/unit`+
  `tests/integration`. Raw CSS colors only in `tokens.css`; result colors NEVER red (not relevant to
  this pane's palette, but keep in mind if touching sports-1.css).
- Relay again at ~80–100k tokens / on any compaction summary — don't wait for a hard stop.

## First actions

1. Confirm branch `coord/656-sports-module`, HEAD `01feb958` or later (`git log --oneline -3`).
2. `coordinated-build` required recalls (state + frontend row).
3. Message Coordinator (`Coordinator` label, verify fresh via `herdr pane list`): "r11 driving,
   building Task 14 from r10's fully-scoped design (2 corrections to r9/r10 handoff noted); will add
   exports subpath + 3 deps to packages/sports + pnpm install (worktree-isolated, already flagged
   twice)." Then build Task 14 (type in the design above, run tests, commit) → Task 15.
