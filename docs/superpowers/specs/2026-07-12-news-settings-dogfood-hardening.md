# News settings dogfood hardening (#990)

**Status:** Draft (awaiting Fable approval)

**Date:** 2026-07-12

**Grounded on:** `origin/main` @ `3ca138eb508a2c1bb552514d52b6d2d7f1f7e6fc`

**Tier:** routine (module-owned UI over existing owner-scoped contracts; no RLS or policy change)

**Builds on:** #954, #975, #981, #899, #906;
`2026-07-11-personalized-news-sources-topics.md`

## Problem

Personalized News already ships owner-private sources, curated topic preferences, freeform topics,
domain exclusions, prerequisite gates, validation, refresh jobs, and create/PATCH/delete topic
routes. The Settings pane exposes most of that machinery, but the dogfood pass found a directness
and comprehension gap:

- “Sources”, “Topics”, “Personalized sources”, and “Topics you describe” read like four parallel
  concepts even though curated topics filter enabled publications while described topics discover
  stories across the web;
- the freeform topic form visually separates its label and guidance, Enter was not proven as the
  submit path, and stored topics can only be removed even though the PATCH contract already exists;
- empty, pending, saved, validation-error, remove, and revalidation states have not been proven in a
  real browser;
- broad generic pane errors can obscure which topic operation failed.

This pass makes the existing personalization contract understandable and operable. It does not
replace the News backend or introduce a second interest model.

## Decisions

1. **Name the two inputs by what they do.** Use “Publications” for source selection, “Topics from
   your publications” for the shipped curated desk filters, “Publications you add” for custom
   sources, and “Topics across the web” for freeform described topics. Supporting copy states that
   publication topics narrow enabled publications, while web topics can find stories beyond them.
2. **One compact topic form handles add and edit.** The default form starts with a required “Topic”
   input and an optional guidance input visibly grouped beneath it. Enter submits from either text
   input. Selecting Edit on a stored topic loads that topic into the same form, changes the primary
   action to “Save changes”, and exposes Cancel. Do not introduce a dialog or a second editor.
3. **Reuse the shipped PATCH route.** Add the missing browser client wrapper for
   `PATCH /api/news/topics/:id` using the existing `UpdateNewsTopicRequest/Response` contract. Create,
   update, delete, validation, refresh triggering, owner scoping, and limits remain server-owned.
   No route, repository, shared-schema, migration, or RLS change is in scope.
4. **Stored topics are compact, editable chips/rows.** Each shows the topic label, optional guidance,
   validation badge when relevant, Edit, and Remove. The control's accessible name includes the
   topic. Rendering must remain safe text, preserving the hostile-content guarantees in the shipped
   unit tests.
5. **Operation state stays beside the operation.** Pending copy says “Checking topic…” for create or
   “Saving changes…” for edit. Success announces “Topic added”, “Changes saved”, or “Topic removed”
   through a polite status region after the returned state is visible. On failure, retain the user's
   inputs/edit mode, show the existing safe user-language mapping in a role-alert, and keep retry
   available. Do not replace #981's backend/error taxonomy or echo model output.
6. **Preserve personalization invalidation.** Successful create, edit, and delete invalidate both
   `newsQueryKeys.personalization` and `newsQueryKeys.overview`, exactly like current personalization
   writes. Curated source/topic preferences retain their existing `prefs` and `overview`
   invalidation semantics.
7. **An empty topic set is an honest state, not a dead end.** When no described topics exist, say
   that News still uses the selected publications and place the ready-to-type form with that copy.
   Missing AI/web-search prerequisites keep the existing truthful disabled gate and self-serve link.

## Reconciled shipped contracts

| Existing behavior                                   | This pass                                                    |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Curated publication on/off planner                  | Preserved                                                    |
| Curated topic preference chips                      | Preserved; relabelled to explain their source-filter role    |
| Owner-private custom sources/topics/exclusions      | Preserved; no data or RLS change                             |
| Topic POST/PATCH/DELETE with policy validation      | Reused; only the missing PATCH web-client call is added      |
| AI/web-search prerequisite gates                    | Preserved                                                    |
| Personalization + overview cache invalidation       | Preserved for create/remove and extended identically to edit |
| #981 actionable backend/topic error work            | Reused after rebase; not reimplemented here                  |
| #906 persisted “more/less like this” story feedback | Separate open feature; no fake or no-op control is added     |

