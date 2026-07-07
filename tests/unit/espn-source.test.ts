import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEspnDatasetAdapter } from "../../packages/sports/src/source/espn-source.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../packages/sports/src/source/__fixtures__/${name}`, import.meta.url)
      ),
      "utf8"
    )
  );
}

const okFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

const adapter = createEspnDatasetAdapter();

function fetchDataset(datasetKey: string, params: Record<string, unknown>, fetchFn: typeof fetch) {
  return adapter.fetchDataset(datasetKey, params, { fetchFn });
}

describe("EspnDatasetAdapter", () => {
  it("parses a scoreboard into GameSummary[]", async () => {
    const games = (await fetchDataset(
      "scoreboard",
      { competitionKey: "nfl", day: "2026-01-04" },
      okFetch(fixture("nfl-scoreboard.json"))
    )) as {
      state: string;
      home: { teamKey: string; score: number | null; winner: boolean };
      away: { teamKey: string };
    }[];
    expect(games.length).toBeGreaterThan(0);
    expect(games[0]?.home.teamKey).toBeTypeOf("string");
    expect(games[0]?.home.teamKey).toBe("dal");
    expect(games[0]?.home.score).toBe(27);
    expect(games[0]?.home.winner).toBe(true);
    expect(games[0]?.away.teamKey).toBe("ne");
    expect(["pre", "live", "final"]).toContain(games[0]?.state);
    expect(games[0]?.state).toBe("final");
  });

  it("throws a typed error on non-200 (caller degrades)", async () => {
    const failFetch = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      fetchDataset("scoreboard", { competitionKey: "nfl", day: "2026-01-04" }, failFetch)
    ).rejects.toThrow(/ESPN/);
  });

  it("rejects an unknown competition before fetching", async () => {
    await expect(
      fetchDataset("scoreboard", { competitionKey: "cricket.ipl", day: "2026-01-04" }, okFetch({}))
    ).rejects.toThrow(/unknown competition/i);
  });

  it("rejects an unknown dataset key", async () => {
    await expect(fetchDataset("nonsense", { competitionKey: "nfl" }, okFetch({}))).rejects.toThrow(
      /unknown dataset/i
    );
  });

  it("parses soccer standings as a single labelled-null section", async () => {
    const table = (await fetchDataset(
      "standings",
      { competitionKey: "eng.1" },
      okFetch(fixture("eng1-standings.json"))
    )) as { sections: { label: string | null; rows: unknown[] }[] };
    expect(table.sections).toHaveLength(1);
    expect(table.sections[0]?.label).toBeNull();
    expect(table.sections[0]?.rows[0]).toMatchObject({
      teamKey: "ars",
      rank: 1,
      points: 46,
      wins: 14,
      losses: 2,
      draws: 4,
      winPercent: null,
      qualifies: true,
      qualificationNote: "UEFA Champions League",
      qualificationColor: "#2a66d1"
    });
    expect((table.sections[0]?.rows[1] as { qualifies: boolean }).qualifies).toBe(false);
  });

  it("keeps every tournament group as its own section", async () => {
    const table = (await fetchDataset(
      "standings",
      { competitionKey: "fifa.world" },
      okFetch(fixture("fifa-standings.json"))
    )) as { sections: { label: string | null; rows: { qualifies: boolean }[] }[] };
    expect(table.sections.map((s) => s.label)).toEqual(["Group A", "Group B"]);
    expect(table.sections[0]?.rows[0]?.qualifies).toBe(true);
  });

  it("parses record-league conferences with winPercent", async () => {
    const table = (await fetchDataset(
      "standings",
      { competitionKey: "nfl" },
      okFetch(fixture("nfl-standings.json"))
    )) as {
      sections: { label: string | null; rows: Record<string, unknown>[] }[];
    };
    expect(table.sections.map((s) => s.label)).toEqual([
      "American Football Conference",
      "National Football Conference"
    ]);
    expect(table.sections[1]?.rows[0]).toMatchObject({
      teamKey: "dal",
      wins: 10,
      losses: 2,
      winPercent: 0.833,
      points: null
    });
  });

  // Live ?level=3 division entries carry no "rank" stat but arrive standings-sorted; the
  // parser must fall back to the entry order or every US-league row ranks 0 and the web
  // guard hides the whole standing line (live feedback mraxrdxr, mraz6m43).
  it("falls back to entry order for rank when the rank stat is absent", async () => {
    const division = (wins: number) => ({
      stats: [
        { name: "wins", value: wins },
        { name: "losses", value: 12 - wins },
        { name: "winPercent", value: wins / 12 }
      ]
    });
    const payload = {
      name: "National Football League",
      children: [
        {
          name: "American Football Conference",
          children: [
            {
              name: "AFC East",
              standings: {
                entries: [
                  {
                    team: { abbreviation: "NE", displayName: "New England Patriots" },
                    ...division(10)
                  },
                  { team: { abbreviation: "BUF", displayName: "Buffalo Bills" }, ...division(8) }
                ]
              }
            }
          ]
        }
      ]
    };
    const table = (await fetchDataset(
      "standings",
      { competitionKey: "nfl" },
      okFetch(payload)
    )) as {
      sections: { label: string | null; conference: string | null; rows: { rank: number }[] }[];
    };
    expect(table.sections[0]?.label).toBe("AFC East");
    expect(table.sections[0]?.conference).toBe("American Football Conference");
    expect(table.sections[0]?.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("parses news into Headline[]", async () => {
    const headlines = (await fetchDataset(
      "headlines",
      { competitionKey: "nfl" },
      okFetch(fixture("nfl-news.json"))
    )) as { id: string; competitionKey: string; url: string; title: string }[];
    expect(headlines).toHaveLength(2);
    expect(headlines[0]).toMatchObject({
      id: "4567",
      competitionKey: "nfl",
      url: "https://www.espn.com/nfl/story/_/id/4567"
    });
    expect(headlines[0]?.title).toContain("Cowboys");
  });

  it("parses teams into TeamRef[]", async () => {
    const teams = (await fetchDataset(
      "teams",
      { competitionKey: "nfl" },
      okFetch(fixture("nfl-teams.json"))
    )) as {
      teamKey: string;
      competitionKey: string;
      name: string;
      shortName: string;
      crestUrl: string | null;
    }[];
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({
      teamKey: "dal",
      competitionKey: "nfl",
      name: "Dallas Cowboys",
      shortName: "Cowboys"
    });
    expect(teams[0]?.crestUrl).toContain("dal.png");
  });

  it("parses news images and provider team tags", async () => {
    const headlines = (await fetchDataset(
      "headlines",
      { competitionKey: "nfl" },
      okFetch(fixture("nfl-news.json"))
    )) as { imageUrl: string | null; sourceTeamIds: string[]; teamKeys: string[] }[];
    expect(headlines[0]?.imageUrl).toBe("https://a.espncdn.com/photo/2026/0104/cowboys-header.jpg");
    expect(headlines[0]?.sourceTeamIds).toEqual(["6"]);
    expect(headlines[0]?.teamKeys).toEqual([]); // the service fills these, not the source
    expect(headlines[1]?.imageUrl).toBeNull();
    expect(headlines[1]?.sourceTeamIds).toEqual([]);
  });

  it("carries the provider team id on listTeams", async () => {
    const teams = (await fetchDataset(
      "teams",
      { competitionKey: "nfl" },
      okFetch(fixture("nfl-teams.json"))
    )) as { sourceTeamId: string | null }[];
    expect(teams[0]?.sourceTeamId).toBe("6");
  });

  it("passes the schedule params through to the teams/competition-scoped endpoint", async () => {
    const games = (await fetchDataset(
      "schedule",
      { teamKey: "dal", competitionKey: "nfl" },
      okFetch(fixture("nfl-scoreboard.json"))
    )) as { competitionKey: string }[];
    expect(games.length).toBeGreaterThan(0);
    expect(games[0]?.competitionKey).toBe("nfl");
  });

  // Soccer schedule URLs only resolve numeric team ids — the abbreviation slug returns an
  // empty payload, which nulled form/next-match on every soccer card (live feedback mrawhx9c).
  it("prefers sourceTeamId over teamKey in the schedule URL when present", async () => {
    const urls: string[] = [];
    const spyFetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchDataset(
      "schedule",
      { teamKey: "sd", competitionKey: "usa.1", sourceTeamId: "22529" },
      spyFetch
    );
    await fetchDataset("schedule", { teamKey: "dal", competitionKey: "nfl" }, spyFetch);
    expect(urls[0]).toContain("/teams/22529/schedule");
    expect(urls[1]).toContain("/teams/dal/schedule"); // no id → abbreviation fallback
  });

  // The /schedule endpoint wraps score in { value, displayValue } (the scoreboard sends a plain
  // string); Number({...}) is NaN, which nulled schedule scores and made soccer draws read as
  // losses in the form pips (live feedback mrawhx9c).
  it("parses object-shaped schedule scores", async () => {
    const drawEvent = {
      events: [
        {
          id: "1",
          date: "2026-07-01T00:00Z",
          competitions: [
            {
              status: { type: { state: "post", detail: "FT" } },
              competitors: [
                {
                  homeAway: "home",
                  winner: false,
                  score: { value: 2, displayValue: "2" },
                  team: { abbreviation: "SD", displayName: "San Diego FC" }
                },
                {
                  homeAway: "away",
                  winner: false,
                  score: { value: 2, displayValue: "2" },
                  team: {
                    abbreviation: "LAFC",
                    displayName: "LAFC",
                    // schedule payloads carry a `logos` array, not the scoreboard's flat
                    // `logo` — the crest must still come through (live feedback mrawvc48)
                    logos: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/lafc.png" }]
                  }
                }
              ]
            }
          ]
        }
      ]
    };
    const games = (await fetchDataset(
      "schedule",
      { teamKey: "sd", competitionKey: "usa.1", sourceTeamId: "22529" },
      okFetch(drawEvent)
    )) as {
      home: { score: number | null };
      away: { score: number | null; crestUrl: string | null };
    }[];
    expect(games[0]?.home.score).toBe(2);
    expect(games[0]?.away.score).toBe(2);
    expect(games[0]?.away.crestUrl).toBe("https://a.espncdn.com/i/teamlogos/soccer/500/lafc.png");
  });
});
