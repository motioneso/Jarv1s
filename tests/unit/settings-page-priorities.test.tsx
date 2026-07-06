import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { SettingsPage } from "../../apps/web/src/settings/settings-page.js";

describe("SettingsPage priorities navigation", () => {
  const adminMe = {
    user: {
      id: "admin-1",
      email: "admin@example.test",
      emailVerified: true,
      name: "Admin",
      status: "active" as const,
      isInstanceAdmin: true,
      isBootstrapOwner: true,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    profilePrefs: { addressed: null },
    hasPasswordCredential: true
  };

  it("exposes Priorities in personal settings navigation", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage
          me={{
            user: {
              id: "user-1",
              email: "user@example.test",
              emailVerified: true,
              name: "User",
              status: "active",
              isInstanceAdmin: false,
              isBootstrapOwner: false,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z"
            },
            profilePrefs: { addressed: null },
            hasPasswordCredential: false
          }}
        />
      </MemoryRouter>
    );

    expect(html).toContain("Personal settings");
    expect(html).toContain("Priorities");
  });

  it("does not render the global Advanced settings toggle", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage me={adminMe} />
      </MemoryRouter>
    );

    expect(html).toContain("Admin / Setup");
    expect(html).not.toContain("Advanced settings");
    expect(html).not.toContain("Show provider, host &amp; developer detail");
  });
});
