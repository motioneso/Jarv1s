import { afterEach, expect, it, vi } from "vitest";
import { sendChatTurn } from "../../apps/web/src/api/client.js";

afterEach(() => vi.unstubAllGlobals());

it("sends chat turns without page context", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ reply: "hello" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  await sendChatTurn("hello");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/chat/turn",
    expect.objectContaining({ body: JSON.stringify({ text: "hello" }) })
  );
});
