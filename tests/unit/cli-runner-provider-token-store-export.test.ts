/**
 * #1121: the seed-only opt-in real-chat token step (tests/uat/seed/cli.ts) needs
 * persistProviderToken from the host side, which can only reach it through the package's
 * public barrel (../../packages/cli-runner/src/index.js) — provider-token-store.ts was not
 * re-exported there.
 */
import { describe, expect, it } from "vitest";
import * as cliRunner from "../../packages/cli-runner/src/index.js";

describe("cli-runner index barrel", () => {
  it("re-exports the provider-token-store functions", () => {
    expect(typeof cliRunner.persistProviderToken).toBe("function");
    expect(typeof cliRunner.readProviderToken).toBe("function");
    expect(typeof cliRunner.providerTokenPath).toBe("function");
    expect(typeof cliRunner.isTokenProvider).toBe("function");
  });
});
