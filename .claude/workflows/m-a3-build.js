export const meta = {
  name: 'm-a3-real-ai-providers',
  description: 'M-A3: Real AI provider calls — CLI bridge, HTTP adapters, async worker, activity panel',
  phases: [
    { title: 'Phase 0: Foundation contract' },
    { title: 'Phase 1: Adapters (parallel)' },
    { title: 'Phase 1 merge: Typecheck gate' },
    { title: 'Phase 2: Wiring (serial, DB)' },
    { title: 'Phase 3: Web' },
    { title: 'Phase 4: Verify & close out' },
  ],
};

const ROOT = '~/Jarv1s';
const PLAN = 'docs/superpowers/plans/2026-06-07-m-a3-real-ai-providers.md';

// SAFETY: The working tree has uncommitted doc edits (docs/, CLAUDE.md, .claude/skills/start/)
// that must NOT be swept into M-A3 commits. Every git add in every agent MUST name specific
// files. NEVER use 'git add -A', 'git add .', or 'git add --all'.
const SPEC = 'docs/superpowers/specs/m-a3-real-ai-providers.md';
const BRANCH = 'm-a3-real-ai-providers';

// ─── Phase 0: Foundation contract ───────────────────────────────────────────
phase('Phase 0: Foundation contract');

await agent(
  'Task 1: Create packages/ai/src/chat-adapter.ts with the ChatProviderAdapter interface.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + ' (already checked out)\n' +
  '- Plan: ' + PLAN + '\n' +
  '- Spec: ' + SPEC + '\n' +
  '\n' +
  'Steps:\n' +
  '1. Read packages/ai/src/repository.ts to find AiConfiguredModelSafeRow (or equivalent routed-model type)\n' +
  '2. Read packages/ai/src/index.ts to see what is currently exported\n' +
  '3. Create packages/ai/src/chat-adapter.ts with:\n' +
  '   - ChatTurn interface: { readonly role: "user" | "assistant"; readonly content: string }\n' +
  '   - ChatActivityEvent interface: { readonly kind: "thinking" | "tool" | "status" | "other"; readonly text: string }\n' +
  '   - GenerateChatInput interface: { readonly model: AiConfiguredModelSafeRow; readonly messages: readonly ChatTurn[]; readonly onActivity?: (event: ChatActivityEvent) => void }\n' +
  '   - ChatProviderAdapter interface: { generateChat(input: GenerateChatInput): Promise<{ readonly text: string }> }\n' +
  '   Use the exact type name from repository.ts for the model field. If AiConfiguredModelSafeRow does not exist, check for AiModelRow or similar.\n' +
  '4. Do NOT touch packages/ai/src/index.ts (exports added in Task 6)\n' +
  '5. Run: cd ' + ROOT + ' && pnpm typecheck 2>&1 | head -40\n' +
  '6. If typecheck passes, commit:\n' +
  '   cd ' + ROOT + '\n' +
  '   git add packages/ai/src/chat-adapter.ts\n' +
  '   git commit -m "feat(ai): chat provider adapter interface + activity event types\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'Report: type import name used, typecheck result, commit hash.',
  { label: 'T1:chat-adapter-interface', phase: 'Phase 0: Foundation contract' }
);

// ─── Phase 1: Adapters (parallel, worktree-isolated) ─────────────────────────
phase('Phase 1: Adapters (parallel)');

