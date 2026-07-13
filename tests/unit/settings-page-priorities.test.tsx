import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { SettingsPage } from "../../apps/web/src/settings/settings-page.js";

describe("SettingsPage priorities navigation", () => {
  const nonAdminMe = {
    user: {
      id: "user-1",
      email: "user@example.test",
      emailVerified: true,
      name: "User",
      status: "active" as const,
      isInstanceAdmin: false,
      isBootstrapOwner: false,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    profilePrefs: { addressed: null },
    hasPasswordCredential: false
  };
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
        <SettingsPage me={nonAdminMe} />
      </MemoryRouter>
    );

    expect(html).toContain("Jarvis");
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

  it("renders the four personal group labels and drops merged destinations", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage me={nonAdminMe} />
      </MemoryRouter>
    );

    expect(html).toContain("Your account");
    expect(html).toContain("Jarvis");
    expect(html).toContain("Connections");
    expect(html).toContain("Extensions");
    expect(html).toContain("Account &amp; preferences");
    expect(html).not.toContain(">General<");
  });

  it("renders the three admin group labels and drops the Identity destination", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/settings?section=people"]}>
        <SettingsPage me={adminMe} />
      </MemoryRouter>
    );

    expect(html).toContain("Access");
    expect(html).toContain("AI &amp; extensions");
    expect(html).toContain("Operations");
    expect(html).not.toContain("Identity &amp; registration");
  });

  it("falls back to a permitted personal section for a non-admin admin deep link", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/settings?section=people"]}>
        <SettingsPage me={nonAdminMe} />
      </MemoryRouter>
    );

    expect(html).toContain("Account &amp; preferences");
    expect(html).not.toContain("People &amp; access");
  });
});
