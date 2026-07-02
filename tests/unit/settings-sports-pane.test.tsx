import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import SportsSettings from "../../packages/sports/src/settings/index.js";

const CATALOG_KEY = ["sports", "catalog"] as const;
const FOLLOWS_KEY = ["sports", "follows"] as const;

function renderWithQuery(client: QueryClient): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(SportsSettings))
  );
}

describe("SportsSettings", () => {
  it("renders competition labels and marquee tag on the World Cup", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "fifa.world",
          label: "FIFA World Cup",
          kind: "tournament",
          marquee: true,
          standingsShape: "groups",
          teams: [
            {
              teamKey: "team.bra",
              competitionKey: "fifa.world",
              name: "Brazil",
              shortName: "BRA",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("FIFA World Cup");
    expect(html).toContain("Marquee");
    expect(html).toContain("BRA");
  });

  it("marks a followed team active", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          standingsShape: "table",
          teams: [
            {
              teamKey: "team.ars",
              competitionKey: "epl",
              name: "Arsenal",
              shortName: "ARS",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("is-active");
  });

  it("shows a whole-league follow button per competition", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          standingsShape: "table",
          teams: []
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("Follow all of <!-- -->Premier League");
  });
});