await parallel([

  () => agent(
    'Task 2: Implement the tmux CLI bridge adapter and JSONL transcript reader.\n' +
    '\n' +
    'Context:\n' +
    '- Root: ' + ROOT + '\n' +
    '- Branch: ' + BRANCH + '\n' +
    '- Plan (read it fully for Task 2): ' + PLAN + '\n' +
    '- CRITICAL: Do NOT touch packages/ai/src/index.ts\n' +
    '- Tests go in tests/unit/ (NOT tests/integration/)\n' +
    '- No Postgres — mock all I/O boundaries\n' +
    '\n' +
    'Steps:\n' +
    '\n' +
    'STEP 1 (DISCOVERY — do this first):\n' +
    'Run: ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -3\n' +
    'Then: tail -20 <first-jsonl-file>\n' +
    'Also search for codex/gemini transcripts:\n' +
    '  find ~ -maxdepth 5 -iname "*.jsonl" 2>/dev/null | grep -i "codex\\|openai\\|gemini\\|google" | head -5\n' +
    'Record: exact field names, how role/type is indicated, how final assistant reply is identified vs intermediate events.\n' +
    '\n' +
    'STEP 2: Create tests/unit/ directory if needed. Write failing tests in tests/unit/ai-tmux-bridge.test.ts\n' +
    'Use a fixture JSONL string matching the REAL schema you discovered. Test parseTranscript and TmuxBridgeAdapter (with fake TmuxIo).\n' +
    'Run: cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-tmux-bridge.test.ts 2>&1 | tail -10 (expect FAIL)\n' +
    '\n' +
    'STEP 3: Create packages/ai/src/adapters/transcript-reader.ts\n' +
    'Include a comment at the top documenting the REAL discovered schema per provider.\n' +
    'Export: ProviderKind type, TranscriptParseResult interface, parseTranscript function.\n' +
    'The implementation MUST match the real Claude transcript schema from Step 1.\n' +
    'For codex/google: use discovered schema or mark with TODO if no transcript found.\n' +
    '\n' +
    'STEP 4: Create packages/ai/src/adapters/tmux-bridge.ts\n' +
    'Export TmuxIo interface and TmuxBridgeAdapter class implementing ChatProviderAdapter.\n' +
    'TmuxIo has: run(cmd, args) -> {code, stdout}, readFile(path) -> string, sleep(ms) -> void.\n' +
    'TmuxBridgeAdapter: one tmux session per threadKey; send prompt via tmux send-keys (load-buffer for multiline); poll transcript file; emit onActivity events; return final reply or throw on timeout.\n' +
    'Import ChatProviderAdapter from ../chat-adapter.js (created in Task 1).\n' +
    '\n' +
    'STEP 5: Run tests -> PASS\n' +
    'cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-tmux-bridge.test.ts 2>&1 | tail -20\n' +
    '\n' +
    'STEP 6: Commit (do NOT touch index.ts)\n' +
    'git add packages/ai/src/adapters/transcript-reader.ts packages/ai/src/adapters/tmux-bridge.ts tests/unit/ai-tmux-bridge.test.ts\n' +
    'git commit -m "feat(ai): tmux CLI bridge adapter + JSONL transcript reader\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
    '\n' +
    'Report: JSONL schema discovered (field names, completion signal), test results, commit hash.',
    { label: 'T2:tmux-bridge', phase: 'Phase 1: Adapters (parallel)', isolation: 'worktree' }
  ),

  () => agent(
    'Task 3: Implement the HTTP API key adapter for anthropic, openai-compatible, and google.\n' +
    '\n' +
    'Context:\n' +
    '- Root: ' + ROOT + '\n' +
    '- Branch: ' + BRANCH + '\n' +
    '- Plan (read it fully for Task 3): ' + PLAN + '\n' +
    '- CRITICAL: Do NOT touch packages/ai/src/index.ts\n' +
    '- Tests go in tests/unit/ (NOT tests/integration/)\n' +
    '- No Postgres\n' +
    '\n' +
    'STEP 1: Write failing test in tests/unit/ai-http-api.test.ts\n' +
    'Test HttpApiAdapter for each provider kind:\n' +
    '  - anthropic: POST to messages endpoint, maps content[0].text; throws HTTP 401 without leaking the key\n' +
    '  - openai-compatible: POST to chat/completions, maps choices[0].message.content\n' +
    '  - google: POST to generateContent, maps candidates[0].content.parts[0].text\n' +
    'Inject a fake fetch function. The API key must NOT appear in error messages.\n' +
    'Run: cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-http-api.test.ts 2>&1 | tail -10 (expect FAIL)\n' +
    '\n' +
    'STEP 2: Create packages/ai/src/adapters/http-api.ts\n' +
    'Export HttpApiAdapter class implementing ChatProviderAdapter.\n' +
    'Constructor: (providerKind: ProviderKind, apiKey: string, opts?: { fetch?: typeof fetch, baseUrl?: string })\n' +
    'Import ChatProviderAdapter from ../chat-adapter.js and ProviderKind from ./transcript-reader.js.\n' +
    'If transcript-reader.ts does not exist yet (parallel task), define ProviderKind locally as a type alias.\n' +
    'Per-provider request builders:\n' +
    '  - anthropic: https://api.anthropic.com/v1/messages, header x-api-key + anthropic-version: 2023-06-01\n' +
    '  - openai-compatible: ${baseUrl ?? "https://api.openai.com"}/v1/chat/completions, header Authorization: Bearer key\n' +
    '  - google: https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=KEY\n' +
    'Map ChatTurn[] to each provider format. On non-2xx: throw Error("HTTP " + status) — never include the key.\n' +
    'May emit a single onActivity event {kind:"status", text:"calling api..."} if onActivity is provided.\n' +
    'Injectable fetch in opts (default: global fetch).\n' +
    '\n' +
    'STEP 3: Run tests -> PASS\n' +
    'cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-http-api.test.ts 2>&1 | tail -20\n' +
    '\n' +
    'STEP 4: Commit (do NOT touch index.ts)\n' +
    'git add packages/ai/src/adapters/http-api.ts tests/unit/ai-http-api.test.ts\n' +
    'git commit -m "feat(ai): API-key HTTP chat adapter (anthropic/openai/google)\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
    '\n' +
    'Report: test results, commit hash.',
    { label: 'T3:http-api-adapter', phase: 'Phase 1: Adapters (parallel)', isolation: 'worktree' }
  ),

  () => agent(
    'Task 4: Implement CLI and tmux presence detection (PATH check only, no auth probing).\n' +
    '\n' +
    'Context:\n' +
    '- Root: ' + ROOT + '\n' +
    '- Branch: ' + BRANCH + '\n' +
    '- CRITICAL: Do NOT touch packages/ai/src/index.ts\n' +
    '- Tests go in tests/unit/ (NOT tests/integration/)\n' +
    '- No Postgres\n' +
    '\n' +
    'STEP 1: Write failing test in tests/unit/ai-cli-availability.test.ts\n' +
    'Test cliAvailable(providerKind, deps) with injected { which: async (bin) => path | null }:\n' +
    '  - anthropic maps to "claude" binary\n' +
    '  - openai-compatible maps to "codex" binary\n' +
    '  - google maps to "gemini" binary\n' +
    '  - returns true when which returns a path, false when null\n' +
    'Test tmuxAvailable(deps): checks "tmux" binary.\n' +
    'Run: cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-cli-availability.test.ts 2>&1 | tail -10 (expect FAIL)\n' +
    '\n' +
    'STEP 2: Create packages/ai/src/cli-availability.ts\n' +
    'Define ProviderKind locally (do not import from transcript-reader.ts since that is a parallel task):\n' +
    '  type ProviderKind = "anthropic" | "openai-compatible" | "google"\n' +
    'Export:\n' +
    '  - cliAvailable(providerKind: ProviderKind, deps?: WhichDeps): Promise<boolean>\n' +
    '    Maps anthropic->"claude", openai-compatible->"codex", google->"gemini"; uses injected which or default node:child_process "command -v"\n' +
    '  - tmuxAvailable(deps?: WhichDeps): Promise<boolean>\n' +
    '    Checks "tmux" binary\n' +
    'WhichDeps = { which: (binary: string) => Promise<string | null> }\n' +
    'Default which: use child_process exec("command -v <binary>"), return stdout.trim() or null on error.\n' +
    'NO auth probing — presence only.\n' +
    '\n' +
    'STEP 3: Run tests -> PASS\n' +
    'cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-cli-availability.test.ts 2>&1 | tail -20\n' +
    '\n' +
    'STEP 4: Commit (do NOT touch index.ts)\n' +
    'git add packages/ai/src/cli-availability.ts tests/unit/ai-cli-availability.test.ts\n' +
    'git commit -m "feat(ai): CLI + tmux presence detection (no auth probe)\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
    '\n' +
    'Report: test results, commit hash.',
    { label: 'T4:cli-availability', phase: 'Phase 1: Adapters (parallel)', isolation: 'worktree' }
  ),

]);

