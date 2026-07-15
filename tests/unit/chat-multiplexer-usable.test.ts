import { mkdtemp, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeMultiplexerUsableProbe } from "../../packages/module-registry/src/chat-multiplexer.js";

// build a PATH containing executable entries for exactly the given binaries, so
// createBinaryProbe(env) reports a deterministic install set (accessSync X_OK only
// inspects the execute permission bit, so empty +x files satisfy it).
async function pathWith(...bins: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jarv1s-mux-probe-"));
  for (const bin of bins) {
    const file = join(dir, bin);
    await writeFile(file, "", { mode: 0o755 });
    await chmod(file, 0o755);
  }
  return dir;
}

describe("makeMultiplexerUsableProbe (#343 — per-kind availability, not env-override funneled)", () => {
  it("with JARVIS_MULTIPLEXER=tmux override + only tmux installed, reports herdr NOT usable and tmux usable", async () => {
    // Regression for #343: previously this routed through decideMultiplexer, which honors
    // the env override first and returned ok=true for BOTH kinds whenever the override
    // was pinned (install.sh pins JARVIS_MULTIPLEXER=tmux in the container env file).
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("tmux"),
      JARVIS_MULTIPLEXER: "tmux"
    });
    expect(await usable("tmux")).toBe(true);
    expect(await usable("herdr")).toBe(false);
  });

  it("with only herdr installed (+ root pane), reports tmux NOT usable and herdr usable", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("herdr"),
      HERDR_PANE_ID: "p_1"
    });
    expect(await usable("tmux")).toBe(false);
    expect(await usable("herdr")).toBe(true);
  });

  it("herdr is NOT usable when installed but NO root pane is resolvable (even with override=herdr)", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("herdr"),
      JARVIS_MULTIPLEXER: "herdr"
    });
    expect(await usable("herdr")).toBe(false);
  });

  it("herdr IS usable when installed AND JARVIS_HERDR_ROOT_PANE is set", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("herdr"),
      JARVIS_HERDR_ROOT_PANE: "w1:p1"
    });
    expect(await usable("herdr")).toBe(true);
  });

  it("herdr IS usable when installed AND HERDR_PANE_ID is set", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("herdr"),
      HERDR_PANE_ID: "p_42"
    });
    expect(await usable("herdr")).toBe(true);
  });

  it("both kinds usable when both installed + a herdr root pane is set (override does not mask either)", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("tmux", "herdr"),
      HERDR_PANE_ID: "p_7",
      JARVIS_MULTIPLEXER: "tmux"
    });
    expect(await usable("tmux")).toBe(true);
    expect(await usable("herdr")).toBe(true);
  });

  it("herdr IS usable when installed AND JARVIS_HERDR_ROOT_TAB is set (#993 — shared predicate)", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith("herdr"),
      JARVIS_HERDR_ROOT_TAB: "jarvis-root"
    });
    expect(await usable("herdr")).toBe(true);
  });

  it("neither usable when nothing is installed", async () => {
    const usable = makeMultiplexerUsableProbe({
      PATH: await pathWith(),
      JARVIS_MULTIPLEXER: "tmux"
    });
    expect(await usable("tmux")).toBe(false);
    expect(await usable("herdr")).toBe(false);
  });
});
