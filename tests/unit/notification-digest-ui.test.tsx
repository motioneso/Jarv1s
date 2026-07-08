import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notification digest settings UI", () => {
  it("wires Email digest to real controls instead of a coming-soon row", () => {
    const view = readFileSync("apps/web/src/settings/settings-module-subviews.tsx", "utf8");
    const client = readFileSync("apps/web/src/api/client.ts", "utf8");
    const queryKeys = readFileSync("apps/web/src/api/query-keys.ts", "utf8");

    expect(view).toContain("getNotificationDigestPreference");
    expect(view).toContain("putNotificationDigestPreference");
    expect(view).toContain('name="Email digest"');
    expect(view).toContain('type="time"');
    expect(view).toContain("Daily");
    expect(view).toContain("Weekly");
    expect(view).not.toContain(
      'name="Email digest"\n          desc="A once-daily summary, instead of live alerts. Tracked in #742."\n          coming'
    );
    expect(client).toContain("/api/me/notification-digest-preference");
    expect(queryKeys).toContain("notificationDigest");
  });
});