// ─── Phase 1 merge: typecheck gate ───────────────────────────────────────────
phase('Phase 1 merge: Typecheck gate');

await agent(
  'Merge Phase-1 worktree results and run serial typecheck.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '\n' +
  'Three parallel agents committed to the branch in isolated worktrees:\n' +
  '  - T2: packages/ai/src/adapters/transcript-reader.ts + tmux-bridge.ts + tests/unit/ai-tmux-bridge.test.ts\n' +
  '  - T3: packages/ai/src/adapters/http-api.ts + tests/unit/ai-http-api.test.ts\n' +
  '  - T4: packages/ai/src/cli-availability.ts + tests/unit/ai-cli-availability.test.ts\n' +
  '\n' +
  'Steps:\n' +
  '1. Check git log: cd ' + ROOT + ' && git log --oneline -15\n' +
  '2. Check all expected files exist:\n' +
  '   ls packages/ai/src/adapters/ 2>/dev/null\n' +
  '   ls packages/ai/src/cli-availability.ts 2>/dev/null\n' +
  '   ls tests/unit/ 2>/dev/null\n' +
  '3. If any files are missing, check git branch -a and cherry-pick any missing commits\n' +
  '4. Check for cross-task import issues (http-api.ts imports ProviderKind from transcript-reader.ts,\n' +
  '   cli-availability.ts defines ProviderKind locally — there may be a conflict. Resolve by having\n' +
  '   cli-availability.ts also import from transcript-reader.ts now that it exists).\n' +
  '5. Run typecheck: cd ' + ROOT + ' && pnpm typecheck 2>&1 | head -50\n' +
  '6. Fix any typecheck errors (likely minor import/type mismatches between Phase-1 files). Commit fixes.\n' +
  '7. Run all unit tests: cd ' + ROOT + ' && pnpm vitest run tests/unit/ 2>&1 | tail -30\n' +
  '8. Fix any test failures.\n' +
  '\n' +
  'Report: git log (last 10 commits), file presence, typecheck result, unit test results.',
  { label: 'merge-typecheck-gate', phase: 'Phase 1 merge: Typecheck gate' }
);

