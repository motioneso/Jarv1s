import { afterEach, describe, expect, it } from "vitest";

import { startJobSearchFixtureServer } from "./job-search-fixture-server.js";

describe("startJobSearchFixtureServer", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("serves the freehire capture as JSON at /__data.json, ignoring query strings", async () => {
    const server = await startJobSearchFixtureServer({ host: "127.0.0.1" });
    stop = server.stop;

    const response = await fetch(`${server.baseUrl}/__data.json?p=3&region=worldwide`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body.type).toBe("data");
  });

  it("serves the linkedin capture as HTML at the guest search path", async () => {
    const server = await startJobSearchFixtureServer({ host: "127.0.0.1" });
    stop = server.stop;

    const response = await fetch(
      `${server.baseUrl}/jobs-guest/jobs/api/seeMoreJobPostings/search?start=25`
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const body = await response.text();
    expect(body).toContain("job-search-card");
  });

  it("404s loudly, naming the path, for anything not in the route table", async () => {
    const server = await startJobSearchFixtureServer({ host: "127.0.0.1" });
    stop = server.stop;

    const response = await fetch(`${server.baseUrl}/not-a-real-route`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("/not-a-real-route");
  });

  it("stop() actually closes the listener", async () => {
    const server = await startJobSearchFixtureServer({ host: "127.0.0.1" });
    await server.stop();
    stop = undefined;

    await expect(fetch(`${server.baseUrl}/__data.json`)).rejects.toThrow();
  });
});
