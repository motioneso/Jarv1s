import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SPA_CSP } from "../../apps/api/src/static-web.js";

const EXPECTED_IMG_SRC = "img-src 'self' data: https://a.espncdn.com https://s.secure.espncdn.com";

describe("SPA CSP image hosts", () => {
  it("folds the composed SportsSource image hosts into img-src", () => {
    expect(SPA_CSP).toContain(EXPECTED_IMG_SRC);
  });

  it("keeps every other directive unchanged", () => {
    expect(SPA_CSP).toContain("default-src 'self'");
    expect(SPA_CSP).toContain("script-src 'self'");
    expect(SPA_CSP).toContain("frame-ancestors 'none'");
  });

  it("keeps the nginx CSP img-src in sync with the API CSP", () => {
    const conf = readFileSync(
      fileURLToPath(new URL("../../infra/nginx/jarv1s-web.conf", import.meta.url)),
      "utf8"
    );
    expect(conf).toContain(EXPECTED_IMG_SRC);
  });
});