// ─── Phase 2: Wiring (serial, DB) ────────────────────────────────────────────
phase('Phase 2: Wiring (serial, DB)');

await agent(
  'Task 5: Add auth_method column + update ai types, DTOs, repository, and routes.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '- Plan (read Task 5 section): ' + PLAN + '\n' +
  '- Postgres must be running. Start if needed: cd ' + ROOT + ' && pnpm db:up\n' +
  '\n' +
  'STEP 1 (DISCOVERY):\n' +
  '  ls packages/*/sql/*.sql | sort | tail -5   # find next migration number\n' +
  '  grep -rn "ai_provider_configs" packages/ai/sql/*.sql | head -5   # confirm table name/columns\n' +
  '  grep -n "migration\\|applied\\|count" tests/integration/foundation.test.ts | head -10\n' +
  '\n' +
  'STEP 2: Start DB and migrate current state:\n' +
  '  cd ' + ROOT + ' && pnpm db:up 2>&1 | tail -3 && pnpm db:migrate 2>&1 | tail -5\n' +
  '\n' +
  'STEP 3: Create new migration file packages/ai/sql/00NN_ai_auth_method.sql (use discovered N):\n' +
  '  ALTER TABLE app.ai_provider_configs\n' +
  '    ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT \'api_key\'\n' +
  '      CHECK (auth_method IN (\'cli\', \'api_key\'));\n' +
  'Register in packages/ai/src/manifest.ts under database.migrations (match existing pattern).\n' +
  'Update migration count in tests/integration/foundation.test.ts if it asserts an exact count.\n' +
  '\n' +
  'STEP 4: Read the existing ai.test.ts, then write a failing integration test:\n' +
  '  - Create provider with authMethod: "cli" -> read back -> assert authMethod === "cli" and hasCredential === false\n' +
  '  - Default authMethod is "api_key"\n' +
  '  Run: cd ' + ROOT + ' && pnpm test:ai 2>&1 | tail -20 (expect FAIL)\n' +
  '\n' +
  'STEP 5: Implement (read each file before editing):\n' +
  '  - packages/db/src/types.ts: add auth_method: "cli" | "api_key" to AI provider configs table type\n' +
  '  - packages/shared/src/ai-api.ts: add authMethod + cliAvailable: boolean to provider DTO\n' +
  '  - packages/ai/src/repository.ts: thread auth_method through create/update/read; cli providers skip credential requirement\n' +
  '  - packages/ai/src/routes.ts: accept authMethod in create/update; populate cliAvailable in DTO via cliAvailable(provider_kind) from ./cli-availability.js\n' +
  '\n' +
  'STEP 6: Apply migration and run tests:\n' +
  '  cd ' + ROOT + ' && pnpm db:migrate 2>&1 | tail -5 && pnpm test:ai 2>&1 | tail -30\n' +
  '  Fix until PASS.\n' +
  '\n' +
  'STEP 7: Commit — stage ONLY your specific files by name (NEVER git add -A or git add .):\n' +
  '  Determine which files you actually created/modified, then:\n' +
  '  git add packages/ai/sql/<migration-file>.sql packages/ai/src/manifest.ts packages/db/src/types.ts packages/shared/src/ai-api.ts packages/ai/src/repository.ts packages/ai/src/routes.ts\n' +
  '  Also add tests/integration/foundation.test.ts if you updated the migration count.\n' +
  '  Also add tests/integration/ai.test.ts for the new test.\n' +
  '  git commit -m "feat(ai): auth_method column + DTO + cli-availability in provider routes\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'INVARIANT: Never edit an existing applied migration. Only add new files.\n' +
  'Report: migration number used, test results, commit hash.',
  { label: 'T5:auth-method-migration', phase: 'Phase 2: Wiring (serial, DB)' }
);

