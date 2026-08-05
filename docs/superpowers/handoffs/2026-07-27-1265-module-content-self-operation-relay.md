# Relay: issue #1265 module-content-self-operation

Branch/worktree: `1265-module-content-self-operation` (this worktree). No code changed yet, no
commits made. This is a pure research relay — successor starts at plan-writing.

Spec: `docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md` (read in full).
Related spec: `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`
(lines 25-74 — prompt-shaping rule).
Handoff doc (source of truth for scope): `coord-1262` worktree's
`docs/coordination/handoff-1265-module-content-self-operation.md` (read in full).

Coordinator: Herdr pane labeled `Coordinator`. Confirm exactly one via `herdr pane list` before
messaging (skill rule — never guess).

## Step ½ verification findings (spec-vs-branch, all confirmed by direct code read)

1. **News retrofit — spec section is STALE, matches handoff's own correction.** All 5 news write
   tools (`confirmSource`, `removeSource`, `addTopic`, `removeTopic`, `addExclusion`) in
   `packages/news/src/manifest.ts` already declare `actionFamilyId: "news_personalization"`,
   `risk: "write"`, `executionPolicy: "auto"`, `selfOperationGrant: "granted_at_install"`.
   `assistantActionFamilies` already has the `news_personalization` entry. Landed in #1263/#1268
   (commit `73e50847`, current HEAD). No code change needed here — just note in plan as verified-done.

2. **`news.addTopic` `guidance` field — real problem, needs a fix.** `guidance` (free text ≤1000
   chars) reaches two live AI prompts unvalidated against a closed set:
   `packages/news/src/discovery/policy-validation.ts` `validateTopic()` and
   `packages/news/src/compilation/rank.ts` `rankCandidates()` (confirmed live via
   `packages/news/src/compilation/compile.ts` lines 70-148). Both frame it as "UNTRUSTED DATA" +
   schema-constrained AI output, but per Spec 1's rule ("closed set AND constant template") this
   fails — untrusted framing alone isn't the same as a closed set. Spec 2 pre-authorizes the fix:
   drop `guidance` from `news.addTopic`'s tool-callable `inputSchema` (currently optional,
   `required: ["label"]` only — dropping it is a schema-only change, not a behavior removal for
   the REST/UI path, only for the assistant tool). **Recommend: drop it from the tool input
   schema in `packages/news/src/manifest.ts`; keep the REST/backend field as-is.** Flag this
   clearly in the plan since it changes a shipped tool's contract, even though pre-authorized.

3. **`news.previewSource` SSRF containment — verified adequate, no code change.**
   `packages/web-research/src/url-safety.ts` (`validateHttpUrl`/`isBlockedIp`, full `BlockList` of
   RFC1918/CGNAT/loopback/link-local incl. cloud metadata/documentation/reserved ranges, IPv6
   equivalents, blocks `localhost`/`*.localhost`) + `reader.ts` (`fetchWebResourceWithBody`:
   per-redirect-hop revalidation loop, HTTPS-only via `requireHttps`, DNS-rebinding protection via
   custom `lookup` override connecting to the pre-validated IP with correct TLS SNI). News's fetch
   port composition (`packages/module-registry/src/index.ts` `buildNewsDiscoveryPorts`) passes
   `requireHttps: true`. Conclusion: adequate as-is — write this up in the plan as a verified
   finding, no code change.

