/**
 * Unit tests for createChatAdapter factory.
 * No Postgres — no real I/O boundaries touched.
 */
import { describe, expect, it } from "vitest";

import { createChatAdapter } from "../../packages/ai/src/chat-adapter.js";
import { TmuxBridgeAdapter } from "../../packages/ai/src/adapters/tmux-bridge.js";
import { HttpApiAdapter } from "../../packages/ai/src/adapters/http-api.js";
import type { AiProviderConfigSafeRow } from "../../packages/ai/src/repository.js";

// Minimal provider row stubs
function cliProvider(provider_kind = "anthropic"): AiProviderConfigSafeRow {
  return {
    id: "p1",
    owner_user_id: "u1",
    provider_kind: provider_kind as AiProviderConfigSafeRow["provider_kind"],
    display_name: "Test CLI Provider",
    base_url: null,
    status: "active",
    auth_method: "cli",
    has_credential: false,
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date()
  };
}

function apiKeyProvider(provider_kind = "anthropic"): AiProviderConfigSafeRow {
  return {
    id: "p2",
    owner_user_id: "u1",
    provider_kind: provider_kind as AiProviderConfigSafeRow["provider_kind"],
    display_name: "Test API Key Provider",
    base_url: null,
    status: "active",
    auth_method: "api_key",
    has_credential: true,
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date()
  };
}

describe("createChatAdapter — cli auth_method", () => {
  it("returns a TmuxBridgeAdapter for anthropic+cli", () => {
    const adapter = createChatAdapter(cliProvider("anthropic"), {
      threadKey: "thread-abc"
    });
    expect(adapter).toBeInstanceOf(TmuxBridgeAdapter);
  });

  it("returns a TmuxBridgeAdapter for openai-compatible+cli", () => {
    const adapter = createChatAdapter(cliProvider("openai-compatible"), {
      threadKey: "thread-def"
    });
    expect(adapter).toBeInstanceOf(TmuxBridgeAdapter);
  });

  it("returns a TmuxBridgeAdapter for google+cli", () => {
    const adapter = createChatAdapter(cliProvider("google"), {
      threadKey: "thread-ghi"
    });
    expect(adapter).toBeInstanceOf(TmuxBridgeAdapter);
  });
});

describe("createChatAdapter — api_key auth_method", () => {
  it("returns an HttpApiAdapter for anthropic+api_key with decryptedKey", () => {
    const adapter = createChatAdapter(apiKeyProvider("anthropic"), {
      threadKey: "thread-jkl",
      decryptedKey: "sk-test-key"
    });
    expect(adapter).toBeInstanceOf(HttpApiAdapter);
  });

  it("returns an HttpApiAdapter for openai-compatible+api_key with decryptedKey", () => {
    const adapter = createChatAdapter(apiKeyProvider("openai-compatible"), {
      threadKey: "thread-mno",
      decryptedKey: "sk-openai-key"
    });
    expect(adapter).toBeInstanceOf(HttpApiAdapter);
  });

  it("throws when auth_method is api_key but decryptedKey is missing", () => {
    expect(() =>
      createChatAdapter(apiKeyProvider("anthropic"), {
        threadKey: "thread-pqr"
        // no decryptedKey
      })
    ).toThrow(/decryptedKey/i);
  });
});
