import { describe, it, expect } from "vitest";
import { HttpApiAdapter } from "../../packages/ai/src/adapters/http-api.js";

const anthropicModel = {
  provider_kind: "anthropic",
  provider_model_id: "claude-3-5-sonnet-20241022"
} as any;

const openaiModel = {
  provider_kind: "openai-compatible",
  provider_model_id: "gpt-4o"
} as any;

const googleModel = {
  provider_kind: "google",
  provider_model_id: "gemini-2.0-flash"
} as any;

describe("HttpApiAdapter — anthropic", () => {
  it("calls the anthropic messages endpoint and maps content[0].text", async () => {
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      expect(urlStr).toBe("https://api.anthropic.com/v1/messages");

      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.model).toBe("claude-3-5-sonnet-20241022");
      expect(body.messages).toEqual([{ role: "user", content: "yo" }]);

      // Headers must include x-api-key and anthropic-version
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("sk-test-anthropic");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");

      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Hello from Anthropic!" }] }),
        { status: 200 }
      );
    };

    const adapter = new HttpApiAdapter("anthropic", "sk-test-anthropic", {
      fetch: fakeFetch as typeof fetch
    });
    const out = await adapter.generateChat({
      model: anthropicModel,
      messages: [{ role: "user", content: "yo" }]
    });
    expect(out.text).toBe("Hello from Anthropic!");
  });

  it("throws HTTP 401 error without leaking the api key", async () => {
    const fakeFetch = async () => new Response("Unauthorized", { status: 401 });
    const adapter = new HttpApiAdapter("anthropic", "sk-secret-key", {
      fetch: fakeFetch as typeof fetch
    });

    await expect(
      adapter.generateChat({ model: anthropicModel, messages: [] })
    ).rejects.toThrow(/401/);

    // Key must NOT appear in error message
    await expect(
      adapter.generateChat({ model: anthropicModel, messages: [] })
    ).rejects.not.toThrow(/sk-secret-key/);
  });
});

describe("HttpApiAdapter — openai-compatible", () => {
  it("calls /v1/chat/completions and maps choices[0].message.content", async () => {
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      expect(urlStr).toBe("https://api.openai.com/v1/chat/completions");

      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.model).toBe("gpt-4o");
      expect(body.messages).toEqual([{ role: "user", content: "hello" }]);

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-test-openai");

      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Hello from OpenAI!" } }]
        }),
        { status: 200 }
      );
    };

    const adapter = new HttpApiAdapter("openai-compatible", "sk-test-openai", {
      fetch: fakeFetch as typeof fetch
    });
    const out = await adapter.generateChat({
      model: openaiModel,
      messages: [{ role: "user", content: "hello" }]
    });
    expect(out.text).toBe("Hello from OpenAI!");
  });

  it("respects a custom baseUrl for openai-compatible providers", async () => {
    const fakeFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      expect(urlStr).toBe("https://my-proxy.example.com/v1/chat/completions");
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "proxied" } }] }),
        { status: 200 }
      );
    };

    const adapter = new HttpApiAdapter("openai-compatible", "sk-test-openai", {
      fetch: fakeFetch as typeof fetch,
      baseUrl: "https://my-proxy.example.com"
    });
    const out = await adapter.generateChat({
      model: openaiModel,
      messages: [{ role: "user", content: "hello" }]
    });
    expect(out.text).toBe("proxied");
  });

  it("throws without leaking the api key on openai 401", async () => {
    const fakeFetch = async () => new Response("Unauthorized", { status: 401 });
    const adapter = new HttpApiAdapter("openai-compatible", "sk-super-secret", {
      fetch: fakeFetch as typeof fetch
    });

    await expect(
      adapter.generateChat({ model: openaiModel, messages: [] })
    ).rejects.toThrow(/401/);

    await expect(
      adapter.generateChat({ model: openaiModel, messages: [] })
    ).rejects.not.toThrow(/sk-super-secret/);
  });
});

describe("HttpApiAdapter — google", () => {
  it("calls generateContent and maps candidates[0].content.parts[0].text", async () => {
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      // URL includes model id and API key as query param
      expect(urlStr).toContain("gemini-2.0-flash");
      expect(urlStr).toContain("generateContent");
      expect(urlStr).toContain("key=sk-test-google");

      // Key must be in URL, NOT in Authorization header
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();

      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.contents).toBeDefined();
      expect(body.contents[0].parts[0].text).toBe("hi google");

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello from Google!" }],
                role: "model"
              }
            }
          ]
        }),
        { status: 200 }
      );
    };

    const adapter = new HttpApiAdapter("google", "sk-test-google", {
      fetch: fakeFetch as typeof fetch
    });
    const out = await adapter.generateChat({
      model: googleModel,
      messages: [{ role: "user", content: "hi google" }]
    });
    expect(out.text).toBe("Hello from Google!");
  });

  it("throws without leaking the api key on google 403", async () => {
    const fakeFetch = async () => new Response("Forbidden", { status: 403 });
    const adapter = new HttpApiAdapter("google", "goog-secret-key", {
      fetch: fakeFetch as typeof fetch
    });

    await expect(
      adapter.generateChat({ model: googleModel, messages: [] })
    ).rejects.toThrow(/403/);

    await expect(
      adapter.generateChat({ model: googleModel, messages: [] })
    ).rejects.not.toThrow(/goog-secret-key/);
  });
});

describe("HttpApiAdapter — onActivity", () => {
  it("emits a status event when onActivity is provided", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "done" }] }),
        { status: 200 }
      );

    const events: Array<{ kind: string; text: string }> = [];
    const adapter = new HttpApiAdapter("anthropic", "sk-test", {
      fetch: fakeFetch as typeof fetch
    });

    await adapter.generateChat({
      model: anthropicModel,
      messages: [{ role: "user", content: "ping" }],
      onActivity: (e) => events.push(e)
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.kind).toBe("status");
  });
});
