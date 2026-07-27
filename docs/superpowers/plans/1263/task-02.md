**Dependency:** Task 1 must already be committed.

**Status:** DONE — `d11c4481`.

**Coordinator ruling:** #1263 assertions cover built-in manifests only; external-module ABI completeness is tracked by #1267. External writes remain safe because their ABI cannot declare an action family, so `packages/ai/src/gateway/policy.ts:40` confirms them unconditionally.

## Task 2 — Implement the one central exclusion artifact and manifest assertion

**Files**

- Add `packages/ai/src/gateway/self-operation.ts`
- Modify `packages/ai/src/gateway/index.ts`
- Add `tests/unit/self-operation-chassis.test.ts`

**Symbols**

- `SELF_OPERATION_EXCLUSIONS`
- `isSelfOperationExcluded(moduleId, tool)`
- `assertBuiltInSelfOperationManifests(manifests)`

**Changes**

1. Keep the exclusion data immutable and server-owned. Each entry has a stable rule id, a fixed
   reason, and a matcher over manifest-owned identity only: module id, tool name, permission id,
   action-family id, and input-schema property names. Do not add a second command registry or a
   module-controlled “excluded” value.
2. Encode all seven approved categories:
   - `self_authority`: YOLO, action-policy/tier promotion, permissions, built-in/external module
     enable/install/remove/purge, connector feature grants, task agency auto-execution, AI service
     bindings/default provider/chat-model override/admin pin.
   - `prompt_shaping`: persona/assistant name, memory settings/fact mutation except the binding
     `memory.remember`/`memory.forget` declarations, priority ranking, source behavior and notes
     source selection, chat-skill mutation/import, and page-context writes.
   - `secrets`: registry entries with `secret:true`, credential and web-search-key writes, provider
     create/update, voice endpoint, connector authorize/complete/connect, onboarding
     login/install, terminal password/ticket.
   - `identity_auth_registration`: account lifecycle, admin promotion, session revocation,
     registration flags, onboarding state.
   - `data_scope_consent`: wellness AI consent and future prompt-data-widening flags.
   - `assistant_brain`: chat model override, embed provider, provider revoke, model disable,
     multiplexer.
   - `external_effect`: third-party sends, scheduled/cancelled work, digest/proactive/notes-source
     scheduling, provider tests/discovery, connector sync/revoke, briefing mutation/run, news
     preview/refresh, transcription, exports, module queue runs, host install.
3. Reject any write/destructive tool whose input schema exposes a generic `key`,
   `preferenceKey`, or `settingKey`; tools must hardcode their target.
4. `assertBuiltInSelfOperationManifests` must reject:
   - a write/destructive tool with neither an exclusion match nor `selfOperationGrant`;
   - an excluded tool which tries to declare either grant;
   - `granted_at_install` unless risk is write, execution policy is auto, its family exists, and
     that family allows both `trusted_auto` and `always_confirm`;
   - `confirm_always` on a tool other than the four-entry planned allowlist
     `memory.forget`, `people.merge`, `people.splitIdentity`, and pending `notes.delete`;
   - any action family referenced by a self-operation-declared tool which omits
     `always_confirm`;
   - duplicate tool names, duplicate family ids, or an action-family reference which does not
     resolve in its own module.
5. Error messages name the module/tool and failed invariant, never tool inputs.
6. Put this exact scope rationale in the assertion's doc comment: it validates **built-in
   manifests only**; external module tools are deferred to #1267, and remain safe because their ABI
   cannot declare `actionFamilyId`, so `policy.ts:40` confirms every external write unconditionally.

**Tests — exact names**

- `"rejects an unclassified built-in write tool"`
- `"rejects a built-in module override of a central exclusion"`
- `"rejects generic preference-key inputs on built-in tools"`
- `"covers all seven immutable built-in exclusion categories"`
- `"rejects built-in granted_at_install without write auto execution"`
- `"rejects built-in granted_at_install without a resolvable trusted family"`
- `"requires always_confirm in every referenced built-in family"`
- `"allows only the four planned built-in confirm_always tools"`
- `"accepts built-in read tools without a declaration"`
- `"documents built-in-only coverage with external modules deferred to #1267"`

Use synthetic manifests in this task; do not wire the assertion into boot until Tasks 4–13 have made
the built-in inventory valid.

**Verify**

`pnpm vitest run tests/unit/self-operation-chassis.test.ts`

**Commit**

`feat(ai): enforce self-operation classifications`
