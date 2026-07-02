import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEspnSportsSource } from "../../packages/sports/src/source/espn-source.js";

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

describe("EspnSportsSource", () => {
  it("parses a scoreboard into GameSummary[]", async () => {
    const src = createEspnSportsSource(okFetch(fixture("nfl-scoreboard.json")));
    const games = await src.getScoreboard("nfl", "2026-01-04");
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
    const src = createEspnSportsSource(failFetch);
    await expect(src.getScoreboard("nfl", "2026-01-04")).rejects.toThrow(/ESPN/);
  });

  it("rejects an unknown competition before fetching", async () => {
    const src = createEspnSportsSource(okFetch({}));
    await expect(src.getScoreboard("cricket.ipl", "2026-01-04")).rejects.toThrow(
      /unknown competition/i
    );
  });

  it("parses soccer standings (points + draws + qualification note)", async () => {
    const src = createEspnSportsSource(okFetch(fixture("eng1-standings.json")));
    const rows = await src.getStandings("eng.1");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      teamKey: "ars",
      rank: 1,
      points: 46,
      wins: 14,
      losses: 2,
      draws: 4,
      qualifies: true
    });
    // Second team has no note → does not qualify.
    expect(rows[1]?.qualifies).toBe(false);
  });

  it("parses news into Headline[]", async () => {
    const src = createEspnSportsSource(okFetch(fixture("nfl-news.json")));
    const headlines = await src.getHeadlines("nfl");
    expect(headlines).toHaveLength(2);
    expect(headlines[0]).toMatchObject({
      id: "4567",
      competitionKey: "nfl",
      url: "https://www.espn.com/nfl/story/_/id/4567"
    });
    expect(headlines[0]?.title).toContain("Cowboys");
  });

  it("parses teams into TeamRef[]", async () => {
    const src = createEspnSportsSource(okFetch(fixture("nfl-teams.json")));
    const teams = await src.listTeams("nfl");
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
    const src = createEspnSportsSource(okFetch(fixture("nfl-news.json")));
    const headlines = await src.getHeadlines("nfl");
    expect(headlines[0]?.imageUrl).toBe("https://a.espncdn.com/photo/2026/0104/cowboys-header.jpg");
    expect(headlines[0]?.sourceTeamIds).toEqual(["6"]);
    expect(headlines[0]?.teamKeys).toEqual([]); // the service fills these, not the source
    expect(headlines[1]?.imageUrl).toBeNull();
    expect(headlines[1]?.sourceTeamIds).toEqual([]);
  });

  it("carries the provider team id on listTeams", async () => {
    const src = createEspnSportsSource(okFetch(fixture("nfl-teams.json")));
    const teams = await src.listTeams("nfl");
    expect(teams[0]?.sourceTeamId).toBe("6");
  });
});
