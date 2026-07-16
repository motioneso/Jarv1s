import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: true,
    refetch: vi.fn()
  }))
}));

vi.mock("../../apps/web/src/api/client.js", () => ({
  listActionAuditLog: vi.fn()
}));

vi.mock("../../apps/web/src/locale/locale-format.js", () => ({
  formatDateTime: vi.fn(() => "July 16, 2026"),
  useUserLocale: vi.fn(() => ({ timezone: "UTC", region: "en-US", dateFormat: "24" }))
}));

import { ActivityPane } from "../../apps/web/src/settings/settings-activity-pane.js";

describe("ActivityPane", () => {
  it("shows bounded recovery instead of endless loading or false empty state", () => {
    const html = renderToString(createElement(ActivityPane, {}));

    expect(html).toContain("Activity unavailable");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Loading…");
    expect(html).not.toContain("No Jarvis actions in this period.");
  });
});
