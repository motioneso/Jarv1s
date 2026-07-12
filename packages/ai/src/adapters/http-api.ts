/**
 * HTTP API-key transport adapter for Anthropic, OpenAI-compatible, and Google Gemini providers.
 *
 * Implements ChatProviderAdapter (defined in chat-adapter.ts).
 */

import type { GenerateChatInput, ChatProviderAdapter } from "../chat-adapter.js";
import {
  buildStructuredRequest,
  extractStructuredResult,
  type GenerateStructuredProviderInput,
  type StructuredProviderResult
} from "./http-api-structured.js";
import type { ProviderKind } from "./transcript-reader.js";

// ---------------------------------------------------------------------------
// HttpApiAdapter
// ---------------------------------------------------------------------------

export interface HttpApiAdapterOpts {
  /** Injectable fetch for testing. Defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Override the base URL for openai-compatible providers. */
  readonly baseUrl?: string;
}

export class HttpApiAdapter implements ChatProviderAdapter {
  private readonly _fetch: typeof fetch;
  private readonly _baseUrl: string | undefined;

  constructor(
    private readonly providerKind: ProviderKind,
    private readonly apiKey: string,
    opts: HttpApiAdapterOpts = {}
  ) {
    this._fetch = opts.fetch ?? globalThis.fetch;
    this._baseUrl = opts.baseUrl;
  }

  async generateChat(input: GenerateChatInput): Promise<{ readonly text: string }> {
    input.onActivity?.({ kind: "status", text: "calling api..." });

    const { url, headers, body } = this.buildRequest(input);

    const response = await this._fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      // Never include the API key in error messages (security invariant)
      throw new Error(`HTTP ${response.status}`);
    }

    const json: unknown = await response.json();
    return { text: this.extractText(json) };
  }

  async generateStructured(
    input: GenerateStructuredProviderInput
  ): Promise<StructuredProviderResult> {
    const request = buildStructuredRequest(
      this.providerKind,
      this.apiKey,
      this._baseUrl ?? null,
      input
    );
    const response = await this._fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: input.signal
    });
    if (!response.ok) {
      throw new Error(`AI provider request failed: HTTP ${response.status}`);
    }
    return extractStructuredResult(this.providerKind, await response.json());
  }

  /**
   * Transcribe an audio clip via the OpenAI-compatible `/v1/audio/transcriptions` REST
   * surface. This endpoint shape is exposed by hosted providers (e.g. Groq) AND
   * self-hosted Whisper/Parakeet-style servers alike, so routing through
   * `providerKind: "openai-compatible"` (with its already-configurable baseUrl + API key)
   * covers transcription without hardcoding a vendor or model — the capability router
   * picked the model, this just calls it. Anthropic/Google have no equivalent audio
   * transcription REST surface behind this adapter, so both throw a clear error instead of
   * silently no-op'ing.
   */
  async transcribeAudio(input: {
    readonly model: { readonly provider_model_id: string };
    readonly audio: Blob;
  }): Promise<{ readonly text: string }> {
    if (this.providerKind !== "openai-compatible") {
      throw new Error(`Transcription is not supported for provider kind: ${this.providerKind}`);
    }

    const base = this._baseUrl ?? "https://api.openai.com";
    const form = new FormData();
    form.set("model", input.model.provider_model_id);
    form.set("file", input.audio, "audio");

    const response = await this._fetch(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form
    });

    if (!response.ok) {
      // Never include the API key in error messages (security invariant)
      throw new Error(`HTTP ${response.status}`);
    }

    const json = (await response.json()) as { text?: unknown };
    if (typeof json.text !== "string") {
      throw new Error("No text field in transcription response");
    }

    return { text: json.text };
  }

  private buildRequest(input: GenerateChatInput): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  } {
    const modelId = input.model.provider_model_id;

    switch (this.providerKind) {
      case "anthropic":
        return {
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: {
            model: modelId,
            // Economy envelope: clamp to the caller's budget when present, else the default.
            max_tokens: input.maxOutputTokens ?? 8192,
            messages: input.messages.map((m) => ({ role: m.role, content: m.content }))
          }
        };

      case "openai-compatible": {
        const base = this._baseUrl ?? "https://api.openai.com";
        return {
          url: `${base}/v1/chat/completions`,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`
          },
          body: {
            model: modelId,
            // No default existed for this provider — only set a cap when the caller asks.
            ...(input.maxOutputTokens !== undefined ? { max_tokens: input.maxOutputTokens } : {}),
            messages: input.messages.map((m) => ({ role: m.role, content: m.content }))
          }
        };
      }

      case "google": {
        // Send the key via the x-goog-api-key header, never the URL query string
        // (a `?key=` query param leaks to external proxy/APM/access logs). Google's
        // generativelanguage endpoint accepts either form; the header keeps the
        // secret out of request lines (secrets-never-escape, defense-in-depth).
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
        return {
          url,
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: {
            contents: input.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }]
            })),
            // No default existed for this provider — only set a cap when the caller asks.
            ...(input.maxOutputTokens !== undefined
              ? { generationConfig: { maxOutputTokens: input.maxOutputTokens } }
              : {})
          }
        };
      }

      default: {
        const exhaustive: never = this.providerKind;
        throw new Error(`Unsupported provider kind: ${String(exhaustive)}`);
      }
    }
  }

  private extractText(json: unknown): string {
    switch (this.providerKind) {
      case "anthropic": {
        // Response: { content: [{ type: "text", text: string }] }
        const r = json as { content: Array<{ type: string; text: string }> };
        const textBlock = r.content.find((c) => c.type === "text");
        if (!textBlock) {
          throw new Error("No text block in Anthropic response");
        }
        return textBlock.text;
      }

      case "openai-compatible": {
        // Response: { choices: [{ message: { role: string, content: string } }] }
        const r = json as { choices: Array<{ message: { content: string } }> };
        const choice = r.choices[0];
        if (!choice) {
          throw new Error("No choices in OpenAI response");
        }
        return choice.message.content;
      }

      case "google": {
        // Response: { candidates: [{ content: { parts: [{ text: string }] } }] }
        const r = json as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        };
        const candidate = r.candidates[0];
        if (!candidate) {
          throw new Error("No candidates in Google response");
        }
        const part = candidate.content.parts[0];
        if (!part) {
          throw new Error("No parts in Google response candidate");
        }
        return part.text;
      }

      default: {
        const exhaustive: never = this.providerKind;
        throw new Error(`Unsupported provider kind: ${String(exhaustive)}`);
      }
    }
  }
}
