# Runtime-functional config: admin Settings framework + embedding (#454)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/settings/src/web-search-key.ts` (#447 Brave-key precedent — cipher,
instance_settings, getWebSearchKeyConfig status pattern), `packages/settings/src/instance-settings-keys.ts`
(registry + secret guard), `packages/memory/src/embedding-provider-config.ts:24` (comment: "M-A3 replaces
this with a DB-backed reader feeding the capability router; EmbeddingProviderConfig shape and
createEmbeddingProvider factory stay stable"), `apps/web/src/settings/settings-ai-admin-pane.tsx`
(`AiProvidersPane` — existing home for AI provider + Brave-key admin UI).

## 1. Decision

Generalize the Brave Search API-key pattern (#447) into a **runtime-functional config framework**:
admin-configurable, DB-backed (encrypted where secret), DB-first/env-fallback, with an admin UI.
Migrate **embedding provider/model** as the first concrete key — the trigger pain that forced
hand-editing `JARVIS_EMBED_PROVIDER=local` in prod.

The framework is the deliverable; each future functional var (TZ, email cap, chat replay-K, etc.)
becomes a mechanical follow-up that registers one key + adds one UI row. This spec ships the
framework + the embedding key only.

## 2. Why framework-first, not key-at-a-time

The Brave key was a one-off. Doing the same for embedding would be a second one-off, and every
future functional var a third. The pattern is now clear enough to generalize once:

- A **runtime-config registry** (alongside `INSTANCE_SETTINGS_REGISTRY`) declaring functional keys:
  key name, type, default, validation, secret flag.
- A **DB-backed reader** that resolves each key: instance_settings row → env var → declared default.
- The **admin UI** renders the registry generically (with per-key custom widgets for non-trivial
  inputs like provider dropdowns).

Each new key is then: register, wire its reader to use the resolver, add UI metadata. No new
routes, no new cipher plumbing, no new admin-pane scaffolding per key.

## 3. Registry

New file `packages/settings/src/runtime-config-keys.ts` (sibling to `instance-settings-keys.ts`):

```ts
export type RuntimeConfigType = "string" | "enum" | "int" | "secret";

export interface RuntimeConfigKeyEntry {
  readonly key: string;                  // e.g. "ai.embed_provider"
  readonly label: string;                // admin UI label
  readonly type: RuntimeConfigType;
  readonly description: string;
  readonly defaultValue: string;         // used when neither DB nor env is set
  readonly envVar: string;               // the legacy env var this replaces (fallback)
  readonly enumValues?: readonly string[]; // for type "enum" — validated at write
  readonly secret?: boolean;             // AES-256-GCM envelope if true
  readonly moduleOwner: string;          // which package owns this (for blast-radius docs)
}

export const RUNTIME_CONFIG_REGISTRY: readonly RuntimeConfigKeyEntry[] = [
  {
    key: "ai.embed_provider",
    label: "Embedding provider",
    type: "enum",
    description: "Where notes/knowledge embeddings are generated. 'local' = on-device model; 'stub' = no-op (search won't work).",
    defaultValue: "local",
    envVar: "JARVIS_EMBED_PROVIDER",
    enumValues: ["local", "stub"],
    moduleOwner: "memory"
  },
  {
    key: "ai.embed_model",
    label: "Embedding model",
    type: "string",
    description: "Model id for the local embedding provider. Leave blank for the provider default.",
    defaultValue: "",
    envVar: "JARVIS_EMBED_MODEL",
    moduleOwner: "memory"
  }
];
```

Secret keys reuse the existing `JsonSecretCipher` family (same keyring as Brave/AI secrets — no new
key to provision, matching `createWebSearchSecretCipher`). The first two keys (embedding) are
non-secret; the secret path is defined now so the first secret runtime key lands cleanly.

## 4. DB-backed reader

Each owning module's reader swaps from `process.env[...]` to a resolver. The
`EmbeddingProviderConfig` shape and `createEmbeddingProvider` factory **stay stable** (per the
existing code comment) — only `getEmbeddingProviderConfig` changes:

```ts
// packages/memory/src/embedding-provider-config.ts
export async function getEmbeddingProviderConfig(
  resolver: RuntimeConfigResolver
): Promise<EmbeddingProviderConfig> {
  const kind = await resolver.resolveEnum("ai.embed_provider"); // DB → env → default, validated
  const modelId = await resolver.resolveString("ai.embed_model");
  return modelId ? { kind, modelId } : { kind };
}
```

`RuntimeConfigResolver` (new, in `packages/settings/src/runtime-config-resolver.ts`) reads
`app.instance_settings` (admin-scoped, via `SettingsRepository`), falls back to the registered env
var, then the declared default. Each typed method (`resolveString`, `resolveEnum`, `resolveInt`,
`resolveSecret`) validates against the registry entry. Caching is bounded + invalidated on write
(the resolver listens to the same write path the admin PUT uses, or is constructed per-request —
decide in implementation; embedding is read on every memory operation, so a small TTL cache is
likely warranted, keyed by key+updatedAt).

`getEmbeddingProviderConfig` becomes async — trace its callers and update them. The factory stays
sync; only the config-read is async now.

## 5. Admin UI

In `apps/web/src/settings/settings-ai-admin-pane.tsx` (`AiProvidersPane` — the existing home for AI
provider + Brave-key admin config), add a new `<EmbeddingConfigGroup />` section mirroring
`<WebSearchKeyGroup />`:

- Reads `GET /api/admin/runtime-config/ai.embed_provider` and `.../ai.embed_model` →
  `{ value, source: "instance" | "env" | "default" }`.
- Embedding provider renders as a `<Select>` of `["local", "stub"]`; model renders as a text input.
- Save → `PUT /api/admin/runtime-config/:key` body `{ value }`.
- Shows the resolved source as a badge ("Instance", "Env", "Default") matching the Brave-key status
  pattern. A value coming from env shows "Env — clear to use instance" so the admin understands the
  fallback is still active.
- Reuses `@jarv1s/settings-ui` atoms (now extracted via the settings-connector spec).

No new admin pane. Future runtime keys add a `<...ConfigGroup />` in their owning area (most land
here in `AiProvidersPane` or a sibling admin pane).

## 6. Routes

Two generic routes (admin-scoped, gated by `settings.view` / admin RLS, matching the existing
`/api/admin/settings` family) in `packages/settings/src/routes.ts`:

- `GET /api/admin/runtime-config/:key` → `{ value: string | null, source: "instance" | "env" | "default" }`.
  For secret keys, `value` is never returned (only `source`/presence), mirroring Brave-key GET.
- `PUT /api/admin/runtime-config/:key` body `{ value: string }` → validates against the registry
  (type, enumValues, secret), encrypts if secret, upserts the instance_settings row, returns the new
  status. Reuses `SettingsRepository.upsertInstanceSetting` + audit (`action:
  "runtime_config.<key>.set"`).

The registry keys are added to `KNOWN_INSTANCE_SETTING_KEYS` so the generic list/upsert routes
recognize them (and the secret ones are rejected on the generic upsert, same as Brave).

## 7. DB-first/env-fallback semantics

For each key, resolution order:

1. `app.instance_settings` row for this key (encrypted envelope decrypted if secret) → `source: "instance"`.
2. The registered `envVar`, if non-empty → `source: "env"`.
3. The declared `defaultValue` → `source: "default"`.

This means **existing env-only deploys keep working unchanged** — zero-downtime migration. An admin
who sets the instance value overrides env for that key going forward. Clearing the instance value
falls back to env (then default). No data migration script needed.

## 8. Full env-var audit (from the issue)

Classification of every `JARVIS_*` var read in the codebase:

**Already DB-backed:** `JARVIS_BRAVE_SEARCH_API_KEY` (#447).

**Migrated by this spec:** `JARVIS_EMBED_PROVIDER`, `JARVIS_EMBED_MODEL`.

**Deployment wiring (STAY env — set once at install, not user-tunable):** `JARVIS_VAULT_ROOT`,
`JARVIS_NOTES_ROOTS`, `JARVIS_DB_CONNECT_TIMEOUT_MS`, `JARVIS_CLI_HOME_BASE`, `JARVIS_CHAT_HOME`,
`JARVIS_CLI_RUNNER_RPC_TIMEOUT_MS`, `JARVIS_AI_SECRET_KEY*`, `JARVIS_CONNECTOR_SECRET_KEY*`,
`JARVIS_*_DATABASE_URL`, auth client IDs/secrets, ports/subnet (per the issue).

**Runtime-functional follow-ups (each a future child issue, register + reader swap + UI row):**
`JARVIS_DEFAULT_TZ`, `JARVIS_EMAIL_SYNC_CAP`, `JARVIS_EMAIL_LLM_TIMEOUT_MS`,
`JARVIS_CHAT_REPLAY_K`, `JARVIS_CHAT_SEED_BUDGET_TOKENS`.

**Rate-limit tunables (borderline — operational, likely stay env unless product wants them surfaced):**
`JARVIS_RL_PERSONA_PREVIEW_MAX`, `JARVIS_RL_MCP_MAX`, `JARVIS_RL_CHAT_MAX`,
`JARVIS_RL_CHAT_MUTATION_MAX`, `JARVIS_RL_AI_TOOLS_MAX`, `JARVIS_RL_OAUTH_MAX`,
`JARVIS_RL_GOOGLE_SYNC_MAX`. Decision: **defer** — surface only if/when an admin needs to tune
these without a redeploy.

## 9. Security & invariants

- **Admin-only writes.** Routes gated by admin RLS + `settings.view` (the existing instance_settings
  posture). Defense in depth, same as Brave key.
- **Secrets encrypted at rest** via the shared `JsonSecretCipher` keyring. Never returned in GET
  (only `source`/presence), never in audit metadata, never in logs. Plaintext only in memory at
  decrypt time.
- **Validated at the boundary.** Enum values reject typos (an invalid provider never reaches the
  factory); ints reject non-numeric; the existing `JARVIS_EMBED_PROVIDER` boundary-validation
  pattern is preserved and generalized.
- **Metadata-only audit.** Audit row records `action` + key name, never the value (secret or not).
- **No new context fields, no RLS weakening.** Reuses `instance_settings` table as-is.

## 10. Rollout / blast radius

- `packages/settings/src/runtime-config-keys.ts` — new registry.
- `packages/settings/src/runtime-config-resolver.ts` — new resolver.
- `packages/settings/src/runtime-config-routes.ts` — new GET/PUT routes (or fold into `routes.ts`).
- `packages/settings/src/instance-settings-keys.ts` — add the two embedding keys to
  `KNOWN_INSTANCE_SETTING_KEYS`.
- `packages/memory/src/embedding-provider-config.ts` — `getEmbeddingProviderConfig` becomes async +
  uses the resolver; trace/update all callers.
- `packages/settings/src/manifest.ts` — register the two new routes.
- `packages/shared/src/*-api.ts` — DTOs + schemas for the runtime-config GET/PUT.
- `apps/web/src/api/client.ts` + `query-keys.ts` — client fns + keys.
- `apps/web/src/settings/settings-ai-admin-pane.tsx` — new `<EmbeddingConfigGroup />`.

**No DB migration** — reuses `app.instance_settings` as-is. **No env var removal** — env stays as
fallback (§7).

## 11. Out of scope

- Migrating the functional follow-up keys (TZ, email cap, chat replay-K, etc.) — each is a child
  issue once the framework lands.
- Rate-limit tunables (deferred, §8).
- A non-admin/user-scoped runtime-config surface (these are instance-wide admin settings only).
- Removing the legacy env vars (they remain as fallback indefinitely for zero-downtime upgrades).
- A "test the resolver" integration harness beyond the per-key unit tests.
