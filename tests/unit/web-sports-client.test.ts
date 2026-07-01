import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSportsFollow,
  deleteSportsFollow,
  getSportsCatalog,
  getSportsOverview,
  listSportsFollows
} from "../../apps/web/src/api/sports-client.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

describe("sports API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defines sports query keys", () => {
    expect(queryKeys.sports.overview).toEqual(["sports", "overview"]);
    expect(queryKeys.sports.catalog).toEqual(["sports", "catalog"]);
    expect(queryKeys.sports.follows).toEqual(["sports", "follows"]);
  });

  it("calls sports endpoints with expected methods and paths", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSportsOverview();
    await getSportsCatalog();
    await listSportsFollows();
    await createSportsFollow({ competitionKey: "nfl", teamKey: "dal" });
    await deleteSportsFollow("follow-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sports/overview",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sports/catalog",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sports/follows",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sports/follows",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ competitionKey: "nfl", teamKey: "dal" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/sports/follows/follow-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