## Slices

### Slice 1 — direct topic language and editor

- Rename and recopy the four settings sections without changing their underlying source/topic
  semantics.
- Add the small PATCH wrapper to the existing News web client.
- Reuse one controlled form for create and edit; keep guidance visibly associated with its topic.
- Render stored described topics as compact safe-text rows/chips with Edit and Remove.
- Add focused unit coverage for section distinctions, empty state, safe rendering, edit labels, and
  the existing error-copy mapping.

### Slice 2 — operation feedback and browser acceptance

- Keep operation-specific pending/success/error state local to the described-topic section and
  accessible via `role="status"`/`role="alert"`.
- Preserve inputs on create/edit failure; cancel returns to add mode without writing.
- Add a stateful route mock inside the News settings E2E spec for personalization, topic
  POST/PATCH/DELETE, and revalidation. No live web search, model, RSS fetch, or worker is required.
- Drive the real module contribution through `/settings?section=modules&module=news` using
  pane-owned accessible selectors.

## Expected paths and collision locks

- Product: `~/Jarv1s/packages/news/src/settings/index.tsx`
- Styles: `~/Jarv1s/packages/news/src/settings/news-settings.css`
- Existing client: `~/Jarv1s/packages/news/src/web/news-client.ts`
- Unit: `~/Jarv1s/tests/unit/news-settings-pane.test.tsx`
- E2E: `~/Jarv1s/tests/e2e/news-settings.spec.ts`

Do not edit News routes, repository, discovery/policy validation, jobs, shared contracts, SQL, or
module-registry wiring. Rebase before build so #981's final user-language copy is retained; if #981
reopens or again edits `packages/news/src/settings/index.tsx`, serialize that single file. #899 owns
the broad `/news` mock and screenshot-capture harness; this issue keeps its focused stateful Settings
mock local and does not edit capture files. #906 owns persisted story relevance feedback. #986 owns
Settings shell/chrome/navigation, while this spec uses the module deep link only. #989 and #990 can
build in parallel because their paths are module-isolated. #988 performs the final combined
walkthrough.

## Desktop and narrow acceptance

- [ ] Desktop distinguishes publications, topics that filter those publications, custom
      publications, and topics discovered across the web without relying on implementation terms.
- [ ] With prerequisites ready, typing a topic and pressing Enter issues one create request, shows a
      pending state, then renders the returned topic and announces “Topic added”.
- [ ] Optional guidance is visibly grouped with the topic, submitted with it, and rendered as safe
      text beneath the saved label.
- [ ] Edit loads the selected topic into the same form; Enter or “Save changes” issues PATCH, keeps
      the editor open on failure, and announces success only after the updated topic is visible.
- [ ] Remove names the target accessibly, issues DELETE once, and leaves the honest no-topics state
      when the last topic is removed.
- [ ] Validation/policy/config/write failures use actionable safe copy, retain user input, and are
      exposed through `role="alert"`; neither raw model output nor generic bare-500 copy is added by
      this UI.
- [ ] “Retry validation” still queues the existing owner-wide revalidation and reports queued/error
      state without implying the asynchronous check already succeeded.
- [ ] Curated publication and topic toggles retain the shipped personalization contract and continue
      invalidating the correct `prefs`, `personalization`, and `overview` queries.
- [ ] With no described topics, copy explains that selected publications still supply News and the
      add form remains prominent; with missing prerequisites, the existing Assistant setup link is
      truthful and reachable.
- [ ] At a narrow viewport, labels, guidance, Edit/Remove, form actions, alerts, and status text remain
      readable, keyboard operable, and free of horizontal overflow.
- [ ] Focused unit tests and `tests/e2e/news-settings.spec.ts` pass; `pnpm check:design-tokens`,
      `pnpm verify:foundation`, and `git diff --check` pass before merge.

## Non-goals

- No new personalization table, migration, route, worker, ranking algorithm, AI prompt, or web-search
  flow.
- No source editor, source/topic merger, unified cross-module interests model, or bulk topic import.
- No story-level “more/less like this” implementation (#906) and no placeholder/no-op feedback.
- No broad `/news` page mock or screenshot-capture expansion (#899).
- No Settings shell/navigation work (#986) or redesign of the News front page.