await agent(
  'Task 6: Add createChatAdapter factory to chat-adapter.ts and export all adapter types from ai/index.ts.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '- Plan (read Task 6 section): ' + PLAN + '\n' +
  '\n' +
  'STEP 1: Read these files to understand exact shapes:\n' +
  '  cat packages/ai/src/chat-adapter.ts\n' +
  '  cat packages/ai/src/adapters/tmux-bridge.ts | head -40\n' +
  '  cat packages/ai/src/adapters/http-api.ts | head -40\n' +
  '  cat packages/ai/src/repository.ts | grep -A3 "ProviderConfig\\|auth_method\\|decrypt\\|crypto"\n' +
  '  cat packages/ai/src/index.ts\n' +
  '  grep -rn "decrypt\\|AiSecret\\|EncryptedAiSecret" packages/ai/src/ | head -5\n' +
  '\n' +
  'STEP 2: Write failing unit test in tests/unit/ai-chat-adapter-factory.test.ts:\n' +
  '  - createChatAdapter(provider with auth_method="cli", {threadKey}) returns a TmuxBridgeAdapter\n' +
  '  - createChatAdapter(provider with auth_method="api_key", {threadKey, decryptedKey}) returns HttpApiAdapter\n' +
  '  - createChatAdapter with api_key but no decryptedKey throws\n' +
  '  Run: cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-chat-adapter-factory.test.ts 2>&1 | tail -10 (expect FAIL)\n' +
  '\n' +
  'STEP 3: Add createChatAdapter to packages/ai/src/chat-adapter.ts:\n' +
  '  export interface CreateChatAdapterDeps { threadKey: string; decryptedKey?: string; cwd?: string }\n' +
  '  export function createChatAdapter(provider, deps): ChatProviderAdapter\n' +
  '  - auth_method "cli" -> new TmuxBridgeAdapter(providerKind, threadKey, realTmuxIo, {cwd})\n' +
  '  - auth_method "api_key" -> if no decryptedKey throw; else new HttpApiAdapter(providerKind, decryptedKey)\n' +
  '  realTmuxIo uses node:child_process exec and node:fs/promises readFile\n' +
  '  Adapt types to exactly match the codebase (use the actual provider row type from repository.ts).\n' +
  '\n' +
  'STEP 4: Update packages/ai/src/index.ts to export:\n' +
  '  - From chat-adapter.ts: ChatTurn, ChatActivityEvent, GenerateChatInput, ChatProviderAdapter, createChatAdapter, CreateChatAdapterDeps\n' +
  '  - From adapters/tmux-bridge.ts: TmuxBridgeAdapter, TmuxIo\n' +
  '  - From adapters/http-api.ts: HttpApiAdapter\n' +
  '  - From adapters/transcript-reader.ts: parseTranscript, ProviderKind, TranscriptParseResult\n' +
  '  - From cli-availability.ts: cliAvailable, tmuxAvailable\n' +
  '\n' +
  'STEP 5: Run tests and typecheck:\n' +
  '  cd ' + ROOT + ' && pnpm vitest run tests/unit/ai-chat-adapter-factory.test.ts 2>&1 | tail -20\n' +
  '  pnpm typecheck 2>&1 | head -30\n' +
  '\n' +
  'STEP 6: Commit:\n' +
  '  git add packages/ai/src/chat-adapter.ts packages/ai/src/index.ts tests/unit/ai-chat-adapter-factory.test.ts\n' +
  '  git commit -m "feat(ai): createChatAdapter factory + export adapters from ai index\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'Report: factory signature, test results, typecheck result, commit hash.',
  { label: 'T6:factory-and-exports', phase: 'Phase 2: Wiring (serial, DB)' }
);