4. **Sports follow/unfollow — build required, extraction requirement confirmed real (not stale).**
   `packages/sports/src/routes.ts` `POST /api/sports/follows` and `DELETE /api/sports/follows/:id`
   call `repository.create`/`repository.remove` directly from the route handler — no service
   function wraps them. Need to extract a shared application/service function used by both the
   route and new assistant tools.
   - Existing file `packages/sports/src/sports-service.ts` (class `SportsService`, already
     constructed in `routes.ts` for reads via `SportsFollowsReader`) — **naming discrepancy**: spec
     prose says create `packages/sports/src/service.ts`; codebase already has `sports-service.ts`.
     Recommend extending `SportsService` (or its constructor deps) with `follow`/`unfollow` methods
     rather than creating a second, confusingly-named file — confirm this reasoning holds when
     rereading `sports-service.ts` in full (not yet read end-to-end this session).
   - `catalogEntry()` (`packages/sports/src/source/catalog.ts`) is the existing closed-set
     validator already used by the route for `competitionKey` — reuse it in the new tool the same
     way.
   - `packages/sports/src/manifest.ts` (read in full, 191 lines) has zero write tools today. Needs:
     new `sports.followTeam` / `sports.unfollowTeam` tool declarations +
     `assistantActionFamilies` entry. Naming convention check needed: existing family id is
     `news_personalization` (snake_case) — use `sports_follows` (snake_case), not the spec prose's
     `sports.follows` (dotted looks like a tool name, not a family id).
   - `permissions` array in the sports manifest already includes an entry covering create/delete of
     the actor's own follows — reuse, don't duplicate.
   - **Not yet fully confirmed:** whether `grantSelfOperationForModule` (generic install-time grant
     hook, called from `packages/settings/src/routes-modules.ts` `PATCH /api/admin/modules/:id`
     when re-enabling) is fully manifest-driven with zero sports-specific wiring needed. Read the
     call site; did not finish reading the hook's own implementation. **First thing to verify on
     resume** — grep for `grantSelfOperationForModule` definition and read it in full before
     planning the sports family declaration.
   - **Not yet confirmed:** whether `packages/ai/src/gateway/self-operation.ts`
     `isSelfOperationExcluded`'s exclusion-rule list (`matchingExclusionRule`, was mid-read around
     lines 184-291) could accidentally match a sports tool. Should be fine (sports isn't in any of
     Spec 1's excluded categories: self-authority/prompt-shaping/secrets/identity-auth) but wasn't
     positively verified against the full rule list — check this before finalizing tool names.

5. **`tests/unit/self-operation-manifests.test.ts` exact-count updates required.** Current (before
   sports tools): `grantedAtInstall.length` = 29, `confirmAlways.length` = 5, `userPromotable.length`
   = 4, sum = 38. Adding 2 sports tools as `granted_at_install` (matches news precedent — these are
   low-risk personal-list edits, not destructive) → `grantedAtInstall.length` should become 31,
   sum 40. **Exact numbers only — do not loosen to a range** (explicit handoff rule). This is the
   documented shared-surface collision with #1264 — note it in commit/PR body, don't silently fix
   without mentioning the collision.

## What's left (successor's task list, in order)

1. Read `grantSelfOperationForModule` implementation in full (`packages/settings/src/routes-modules.ts`,
   grep for its definition — may be in a different file, e.g. `packages/ai/src/gateway/self-operation.ts`
   or a settings-specific module). Confirm manifest-driven / no extra wiring needed.
2. Read `packages/sports/src/sports-service.ts` in full; confirm extending it (not a new `service.ts`)
   is the right call.
3. Read `packages/ai/src/gateway/self-operation.ts` exclusion-rule list in full to positively rule
   out an accidental match for sports tool names.
4. Run CLAUDE.md required agentmemory recalls relevant to this work (state, RLS-if-touching-tables
   — sports follows already has RLS from its original migration, self-operation work doesn't add
   tables, so likely just the "jarv1s current project state" + a self-operation-specific query;
   two `memory_smart_search` attempts this session returned empty results — try `memory_recall`
   instead, or rely on injected MEMORY.md, don't burn more than 1-2 calls on this).
5. Write the plan via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-27-<slug>.md`.
   Cover: (a) drop `guidance` from `news.addTopic` tool input schema — TDD test asserting the tool
   schema no longer accepts/requires it, no regression to REST path; (b) sports service extraction
   + `sports.followTeam`/`sports.unfollowTeam` tools + action family declaration; (c)
   `self-operation-manifests.test.ts` count updates (29→31, 38→40) + new sports describe block;
   (d) spec's other listed tests (no-confirmation-card assertions, catalog-key rejection, unfollow
   idempotency, cross-actor RLS isolation via existing `sports_follows` RLS, denylist check,
   preview/confirm regression test for news). No migration expected — sports table already exists.
6. Message coordinator with plan path, **STOP and wait for approval** — do not write code first.
7. On approval: TDD build, commit per task, `git add` explicit paths only.
8. Relay again at 70% context warning or on compaction summary — don't push past it.
9. `coordinated-wrap-up` at Exit Criteria: pre-push trio, full gate, push, PR, report to coordinator.
   Never merge/board/close.

## Threshold reminder
Relay on context-meter 70% warning (self-monitoring PostToolUse hook) or immediately on seeing a
compaction summary. Read spec/plan by section only, never in full re-reads.
