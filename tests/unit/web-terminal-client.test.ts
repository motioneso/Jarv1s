import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getTerminalStatus,
  requestTerminalTicket,
  setTerminalPassword,
  terminalWsUrl
} from "../../apps/web/src/api/client.js";

// #1059: owner-gated CLI-provider terminal — password/status/ticket client helpers +
// the ws:// URL builder the settings terminal modal will call into (Task 9).
describe("terminal API client (#1059)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls terminal endpoints with expected methods", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getTerminalStatus();
    await setTerminalPassword("hunter22");
    await requestTerminalTicket("hunter22");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/ai/terminal/status", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/ai/terminal/password",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "hunter22" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/ai/terminal/ticket",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "hunter22" }) })
    );
  });

  it("terminalWsUrl embeds ticket + ws scheme (#1059)", () => {
    // https -> wss and http -> ws: the terminal ws connection must inherit the page's
    // transport security rather than hardcoding one, or it'll be blocked by mixed-content
    // rules in prod (https page) / fail to matter in local dev (http page).
    vi.stubGlobal("window", { location: { protocol: "https:", host: "app.example.com" } });
    expect(terminalWsUrl("abc")).toBe("wss://app.example.com/api/ai/terminal?ticket=abc");

    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:5173" } });
    expect(terminalWsUrl("abc")).toBe("ws://localhost:5173/api/ai/terminal?ticket=abc");
  });
});
