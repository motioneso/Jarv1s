import { describe, expect, it } from "vitest";
import { SPORTS_CATALOG, catalogEntry } from "../../packages/sports/src/source/catalog.js";

describe("sports catalog", () => {
  it("covers the approved competitions (#907 slice 3: Americas + UEFA top flights)", () => {
    expect(SPORTS_CATALOG.map((c) => c.competitionKey).sort()).toEqual(
      [
        "arg.1",
        "aut.1",
        "bel.1",
        "bra.1",
        "chi.1",
        "col.1",
        "crc.1",
        "den.1",
        "eng.1",
        "eng.2",
        "eng.3",
        "eng.4",
        "eng.5",
        "esp.1",
        "fifa.world",
        "fra.1",
        "ger.1",
        "gre.1",
        "ita.1",
        "mex.1",
        "mlb",
        "nba",
        "ned.1",
        "nfl",
        "nhl",
        "por.1",
        "sco.1",
        "sui.1",
        "tur.1",
        "uefa.champions",
        "uru.1",
        "usa.1"
      ].sort()
    );
  });
  it("groups the new top flights into their confederations (#907 slice 3)", () => {
    expect(catalogEntry("bra.1")?.confederation).toBe("CONMEBOL");
    expect(catalogEntry("mex.1")?.confederation).toBe("CONCACAF");
    expect(catalogEntry("esp.1")?.confederation).toBe("UEFA");
    for (const key of [
      "esp.1",
      "ger.1",
      "ita.1",
      "fra.1",
      "ned.1",
      "por.1",
      "sco.1",
      "tur.1",
      "bel.1",
      "gre.1",
      "sui.1",
      "aut.1",
      "den.1"
    ]) {
      expect(catalogEntry(key)?.confederation).toBe("UEFA");
    }
    for (const key of ["mex.1", "crc.1"]) {
      expect(catalogEntry(key)?.confederation).toBe("CONCACAF");
    }
    for (const key of ["bra.1", "arg.1", "col.1", "chi.1", "uru.1"]) {
      expect(catalogEntry(key)?.confederation).toBe("CONMEBOL");
    }
    for (const entry of SPORTS_CATALOG) {
      expect(entry.standingsShape).not.toBeNull();
    }
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
