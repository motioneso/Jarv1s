import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityPeek, activityVerb } from "../../apps/web/src/chat/chat-drawer.js";

const allowedRecord = {
  kind: "action_result" as const,
  text: "Allowed by YOLO: Read",
  outcome: "allowed" as const
};

describe("chat drawer activity outcomes", () => {
  it("maps and renders allowed outcomes truthfully", () => {
    expect(activityVerb(allowedRecord)).toBe("Allowed by YOLO");

    const html = renderToString(createElement(ActivityPeek, { records: [allowedRecord] }));
    expect(html).toContain("Allowed by YOLO");
    expect(html).not.toContain("Denied");
  });
});
