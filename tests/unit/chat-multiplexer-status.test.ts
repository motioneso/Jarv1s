import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeChatMultiplexerStatusProbe } from "../../packages/module-registry/src/chat-multiplexer.js";

async function pathWith(...bins: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jarv1s-mux-status-"));
  for (const bin of bins) {
    await writeFile(join(dir, bin), "", { mode: 0o755 });
    await chmod(join(dir, bin), 0o755);
  }
  return dir;
}

describe("makeChatMultiplexerStatusProbe", () => {
  it("reports herdrInstalled=false, active=tmux/auto when only tmux is present", async () => {
    const probe = makeChatMultiplexerStatusProbe({ PATH: await pathWith("tmux") });
    const status = await probe("auto");
    expect(status.available).toEqual({ tmux: true, herdr: false });
    expect(status.herdrInstalled).toBe(false);
    expect(status.active).toBe("tmux");
    expect(status.activeSource).toBe("auto");
    expect(status.envOverride).toBeNull();
  });

  it("reports herdrInstalled=true even when herdr is not usable (no root pane)", async () => {
    const probe = makeChatMultiplexerStatusProbe({ PATH: await pathWith("herdr") });
    const status = await probe("auto");
    expect(status.available).toEqual({ tmux: false, herdr: false });
    expect(status.herdrInstalled).toBe(true);
    expect(status.active).toBeNull();
    expect(status.activeSource).toBeNull();
  });

  it("reports active=herdr/configured when herdr is installed, usable, and selected", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("herdr"),
      HERDR_PANE_ID: "p_1"
    });
    const status = await probe("herdr");
    expect(status.active).toBe("herdr");
    expect(status.activeSource).toBe("configured");
  });

  it("surfaces envOverride and pins active/source to the env value", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("tmux"),
      JARVIS_MULTIPLEXER: "tmux"
    });
    const status = await probe("herdr");
    expect(status.envOverride).toBe("tmux");
    expect(status.active).toBe("tmux");
    expect(status.activeSource).toBe("env");
  });

  it("degrades to active=null (never rejects) for an unrecognized JARVIS_MULTIPLEXER value", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("tmux"),
      JARVIS_MULTIPLEXER: "screen"
    });
    const status = await probe("auto");
    expect(status.active).toBeNull();
    expect(status.activeSource).toBeNull();
    expect(status.envOverride).toBeNull();
    expect(status.available).toEqual({ tmux: true, herdr: false });
  });
});
