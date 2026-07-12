# Adversarial review — Personalized News Slice 1 plan

**Date:** 2026-07-11  
**Reviewer:** Independent Claude Fable 5 plan critic (read-only)  
**Plan:** `docs/superpowers/plans/2026-07-11-personalized-news-slice1.md`  
**Spec:** `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`  
**Grounded on:** `e402b99f` (= `origin/main@6b37bc01` + 1 local doc commit; `pnpm audit:preflight`
exit 0, behind=0)

## Verdict

**APPROVE WITH REQUIRED CHANGES** — confidence **90%**.

The slice structure is sound, faithful to the approved spec's Slice 1 boundary, default-deny by
construction (no create/edit route for custom sources or topics exists anywhere in the plan), and
independently mergeable with real user value (working domain exclusions, truthful prerequisite
reporting, complete data lifecycle). Every load-bearing symbol, file, seam, and test convention the
plan names was verified present on fresh main. Four required corrections below; none require
re-slicing.

**Implementation may start once the four required corrections are folded into the plan text.**

## Blocking findings (required changes)

### B1. Task 1 breaks `pnpm check:file-size` — `foundation.test.ts` is at exactly 1000 lines

Evidence: `tests/integration/foundation.test.ts` is exactly 1000 lines on main.
`scripts/check-file-size.ts` fails any checked file over 1000 lines; `tests/` is not in its
ignore/exempt sets, and `verify:foundation` runs the check before integration tests. Task 1
requires adding at least one migration-ledger row (`expect(migrations.rows).toEqual([...])`,
line ~102) plus rows for four new tables in the FORCE-RLS/security assertion (line ~371). Any
addition pushes the file over the cap and Task 6's `verify:foundation` fails — after the builder
has already committed five tasks.

Smallest correction: add an explicit Task 1 step to split `foundation.test.ts` first (e.g. extract
the migration-ledger and security-catalog assertions into a new
`tests/integration/foundation-schema-catalog.test.ts`), name the new file in Task 1's **Files**
list so the stage-only-explicit-files rule covers it, and only then add the four-table rows.

### B2. Merge gate: replace the manual Ben sign-off with the 3-provider review council (Coordinator directive)

Directed change from the Coordinator/user on 2026-07-11, recorded here as instructed — not a
reviewer-originated finding. The plan's Risk-tier paragraph and final exit criterion currently
require "Ben's explicit merge sign-off". Replace with:

> Merge requires unanimous GREEN from a 3-provider review council — Opus + Codex + Gemini, at
> least one non-Claude provider — each posting a durable verdict on the PR. Any dissenting
> verdict, or any provider unreachable, holds the News merge for Ben's manual decision.

Note for the record: on unanimous council GREEN this removes the human sign-off step that the plan
authors assumed for a `security`-tier PR. The dissent/unreachable → Ben escalation path preserves a
human backstop. Recording the provenance explicitly so the change is auditable.

### B3. Snapshot payload "validation through the shared snapshot contract" names a mechanism that does not exist

