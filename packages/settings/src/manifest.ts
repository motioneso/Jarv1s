import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const settingsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const settingsModuleManifest: JarvisModuleManifest = {
  id: "settings",
  name: "Settings",
  version: "0.0.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true
  },
  navigation: [
    {
      id: "settings",
      label: "Settings",
      path: "/settings",
      icon: "settings",
      order: 1000,
      permissionId: "settings.view"
    }
  ],
  settings: [
    {
      id: "admin-settings",
      label: "Admin",
      path: "/settings/admin",
      scope: "admin",
      order: 1000,
      permissionId: "settings.manage"
    }
  ],
  permissions: [
    {
      id: "settings.view",
      label: "View settings",
      description: "View personal settings surfaces.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "settings.manage",
      label: "Manage instance settings",
      description: "Manage users and instance-level settings.",
      scope: "admin",
      actions: ["manage"]
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/bootstrap/status"
    },
    {
      method: "GET",
      path: "/api/me",
      permissionId: "settings.view"
    },
    {
      method: "PATCH",
      path: "/api/me/profile",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/me/locale",
      permissionId: "settings.view"
    },
    {
      method: "PUT",
      path: "/api/me/locale",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/me/sessions",
      permissionId: "settings.view"
    },
    {
      method: "DELETE",
      path: "/api/me/sessions/others",
      permissionId: "settings.view"
    },
    {
      method: "DELETE",
      path: "/api/me/sessions/:id",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/me/persona",
      permissionId: "settings.view"
    },
    {
      method: "PUT",
      path: "/api/me/persona",
      permissionId: "settings.view"
    },
    {
      method: "POST",
      path: "/api/me/persona/preview",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/me/source-behaviors",
      permissionId: "settings.view"
    },
    {
      method: "PUT",
      path: "/api/me/source-behaviors/:id",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/admin/auth/providers",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/users",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/settings",
      permissionId: "settings.manage"
    },
    {
      method: "PATCH",
      path: "/api/admin/settings/:key",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/audit-events",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/modules",
      permissionId: "settings.manage"
    },
    {
      method: "PATCH",
      path: "/api/admin/modules/:id",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/me/modules",
      permissionId: "settings.view"
    },
    {
      method: "PATCH",
      path: "/api/me/modules/:id",
      permissionId: "settings.view"
    },
    {
      method: "GET",
      path: "/api/settings/me/data-export",
      permissionId: "settings.view"
    },
    {
      method: "POST",
      path: "/api/onboarding/provider-check",
      permissionId: "settings.manage"
    }
  ]
};
