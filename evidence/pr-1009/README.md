# PR #1009 live Sports settings UAT evidence

Run date: 2026-07-13

Product branch/SHA: `ux/989-sports-settings-build` @ `c1093427`

## Environment proof

- API: `localhost:3002`, cwd `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build/apps/api`
- Web: `localhost:5189`, cwd `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build/apps/web`
- Both processes carried explicit `JARVIS_PGDATABASE=jarv1s_ux989_uat`.
- Web carried `JARVIS_API_PROXY_TARGET=http://localhost:3002`.
- `jarv1s_ux989_uat` was created and migrated independently; shared `jarv1s` was not migrated, dropped, or edited.
- Fresh bootstrap owner was created through the real `Create owner account` UI. No request mocks or direct auth/app-table writes were used.

## Result

GREEN. Desktop and 390px walkthrough completed: search Arsenal, follow, verify `Following`, unfollow, follow all Premier League, verify `Following all of Premier League`, unfollow all, expand `Browse leagues`, and verify no horizontal page overflow. Final follow state was clean. All 22 observed Sports API responses were below HTTP 400.

## Screenshots

- [Fresh owner onboarding](final_execution_1_fresh_owner_onboarding.png)
- [Desktop collapsed](final_execution_2_desktop_collapsed.png)
- [Desktop team followed](final_execution_4_desktop_team_followed.png)
- [Desktop team unfollowed](final_execution_5_desktop_team_unfollowed.png)
- [Desktop league followed](final_execution_6_desktop_league_followed.png)
- [Desktop league unfollowed](final_execution_7_desktop_league_unfollowed.png)
- [Desktop Browse leagues expanded](final_execution_8_desktop_browse_expanded.png)
- [390px collapsed](final_execution_9_mobile_collapsed.png)
- [390px team followed](final_execution_11_mobile_team_followed.png)
- [390px team unfollowed](final_execution_12_mobile_team_unfollowed.png)
- [390px league followed](final_execution_13_mobile_league_followed.png)
- [390px league unfollowed](final_execution_14_mobile_league_unfollowed.png)
- [390px Browse leagues expanded](final_execution_15_mobile_browse_expanded.png)

## Action log

1. Created fresh bootstrap owner through real UI.
2. Completed onboarding skip flow and opened active Sports settings.
3. Verified desktop disclosure collapsed by default and no overflow.
4. Searched Arsenal against real catalog.
5. Followed Arsenal; verified pressed `Following`.
6. Unfollowed Arsenal; verified `Follow` restored.
7. Followed all Premier League; verified pressed `Following all`.
8. Unfollowed all Premier League; verified `Follow all` restored.
9. Expanded real league catalog.
10. Switched to 390px; verified no horizontal overflow.
11. Repeated search, team follow/unfollow, league follow-all/unfollow-all, and disclosure flows at 390px.
12. Verified 22 non-mocked Sports API responses, all below HTTP 400.
