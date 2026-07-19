# #1182 — Hide implementation-only embedding controls

**Status:** Approved by Ben from live Agentation feedback on 2026-07-19  
**Issue:** #1182  
**Annotation:** `mrs7esoy-5vom9w`  
**Tier:** Routine UI cleanup

## Problem

Assistant & AI settings currently asks a normal user to choose an embedding provider and model.
The only provider choices are `local` and the test-only `stub`, so the control exposes implementation
detail without offering a useful product choice. Selecting the wrong value can also disable real
semantic memory behavior.

## Decision

- Remove the editable embedding-provider and embedding-model controls from user-facing Settings.
- Keep the existing instance/environment configuration path for development and tests; this change
  does not delete runtime configuration keys or alter provider construction.
- Retain one read-only Memory search status in the existing Assistant & AI pane:
  - a real local provider is described as configured on this Jarvis host;
  - a non-production/test provider is described as unavailable in this environment, without naming
    `stub` or offering a selector.
- Do not display model identifiers. They do not help a normal user act on the state.

## Scope

- Simplify `~/Jarv1s/apps/web/src/settings/settings-embedding-config-group.tsx` to a read-only status.
- Update focused Settings tests for the local and unavailable states.
- Delete now-unused mutation, form-state, and model-query code from that component.

## Non-goals

- No API, database, environment-variable, provider factory, embedding model, or memory-ingestion
  changes.
- No new role, feature flag, advanced-settings surface, or replacement selector.
- No promise that configured means the model has completed a live inference; copy must describe
  configuration, not runtime health.

## Acceptance

- [ ] No normal Settings route renders `stub`, an embedding-provider select, or an embedding-model
      input.
- [ ] Local configuration is reported in user language as running on this Jarvis host.
- [ ] Test/non-production configuration is reported as unavailable without implementation-only
      vocabulary.
- [ ] Existing non-UI dev/test configuration continues unchanged.
- [ ] Focused component tests cover both states and prove the removed controls are absent.
- [ ] A live `5178` screenshot verifies the assembled Assistant & AI pane before the annotation is
      resolved.