Evidence: shared contracts in `packages/shared/*-api.ts` are compile-time TypeScript plus Fastify
JSON schemas used only at the route layer. There is no runtime JSON-schema validator available to
repositories — no ajv anywhere in the workspace; the only runtime schema validation is the
hand-rolled tool-I/O validator inside `packages/ai/src/gateway/`. Task 3's requirement to validate
"the 40 article/size-bound contract before SQL" is right, but as written an implementer would
either reach for a new dependency (forbidden by the plan's own constraints) or silently skip
validation.

Smallest correction: state the mechanism — a small News-owned pure function (e.g.
`assertSnapshotPayload` in `personalization-domain.ts` or the repository) that enforces the array
cap (40), per-field string caps, and total serialized-size bound by hand, unit-tested in Task 2/3.
No new dependency.

### B4. `validation_fingerprint` / provider identity must be provably absent from every response DTO

The plan excludes fingerprints from account export (Task 6) but never says the personalization GET
response excludes them. `validation_fingerprint` is opaque provider/model-identity material; the
plan's own global constraint says provider identifiers reach neither logs nor payloads. The
`additionalProperties: false` serialization convention will strip undeclared fields only if the
implementer doesn't declare the field — nothing currently forbids declaring it.

Smallest correction: in Task 2, explicitly state `NewsCustomSourceDto` / `NewsCustomTopicDto` omit
`validation_fingerprint` (and any provider identity), and in Task 4 add an `app.inject` assertion
that a row seeded with a fingerprint serializes without it.

## Non-blocking simplifications

1. **Defer the full 40-article snapshot card schema.** Slice 1 has no production snapshot writer;
   the detailed per-article contract is speculative until Slice 2's compilation output exists and
   will likely churn. Keep the table, `replaceLatestSnapshot`/`readLatestSnapshot`, and the
   size/count bounds; define the full card field set in Slice 2. (Spec places snapshot persistence
   in Slice 1, so the table itself is correctly scoped.)
2. **Drop the conditional `tests/unit/news-registry.test.ts`.** Registry wiring assertions live in
   `tests/integration/module-registry.test.ts`; extend that instead of adding a new suite whose
   existence is decided at build time.
3. **Exclusion-cap race.** `createExclusion`'s count-then-insert can over-admit the 100-domain cap
   under concurrent requests. Either enforce in one statement (`INSERT ... SELECT ... WHERE count`)
   or document the accepted race; single-owner tables make this low-stakes.
4. **Headline-level exclusion hardening.** Task 4 filters curated _sources_ by homepage domain. A
   headline whose article URL host matches an excluded domain can still surface through another
   curated source's feed (rare; the catalog is first-party publishers). Cheap to also apply
   `publisherDomainMatches` to each composed headline's URL host — closes the spec's "never appear"
   wording fully. Fine to defer to Slice 2 if noted.

## Missing verification (add to plan tasks)

- **Fingerprint schema-strip test** (see B4) — both directions: declared fields survive
  serialization, undeclared fingerprint/provider fields are dropped.
- **Dual-vocabulary truthfulness:** a curated source excluded via the new domain table while its V1
  toggle still reads "On" — assert overview omits it and the Settings UI renders a truthful state
  (or copy explains the two mechanisms). V1 `source_exclude` (by sourceKey) and the new domain
  exclusions coexist; tests should pin their interaction.
- **Export-with-data snapshot omission:** seed a snapshot row via the repository in the export
  test, then assert the archive contains sources/topics/exclusions but no snapshot content — an
  empty-table pass is vacuous.
- **Punycode/IDN case** in the domain-normalization table tests (plan covers credentials, ports, IP
  literals, `notexample.com`, trailing dot; add one non-ASCII → punycode case since curated
  homepage hosts are compared against user input).
- **File-size gate green after the B1 split** — name it in Task 1's verification step.

## Buildability verification (all confirmed on `6b37bc01`)

- Max migration prefix is `0158`; the plan's recompute-at-build instruction is correct and
  necessary.
- Every file the plan touches exists at the stated path, including
  `packages/news/src/web/query-keys.ts`, `news-client.ts`, `settings/index.tsx` (uses `PaneHead`,
  `Note`, `nw-*` classes as the plan assumes), and `tests/unit/news-routes.test.ts` (already
  `app.inject`-style).
- `AiRepository.resolveModelForCapability(scopedDb, capability)` exists
  (`packages/ai/src/repository.ts:1018`) and `"json"` is the structured-output capability.
- Web-search availability machinery exists: `hasInstanceWebSearchKey(scopedDb)`
  (`packages/settings/src/web-search-key.ts`) plus `JARVIS_BRAVE_SEARCH_API_KEY` env fallback
  (`packages/web-research/src/providers.ts:169`). `packages/module-registry` already imports
  `@jarv1s/ai` and `@jarv1s/settings`, so the availability callbacks need no new dependencies.
- The module export seam exists exactly as assumed: `dataLifecycle.exportSections` +
  `collectModuleExportSection` in `packages/settings/src/data-export.ts` (wellness precedent);
  News currently declares `exportSections: []`, and the registry parity check requires
  `deletion.tables` ⊇ owned tables while export sections may be non-covering — so exporting
  preferences while omitting snapshots is legal under existing assertions.
- `tests/integration/module-data-lifecycle-cascade.test.ts` pins the exact cascade table list;
  Task 1 correctly schedules its update.
- Route-guard requires every registered route be claimed by a manifest `routes[]` entry; the plan's
  "manifest declarations + routes" step satisfies it. Minor gap: the plan doesn't name the
  `permissionId` for the new routes — reuse `news.view` (GET) / `news.prefs` (exclusion writes).
- RLS policy shape in the plan matches the applied `0151_news_prefs.sql` conventions
  (ENABLE + FORCE, per-verb `jarvis_app_runtime` policies on `app.current_actor_user_id()`, no
  worker grants).

## Lens summary

- **Scope fidelity:** faithful. Slice 1 spec bullets all covered; exclusion _writes_ in Slice 1 are
  a legitimate reading (they need no LLM/web validation, so default-deny is not weakened). Nothing
  pulled forward from Slices 2–4.
- **Default-deny:** holds structurally — no route, repository writer, chat tool, or import path can
  create a custom source/topic; V1 `POST /api/news/prefs` stays catalog-key-validated.
- **RLS/lifecycle:** correct posture; B4 and the export-with-data test close the remaining gaps.
- **Module isolation:** boolean availability ports injected at the composition root are clean; no
  forbidden imports; News-owned export collector matches the #801 seam.
- **Independent merge value:** yes — truthful without fabrication (exclusions work end-to-end;
  empty custom-source/topic sections with disabled writes are honest given the release-note rule).
- **Ponytail:** simplifications 1–2 above; nothing else deletable without losing a Slice 1 outcome.
- **Collision/risk:** `security` tier is right. Hot shared files: `foundation.test.ts` (see B1),
  `packages/db/src/types.ts`, `packages/module-registry/src/index.ts`; migration slot `0159` may be
  contended by the in-flight external-modules series (which just landed 0157/0158) — builder should
  also check open PRs for claimed migration numbers at start, not only the local tree.
