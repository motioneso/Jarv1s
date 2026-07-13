import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GetQuietHoursSettingsResponse, MeResponse } from "@jarv1s/shared";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { isValidQuietHoursTime } from "../../apps/web/src/settings/settings-personal-panes.js";

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

describe("isValidQuietHoursTime", () => {
  it("accepts valid HH:MM", () => {
    expect(isValidQuietHoursTime("22:00")).toBe(true);
    expect(isValidQuietHoursTime("07:05")).toBe(true);
  });
  it("rejects empty string and malformed values", () => {
    expect(isValidQuietHoursTime("")).toBe(false);
    expect(isValidQuietHoursTime("24:00")).toBe(false);
    expect(isValidQuietHoursTime("7:5")).toBe(false);
  });
});

describe("ProfilePane quiet-hours controls", () => {
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

const me: MeResponse = {
  user: {
    id: "u1",
    email: "u@example.test",
    emailVerified: true,
    name: "U",
    status: "active",
    isInstanceAdmin: false,
    isBootstrapOwner: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  profilePrefs: { addressed: null },
  hasPasswordCredential: true
};

async function renderPane(seed: (client: QueryClient) => void): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const { FeedbackProvider } = await import("../../apps/web/src/settings/settings-feedback.js");
  const { ProfilePane } = await import("../../apps/web/src/settings/settings-personal-panes.js");
  return renderToString(
    createElement(
      FeedbackProvider,
      null,
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProfilePane, { me, onNavigate: () => {} }) as ReactElement
      )
    )
  );
}
