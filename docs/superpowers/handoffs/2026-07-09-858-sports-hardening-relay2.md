# Relay 2 — 858-sports-hardening (context 70%, no code written yet)

Same branch/worktree/coordinator as
`docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay.md` (read that one first for the
full issue #858 body + approved scope + exact fix list — not repeated here). This doc only adds
what I researched this round: **spec verified current on-branch, 858b design decided, test
patterns found. Still zero commits. Next action = write the plan doc, nothing else.**

## What I did this round (research only, no edits)

1. **Verified all 858a premises still hold on this branch** (line numbers match the first relay
   doc exactly): `packages/sports/src/web/sports-news.tsx` L159/175/209/316/358-368/395/403, and
   `packages/sports/src/sports-service.ts` L300/342/376-384/773-801. Nothing drifted. Proceed
   straight to planning — no re-scope needed.
2. **Located 858b** (`packages/datasets/src/host-pinning.ts`, `createHostPinnedFetch`, L129-167) and
   its only caller (`packages/datasets/src/client.ts:88`, `createDatasetClient`). No existing caller
   anywhere passes `RequestInit.signal` (grepped, zero hits) — no signal-merging complexity needed.
3. **Designed 858b:** add `timeoutMs = DEFAULT_FETCH_TIMEOUT_MS` (new export, value **15_000**,
   pick rationale: shared path used by every connector, not just fast ESPN JSON — 15s is generous
   enough for a slow-but-legit source while still bounding worst-case hold) as a 3rd param to
   `createHostPinnedFetch`. **One `AbortController` created ONCE per outer call, reused across every
   redirect hop** (not reset per-hop) — this is the key design choice: a slow multi-hop chain must
   not evade the deadline by having each individual hop resolve fast. `clearTimeout` in a `finally`.
   Thread it through `DatasetClientDeps.fetchTimeoutMs?: number` → `createDatasetClient` →
   `createHostPinnedFetch(source.fetchHosts, deps.fetchFn ?? fetch, deps.fetchTimeoutMs)`, mirroring
   the existing `maxEntriesPerSource` pattern in the same file (`client.ts:37-42`, `88`).
   Export `DEFAULT_FETCH_TIMEOUT_MS` from `packages/datasets/src/index.ts` (same pattern as
   `DEFAULT_STALE_RETENTION_MS`/`DEFAULT_MAX_ENTRIES_PER_SOURCE`, already there).
4. **Found existing test files/patterns to reuse (do NOT create new test infra):**
   - `tests/unit/dataset-host-pinning.test.ts` — existing `createHostPinnedFetch` suite, uses a
     `fakeFetch(responses)` helper returning a stubbed `typeof fetch`. Add timeout tests here as a
     new `describe("createHostPinnedFetch — fetch timeout (#858)")` block. New fake needed: a
     fetchFn that honors `init.signal` (rejects with `new DOMException("Aborted", "AbortError")` on
     abort, else resolves after a configurable delay via `setTimeout`) — none of the existing fakes
     do this, write it fresh in this file.
   - `tests/unit/dataset-client.test.ts` — `createDatasetClient` suite, uses `adapterFrom(fn)` where
     `fn` gets called directly (bypasses `ctx.fetchFn`/pinnedFetch entirely). To test
     `fetchTimeoutMs` threads through, write an adapter that actually calls
     `ctx.fetchFn(url, init)` with the hanging-fetch fake from above, then assert the envelope comes
     back `degraded: true` promptly (not hung) when `fetchTimeoutMs` is small.
   - `tests/unit/sports-service.test.ts` — exports `makeDatasetClient`, `makeSource`, `makeDeps`,
     `userA`, `side` (already imported by `sports-service-dedupe.test.ts` the same way — follow
     that precedent for a new `sports-service-url-keys.test.ts` file, or add `describe` blocks
     inline to `sports-service.test.ts`; either is fine, prefer inline unless it gets long).
     `SourceHeadline` fixture shape confirmed (id/url/competitionKey/competitionLabel/title/
     publishedAt/imageUrl/summary/teamKeys/sourceTeamIds) — see `nflHeadlines` at L206-218 for a
     minimal example, and the "ranks by editorial feed position" test at L530-575 for the
     multi-headline-array-with-listTeams-override pattern to copy for id-collision fixtures.
   - `tests/unit/sports-newsband.test.tsx` — `NewsBand` React tests via `renderToString` +
     `createElement`, tiny `headline()`/`group()` factory helpers (L9-26). This is the file to
     extend for the 858a web-layer majorIds/mosaicIds regression test.
5. **Designed the 858a web-layer regression test** (proves the id-collision bug is real, not just a
   style nit): in `NewsBand`, feed one league group with items in this order: item0 (no imageUrl,
   no summary — feedRank-0 bonus alone gives weight 2, `BIG_STORY_WEIGHT` is 4, so it never becomes
   `feature`), then 4 more items ALL with `imageUrl` set (weight 2 each, tied, stable-sort keeps
   insertion order since none reach weight 4). Give item1 `id: "dup"`, item2 `id: "b"`, item3
   `id: "dup"` again (DIFFERENT url from item1 — simulates the real ESPN cross-feed id collision),
   item4 `id: "d"`. `MAJORS_CAP = 2` (sports-news.tsx:234) picks item1+item2 into majors (first 2
   image-bearing in order). **Before the fix**, `majorIds` is a `Set` of `.id` = `{"dup","b"}`, so
   `flow = rest.filter(s => !majorIds.has(s.headline.id))` wrongly drops item3 too (same id "dup"
   as item1, even though it's a distinct story/url) — item3 vanishes from majors, standards, AND
   briefs. **After the fix** (`majorIds` keyed by `.url`), item3's distinct url survives into
   `flow`/standards. Assert via `renderToString` output `toContain`ing item3's distinctive `title`.

## Next steps for successor (unchanged target, just resume here)

1. `[ -d node_modules ] || pnpm install` (already present, skip).
2. Write the plan via `superpowers:writing-plans` →
   `docs/superpowers/plans/2026-07-09-858-sports-hardening.md`. Use the exact file paths, line
   numbers, and test designs captured above (both this doc and relay-doc-1) — no further research
   needed, go straight to authoring bite-sized TDD tasks. Suggested task order: 858b timeout
   (host-pinning.ts + its test file) → 858b threading (client.ts + dataset-client.test.ts) → 858a
   web-layer regression test + all 7 key swaps in sports-news.tsx (one task, they're mechanical and
   share one file) → 858a service-layer topStoryIds → feature-body splice → rankTopStories
   pickedIds→pickedUrls (3 small tasks or 1 combined, sports-service.ts, coordinator explicitly
   wants all 3 called out by line ref in the plan + PR body).
3. Message coordinator (label `Coordinator`, **resolve pane fresh by label+session id via
   `herdr pane list`, never a cached `…-N`**) with the plan path. **STOP and wait for approval
   before writing any code** — per `coordinated-build` step 1, this has NOT happened yet.
4. Build via `superpowers:test-driven-development` once approved. Commit each task green,
   `git add` explicit paths only (nothing else is dirty in this tree right now besides the
   auto-managed `.claude/context-meter.log`, which is not yours to add).
5. Pre-push trio (`format:check && lint && typecheck` + rebase on `origin/main`) before push.
6. `coordinated-wrap-up` — PR body must call out all 3 service-layer fixes with line refs, per
   coordinator's condition (see relay-doc-1's verbatim approval message).

## Bootstrap for successor (herdr-handoff)

Same worktree/branch. Bootstrap: "continue 858-sports-hardening; `[ -d node_modules ] ||
pnpm install`; read `docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay2.md` IN FULL
(and its predecessor `...-relay.md` if you need the original issue body/approval verbatim), then
resume via `coordinated-build` starting at 'Next steps for successor' step 2 — go straight to
writing the plan, all research is done."
