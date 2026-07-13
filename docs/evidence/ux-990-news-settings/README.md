# UX #990 News Settings QA R2 repair UAT evidence

Tested exact pushed product head: `44c624744b26cd0ec8b4ec478324408836faf5e0`.

Firefox exercised the real Vite-served app shell, News Settings component, and client mutation paths. Browser-intercepted API responses were deterministic and stateful; no external search, model, RSS, or worker ran. The action log records request payloads, mode transitions, query states, viewport sizes, and final PASS.

## Evidence

- [Critical-point checklist](plan.md)
- [Action log](final_script_log.txt)
- [Desktop empty state](screenshots/final_execution_1_desktop_empty_state.png)
- [Enter add and compact row](screenshots/final_execution_2_enter_add_compact_row.png)
- [Edit saved](screenshots/final_execution_3_edit_saved.png)
- [Remove and empty state](screenshots/final_execution_4_remove_empty_state.png)
- [Actionable policy error with retained input](screenshots/final_execution_5_actionable_policy_error.png)
- [Revalidation queued](screenshots/final_execution_6_revalidation_queued.png)
- [Revalidation error](screenshots/final_execution_7_revalidation_error.png)
- [Authored personalization loading state](screenshots/final_execution_8_personalization_loading.png)
- [Authored personalization error state](screenshots/final_execution_9_personalization_error.png)
- [390px narrow layout with full saved guidance](screenshots/final_execution_10_narrow_full_guidance.png)
- [Stored guidance cleared with success feedback](screenshots/final_execution_11_clear_guidance.png)
- [Add mode restored without leaked mutation alert](screenshots/final_execution_12_operation_local_errors.png)
