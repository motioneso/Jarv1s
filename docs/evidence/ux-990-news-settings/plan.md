# Task

Exercise News Settings on exact pushed head `472c2f2dc7715e3e6bec79bb918fc08d84230fe2` through the real Vite-served app shell and real News Settings UI, with deterministic browser-intercepted API responses. Capture durable desktop and narrow evidence for add/edit/remove, empty state, actionable validation failure with retained input, retry-validation queued/error feedback, and honest personalization loading/error states.

# Critical Points

- [x] CP1: Desktop News Settings visibly presents the honest empty state and topic/guidance relationship. Evidence: `final_execution_1_desktop_empty_state.png`, log step 1.
- [x] CP2: Pressing Enter in the topic field sends add input, renders compact topic row, and reports `Topic added`. Evidence: `final_execution_2_enter_add_compact_row.png`, log step 2.
- [x] CP3: Edit loads existing values; save updates guidance and reports `Changes saved`. Evidence: `final_execution_3_edit_saved.png`, log step 3.
- [x] CP4: Remove returns to the honest empty state and reports `Topic removed`. Evidence: `final_execution_4_remove_empty_state.png`, log step 4.
- [x] CP5: Policy validation failure shows actionable content-policy guidance and retains typed input. Evidence: `final_execution_5_actionable_policy_error.png`, log step 5.
- [x] CP6: Retry validation visibly reports both queued success and a safe retryable error. Evidence: `final_execution_6_revalidation_queued.png`, `final_execution_7_revalidation_error.png`, log steps 6-7.
- [x] CP7: Narrow viewport preserves readable form, compact topic controls, full saved guidance, and feedback without horizontal overflow. Evidence: `final_execution_10_narrow_full_guidance.png`, log step 10 (`390 == 390`, `overflow: visible`, `whiteSpace: normal`).
- [x] CP8: Log records exact tested Git SHA, server URL, request payloads, viewport sizes, and successful completion. Evidence: `final_script_log.txt`, steps 0-10 and `FINAL_RESPONSE`.
- [x] CP9: Personalization loading/error states are authored and suppress false empty/form UI until query success. Evidence: `final_execution_8_personalization_loading.png`, `final_execution_9_personalization_error.png`, log steps 8-9.
