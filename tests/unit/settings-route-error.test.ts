import { describe, expect, it } from "vitest";

import { handleSettingsRouteError } from "../../packages/settings/src/route-error.js";

function fakeReply() {
  const calls: Array<{ code: number; payload: unknown }> = [];
  let pendingCode = 200;
  const reply = {
    code(code: number) {
      pendingCode = code;
      return reply;
    },
    send(payload: unknown) {
      calls.push({ code: pendingCode, payload });
      return reply;
    },
    calls
  };
  return reply;
}

describe("handleSettingsRouteError", () => {
  it("maps account_pending_approval to 403 with the original message and code", () => {
    const reply = fakeReply();
    const error = Object.assign(new Error("Account is awaiting approval"), {
      code: "account_pending_approval"
    });
    handleSettingsRouteError(error, reply as never);
    expect(reply.calls).toEqual([
      {
        code: 403,
        payload: { error: "Account is awaiting approval", code: "account_pending_approval" }
      }
    ]);
  });

  it("maps account_deactivated to 403", () => {
    const reply = fakeReply();
    const error = Object.assign(new Error("Account deactivated"), { code: "account_deactivated" });
    handleSettingsRouteError(error, reply as never);
    expect(reply.calls).toEqual([
      { code: 403, payload: { error: "Account deactivated", code: "account_deactivated" } }
    ]);
  });
});
