// tests/unit/external-module-job-search-adapters-config.test.ts
//
// JS-04 (#933) Task 3: adapter contract types + shared board-config parsing.
// Board tokens become a URL path segment on an allow-listed host, so the
// parser is a security boundary: every delimiter that could smuggle a path
// hop, query, or encoded byte must be rejected, URLs must be https on a
// recognized host with no credentials, and InputError messages name the
// key + constraint only (JS-02/JS-03 discipline — never echo hostile input).
import { describe, expect, it } from "vitest";

import {
  mapWorkMode,
  parseBoardConfig,
  parseIsoTimestamp
} from "../../external-modules/job-search/src/adapters/board-config.js";
import { JobSearchFetchError } from "../../external-modules/job-search/src/adapters/types.js";
import { InputError } from "../../external-modules/job-search/src/worker/validate.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";

const GH_RULES = {
  adapterId: "greenhouse",
  tokenPattern: /^[a-z0-9]{1,100}$/,
  urlHosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"]
} as const;

describe("parseBoardConfig", () => {
  it("accepts a plain board token", () => {
    expect(parseBoardConfig({ board: "gitlab" }, GH_RULES)).toEqual({ board: "gitlab" });
  });

  it("keeps a sanitized companyName", () => {
    expect(parseBoardConfig({ board: "gitlab", companyName: "GitLab" }, GH_RULES)).toEqual({
      board: "gitlab",
      companyName: "GitLab"
    });
    // Markup in companyName is attacker-reachable via capture flows — strip it.
    expect(
      parseBoardConfig({ board: "gitlab", companyName: "<b>GitLab</b>\n Inc" }, GH_RULES)
    ).toEqual({ board: "gitlab", companyName: "GitLab Inc" });
  });

  it("extracts the token from recognized board URLs", () => {
    expect(parseBoardConfig({ url: "https://boards.greenhouse.io/gitlab" }, GH_RULES)).toEqual({
      board: "gitlab"
    });
    expect(
      parseBoardConfig({ url: "https://job-boards.greenhouse.io/gitlab/jobs" }, GH_RULES)
    ).toEqual({ board: "gitlab" });
    // Hostname compare is case-insensitive (URL lowercases, but pin it).
    expect(parseBoardConfig({ url: "https://BOARDS.GREENHOUSE.IO/gitlab" }, GH_RULES)).toEqual({
      board: "gitlab"
    });
  });

  it("rejects non-https, unrecognized hosts, credentials, and empty paths", () => {
    expect(() => parseBoardConfig({ url: "http://boards.greenhouse.io/gitlab" }, GH_RULES)).toThrow(
      InputError
    );
    // Subdomain tricks must not pass an exact-host allow list.
    expect(() =>
      parseBoardConfig({ url: "https://boards.eu.greenhouse.io/gitlab" }, GH_RULES)
    ).toThrow(InputError);
    expect(() =>
      parseBoardConfig({ url: "https://evil@boards.greenhouse.io/gitlab" }, GH_RULES)
    ).toThrow(InputError);
    expect(() => parseBoardConfig({ url: "https://boards.greenhouse.io/" }, GH_RULES)).toThrow(
      InputError
    );
    expect(() => parseBoardConfig({ url: "not a url" }, GH_RULES)).toThrow(InputError);
  });

  it("rejects hostile board tokens", () => {
    for (const board of ["a/b", "a?b", "a#b", "a b", "..", "", "a\\b", "a%2fb", "A"]) {
      expect(() => parseBoardConfig({ board }, GH_RULES), `token ${JSON.stringify(board)}`).toThrow(
        InputError
      );
    }
    expect(() => parseBoardConfig({ board: "a".repeat(101) }, GH_RULES)).toThrow(InputError);
    expect(() => parseBoardConfig({ board: 42 }, GH_RULES)).toThrow(InputError);
  });

  it("percent-encoded delimiters in a URL path segment do not survive decoding", () => {
    // decodeURIComponent("gitlab%2f..") = "gitlab/.." which the pattern rejects.
    expect(() =>
      parseBoardConfig({ url: "https://boards.greenhouse.io/gitlab%2f.." }, GH_RULES)
    ).toThrow(InputError);
  });

  it("requires exactly one of board or url", () => {
    expect(() => parseBoardConfig({}, GH_RULES)).toThrow(InputError);
    expect(() =>
      parseBoardConfig({ board: "gitlab", url: "https://boards.greenhouse.io/gitlab" }, GH_RULES)
    ).toThrow(InputError);
  });

  it("error messages name key + constraint, never the hostile value", () => {
    try {
      parseBoardConfig({ board: "EVIL/../PAYLOAD" }, GH_RULES);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InputError);
      expect((error as InputError).message).not.toContain("EVIL");
      expect((error as InputError).message).toContain("board");
    }
  });
});

describe("mapWorkMode", () => {
  it("maps known modes case-insensitively", () => {
    expect(mapWorkMode("Remote")).toBe("remote");
    expect(mapWorkMode("HYBRID")).toBe("hybrid");
    expect(mapWorkMode("on-site")).toBe("onsite");
    expect(mapWorkMode("OnSite")).toBe("onsite");
  });

  it("returns undefined for unknown or non-string values", () => {
    expect(mapWorkMode("unspecified")).toBeUndefined();
    expect(mapWorkMode(42)).toBeUndefined();
    expect(mapWorkMode(undefined)).toBeUndefined();
  });
});

describe("parseIsoTimestamp", () => {
  it("normalizes ISO strings and epoch-ms numbers to ISO", () => {
    expect(parseIsoTimestamp("2026-04-17T05:58:03-04:00")).toBe("2026-04-17T09:58:03.000Z");
    expect(parseIsoTimestamp(1553186035299)).toBe("2019-03-21T16:33:55.299Z");
  });

  it("returns undefined for garbage", () => {
    expect(parseIsoTimestamp("garbage")).toBeUndefined();
    expect(parseIsoTimestamp(Number.NaN)).toBeUndefined();
    expect(parseIsoTimestamp(-5)).toBeUndefined();
    expect(parseIsoTimestamp(undefined)).toBeUndefined();
  });
});

describe("JobSearchFetchError through the wrap envelope", () => {
  it("becomes a structured scrubbed error result instead of rethrowing", async () => {
    const handler = wrap(async () => {
      throw new JobSearchFetchError("board_not_found", "board does not exist on greenhouse");
    });
    await expect(handler({})).resolves.toEqual({
      status: "error",
      code: "board_not_found",
      message: "board does not exist on greenhouse"
    });
  });
});
