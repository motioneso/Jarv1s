import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendChatTurn } from "../../apps/web/src/api/client.js";
import {
  AssistantSurface,
  AssistantSurfaceHostProvider
} from "../../apps/web/src/chat/assistant-surface/index.js";

vi.mock("../../apps/web/src/api/client.js", () => ({ sendChatTurn: vi.fn() }));

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
  });
});
