import { describe, expect, it } from "vitest";

import { OPTIONS } from "../../apps/web/src/onboarding/multiplexer-options.js";

describe("onboarding multiplexer step options", () => {
  it("does not offer herdr (unavailable in the deployed container; tmux is forced)", () => {
    expect(OPTIONS.map((o) => o.id)).not.toContain("herdr");
  });

  it("still offers Auto and tmux", () => {
    const ids = OPTIONS.map((o) => o.id);
    expect(ids).toContain("auto");
    expect(ids).toContain("tmux");
  });

  it("offers exactly Auto and tmux", () => {
    expect(OPTIONS).toHaveLength(2);
  });
});
