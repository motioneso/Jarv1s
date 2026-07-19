import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AssistantSurface,
  AssistantSurfaceHostProvider
} from "../../apps/web/src/chat/assistant-surface/index.js";
import type { TranscriptRecord } from "../../apps/web/src/chat/use-chat-stream.js";

const records: readonly TranscriptRecord[] = [
  { kind: "thinking", text: "hidden thought" },
  { kind: "user", text: "Streamed user" },
  { kind: "reply", text: "**Streamed reply**" },
  {
    kind: "action_request",
    text: "Approve profile",
    actionRequestId: "ar-1",
    toolName: "job-search.profile.approve",
    summary: "Approve profile"
  },
  { kind: "action_result", text: "Profile approved", outcome: "executed" },
  { kind: "error", text: "Visible failure" }
];

describe("AssistantSurface", () => {
  it("renders scripted rows, default live records, typing, then the active control", () => {
    const html = renderToString(
      createElement(
        AssistantSurfaceHostProvider,
        {
          value: {
            records,
            registerComposer: () => () => undefined,
            subscribeRecords: () => () => undefined
          }
        },
        createElement(AssistantSurface, {
          localRows: [
            { id: "intro", role: "assistant", content: "Scripted intro" },
            { id: "answer", role: "user", content: "Scripted answer" }
          ],
          activeControl: createElement("button", { type: "button" }, "Choose sources"),
          typing: true
        })
      )
    );

    expect(html).not.toContain("hidden thought");
    expect(html).toContain("<strong>Streamed reply</strong>");
    expect(html).toContain("Approve profile");
    expect(html).toContain("Profile approved");
    expect(html).toContain("Visible failure");
    expect(html).toContain('aria-label="Jarvis is typing"');
    expect(html.indexOf("Scripted intro")).toBeLessThan(html.indexOf("Streamed user"));
    expect(html.indexOf("Streamed user")).toBeLessThan(html.indexOf("Choose sources"));
  });

  it("honors an explicit record-kind filter", () => {
    const html = renderToString(
      createElement(
        AssistantSurfaceHostProvider,
        {
          value: {
            records,
            registerComposer: () => () => undefined,
            subscribeRecords: () => () => undefined
          }
        },
        createElement(AssistantSurface, { recordKinds: ["reply"] })
      )
    );

    expect(html).toContain("Streamed reply");
    expect(html).not.toContain("Streamed user");
    expect(html).not.toContain("Approve profile");
  });
});
