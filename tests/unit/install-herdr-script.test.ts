import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scripts/install-herdr.sh", () => {
  it("pins both per-arch release artifacts with their SHA-256 and uses set -euo pipefail", async () => {
    const script = await readFile(
      new URL("../../scripts/install-herdr.sh", import.meta.url),
      "utf8"
    );

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("herdr-linux-x86_64");
    expect(script).toContain("043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d");
    expect(script).toContain("herdr-linux-aarch64");
    expect(script).toContain("ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1");
    expect(script).toContain("v0.7.3");
    expect(script).not.toMatch(/curl\s.*\|\s*sh/);
    expect(script).not.toMatch(/wget\s.*\|\s*sh/);
  });

  it("installs into the CLI tools prefix and is idempotent on a matching existing binary", async () => {
    const script = await readFile(
      new URL("../../scripts/install-herdr.sh", import.meta.url),
      "utf8"
    );

    expect(script).toContain("JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools");
    expect(script).toMatch(/sha256sum|shasum/);
    expect(script).toContain("chmod +x");
  });
});
