import { describe, expect, it } from "vitest";

import { sportsModuleManifest } from "../../packages/sports/src/manifest.js";

describe("sports manifest", () => {
  it("declares owner-only table + nav + settings + routes", () => {
    expect(sportsModuleManifest.database.ownedTables).toEqual(["app.sports_follows"]);
    expect(sportsModuleManifest.database.migrations).toEqual(["sql/0133_sports_follows.sql"]);
    expect(sportsModuleManifest.navigation[0]?.path).toBe("/sports");
    expect(sportsModuleManifest.settings[0]?.path).toBe("/settings/modules/sports");
    expect(sportsModuleManifest.routes.map((r) => r.path)).toContain("/api/sports/overview");
  });

  it("exposes exactly one read-risk briefing tool", () => {
    expect(sportsModuleManifest.assistantTools).toHaveLength(1);
    expect(sportsModuleManifest.assistantTools[0]?.name).toBe("sports.followedFactsToday");
    expect(sportsModuleManifest.assistantTools[0]?.risk).toBe("read");
  });

  it("declares the espn external source with credential none and pinned hosts", () => {
    const [espn] = sportsModuleManifest.externalSources ?? [];
    expect(espn?.id).toBe("espn");
    expect(espn?.credential).toBe("none");
    expect(espn?.fetchHosts).toEqual(["site.api.espn.com"]);
    expect(espn?.imageHosts).toEqual(["a.espncdn.com", "s.secure.espncdn.com"]);
    expect(espn?.datasets.map((d) => d.key).sort()).toEqual(
      ["headlines", "schedule", "scoreboard", "standings", "teams"].sort()
    );
    expect(espn?.datasets.every((d) => d.staleness === "degrade-empty")).toBe(true);
  });
});
