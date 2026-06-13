import { describe, it, expect } from "vitest";
import { herdrAvailable, tmuxAvailable } from "../../packages/ai/src/cli-availability.js";

describe("herdrAvailable", () => {
  it("returns true when the herdr binary is found", async () => {
    const deps = { which: async (bin: string) => (bin === "herdr" ? "/usr/bin/herdr" : null) };
    expect(await herdrAvailable(deps)).toBe(true);
  });

  it("returns false when the herdr binary is not found", async () => {
    const deps = { which: async (_bin: string) => null };
    expect(await herdrAvailable(deps)).toBe(false);
  });

  it("probes only herdr (presence-only, no auth, no other binary)", async () => {
    const probed: string[] = [];
    const deps = {
      which: async (bin: string) => {
        probed.push(bin);
        return bin === "herdr" ? "/usr/local/bin/herdr" : null;
      }
    };
    expect(await herdrAvailable(deps)).toBe(true);
    expect(probed).toEqual(["herdr"]);
  });

  it("does not regress tmuxAvailable", async () => {
    const deps = { which: async (bin: string) => (bin === "tmux" ? "/usr/bin/tmux" : null) };
    expect(await tmuxAvailable(deps)).toBe(true);
  });
});
