# Relay — 858-sports-hardening (context 70%, no code written yet)

**Issue:** #858 (spec-exempt, tracked debt from Fable's #857 review). Full body already
fetched — see below. **Branch/worktree:** `build/858-sports-hardening`, this worktree, base
`14d28cbc` (post-#855, clean). `node_modules` already installed — do NOT re-run `pnpm install`.
**Coordinator label:** `Coordinator` (session `ebeadec3-21a7-46d3-8b12-81fab81e4d0e`) — resolve
pane fresh by label+session id each time, never a cached `…-N`.

## Status: scope APPROVED by coordinator. Next step = write the plan (superpowers:writing-plans),
message coordinator for plan approval, then TDD build. **No commits yet — nothing to lose.**

## Issue #858 body (verbatim, so you don't need to re-fetch)

> L1 — story `id` collisions can dedup/mis-key legitimately distinct stories. The gameday
> NewsBand now dedups by `url` (fixed in #857 M1), but React list keys and any remaining
> id-based caps still assume ESPN article ids are globally unique. They are not: the same
> story surfaces under different ids across league vs team feeds, and (rarely) different
> stories can collide. Audit every `key={...}` and id-based cap in the sports web + service
> layer; key on `url` (the stable cross-feed identity) or a composite. Impact: duplicate/dropped
> React children, key warnings; low severity (cosmetic + potential missed story), no security
> surface.
>
> L3 — shared datasets runtime has no per-fetch timeout. `createHostPinnedFetch` (and the
> dataset connector-SDK runtime it feeds) has no request timeout. Add an `AbortController`
> deadline to the shared fetch path; applies to all external sources, not just sports.
> Impact: tail-latency/resource-hold under a degraded upstream; not a correctness bug.

## Coordinator's approval message (verbatim)

> Scope APPROVED: include the 3 service-layer id->url cap fixes (topStoryIds, feature-body
> splice, rankTopStories pickedIds) in 858a alongside the web-layer key={} fixes + 858b timeout.
> Your audit satisfies the manifest condition — the ban was on double-fixing/re-keying what #855
> already restructured, and you verified these 3 are untouched by #855 at cited lines.
> Conditions: **mechanical key-swaps only** (no restructuring of the #855-landed
> followed-card/followed-groups split), **TDD per spot**, and **call out all 3 in the plan + PR
> body with line refs**. Proceed to plan.

## Full audit — exact fix list (verified against THIS branch, line numbers current)

### 858a — web-layer `key={}` fixes (id → url), `packages/sports/src/web/sports-news.tsx`
All confirmed still id-keyed on this branch (not touched by #855, which only touched
followed-card/ticker):
- L159 `<HeroSlide key={headline.id} .../>` → `key={headline.url}`
- L175 carousel dot `key={headline.id}` → `key={headline.url}`
- L209 `<li ... key={headline.id}>` (LatestColumn) → `key={headline.url}`
- L316 `key={\`${headline.id}-p${index}\`}` (FeatureArticle paragraphs) → `` key={`${headline.url}-p${index}`} ``
- L358-366 `majorIds`/`mosaicIds` Sets built from `s.headline.id` → rebuild from `.url`
  (also flip the `.has(s.headline.id)` / `.has(headline.id)` reads at L364, L366, L368, L395)
- L395 `<NewsArticle key={headline.id} .../>` → `key={headline.url}`, and `major={majorIds.has(headline.id)}` → `.has(headline.url)`
  once majorIds is url-keyed
- L403 `<li ... key={headline.id}>` (briefs) → `key={headline.url}`

Already-correct (leave alone, confirmed url-keyed): `sports-ticker.tsx:325,448` (`story.url`).
Game/team/follow-id keys elsewhere (`game.id`, `f.id` on `SportsFollowDto`, `entry.competitionKey`
etc.) are OUT OF SCOPE — issue is specifically about **story/headline** id collisions.

### 858a — service-layer id→url cap fixes (coordinator-approved), `packages/sports/src/sports-service.ts`
Mechanical swaps only, mirror the pattern already used at L294 (`followedStoryUrls`) and
L322-333 (hero-team merge, already url-keyed) — same file, same fix shape, just extend it:
1. **L300 `topStoryIds`** — `new Set(rankedTopStories.map((h) => h.id))`, consumed at **L342**
   (`.filter((h) => !topStoryIds.has(h.id))`) → rename to `topStoryUrls`, key/consume on `.url`.
2. **L376-384 feature-body splice** — `feature = selectFeature(...)`, then
   `h.id === feature.id ? { ...h, body: featureBody } : h` at **L384** → compare `h.url === feature.url`.
   (Leave the cache key `{ articleId: feature.id }` at L377 alone — that's a cache-key concern,
   not a React/list-identity concern, out of the issue's stated scope.)
3. **L773, L783, L785, L798, L801 `rankTopStories`'s `pickedIds`** — currently
   `new Set<string>()` of `.id`; tier-1 (L781-787) and tier-2 (L795-803) both check/add by
   `.id` → switch to `.url` throughout (rename `pickedIds` → `pickedUrls` for clarity).

Do NOT touch: `followed-card.ts` (`toTeamStories`, already url-deduped, confirmed L107-108,
L131-135), `followed-groups.ts`, or the L256-260 per-follow-team `seen`/`headlines` merge in
`sports-service.ts` (redundant-but-harmless — downstream `toTeamStories` already re-dedups by
url, so leave it; touching it would be the "double-fix" the coordinator's condition warned against).

### 858b — fetch timeout
Handoff doc's original note: `createHostPinnedFetch` (shared datasets fetch path, used by ALL
connectors) has no request timeout. Add an `AbortController` deadline. **NOT YET LOCATED on this
branch** — successor's first job: `grep -rn "createHostPinnedFetch" packages/` to find the
definition, read its current signature/callers, then design the timeout (pick a default deadline
sane for slow-but-legit sources; document the number and why in the plan, per the original
handoff's caution — this touches ALL connectors, not just sports).

## Next steps for successor

1. `[ -d node_modules ] || pnpm install` (should already exist, skip).
2. Re-run the required agentmemory recalls if desired (returned empty for me — fresh index, not
   a blocker).
3. Locate `createHostPinnedFetch` (858b) — only unfinished research item.
4. Write the plan via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-09-858-sports-hardening.md`,
   covering 858a (7 web-layer key swaps + 3 service-layer url-swaps, TDD per spot per
   coordinator's condition) and 858b (timeout, with chosen deadline + rationale).
5. Message coordinator (label `Coordinator`, resolve pane fresh) with the plan path — **STOP and
   wait for approval before writing code** (per `coordinated-build`).
6. Build via `superpowers:test-driven-development`, commit each task green, `git add` explicit
   paths only.
7. Pre-push trio (`format:check && lint && typecheck` + rebase on origin/main) before push.
8. `coordinated-wrap-up` — PR body must call out all 3 service-layer fixes with line refs per
   coordinator's condition.

## Bootstrap for successor (herdr-handoff)

Same worktree/branch. Bootstrap: "continue 858-sports-hardening; `[ -d node_modules ] ||
pnpm install`; read `docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay.md` IN FULL
and resume via `coordinated-build` starting at 'Next steps for successor' step 3."
