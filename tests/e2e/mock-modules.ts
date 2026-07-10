import type { Page } from "@playwright/test";
import type {
  ExternalModuleDto,
  ListExternalModulesResponse,
  ListModulesResponse,
  ListMyModulesResponse
} from "@jarv1s/shared";

export const modulesResponse: ListModulesResponse = {
  modules: [
    {
      id: "connectors",
      name: "Connectors",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [],
      settings: [
        {
          id: "connectors.user-settings",
          label: "Connectors",
          path: "/settings/connectors",
          scope: "user",
          order: 30
        }
      ]
    },
    {
      id: "tasks",
      name: "Tasks",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "tasks",
          label: "Tasks",
          path: "/tasks",
          icon: "check-square",
          order: 10
        }
      ],
      settings: []
    },
    {
      id: "notifications",
      name: "Notifications",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "notifications",
          label: "Notifications",
          path: "/notifications",
          icon: "bell",
          order: 30
        }
      ],
      settings: []
    },
    {
      id: "calendar",
      name: "Calendar",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "calendar",
          label: "Calendar",
          path: "/calendar",
          icon: "calendar-days",
          order: 35
        }
      ],
      settings: []
    },
    {
      id: "email",
      name: "Email",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "email",
          label: "Email",
          path: "/email",
          icon: "mail",
          order: 40
        }
      ],
      settings: []
    },
    {
      id: "ai",
      name: "AI",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [],
      settings: [
        {
          id: "ai.user-settings",
          label: "AI Providers",
          path: "/settings/ai",
          scope: "user",
          order: 40
        }
      ]
    },
    {
      id: "chat",
      name: "Chat",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "chat",
          label: "Chat",
          path: "/chat",
          icon: "message-square",
          order: 45
        }
      ],
      settings: []
    },
    {
      id: "briefings",
      name: "Briefings",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "briefings",
          label: "Briefings",
          path: "/briefings",
          icon: "newspaper",
          order: 50
        }
      ],
      settings: []
    },
    {
      id: "settings",
      name: "Settings",
      version: "0.0.0",
      lifecycle: "required",
      navigation: [
        {
          id: "settings",
          label: "Settings",
          path: "/settings",
          icon: "settings",
          order: 1000
        }
      ],
      settings: []
    }
  ]
};

/**
 * Per-actor enablement flags for the same module set, all active — the shell hides nav only
 * for modules the actor has explicitly disabled, so the default fixture keeps the full nav.
 */
export const myModulesResponse: ListMyModulesResponse = {
  modules: modulesResponse.modules.map((module) => ({
    id: module.id,
    name: module.name,
    version: module.version,
    lifecycle: module.lifecycle,
    required: module.lifecycle === "required",
    supportsUserDisable: module.lifecycle === "user-toggleable",
    instanceDisabled: false,
    userDisabled: false,
    active: true
  }))
};

/**
 * Stateful mock for the #917 external-modules admin surface (Settings → Instance modules).
 * Seeds one discovered-but-inactive module; the POST toggle flips its status in-memory so the
 * pane round-trips (enable → refetch shows the switch checked), mirroring the stateful handlers
 * in mock-api.ts (e.g. handleAdminUsersRoute).
 *
 * MUST be registered AFTER mockApi(page, …): Playwright matches the most-recently-registered
 * route first, so these override mockApi's catch-all 404 for /api/*.
 */
export async function mockExternalModules(page: Page): Promise<void> {
  // `enabled:true` mirrors the server having JARVIS_ENABLE_EXTERNAL_MODULES=1; without it the
  // pane hides the whole section (the fail-closed default), so the feature-on path needs it true.
  let current: ExternalModuleDto = {
    id: "acme-widgets",
    name: "Acme Widgets",
    version: "0.1.0",
    publisher: "Acme, Inc.",
    status: "discovered",
    active: false,
    drifted: false,
    disabledReason: null
  };

  // GET list — the pane's initial query and every post-toggle refetch read this.
  await page.route("**/api/admin/external-modules", async (route) => {
    const body: ListExternalModulesResponse = { enabled: true, modules: [current], rejected: [] };
    await route.fulfill({ json: body });
  });

  // POST /api/admin/external-modules/:id — flip the module's status so the refetched list
  // reflects the new enablement, matching the real endpoint's { module } envelope.
  await page.route("**/api/admin/external-modules/*", async (route) => {
    const enabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
    current = {
      ...current,
      status: enabled ? "enabled" : "disabled",
      active: enabled
    };
    await route.fulfill({ json: { module: current } });
  });
}
