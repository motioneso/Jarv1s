import { describe, it, expect } from "vitest";
// #1059 terminal RPC wire-format. Lives in tests/unit (the only unit location
// wired into `pnpm test:unit` / verify:foundation); package-src *.test.ts run in
// no CI gate here. Import package internals via relative path, matching the
// existing cli-runner-protocol / chat-rpc-client unit tests.
import {
  encodeFrame,
  decodeFrame,
  type RpcPush
} from "../../packages/chat/src/live/rpc-contract.js";

describe("terminal push frame (#1059)", () => {
  it("round-trips a terminalData push frame", () => {
    const push: RpcPush = {
      t: "push",
      bootId: "boot-1",
      channel: "terminalData",
      terminalId: "t-1",
      dataB64: Buffer.from("hi").toString("base64")
    };
    const decoded = decodeFrame(encodeFrame(push));
    expect(decoded.kind).toBe("frame");
    if (decoded.kind !== "frame") throw new Error("unreachable");
    expect(JSON.parse(decoded.body.toString("utf8"))).toEqual(push);
  });
});
