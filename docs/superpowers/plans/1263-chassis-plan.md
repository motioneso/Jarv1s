# 1263 chassis plan (terse — coordinator-directed format)

Grounded on branch `1263-self-operation-chassis`. Spec: `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` (Decisions/Prerequisite/Files/Tests sections). Handoff: `docs/coordination/handoff-1263-self-operation-chassis.md`.

Verified against actual code (not stale): `module-sdk/src/index.ts:18-27,499` (defaultTier type, ModuleAssistantToolManifest — field name for the new declaration is my choice, not spec-given: `selfOperationTier?: "granted_at_install" | "confirm_always"`); `gateway.ts:157-172` YOLO branch precedes `resolvePolicy` (~173); `policy.ts:29-57` matches spec exactly (37 destructive→confirm, 40 no-family→confirm, 47 stored-tier-wins, 49 trusted_auto+auto+allowedTiers→run); `action-policy-routes.ts:88-92` rejects tier not in family's `allowedTiers`; `repository.ts:1901-1924` `setActionPolicy` is a clobbering upsert (no insert-if-absent variant exists yet — need one for install-grant); action-policy storage is `app.preferences` key `assistant.action_policy.v1.<moduleId>.<familyId>` — **no new migration needed**; module enable/disable hooks: `settings/routes-modules.ts` (`/api/me/modules/:id`, `/api/admin/modules/:id`, `/api/admin/external-modules/:id`); manifest composition root: `apps/api/src/server.ts` `getBuiltInModuleManifests`. Write/destructive inventory re-measured: 39 tools / 11 packages, matches handoff table exactly.

**ESCALATION (do not guess, per Ben's ruling):** `people.merge`/`people.splitIdentity` (`packages/people/src/tools.ts:161,179`, `service.ts:139,192`, `repository.ts:759`) — verified `splitIdentity` does NOT restore exact prior state after a `merge`: merge marks the secondary person `status: "merged"` + `merged_into_person_id` and moves ALL its identities+links to primary; splitIdentity only relinks ONE identity to a (possibly new) person and never revives the secondary's status or moves back the other identities/links. Round-trip fails. Need your call: `confirm_always` on both, or something else — not declaring `granted_at_install` myself.

## Tasks

1. module-sdk: add `selfOperationTier?: "granted_at_install" | "confirm_always"` to `ModuleAssistantToolManifest` (index.ts:499). No `defaultTier` widening.
2. New central denylist module (7 rule categories verbatim from spec's "Central exclusion set") + matcher fn, keyed on moduleId/permissionId/actionFamilyId/tool-name/preference-key patterns.
3. Build assertion fn: (a) every non-read tool must declare `selfOperationTier` XOR be denylist-excluded — declaring nothing and not excluded fails; declaring something while excluded fails ("no override"); (b) `granted_at_install` without `executionPolicy:"auto"` fails (silent-prompt trap); (c) every actionFamilyId referenced by a self-operation-declared tool must have `allowedTiers` including `"always_confirm"` on its family manifest.
4. Wire assertion into `apps/api/src/server.ts` boot (throw before listen) + a unit test calling it directly against `getBuiltInModuleManifests()` output (this is what CI actually catches on).
5. Gateway: hoist the exclusion check above the YOLO branch in `gateway.ts` dispatch (~line 157) — excluded → deny always; YOLO on → run bypassing confirm_always/destructive/requiresConfirmation (unchanged); otherwise ordinary policy (unchanged). Also filter excluded tools out of `executableTools()` listing (never surfaced to model). Tests: YOLO-on+excluded=deny; YOLO-on+confirm_always/destructive=still runs (regression guard); YOLO-off unaffected.
6. New repository method: insert-if-absent action-policy grant (ON CONFLICT DO NOTHING, not the existing clobbering upsert).
7. Wire install-time grant call into the three module-enable routes (`routes-modules.ts`): for families with `allowedTiers` including `trusted_auto`, grant it via #6 on enable. Regression test: existing user-set `always_confirm` row is never clobbered by a reinstall/reconcile re-run.
8. Classify tasks package (13 tools) — `selfOperationTier` per tool, denylist or granted_at_install, escalate anything ambiguous.
9. Classify news package (5 tools).
10. Classify people package (2 remaining tools, not merge/splitIdentity — those are escalated in task list above).
11. Classify notes package (3 tools).
12. Classify goals package (3 tools).
13. Classify commitments package (3 tools).
14. Classify memory package (2 tools) — already settled: `remember`=granted_at_install, `forget`=confirm_always (preserved-by-declaration per policy.ts:37).
15. Classify email package (2 tools).
16. Classify calendar package (2 tools).
17. Classify web-research package (1 tool).
18. Classify ai package (1 tool).
19. Full gate: `pnpm verify:foundation` green, real exit code, no `| tail`.

Each classification task (8–18) commits its package's manifest diff + any reverse/roundtrip test the classification rationale depends on. A parallel research fork is currently classifying tasks 8–18's tools in detail (denylist-rule match or reversibility per tool); its findings will be folded in before each task starts, and any second confirm_always candidate it flags gets escalated the same way as people.merge/splitIdentity, not decided solo.
