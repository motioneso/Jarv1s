# YOLO Admin Controls Move (#681)

**Status:** approved
**Issue:** #681
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

Admin YOLO / auto-approval controls currently live in Admin > People & access. The controls are
really Assistant & AI policy, and the per-member toggle list is noisy once an instance has more
than a few users.

## 2. Decisions

- Move admin YOLO controls to Admin / Setup > Assistant & AI.
- Keep the user's own YOLO toggle in Personal > Assistant & AI.
- Keep existing backend policy and endpoint behavior unless an existing endpoint is insufficient.
- Keep the instance master switch behavior as-is: enabling it also allows/enables YOLO for the
  admin who flipped it.
- Keep "Allow all current members"; this issue is a move and UX cleanup, not a policy change.
- Replace the always-visible per-user toggle wall with explicit member search/add and a compact
  allowed-user list.

## 3. Scope

- Remove the YOLO / auto-approval group from Admin > People & access.
- Add the same admin controls to Admin / Setup > Assistant & AI:
  - instance master switch;
  - allow all current members action;
  - searchable active-member add control;
  - compact allowed-user list with remove controls.
- The add picker includes active members who are not already YOLO-allowed.
- Adding a member sets `yoloAllowed=true`; removing a member sets `yoloAllowed=false`.
- Preserve existing confirmation for enabling the instance master switch.
- Keep query invalidation/cache updates coherent for both admin and self YOLO settings.

## 4. Non-Goals

- New YOLO backend policy.
- New YOLO routes unless the current routes cannot support the UI.
- Removing "Allow all current members".
- Changing action execution semantics.
- Moving unrelated People & access controls.

## 5. Acceptance

- Admin YOLO controls no longer render under Admin > People & access.
- Admin YOLO controls render under Admin / Setup > Assistant & AI.
- Instance master and "Allow all current members" still call the existing behavior.
- Admins can search/select an active member to allow YOLO without scrolling a full member toggle
  list.
- Allowed members are visible in a compact list and can be removed.
- Pending/deactivated users and already-allowed users do not appear as add candidates.
- Existing self-service YOLO behavior in Personal > Assistant & AI still works.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/settings/settings-admin-panes.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-ai-admin-pane.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-ai-pane.tsx`
- `~/Jarv1s/apps/web/src/api/client.ts`
- `~/Jarv1s/packages/settings/src/yolo-routes.ts`
- `~/Jarv1s/packages/shared/*yolo*`
