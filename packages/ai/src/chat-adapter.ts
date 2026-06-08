import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { AiProviderConfigSafeRow } from "./repository.js";
import { TmuxBridgeAdapter, type TmuxIo } from "./adapters/tmux-bridge.js";
import { HttpApiAdapter } from "./adapters/http-api.js";
import type { ProviderKind } from "./adapters/transcript-reader.js";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatActivityEvent {
  readonly kind: "thinking" | "tool" | "status" | "other";
  readonly text: string;
}

export interface GenerateChatInput {
  readonly model: { readonly provider_kind: string; readonly provider_model_id: string };
  readonly messages: readonly ChatTurn[];
  readonly onActivity?: (event: ChatActivityEvent) => void;
}

export interface ChatProviderAdapter {
  generateChat(input: GenerateChatInput): Promise<{ readonly text: string }>;
}

export interface CreateChatAdapterDeps {
  threadKey: string;
  decryptedKey?: string;
  cwd?: string;
}

// Supported CLI provider kinds (subset of AiProviderKind)
const CLI_PROVIDER_KINDS = new Set<ProviderKind>(["anthropic", "openai-compatible", "google"]);

const execFileAsync = promisify(execFile);

/** Real TmuxIo implementation backed by node:child_process and node:fs/promises. */
const realTmuxIo: TmuxIo = {
  async run(cmd: string, args: readonly string[]): Promise<{ code: number; stdout: string }> {
    // Use execFile (not exec) so arguments are passed directly to the process
    // without a shell re-parsing them. A shell join would mangle args containing
    // spaces, quotes, pipes, or redirects (e.g. the `bash -c "<pipeline>"` calls).
    try {
      const { stdout } = await execFileAsync(cmd, [...args]);
      return { code: 0, stdout: stdout ?? "" };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? "" };
    }
  },
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  },
  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  },
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

/**
 * Factory: select and instantiate the right ChatProviderAdapter based on the
 * provider's auth_method and provider_kind.
 *
 * - auth_method "cli"     → TmuxBridgeAdapter (drives a local CLI in a tmux session)
 * - auth_method "api_key" → HttpApiAdapter (direct HTTPS call with decrypted key)
 */
export function createChatAdapter(
  provider: AiProviderConfigSafeRow,
  deps: CreateChatAdapterDeps
): ChatProviderAdapter {
  const { threadKey, decryptedKey, cwd } = deps;

  switch (provider.auth_method) {
    case "cli": {
      const kind = provider.provider_kind as string;
      if (!CLI_PROVIDER_KINDS.has(kind as ProviderKind)) {
        throw new Error(
          `createChatAdapter: provider_kind "${kind}" is not supported for CLI auth — ` +
            `supported kinds: ${[...CLI_PROVIDER_KINDS].join(", ")}`
        );
      }
      return new TmuxBridgeAdapter(kind as ProviderKind, threadKey, realTmuxIo, {
        ...(cwd !== undefined ? {} : {}) // cwd is used by TmuxBridgeAdapter internally via process.cwd()
      });
    }
    case "api_key": {
      if (!decryptedKey) {
        throw new Error(
          `createChatAdapter: decryptedKey is required for auth_method "api_key" ` +
            `(provider ${provider.id})`
        );
      }
      const kind = provider.provider_kind as ProviderKind;
      return new HttpApiAdapter(kind, decryptedKey, {
        ...(provider.base_url ? { baseUrl: provider.base_url } : {})
      });
    }
    default: {
      throw new Error(
        `createChatAdapter: unsupported auth_method "${String(provider.auth_method)}" ` +
          `(provider ${provider.id})`
      );
    }
  }
}
