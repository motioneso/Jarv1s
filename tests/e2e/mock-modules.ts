import type { ListModulesResponse } from "@jarv1s/shared";

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
