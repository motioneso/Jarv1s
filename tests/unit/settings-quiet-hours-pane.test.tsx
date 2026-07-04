import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GetQuietHoursSettingsResponse } from "@jarv1s/shared";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

vi.mock("virtual:jarvis-module-settings", () => ({
  MODULE_SETTINGS_SURFACES: [],
  MODULE_SETTINGS_COMPONENTS: {}
}));

const quietHours: GetQuietHoursSettingsResponse = {
  quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "America/Chicago" }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quiet-hours settings client", () => {
  it("uses the current-user quiet-hours API for reads and writes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(quietHours), { status: 200 }))
      );
    const { getQuietHoursSettings, putQuietHoursSettings } =
      await import("../../apps/web/src/api/client.js");

    await expect(getQuietHoursSettings()).resolves.toEqual(quietHours);
    await expect(putQuietHoursSettings({ quietHours: quietHours.quietHours })).resolves.toEqual(
      quietHours
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/me/quiet-hours",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/quiet-hours",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ quietHours: quietHours.quietHours }),
        credentials: "include"
      })
    );
  });

  it("has a dedicated settings query key", () => {
    expect(queryKeys.settings.quietHours).toEqual(["settings", "quiet-hours"]);
  });
});

describe("GeneralPane quiet-hours controls", () => {
  it("renders backend quiet-hours values and removes coming-soon copy", async () => {
    const html = await renderPane((client) => {
      client.setQueryData(queryKeys.settings.locale, {
        locale: { timezone: "America/Los_Angeles", region: "en-US", dateFormat: "24" }
      });
      client.setQueryData(queryKeys.settings.quietHours, quietHours);
    });

    expect(html).toContain('aria-label="Enable quiet hours"');
    expect(html).toContain('checked=""');
    expect(html).toContain('value="22:00"');
    expect(html).toContain('value="07:00"');
    expect(html).not.toContain(["Saving quiet hours", " is coming soon"].join(""));
    expect(html).not.toContain("BACKEND-TODO");
  });
});

async function renderPane(seed: (client: QueryClient) => void): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const { FeedbackProvider } = await import("../../apps/web/src/settings/settings-feedback.js");
  const { GeneralPane } =
    await import("../../apps/web/src/settings/settings-personal-data-panes.js");
  return renderToString(
    createElement(
      FeedbackProvider,
      null,
      createElement(QueryClientProvider, { client }, createElement(GeneralPane) as ReactElement)
    )
  );
}
