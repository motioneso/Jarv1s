import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

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
      description: "View personal and workspace settings surfaces.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "settings.manage",
      label: "Manage instance settings",
      description: "Manage users, workspaces, grants, and instance-level settings.",
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
      path: "/api/admin/workspaces",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/workspaces",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/workspaces/:id/memberships",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/workspaces/:id/memberships",
      permissionId: "settings.manage"
    },
    {
      method: "DELETE",
      path: "/api/admin/workspaces/:id/memberships/:userId",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/resource-grants",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/resource-grants",
      permissionId: "settings.manage"
    },
    {
      method: "DELETE",
      path: "/api/admin/resource-grants/:resourceType/:resourceId/:granteeUserId",
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
    }
  ]
};
