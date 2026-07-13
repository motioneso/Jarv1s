# UX #990 News Settings UAT evidence

Tested exact pushed PR head: `36a0639433a2cbb592716d2df21931fb7f63160b`.

This head is rebased on `origin/main` `7d8520927e402eaaa527985f31b351b618237c05`, including the #986 Settings shell navigation and IA changes.

Firefox exercised the real Vite-served app shell, News Settings component, and client mutation paths. Browser-intercepted API responses were deterministic and stateful; no external search, model, RSS, or worker ran. The action log records POST/PATCH/DELETE payloads, queued/error revalidation responses, viewport sizes, and final PASS.

## Evidence

- [Critical-point checklist](plan.md)
- [Action log](final_script_log.txt)
- [Desktop empty state with rebased Settings IA](screenshots/final_execution_1_desktop_empty_state.png)
- [Enter add and compact row](screenshots/final_execution_2_enter_add_compact_row.png)
- [Edit saved](screenshots/final_execution_3_edit_saved.png)
- [Remove and empty state](screenshots/final_execution_4_remove_empty_state.png)
- [Actionable policy error with retained input](screenshots/final_execution_5_actionable_policy_error.png)
- [Revalidation queued](screenshots/final_execution_6_revalidation_queued.png)
- [Revalidation error](screenshots/final_execution_7_revalidation_error.png)
- [390px narrow compact topic](screenshots/final_execution_8_narrow_compact_topic.png)
