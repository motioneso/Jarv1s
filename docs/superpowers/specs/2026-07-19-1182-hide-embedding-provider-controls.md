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
- Do not replace the controls with a read-only Settings card. If the user cannot act on the state,
  it is not a setting. Remove the Embeddings group from the pane entirely.
- Keep the existing runtime configuration API/resolver truthful for diagnostics and internal use;
  do not display provider or model identifiers in normal Settings.

## Scope

- Remove `EmbeddingConfigGroup` from its only Settings caller and delete the now-unused component if
  no other caller exists.
- Update focused Settings tests to prove the entire non-actionable group is absent.

## Non-goals

- No API, database, environment-variable, provider factory, embedding model, or memory-ingestion
  changes.
- No new role, feature flag, advanced-settings surface, or replacement selector.
- No promise that configured means the model has completed a live inference; copy must describe
  configuration, not runtime health.

## Acceptance

- [ ] No normal Settings route renders `stub`, an embedding-provider select, or an embedding-model
      input.
- [ ] No read-only replacement card or decorative Settings text is added.
- [ ] Existing non-UI dev/test configuration continues unchanged.
- [ ] Focused pane tests prove the removed group and controls are absent.
- [ ] A low-cost visual-QA agent verifies the assembled Assistant & AI pane on `5178` and clicks every
      remaining interactive control in the touched section; any no-op control fails acceptance.
