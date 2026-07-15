# Critical Points

- [x] CP1: A production-shaped stack built from exact PR head `dc6e3e949c861848d7800f0b45a976546001c2ad` accepts a real owner/admin login and renders authenticated Settings.
- [x] CP2: On desktop, adding a blank priority and pressing Save shows validation, sends zero priority-model PATCH requests, and keeps the draft editable.
- [x] CP3: Completing that priority and pressing Save sends exactly one valid priority-model PATCH; a reload shows the saved value.
- [x] CP4: Editing the saved priority and pressing Discard restores the saved snapshot without another PATCH.
- [x] CP5: A hidden future source seeded through the authenticated API survives a real UI edit/save round-trip in the outgoing PATCH payload.
- [x] CP6: With the instance owner policy disabled and the personal YOLO preference enabled, Assistant & AI truthfully says the effective state is inactive because the instance owner disabled YOLO.
- [x] CP7: At a narrow viewport, authenticated Priorities remains usable without horizontal overflow and the saved priority plus Save/Discard interaction are reachable.

# Evidence

- CP1: `final_runs/run_3/screenshots/final_execution_1_authenticated_priorities_desktop.png`; log step 1.
- CP2: `final_runs/run_3/screenshots/final_execution_2_blank_label_blocked_zero_patch.png`; log step 2.
- CP3: `final_runs/run_3/screenshots/final_execution_3_saved_priority_hidden_source_round_trip.png`; log step 3.
- CP4: `final_runs/run_3/screenshots/final_execution_4_discard_restored_snapshot.png`; log step 4.
- CP5: log step 3 records the asserted outgoing PATCH payload preserving hidden source `wellness`.
- CP6: `final_runs/run_3/screenshots/final_execution_5_truthful_yolo_effective_state_desktop.png`; log step 5.
- CP7: `final_runs/run_3/screenshots/final_execution_6_narrow_priorities_dirty_actions.png`; log step 6.
