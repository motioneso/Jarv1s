# Spec 2 — Module self-operation: module content commands

Status: APPROVED by Ben 2026-07-26. Grounded on `751c7f14`.
Depends on Spec 1 (`2026-07-26-module-self-operation-settings-commands.md`) for the declaration
field, the denylist, and the gateway policy ordering. This spec applies that model to module content
and fills the gap where a module has no write tools at all.

## Correction to the source plan (verified in code, 2026-07-26)

The plan assumed `news.addSource` had to be built. **It already exists**, and so do four siblings:
`news.previewSource`, `news.confirmSource`, `news.removeSource`, `news.addTopic`, `news.removeTopic`,
`news.addExclusion` (`packages/news/src/manifest.ts:258–370`, five at `risk: "write"`). The real
finding is worse and more useful:

- **None of them carry an `actionFamilyId`** — deliberately, per the comment at `manifest.ts:283`
  ("can never be promoted to auto-approve"). `policy.ts:40` returns `confirm` for any write tool
  without a family, so **every one of these prompts on every call, forever**, with no user-reachable
  way to change that. This is precisely the walk-away failure Ben's ruling targets.
- Across all modules there are **29 write tools**, and only 8 manifests mention `actionFamilyId` at
  all — news's two mentions are comments, not declarations. The retrofit is the work; the tools are
  mostly already there.
- **`sports` is the genuine gap**: one read tool, `sports.followedFactsToday`
  (`packages/sports/src/manifest.ts:144`), and no write side. "Follow the Yankees" is not answerable
  today.

## Decisions (locked)

- **Retrofit before build.** Pass one is classifying the 29 existing module write tools under the
  Spec 1 permissions model; pass two adds `sports.followTeam` / `sports.unfollowTeam`. Building new
  tools while the existing ones prompt forever would leave the same complaint intact.
- **News is prompt-free end to end. All five write tools are `granted_at_install`** (Ben,
  2026-07-26). An earlier draft of this spec put `confirmSource` and `removeSource` on
  `confirm_always`, gating on "reaches a third party" and "prunes articles from the briefing."
  **Both were over-classified and the ruling rejects them.** The bar is durable unrecoverable loss,
  and neither clears it: following a publisher is exactly reversed by unfollowing, and a removed
  source's articles come back when the source is re-added and refetched. Ben's instruction is
  explicit — no module should be asking permission for its own content settings at this point.
  - `granted_at_install` — `news.addTopic`, `news.removeTopic`, `news.addExclusion`,
    `news.confirmSource`, `news.removeSource`.
  - **The one open question that could change this is prompt-shaping, not risk.** `addTopic`'s
    `guidance` field is free text that steers article selection. Spec 1's rule is a hard property, not
    a risk judgment, and Ben's ruling does not relax it: a value may reach a prompt only if its write
    path validates against a closed set **and** it renders through a server-owned constant template.
    Read the execute path and resolve it. If `guidance` does reach a prompt, the fix is to render it
    through a constant template or drop it from the tool's input — **not** to add a confirmation, which
    would not stop injection anyway.
  - `news.previewSource` is already `risk: "read"` but **fetches an arbitrary user-named URL** and is
    marked `externalContent: true` (`manifest.ts:265`). Confirm the existing SSRF/host controls on
    that fetch are adequate; that is a containment check, not a reason to prompt.
- **`sports.followTeam` / `sports.unfollowTeam` are `granted_at_install`.** Follows are catalog
  references only: `POST /api/sports/follows` rejects anything outside `SPORTS_CATALOG`
  (`routes.ts:161`), the module declares `exportSections: []` because follows carry no user content
  (`manifest.ts:157`), and unfollow fully restores state. Closed catalog + no content + exact reverse
  = the auto-safe definition, met.
- **Tools take a catalog key, never a free-text team name.** Resolution from "the Yankees" to a
  competition key happens through the existing search/catalog read path, which the assistant already
  has; the write tool validates against `catalogEntry()` exactly as the route does. This keeps the
  closed-set property that makes the classification defensible.
- **Extraction is required here too.** `POST /api/sports/follows` calls `repository.create` straight
  from the route handler (`routes.ts:163`) — there is no service function for a tool to call. Same
  pattern as Spec 1's locale/quiet-hours finding. Extract a module-owned application function; the
  route and the tool both call it.
- **One action family per module, not per tool.** Tier storage is per `(moduleId, familyId)`
  (`policy.ts:47`), so `news.content` and `sports.follows` families each get `allowedTiers` including
  `trusted_auto` and receive the stored `trusted_auto` grant at install. Per-tool families would
  multiply the grant surface with no user benefit.
- **`executionPolicy: "auto"` is required alongside the tier** — `policy.ts:49` needs tier **and**
  `executionPolicy` **and** `allowedTiers` all three. A tool declared `granted_at_install` without
  `executionPolicy: "auto"` silently keeps prompting; the Spec 1 build assertion must catch that
  combination, not just a missing declaration.
- **Two-phase preview/confirm survives, and is the model for other modules.** It is a good pattern
  for anything that ingests an external identifier, and Spec 1's rules do not require collapsing it.

## Files

- `packages/news/src/manifest.ts` (:245–370) — add an `actionFamilyId` (`news.content`), the Spec 1
  declaration field per tool, `executionPolicy` where auto, and an `actionFamilies` entry. Replace the
  "can never be promoted" comments — they document the old policy.
- `packages/news/src/*` (execute path for `addTopic`) — confirm whether `guidance` reaches a prompt;
  classification depends on the answer.
- `packages/sports/src/manifest.ts` (:142) — add `sports.followTeam` / `sports.unfollowTeam` and a
  `sports.follows` action family.
- `packages/sports/src/routes.ts` (:154, :174) — extract the application function; routes call it.
- `packages/sports/src/service.ts` — new follow/unfollow functions taking a `DataContextDb`, catalog
  validation shared with the routes.
- Remaining modules with write tools (`tasks`, `notes`, `commitments`, `goals`, `calendar`, `email`,
  `ai`) — classify each; anything unclassified fails the Spec 1 build assertion, so this is not
  optional follow-up work, it lands with the assertion.

## Tests

- With the install grant applied, **every** news write tool and both sports follow tools run with no
  confirmation card. A test asserting that any of them confirms is a regression, not a safety net.
- A tool declared `granted_at_install` but missing `executionPolicy: "auto"` fails the build (the
  silent-prompt trap).
- `sports.followTeam` with a competition key outside `SPORTS_CATALOG` is rejected before any write,
  matching `routes.ts:161`.
- `sports.unfollowTeam` restores the exact prior state; follow → unfollow → follow is idempotent.
- Cross-actor: a follow created by user A is invisible and unremovable from user B's tool call (RLS,
  via `withDataContext`).
- Denylist: no news or sports tool intersects the Spec 1 excluded set.
- Regression: the existing news preview/confirm two-phase flow still rejects a `confirmSource` whose
  label/domain do not match the cached preview.

## Exit criterion (UAT — #1000 harness, mandatory)

Real dev-instance Playwright run: "add a topic for local climate policy to my news" → added with **no
confirmation card**, visible on the news personalization surface. "Follow the Yankees" → resolved
through the catalog and followed, no card, visible on `/sports`. "Stop following that source" →
removed, **also with no card**. A confirmation card appearing anywhere in this run is a failure.
Full `pnpm verify:foundation` green with a real exit code.
