export const meta = {
  name: 'otnr-revalidate-vs-origin',
  description: 'Revalidate stale OTNR audit findings against current origin/main code',
  phases: [
    { title: 'Revalidate', detail: 'one Opus agent per touched phase, reads origin code, verdicts each finding' },
    { title: 'Synthesize', detail: 'roll up verdicts into close/update/stand buckets' },
  ],
}

// Read-only origin worktree pinned to origin/main @ 240de7e
const ORIGIN = '/tmp/jarv1s-origin'
const AUDIT = '/home/ben/Jarv1s/docs/audit/otnr'

// Each touched phase: original finding file, origin files to re-read, filed issues to verdict.
const PHASES = [
  { id: 'P1', name: 'DB-level Security & RLS', file: 'phase-01-security-db-rls.md',
    files: ['infra/postgres/migrations/0047_users_rls_tighten.sql','infra/postgres/migrations/0050_multi_user_accounts.sql','infra/postgres/migrations/0051_fix_current_actor_user_id_grant.sql','infra/postgres/migrations/0052_fix_admin_select_policy.sql'],
    issues: ['#116 workspace_memberships NO RLS','#115 resource_grants NO RLS','#117 P1 MED/LOW bundle'] },
  { id: 'P2', name: 'Secrets & Vault (bearer-token in auth)', file: 'phase-02-security-secrets-vault.md',
    files: ['packages/auth/src/index.ts'],
    issues: ['#113 bearer-token treats any opaque token as session UUID','#114 P2 MED/LOW bundle'] },
  { id: 'P3', name: 'AI Gateway & Provider Security', file: 'phase-03-security-ai-gateway.md',
    files: ['packages/ai/src/gateway/gateway.ts','packages/ai/src/routes.ts','packages/ai/src/repository.ts','packages/ai/sql/0048_ai_model_tier.sql','packages/chat/src/mcp-transport.ts'],
    issues: ['#121 MCP transport unthrottled/unlogged','#119 MCP allowlist not enforced server-side','#118 no rate limit/cost ceiling on AI/chat/MCP','#123 P3 MED/LOW bundle'] },
  { id: 'P4', name: 'API Surface & Auth Security', file: 'phase-04-security-api-auth.md',
    files: ['apps/api/src/server.ts','packages/settings/src/routes.ts','packages/shared/src/platform-api.ts','packages/auth/src/index.ts'],
    issues: ['#120 dead workspaces subsystem wired through bootstrap/settings/repo','#122 P4 MED/LOW bundle'] },
  { id: 'P5', name: 'Module db', file: 'phase-05-module-db.md',
    files: ['packages/db/src/types.ts'],
    issues: ['#124 runSqlMigrations shares schema_migrations across dirs','#125 P5 MED/LOW bundle'] },
  { id: 'P6', name: 'Module auth', file: 'phase-06-module-auth.md',
    files: ['packages/auth/src/index.ts'],
    issues: ['#127 bootstrap writes via app_runtime w/ self-set actor GUC','#126 parallel bearer-token path live in prod','#128 P6 MED/LOW bundle'] },
  { id: 'P8', name: 'Module ai', file: 'phase-08-module-ai.md',
    files: ['packages/ai/src/routes.ts','packages/ai/src/gateway/gateway.ts','packages/ai/src/repository.ts'],
    issues: ['#132 REST tool-invoke bypasses AssistantToolGateway','#133 P8 MED/LOW bundle'] },
  { id: 'P9', name: 'Module chat', file: 'phase-09-module-chat.md',
    files: ['packages/chat/src/index.ts','packages/chat/src/repository.ts','packages/chat/src/live/chat-session-manager.ts','packages/chat/src/live/persistence.ts','packages/chat/src/live/recall-seed.ts','packages/chat/src/recall-port.ts','packages/chat/sql/0049_chat_conversation_summary.sql'],
    issues: ['#135 incognito documented immutable but no DB trigger','#134 worker retains dead UPDATE grant on chat_messages','#136 P9 MED/LOW bundle'] },
  { id: 'P10', name: 'Module tasks', file: 'phase-10-module-tasks.md',
    files: ['packages/tasks/src/tools.ts'],
    issues: ['#140 no ownership check list_id/parent_task_id','#139 sub-tasks under another user parent','#137 view-only sharee can write task activity','#142 P10 MED/LOW bundle'] },
  { id: 'P11', name: 'Module connectors', file: 'phase-11-module-connectors.md',
    files: ['packages/connectors/src/routes.ts'],
    issues: ['#141 OAuth token-endpoint error body echoed (secret leak)','#138 /google/authorize accepts client secret no rate limit','#143 P11 MED/LOW bundle'] },
  { id: 'P15', name: 'Module briefings', file: 'phase-15-module-briefings.md',
    files: ['packages/briefings/src/repository.ts'],
    issues: ['#148 assistant tools executed with blank ToolContext','#150 P15 MED/LOW bundle'] },
  { id: 'P18', name: 'Module settings', file: 'phase-18-module-settings.md',
    files: ['packages/settings/src/repository.ts','packages/settings/src/routes.ts','packages/settings/src/manifest.ts','packages/settings/src/index.ts'],
    issues: ['#155 /api/me reads other users workspace/membership via unguarded raw-Kysely','#153 resource-grants admin surface is dead','#156 P18 MED/LOW bundle'] },
  { id: 'P20', name: 'Module module-registry', file: 'phase-20-module-module-registry.md',
    files: ['packages/module-registry/src/index.ts'],
    issues: ['#159 P20 MED/LOW bundle'] },
  { id: 'P21', name: 'Module module-sdk', file: 'phase-21-module-module-sdk.md',
    files: ['packages/module-sdk/src/index.ts'],
    issues: ['#160 P21 MED/LOW bundle'] },
  { id: 'P22', name: 'Module shared', file: 'phase-22-module-shared.md',
    files: ['packages/shared/src/ai-api.ts','packages/shared/src/platform-api.ts'],
    issues: ['#161 P22 MED/LOW bundle'] },
  { id: 'P23', name: 'apps/api', file: 'phase-23-apps-api.md',
    files: ['apps/api/src/server.ts'],
    issues: ['#162 no global rate limit (chat/AI/MCP unthrottled)','#164 P23 MED/LOW bundle'] },
  { id: 'P24', name: 'apps/web', file: 'phase-24-apps-web.md',
    files: ['apps/web/src/api/client.ts','apps/web/src/api/query-keys.ts','apps/web/src/app.tsx','apps/web/src/settings/admin-users-panel.tsx','apps/web/src/settings/settings-page.tsx'],
    issues: ['#163 P24 MED/LOW bundle'] },
  { id: 'P26', name: 'Integration Tests', file: 'phase-26-cross-tests.md',
    files: ['tests/integration/foundation.test.ts','tests/integration/multi-user-isolation.test.ts','tests/integration/auth-settings.test.ts','tests/integration/mcp-gateway.test.ts'],
    issues: ['#166 cross-test contamination: app.shares rows leak, no teardown','#167 P26 MED/LOW bundle'] },
  { id: 'P27', name: 'Infrastructure & Migrations', file: 'phase-27-cross-infra.md',
    files: ['infra/docker-compose.yml','infra/postgres/migrations/0050_multi_user_accounts.sql','infra/postgres/migrations/0052_fix_admin_select_policy.sql'],
    issues: ['#168 P27 MED/LOW bundle'] },
]

