import { describe, expect, it } from "vitest";
import { SPORTS_CATALOG, catalogEntry } from "../../packages/sports/src/source/catalog.js";

describe("sports catalog", () => {
  it("covers the eight approved competitions", () => {
    expect(SPORTS_CATALOG.map((c) => c.competitionKey).sort()).toEqual(
      ["eng.1", "fifa.world", "mlb", "nba", "nfl", "nhl", "uefa.champions", "usa.1"].sort()
    );
  });
  it("maps nfl to ESPN football/nfl as a league", () => {
    const e = catalogEntry("nfl");
    expect(e?.espnSport).toBe("football");
    expect(e?.espnLeague).toBe("nfl");
    expect(e?.kind).toBe("league");
  });
  it("flags the World Cup as a marquee tournament", () => {
    const e = catalogEntry("fifa.world");
    expect(e?.kind).toBe("tournament");
    expect(e?.marquee).toBe(true);
  });
});
