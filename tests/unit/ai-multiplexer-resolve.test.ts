import { describe, expect, it } from "vitest";
import {
  decideMultiplexer,
  resolveMultiplexer
} from "../../packages/ai/src/adapters/multiplexer-resolve.js";

const both = () => true;
const none = () => false;
const only = (k: string) => (b: string) => b === k;
const ROOT = { HERDR_PANE_ID: "p_51" }; // makes herdr "usable" (a root pane is resolvable)
const io = {
  run: async () => ({ code: 0, stdout: "" }),
  sleep: async () => {},
  readFile: async () => "",
  writeFile: async () => {}
} as never;

describe("decideMultiplexer", () => {
  it("env override wins and bypasses the install probe", () => {
    expect(
      decideMultiplexer({
        env: { JARVIS_MULTIPLEXER: "herdr" },
        configured: "auto",
        isInstalled: none
      })
    ).toEqual({ ok: true, kind: "herdr", source: "env" });
  });
  it("throws on an invalid env override", () => {
    expect(() =>
      decideMultiplexer({
        env: { JARVIS_MULTIPLEXER: "screen" },
        configured: "auto",
        isInstalled: both
      })
    ).toThrow(/JARVIS_MULTIPLEXER/);
  });
  it("honors an explicit herdr admin setting when installed AND a root pane is resolvable", () => {
    expect(
      decideMultiplexer({ env: ROOT, configured: "herdr", isInstalled: only("herdr") })
    ).toEqual({ ok: true, kind: "herdr", source: "configured" });
  });
  it("fails when herdr is selected and installed but NO root pane is resolvable", () => {
    const d = decideMultiplexer({ env: {}, configured: "herdr", isInstalled: only("herdr") });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.reason).toMatch(/root pane/i);
  });
  it("fails when the explicit admin setting is not installed", () => {
    expect(decideMultiplexer({ env: {}, configured: "tmux", isInstalled: only("herdr") }).ok).toBe(
      false
    );
  });
  it("auto prefers tmux when both usable and not inside herdr", () => {
    expect(decideMultiplexer({ env: ROOT, configured: "auto", isInstalled: both })).toMatchObject({
      ok: true,
      kind: "tmux",
      source: "auto"
    });
  });
  it("auto prefers herdr when inside herdr (HERDR_ENV=1) and herdr is usable", () => {
    expect(
      decideMultiplexer({ env: { ...ROOT, HERDR_ENV: "1" }, configured: "auto", isInstalled: both })
    ).toMatchObject({ ok: true, kind: "herdr" });
  });
  it("auto FALLS BACK TO TMUX when herdr is installed but has no root pane (the R2-#1 fix)", () => {
    // herdr binary present, but no HERDR_PANE_ID/JARVIS_HERDR_ROOT_PANE → herdr not usable.
    expect(
      decideMultiplexer({ env: { HERDR_ENV: "1" }, configured: "auto", isInstalled: both })
    ).toMatchObject({ ok: true, kind: "tmux" });
  });
  it("auto falls back to herdr when only herdr is usable", () => {
    expect(
      decideMultiplexer({ env: ROOT, configured: "auto", isInstalled: only("herdr") })
    ).toMatchObject({ ok: true, kind: "herdr" });
  });
  it("auto fails when neither is usable", () => {
    expect(decideMultiplexer({ env: {}, configured: "auto", isInstalled: none }).ok).toBe(false);
  });
  it("honors JARVIS_HERDR_ROOT_TAB alone as a resolvable root workspace (#993)", () => {
    expect(
      decideMultiplexer({
        env: { JARVIS_HERDR_ROOT_TAB: "jarvis-root" },
        configured: "herdr",
        isInstalled: only("herdr")
      })
    ).toEqual({ ok: true, kind: "herdr", source: "configured" });
  });
});

describe("resolveMultiplexer", () => {
  it("returns a Multiplexer of the decided kind", () => {
    const r = resolveMultiplexer({ io, env: {}, configured: "auto", isInstalled: only("tmux") });
    expect(r.ok && r.mux.kind).toBe("tmux");
  });
  it("propagates the unavailable reason", () => {
    expect(resolveMultiplexer({ io, env: {}, configured: "auto", isInstalled: none }).ok).toBe(
      false
    );
  });
});
