import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { LookupAiCapabilityRouteResponse } from "@jarv1s/shared";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { Composer, mergeTranscriptIntoText } from "../../apps/web/src/chat/composer.js";

// #738 — Chat voice input capture and transcription: composer-side coverage.
//
// mergeTranscriptIntoText is the pure function the mic control uses to land a transcript in the
// composer text for review/edit. Testing it directly proves transcription is an INSERT, never a
// send — there is no code path here that reaches for props.onSend.
describe("mergeTranscriptIntoText (#738 transcript insertion, never auto-send)", () => {
  it("seeds an empty composer with the trimmed transcript", () => {
    expect(mergeTranscriptIntoText("", "  hello there  ")).toBe("hello there");
  });

  it("appends to existing composer text with a single space, preserving what was typed", () => {
    expect(mergeTranscriptIntoText("remember to", "call the vet")).toBe("remember to call the vet");
  });

  it("is a true no-op on an empty or whitespace-only transcript (leaves current text untouched)", () => {
    expect(mergeTranscriptIntoText("  draft  ", "")).toBe("  draft  ");
    expect(mergeTranscriptIntoText("  draft  ", "   ")).toBe("  draft  ");
  });
});

describe("Composer mic control (#738)", () => {
  it("disables the mic with an explanatory tooltip when the transcription route is unavailable", async () => {
    const html = await renderComposer((client) => {
      client.setQueryData(queryKeys.ai.capability("transcription"), unavailableRoute());
    });

    const micButton = extractMicButtonTag(html);
    expect(micButton).toContain("disabled");
    expect(micButton).toContain("Set up a transcription model in Settings");
  });

  it("enables the mic once the transcription capability route reports available", async () => {
    const html = await renderComposer((client) => {
      client.setQueryData(queryKeys.ai.capability("transcription"), availableRoute());
    });

    const micButton = extractMicButtonTag(html);
    expect(micButton).not.toContain("disabled");
    expect(micButton).toContain('title="Record a voice message"');
  });

  it("keeps the mic disabled when the chat itself is read-only, even if voice is configured", async () => {
    const html = await renderComposer(
      (client) => {
        client.setQueryData(queryKeys.ai.capability("transcription"), availableRoute());
      },
      { readOnly: true }
    );

    expect(extractMicButtonTag(html)).toContain("disabled");
  });
});

/** Extracts the mic `<button ...>` opening tag, regardless of the order React writes attributes. */
function extractMicButtonTag(html: string): string {
  const start = html.indexOf('<button aria-label="Record voice message"');
  if (start === -1) {
    const altStart = html.indexOf('<button aria-label="Stop recording"');
    if (altStart === -1) throw new Error("mic button not found in rendered HTML");
    return html.slice(altStart, html.indexOf(">", altStart) + 1);
  }
  return html.slice(start, html.indexOf(">", start) + 1);
}

// Defense-in-depth source guard: transcription is required to land in the composer for
// review/edit, never to auto-send. This directly inspects the handlers that own the mic
// recording lifecycle so a future edit that wires the mic to onSend fails CI immediately,
// rather than only being caught by interaction tests this project's test setup (node
// environment, no jsdom) cannot run against MediaRecorder.
describe("Composer source guard: voice input never auto-sends (#738)", () => {
  it("does not call onSend from the recording/transcription handlers", () => {
    const source = readFileSync(
      new URL("../../apps/web/src/chat/composer.tsx", import.meta.url),
      "utf8"
    );
    const startIndex = source.indexOf("const startRecording");
    const endIndex = source.indexOf("const micDisabled");
    expect(startIndex).toBeGreaterThan(-1);
    expect(endIndex).toBeGreaterThan(startIndex);

    const voiceInputHandlers = source.slice(startIndex, endIndex);
    expect(voiceInputHandlers).not.toContain("props.onSend");
    expect(voiceInputHandlers).toContain("insertTranscript");
  });
});

function unavailableRoute(): LookupAiCapabilityRouteResponse {
  return {
    route: { capability: "transcription", available: false, reason: "no-active-model", model: null }
  };
}

function availableRoute(): LookupAiCapabilityRouteResponse {
  return {
    route: {
      capability: "transcription",
      available: true,
      reason: "matched-active-model",
      model: {
        id: "model-1",
        providerConfigId: "provider-1",
        providerKind: "openai-compatible",
        providerDisplayName: "Voice provider",
        providerStatus: "active",
        providerModelId: "whisper-1",
        displayName: "Whisper",
        capabilities: ["transcription"],
        status: "active",
        tier: "interactive",
        allowUserOverride: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    }
  };
}

async function renderComposer(
  seed: (client: QueryClient) => void,
  overrides: Partial<{ readOnly: boolean }> = {}
): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(Composer, {
        readOnly: overrides.readOnly ?? false,
        isFounder: false,
        isSending: false,
        sendError: null,
        needsProvider: false,
        lockedModelUnavailable: false,
        onSend: () => {},
        onStop: () => {}
      }) as ReactElement
    )
  );
}
