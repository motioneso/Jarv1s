# Plan for #535: Long-running Jarvis goals

## Gap Verification

Confirmed via branch inspection:

- `packages/goals` does not exist.
- `app.jarvis_goals` and `app.jarvis_goal_evidence` tables do not exist.
- `packages/jobs/src/pg-boss.ts` contains `assertMetadataOnlyPayload` but lacks goal keys.

## Tasks (Bite-sized, TDD, green per commit)

1. **Scaffold Package and DB Migration**
   - Create `packages/goals/package.json` and basic setup.
   - Create `packages/goals/sql/0123_long_running_goals.sql` with tables, RLS policies, and triggers.
   - Commit green.

2. **Core Types and Verification**
   - Define TS interfaces, enums, and Zod schemas in `packages/goals/src/types.ts`.
   - Implement source verifier registry interface (to verify external source kinds).
   - Commit green.

3. **Jobs & Background Workers**
   - Extend `packages/jobs/src/pg-boss.ts` `assertMetadataOnlyPayload` with `goalId`, `goalUpdatedAt`, and `reason`.
   - Implement `goals-memory-sync` worker and `goals-memory-sync-reconcile` in `packages/goals/src/workers.ts` (with per-owner locks, error handling).
   - Commit green.

4. **API Routes and DB Access**
   - Implement `packages/goals/src/db.ts` for database CRUD.
   - Implement Fastify routes in `packages/goals/src/routes.ts` (`GET /api/goals`, `POST /api/goals`, evidence routes, etc.).
   - Integrate with source verifiers for evidence.
   - Commit green.

5. **Assistant Tools**
   - Implement `goals.*` tools (read/write) governed by `goal_changes` policy in `packages/goals/src/tools.ts`.
   - Ensure read tools truncate summaries/evidence.
   - Commit green.

6. **Registry Wiring**
   - Add module manifest in `packages/goals/src/index.ts`.
   - Register module, routes, workers, and tools in the central module registry.
   - Commit green.

7. **Frontend / UI Integration**
   - Add Goals surface to the app shell (e.g., `packages/web/src/pages/goals.tsx` or similar).
   - Add bounded UI section to the Today page.
   - Commit green.

## Exit Criteria

- API, UI, and Tools functional for CRUD on goals and evidence.
- Verified isolation/RLS (owner-scoped).
- Background sync job updates derived memory without modifying goal `updated_at`.
