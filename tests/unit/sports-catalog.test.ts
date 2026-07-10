import { describe, expect, it } from "vitest";
import { SPORTS_CATALOG, catalogEntry } from "../../packages/sports/src/source/catalog.js";

describe("sports catalog", () => {
  it("covers the approved competitions (#907 slice 2: English pyramid)", () => {
    expect(SPORTS_CATALOG.map((c) => c.competitionKey).sort()).toEqual(
      [
        "eng.1",
        "eng.2",
        "eng.3",
        "eng.4",
        "eng.5",
        "fifa.world",
        "mlb",
        "nba",
        "nfl",
        "nhl",
        "uefa.champions",
        "usa.1"
      ].sort()
    );
  });
  it("gives England its full pyramid, all UEFA table leagues (#907)", () => {
    for (const key of ["eng.2", "eng.3", "eng.4", "eng.5"]) {
      const entry = catalogEntry(key);
      expect(entry?.confederation).toBe("UEFA");
      expect(entry?.standingsShape).toBe("table");
      expect(entry?.espnSport).toBe("soccer");
    }
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
  it("tags every entry with a confederation (#907)", () => {
    for (const entry of SPORTS_CATALOG) expect(entry.confederation).toBeTruthy();
    expect(catalogEntry("eng.1")?.confederation).toBe("UEFA");
    expect(catalogEntry("usa.1")?.confederation).toBe("CONCACAF");
    expect(catalogEntry("uefa.champions")?.confederation).toBe("UEFA");
    expect(catalogEntry("fifa.world")?.confederation).toBe("INTL");
    expect(catalogEntry("nfl")?.confederation).toBe("INTL");
  });
});
