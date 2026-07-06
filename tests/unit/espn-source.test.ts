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
      qualifies: true
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
});