await agent(
  'Task 7a: Add working/error chat statuses, activity DTO, and enqueue a metadata-only job from appendUserMessage.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '- Plan (read Task 7a section): ' + PLAN + '\n' +
  '- Postgres is running\n' +
  '\n' +
  'STEP 1 (DISCOVERY):\n' +
  '  grep -n "status\\|CHECK\\|enum" packages/chat/sql/*.sql | head -20\n' +
  '  grep -n "ChatMessageStatus\\|status\\|pending\\|stored" packages/shared/src/chat-api.ts | head -20\n' +
  '  grep -n "model_metadata\\|activity" packages/chat/sql/*.sql | head -10\n' +
  '  cat packages/tasks/src/jobs.ts | head -60   # canonical worker/queue pattern\n' +
  '  cat packages/tasks/src/manifest.ts | head -40\n' +
  '  grep -rn "boss\\|enqueue\\|registerDataContextWorker\\|QueueDefinition\\|ActorScopedJobPayload" packages/tasks/src/ | head -10\n' +
  '  ls packages/*/sql/*.sql | sort | tail -5   # next migration number\n' +
  '\n' +
  'STEP 2: Add working and error statuses:\n' +
  '  If status is CHECK-constrained in SQL: create packages/chat/sql/00NN_chat_status_activity.sql\n' +
  '  extending the constraint to include "working" and "error".\n' +
  '  If free text: no migration needed.\n' +
  '  Register in manifest if migration created. Update foundation.test.ts migration count.\n' +
  '  Add "working" | "error" to ChatMessageStatus in packages/shared/src/chat-api.ts and packages/db/src/types.ts.\n' +
  '  Add activity?: ChatActivityEventDto[] to the message DTO (ChatActivityEventDto: {kind: string, text: string}).\n' +
  '\n' +
  'STEP 3: Declare CHAT_EXECUTION_QUEUE in packages/chat/src/manifest.ts (mirror tasks pattern).\n' +
  '\n' +
  'STEP 4: Read existing tests/integration/chat.test.ts, then write a failing test:\n' +
  '  When appendUserMessage resolves a route, the assistant message has status "pending"\n' +
  '  AND exactly one job is enqueued with payload containing only {actorUserId, threadId, assistantMessageId}.\n' +
  '  Inject a fake boss or capture enqueued jobs via a spy.\n' +
  '  Run: cd ' + ROOT + ' && pnpm test:chat 2>&1 | tail -30 (expect FAIL)\n' +
  '\n' +
  'STEP 5: Implement:\n' +
  '  Modify packages/chat/src/repository.ts:\n' +
  '    - Give ChatRepository access to a boss/enqueue function (add to constructor deps like tasks does)\n' +
  '    - In appendUserMessage, when route is available: still set status "pending" but NOW also enqueue\n' +
  '      a metadata-only job {actorUserId, threadId, assistantMessageId} — NO prompt content, NO secrets\n' +
  '  The payload MUST contain only those three fields.\n' +
  '\n' +
  'STEP 6: Apply migration and run tests:\n' +
  '  cd ' + ROOT + ' && pnpm db:migrate 2>&1 | tail -5 && pnpm test:chat 2>&1 | tail -30\n' +
  '  Fix until PASS.\n' +
  '\n' +
  'STEP 7: Commit — stage ONLY your specific files by name (NEVER git add -A or git add .):\n' +
  '  git add packages/shared/src/chat-api.ts packages/db/src/types.ts packages/chat/src/manifest.ts packages/chat/src/repository.ts\n' +
  '  If you created a migration: git add packages/chat/sql/<migration-file>.sql\n' +
  '  Also add tests/integration/chat.test.ts and tests/integration/foundation.test.ts if changed.\n' +
  '  git commit -m "feat(chat): async execution statuses, activity DTO, metadata-only job enqueue\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'INVARIANT: Payload must contain ONLY {actorUserId, threadId, assistantMessageId} — no content, no secrets.\n' +
  'Report: status constraint discovery, migration number, enqueue pattern, test results, commit hash.',
  { label: 'T7a:chat-enqueue', phase: 'Phase 2: Wiring (serial, DB)' }
);

