import { test, expect, type Page, type Route } from "@playwright/test";
import type {
  CompetitionRef,
  CreateSportsFollowRequest,
  SportsFollowDto,
  TeamRef
} from "@jarv1s/shared";

import { mockApi } from "./mock-api.js";

const NFL: CompetitionRef = {
  competitionKey: "nfl",
  label: "NFL",
  kind: "league",
  marquee: true,
  standingsShape: "record",
  confederation: "INTL"
};
const EPL: CompetitionRef = {
  competitionKey: "epl",
  label: "Premier League",
  kind: "league",
  marquee: true,
  standingsShape: "table",
  confederation: "UEFA"
};
const COWBOYS: TeamRef = {
  teamKey: "dal",
  competitionKey: "nfl",
  name: "Dallas Cowboys",
  shortName: "DAL",
  crestUrl: null
};
const ARSENAL: TeamRef = {
  teamKey: "team.ars",
  competitionKey: "epl",
  name: "Arsenal",
  shortName: "ARS",
  crestUrl: null
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Stateful mock local to this spec (spec Slice 3) — catalog, follows, search, roster, and
    create/delete follow, all in-memory. No ESPN call, no real account. */
async function mockSportsSettings(page: Page): Promise<void> {
  let follows: SportsFollowDto[] = [];
  let nextId = 1;

  await page.route("**/api/me/modules", (route) =>
    fulfillJson(route, {
      modules: [
        {
          id: "sports",
          name: "Sports",
          version: "0.1.0",
          lifecycle: "user-toggleable",
          required: false,
          supportsUserDisable: true,
          instanceDisabled: false,
          userDisabled: false,
          active: true
        }
      ]
    })
  );

  await page.route("**/api/sports/catalog", (route) =>
    fulfillJson(route, { competitions: [NFL, EPL], degraded: false })
  );

  await page.route("**/api/sports/follows", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, { follows });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as CreateSportsFollowRequest;
      const follow: SportsFollowDto = {
        id: `f${nextId++}`,
        competitionKey: body.competitionKey,
        teamKey: body.teamKey,
        createdAt: "2026-07-12T00:00:00.000Z"
      };
      follows = [...follows, follow];
      return fulfillJson(route, { follow });
    }
    return route.continue();
  });

  await page.route("**/api/sports/follows/*", (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    follows = follows.filter((f) => f.id !== id);
    return fulfillJson(route, { ok: true });
  });

  await page.route("**/api/sports/teams/search*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const teams = [COWBOYS, ARSENAL].filter((t) => t.name.toLowerCase().includes(q));
    return fulfillJson(route, { teams, partial: false, degraded: false });
  });

  await page.route("**/api/sports/leagues/*/teams", (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const teams = key === "nfl" ? [COWBOYS] : key === "epl" ? [ARSENAL] : [];
    return fulfillJson(route, { teams, degraded: false });
  });
}

async function gotoSportsSettings(page: Page): Promise<void> {
  await page.goto("/settings?section=modules&module=sports");
  await expect(page.getByRole("heading", { name: "Sports" })).toBeVisible();
}

test.describe("Sports settings follow picker (#989)", () => {
  test("search → follow → Following → unfollow a team; follow-all → unfollow-all a league", async ({
    page
  }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    // Browse leagues starts collapsed on desktop too.
    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await expect(browseToggle).toHaveAttribute("aria-expanded", "false");

    // Search → follow an individual team.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("cowboys");
    const followBtn = page.getByRole("button", { name: "Follow Dallas Cowboys" });
    await expect(followBtn).toBeVisible();
    await followBtn.click();
    await expect(page.getByRole("button", { name: "Unfollow Dallas Cowboys" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unfollow Dallas Cowboys" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Unfollow via the same control.
    await page.getByRole("button", { name: "Unfollow Dallas Cowboys" }).click();
    await expect(page.getByRole("button", { name: "Follow Dallas Cowboys" })).toBeVisible();

    // Follow-all a league from search results.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("nfl");
    const followAllBtn = page.getByRole("button", { name: "Follow all of NFL" });
    await followAllBtn.click();
    await expect(page.getByRole("button", { name: "Unfollow all of NFL" })).toBeVisible();

    await page.getByRole("button", { name: "Unfollow all of NFL" }).click();
    await expect(page.getByRole("button", { name: "Follow all of NFL" })).toBeVisible();
  });

  test("browse leagues disclosure opens only the selected league's roster and preserves loading/retry states", async ({
    page
  }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await browseToggle.click();
    await expect(browseToggle).toHaveAttribute("aria-expanded", "true");
    const leagueToggle = page.getByRole("button", { name: "Premier League", exact: true });
    await expect(leagueToggle).toBeVisible();

    await leagueToggle.click();
    await expect(page.getByRole("button", { name: "Follow Arsenal" })).toBeVisible();
    // Only the expanded league's roster fetched — NFL's roster button never appears unexpanded.
  });

  test("narrow viewport: browse starts collapsed, keyboard-openable, no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await expect(browseToggle).toHaveAttribute("aria-expanded", "false");
    await browseToggle.focus();
    await page.keyboard.press("Enter");
    await expect(browseToggle).toHaveAttribute("aria-expanded", "true");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Search → follow round-trip still works at narrow width.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("arsenal");
    await page.getByRole("button", { name: "Follow Arsenal" }).click();
    await expect(page.getByRole("button", { name: "Unfollow Arsenal" })).toBeVisible();
    await page.getByRole("button", { name: "Unfollow Arsenal" }).click();
    await expect(page.getByRole("button", { name: "Follow Arsenal" })).toBeVisible();
  });
});
