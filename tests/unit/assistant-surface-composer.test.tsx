import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendChatTurn } from "../../apps/web/src/api/client.js";
import {
  AssistantSurface,
  AssistantSurfaceHostProvider
} from "../../apps/web/src/chat/assistant-surface/index.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

vi.mock("../../apps/web/src/api/client.js", () => ({
  sendChatTurn: vi.fn(),
  // AssistantSurface resolves the configured assistant name via useAssistantName, which imports
  // getPersonaSettings from this module — the mock must define it or the import throws. "Alfred"
  // (not "Moss") keeps this ASSISTANT-name fixture unambiguous from the fixed PRODUCT name "Moss".
  getPersonaSettings: vi.fn(async () => ({
    persona: { assistantName: "Alfred", personaText: "" }
  }))
}));

// AssistantSurface needs a QueryClientProvider ancestor; prime the cache so the assistant name is
// available on first render instead of the "Moss" loading fallback.
function withPersonaQueryClient(child: ReturnType<typeof createElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.settings.persona, {
    persona: { assistantName: "Alfred", personaText: "" }
  });
  return createElement(QueryClientProvider, { client }, child);
}

describe("AssistantSurface composer", () => {
  beforeEach(() => vi.mocked(sendChatTurn).mockReset());

  it("lets the composer intercept handled text and sends other text", async () => {
    const onSubmitText = vi.fn<(text: string) => "handled" | "send">();
    onSubmitText.mockReturnValueOnce("handled").mockReturnValueOnce("send");
    vi.mocked(sendChatTurn).mockResolvedValue({
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      reply: "ok",
      sourceFreshness: null
    });
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        withPersonaQueryClient(
          createElement(
            AssistantSurfaceHostProvider,
            {
              value: {
                records: [],
                registerComposer: () => () => undefined,
                subscribeRecords: () => () => undefined
              }
            },
            createElement(AssistantSurface, {
              composer: { placeholder: "Message embedded Jarvis", onSubmitText }
            })
          )
        )
      );
    });

    const textarea = renderer!.root.findByType("textarea");
    const form = renderer!.root.findByType("form");
    const submit = () => form.props.onSubmit({ preventDefault: vi.fn() });

    await act(async () => textarea.props.onChange({ target: { value: "   " } }));
    await act(async () => submit());
    expect(onSubmitText).not.toHaveBeenCalled();
    expect(sendChatTurn).not.toHaveBeenCalled();

    await act(async () => textarea.props.onChange({ target: { value: "  local answer  " } }));
    await act(async () => submit());
    expect(onSubmitText).toHaveBeenLastCalledWith("local answer");
    expect(sendChatTurn).not.toHaveBeenCalled();

    await act(async () => textarea.props.onChange({ target: { value: "  ask Jarvis  " } }));
    await act(async () => submit());
    expect(onSubmitText).toHaveBeenLastCalledWith("ask Jarvis");
    expect(sendChatTurn).toHaveBeenCalledExactlyOnceWith("ask Jarvis");
    expect(textarea.props.value).toBe("");
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
  });

  it("uploads a configured attachment and submits an attachment-only turn", async () => {
    const onSubmitText = vi.fn<
      (text: string, attachmentIds?: readonly string[]) => "handled" | "send"
    >(() => "handled");
    const uploadAttachment = vi.fn(async (file: File) => ({
      id: "attachment-1",
      fileName: file.name,
      sizeBytes: file.size
    }));
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        withPersonaQueryClient(
          createElement(
            AssistantSurfaceHostProvider,
            {
              value: {
                records: [],
                registerComposer: () => () => undefined,
                subscribeRecords: () => () => undefined
              }
            },
            createElement(AssistantSurface, {
              composer: {
                onSubmitText,
                uploadAttachment,
                attachmentLabel: "Attach résumé"
              }
            })
          )
        )
      );
    });

    const file = new File(["resume"], "resume.txt", { type: "text/plain" });
    const input = renderer!.root.findByType("input");
    await act(async () => {
      input.props.onChange({ target: { files: [file], value: "resume.txt" } });
      await Promise.resolve();
    });

    expect(uploadAttachment).toHaveBeenCalledExactlyOnceWith(file);
    expect(renderer!.root.findByProps({ "aria-label": "Attach résumé" })).toBeTruthy();

    const form = renderer!.root.findByType("form");
    await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));
    expect(onSubmitText).toHaveBeenCalledExactlyOnceWith("", ["attachment-1"]);
    expect(sendChatTurn).not.toHaveBeenCalled();
  });
});