await agent(
  'Task 7b: Implement the pg-boss chat worker that drives the ChatProviderAdapter.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '- Plan (read Task 7b section): ' + PLAN + '\n' +
  '- Postgres is running\n' +
  '\n' +
  'STEP 1 (DISCOVERY):\n' +
  '  cat packages/tasks/src/jobs.ts   # canonical worker pattern — copy this\n' +
  '  grep -rn "registerBuiltIn\\|getAllQueue\\|registerDataContextWorker" packages/module-registry/src/ 2>/dev/null | head -20\n' +
  '  grep -rn "registerBuiltIn\\|getAllQueue" apps/api/src/ 2>/dev/null | head -20\n' +
  '  cat packages/chat/src/repository.ts   # understand existing repo helpers\n' +
  '  grep -rn "capability\\|selectModel\\|selectRoute\\|chat" packages/ai/src/ | head -10\n' +
  '  grep -rn "decrypt\\|getSecret\\|encryptedSecret" packages/ai/src/ | head -10\n' +
  '\n' +
  'STEP 2: Write failing integration test in tests/integration/chat.test.ts:\n' +
  '  - Create thread + user message (produces pending assistant message + enqueued job)\n' +
  '  - Call the worker handler directly with fake createChatAdapter that emits 2 activity events then returns {text: "the answer"}\n' +
  '  - Assert: message transitions to "stored", body is "the answer", model_metadata.activity has 2 events\n' +
  '  - Failing adapter path: status becomes "error" with a clear message\n' +
  '  Run: cd ' + ROOT + ' && pnpm test:chat 2>&1 | tail -30 (expect FAIL)\n' +
  '\n' +
  'STEP 3: Create packages/chat/src/jobs.ts:\n' +
  '  - Export ChatExecutionPayload type: {actorUserId: string, threadId: string, assistantMessageId: string}\n' +
  '  - Export registerChatJobWorkers(boss, dataContext, deps?: {createChatAdapter?})\n' +
  '  - The worker: validate payload is metadata-only (throw if unexpected keys); mark message "working";\n' +
  '    load thread history via DataContextRunner; resolve route via capability router;\n' +
  '    call createChatAdapter(provider, {threadKey: threadId, decryptedKey}).generateChat({model, messages, onActivity});\n' +
  '    persist activity events incrementally to model_metadata.activity; on success write final text + set "stored";\n' +
  '    on any error set "error" with a clear message. Never crash the process.\n' +
  '  - Add helper methods to ChatRepository as needed: updateMessageStatus, appendActivity, updateMessageComplete\n' +
  '\n' +
  'STEP 4: Register workers in module registry (mirror tasks pattern exactly).\n' +
  '\n' +
  'STEP 5: Run tests:\n' +
  '  cd ' + ROOT + ' && pnpm test:chat 2>&1 | tail -40\n' +
  '  Fix until PASS.\n' +
  '\n' +
  'STEP 6: Commit:\n' +
  '  git add packages/chat/src/jobs.ts packages/chat/src/repository.ts packages/chat/src/manifest.ts\n' +
  '  # + any module-registry changes\n' +
  '  git commit -m "feat(chat): pg-boss worker drives ChatProviderAdapter; working->stored/error\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'INVARIANTS: Payload validation (throw on unexpected keys). Secrets never in logs/payloads. DataContextDb only.\n' +
  'Report: DataContextRunner pattern used, route resolution approach, activity storage approach, test results, commit hash.',
  { label: 'T7b:chat-worker', phase: 'Phase 2: Wiring (serial, DB)' }
);

// ─── Phase 3: Web ─────────────────────────────────────────────────────────────
phase('Phase 3: Web');

