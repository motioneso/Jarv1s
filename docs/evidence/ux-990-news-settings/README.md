# UX #990 News Settings repair UAT evidence

Tested exact pushed product head: `472c2f2dc7715e3e6bec79bb918fc08d84230fe2`.

Firefox exercised the real Vite-served app shell, News Settings component, and client mutation paths. Browser-intercepted API responses were deterministic and stateful; no external search, model, RSS, or worker ran. The action log records POST/PATCH/DELETE payloads, queued/error revalidation responses, loading/error query states, viewport sizes, and final PASS.

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
