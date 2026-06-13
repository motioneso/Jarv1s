import type { Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import type { ChatMultiplexerChoice } from "@jarv1s/shared";
import { createBinaryProbe, createRealTmuxIo, resolveMultiplexer } from "@jarv1s/ai";
import {
  createRealEngineFactory,
  unavailableEngineFactory,
  type ChatEngineFactory
} from "@jarv1s/chat";

export interface ChatMultiplexerAvailability {
  readonly tmux: boolean;
  readonly herdr: boolean;
}

/**
 * Allowlist of NON-SECRET instance-config keys readable pre-auth via the raw appDb
 * handle. This bounds the documented exemption (Codex finding #1): only these keys
 * may be read this way, and they must never hold secrets (secrets live in the
 * AES-256-GCM credential store, never in instance_settings).
 */
const PREAUTH_READABLE_SETTING_KEYS = new Set<string>(["chat.multiplexer"]);

/** Sync PATH probe for the admin UI hint (apply-on-restart, so a boot snapshot is correct). */
export function probeChatMultiplexerAvailability(
  env: NodeJS.ProcessEnv = process.env
): ChatMultiplexerAvailability {
  const probe = createBinaryProbe(env);
  return { tmux: probe.has("tmux"), herdr: probe.has("herdr") };
}

/**
 * Pre-auth read of the non-secret `chat.multiplexer` instance setting. This is the
 * SAME sanctioned class of access already used by the auth registration gate
 * (packages/auth/src/index.ts `readBooleanSetting` for `registration.enabled`): a
 * raw read as jarvis_app_runtime with NO actor GUC. The instance_settings SELECT
 * policy is USING (true) precisely so boot/pre-auth config reads work (migration
 * 0059_admin_tables_rls.sql), while WRITES stay admin-gated
 * (current_actor_is_admin()). It works on a fresh install with zero users (no actor
 * exists yet), and reads only allowlisted non-secret keys.
 *
 * This is a documented, bounded exception to "DataContextDb only" — see
 * docs/DEVELOPMENT_STANDARDS.md "Pre-auth non-secret instance-config reads" (added
 * by this slice). The admin GET/PUT routes (Task 12) still go through DataContextDb
 * + assertAdminUser; only this boot read bypasses it, and only for the allowlist.
 */
async function readMultiplexerChoice(
  appDb: Kysely<JarvisDatabase>
): Promise<ChatMultiplexerChoice> {
  const key = "chat.multiplexer";
  if (!PREAUTH_READABLE_SETTING_KEYS.has(key)) {
    throw new Error(`pre-auth instance-setting read not allowed for key "${key}"`);
  }
  const row = await appDb
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  const raw = (row?.value as { value?: unknown } | undefined)?.value;
  return raw === "tmux" || raw === "herdr" ? raw : "auto";
}

/**
 * Resolve the production chat engine factory at boot: env override > admin setting >
 * auto-detect. On success returns a factory bound to the one shared Multiplexer; if
 * no multiplexer is installed, returns a factory that throws CliChatUnavailableError
 * (→ HTTP 503), and logs a clear warning. Never throws — live chat is disabled, not
 * crashed.
 */
export async function resolveChatEngineFactory(deps: {
  appDb: Kysely<JarvisDatabase>;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}): Promise<ChatEngineFactory> {
  const env = deps.env ?? process.env;
  const io = createRealTmuxIo();
  const probe = createBinaryProbe(env);
  const configured = await readMultiplexerChoice(deps.appDb);

  let resolution;
  try {
    resolution = resolveMultiplexer({ io, env, configured, isInstalled: (b) => probe.has(b) });
  } catch (err) {
    // Only thrown for an invalid JARVIS_MULTIPLEXER value — a deploy config error.
    const reason = err instanceof Error ? err.message : String(err);
    deps.log?.(`[chat] live CLI chat disabled — ${reason}`);
    return unavailableEngineFactory(reason);
  }

  if (!resolution.ok) {
    deps.log?.(`[chat] live CLI chat disabled — ${resolution.reason}`);
    return unavailableEngineFactory(resolution.reason);
  }
  deps.log?.(
    `[chat] live CLI chat multiplexer: ${resolution.mux.kind} (source: ${resolution.source})`
  );
  return createRealEngineFactory({ mux: resolution.mux });
}