await agent(
  'Task 8: Add async polling, collapsible activity panel, and provider auth_method UI to the web shell.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '- Plan (read Task 8 section): ' + PLAN + '\n' +
  '\n' +
  'STEP 1 (DISCOVERY — required):\n' +
  '  ls apps/web/src/chat/ 2>/dev/null\n' +
  '  ls apps/web/src/ai/ 2>/dev/null || ls apps/web/src/settings/ 2>/dev/null\n' +
  '  cat apps/web/src/chat/*.tsx 2>/dev/null | head -200\n' +
  '  grep -n "ChatMessage\\|status\\|activity\\|working\\|pending" packages/shared/src/chat-api.ts | head -20\n' +
  '  grep -rn "useQuery\\|refetchInterval\\|queryKey" apps/web/src/ | head -20\n' +
  '\n' +
  'STEP 2: Implement polling:\n' +
  '  In the chat messages query hook, check if any assistant message has status "pending" or "working".\n' +
  '  If so, set refetchInterval to ~1500ms. Stop (false) when all messages are "stored" or "error".\n' +
  '  Match the existing React Query patterns exactly.\n' +
  '\n' +
  'STEP 3: Implement the collapsible activity panel:\n' +
  '  In the message render component, for each assistant message:\n' +
  '  - If status is "pending" or "working": show a "working..." indicator\n' +
  '  - If message.activity has items: render a <details> element (collapsed by default)\n' +
  '    with summary "Agent activity (N events)" and list each {kind, text} event\n' +
  '  - When status is "stored" or "error": show the final body\n' +
  '  Use native HTML <details>/<summary> — no new libraries.\n' +
  '\n' +
  'STEP 4: Provider config UI:\n' +
  '  In the AI provider config form:\n' +
  '  - Add auth_method selector (select element) with options: "api_key" (default) and "cli"\n' +
  '  - When auth_method is "cli", hide/disable the API key field\n' +
  '  - When cliAvailable === false and auth_method === "cli", show warning text:\n' +
  '    "CLI not found on PATH. Install and authenticate before using this provider."\n' +
  '\n' +
  'STEP 5: Build and typecheck:\n' +
  '  cd ' + ROOT + ' && pnpm build:web 2>&1 | tail -30\n' +
  '  pnpm --filter @jarv1s/web typecheck 2>&1 | tail -20\n' +
  '  Fix any errors.\n' +
  '\n' +
  'STEP 6: Commit:\n' +
  '  git add apps/web/src/chat/ apps/web/src/ai/\n' +
  '  # + any other changed web files\n' +
  '  git commit -m "feat(web): collapsible activity panel, async polling, provider auth_method UI\n\nCo-Authored-By: Claude <noreply@anthropic.com>"\n' +
  '\n' +
  'Report: files changed, polling approach, activity panel approach, build/typecheck result, commit hash.',
  { label: 'T8:web-activity-panel', phase: 'Phase 3: Web' }
);

// ─── Phase 4: Verify & close out ─────────────────────────────────────────────
phase('Phase 4: Verify & close out');

await agent(
  'Task 9: Run the full verification gate for M-A3. Do NOT skip any step.\n' +
  '\n' +
  'Context:\n' +
  '- Root: ' + ROOT + '\n' +
  '- Branch: ' + BRANCH + '\n' +
  '\n' +
  'STEP 1: Full foundation gate:\n' +
  '  cd ' + ROOT + ' && pnpm verify:foundation 2>&1\n' +
  '  This runs: lint, format:check, check:file-size, typecheck, db:migrate, test:integration.\n' +
  '  If anything fails, fix the root cause. Do NOT use --no-verify or skip steps.\n' +
  '  Do NOT wave off failures as "pre-existing" without confirming against main.\n' +
  '\n' +
  'STEP 2: Release hardening audit:\n' +
  '  cd ' + ROOT + ' && pnpm audit:release-hardening 2>&1\n' +
  '  Must produce passed: true.\n' +
  '\n' +
  'STEP 3: File size check:\n' +
  '  cd ' + ROOT + ' && pnpm check:file-size 2>&1\n' +
  '  If any source file exceeds 1000 lines, split it first.\n' +
  '\n' +
  'STEP 4 (SKIPPED): docs/STATUS.md is now retired — GitHub is the single source of truth.\n' +
  '  Do NOT touch or commit docs/STATUS.md.\n' +
  '\n' +
  'STEP 5: Return a comprehensive report:\n' +
  '  - verify:foundation result (pass/fail, specific failures if any)\n' +
  '  - audit:release-hardening result\n' +
  '  - file-size result\n' +
  '  - Total integration test count\n' +
  '  - Migration count\n' +
  '  - Any issues found and how they were fixed\n' +
  '  - Final commit hash\n' +
  '\n' +
  'IMPORTANT: Do NOT close the GitHub issue — the orchestrator handles that after reviewing your report.',
  { label: 'T9:verify-gate', phase: 'Phase 4: Verify & close out' }
);