const SCHEMA = {
  type: 'object',
  required: ['phase', 'verdicts'],
  properties: {
    phase: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issue', 'finding', 'status', 'evidence', 'action'],
        properties: {
          issue: { type: 'string', description: 'issue ref e.g. #155, or finding title if no issue' },
          finding: { type: 'string', description: 'short finding title' },
          status: { type: 'string', enum: ['FIXED', 'PARTIAL', 'STILL_PRESENT', 'MOVED'] },
          evidence: { type: 'string', description: 'origin file:line + what the current code does, concretely' },
          action: { type: 'string', enum: ['CLOSE', 'UPDATE', 'STAND'], description: 'CLOSE=fixed; UPDATE=line/scope changed or partial; STAND=still valid as written' },
        },
      },
    },
  },
}

phase('Revalidate')
const results = await parallel(PHASES.map((p) => () =>
  agent(
    `You are revalidating audit findings against the CURRENT code on origin/main, because the original audit ran against a stale local tree missing 8 feature PRs.

PHASE: ${p.id} — ${p.name}

STEP 1 — Read the ORIGINAL findings file (this is what the stale audit reported):
${AUDIT}/${p.file}

STEP 2 — Read the CURRENT origin/main code for each of these files (read fully, note line numbers):
${p.files.map((f) => `${ORIGIN}/${f}`).join('\n')}

STEP 3 — For EACH finding in the original phase file (HIGH, MED, LOW, INFO) that concerns one of the files above, determine its status against the CURRENT code:
  - FIXED: the current code no longer has the issue (cite the code that fixes it).
  - PARTIAL: partially addressed — some of the concern remains.
  - MOVED: still present but at a different line / shifted location (give new file:line).
  - STILL_PRESENT: unchanged, finding holds verbatim.
Map each to a filed GitHub issue where one exists. Filed issues for this phase:
${p.issues.map((i) => `  - ${i}`).join('\n')}

CRITICAL RULES:
- Judge ONLY against origin/main code under ${ORIGIN}. Do NOT read /home/ben/Jarv1s/packages or /home/ben/Jarv1s/apps (that is the stale tree).
- Be concrete: every verdict needs origin file:line evidence describing what the current code actually does.
- Be skeptical of "fixed": a SECURITY DEFINER helper or requireAdmin gate may move the concern, not eliminate it — say PARTIAL if defense-in-depth is still convention-only.
- Findings about files NOT in your list (untouched code) are out of scope — skip them.
- action: CLOSE only if FIXED; UPDATE if PARTIAL/MOVED; STAND if STILL_PRESENT.

Return the structured verdict object.`,
    { label: `reval:${p.id}`, phase: 'Revalidate', model: 'opus', schema: SCHEMA }
  )
))

phase('Synthesize')
const flat = results.filter(Boolean).flatMap((r) => (r.verdicts || []).map((v) => ({ ...v, phase: r.phase })))
const close = flat.filter((v) => v.action === 'CLOSE')
const update = flat.filter((v) => v.action === 'UPDATE')
const stand = flat.filter((v) => v.action === 'STAND')

log(`Revalidation complete: ${flat.length} verdicts — CLOSE ${close.length}, UPDATE ${update.length}, STAND ${stand.length}`)

return { totals: { verdicts: flat.length, close: close.length, update: update.length, stand: stand.length }, close, update, stand, raw: results.filter(Boolean) }
