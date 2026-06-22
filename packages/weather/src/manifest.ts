import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { getWeatherTodayRouteSchema } from "@jarv1s/shared";

export const WEATHER_MODULE_ID = "weather";

export const weatherModuleManifest = {
  id: WEATHER_MODULE_ID,
  name: "Weather",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true,
    supportsUserDisable: false
  },
  database: {
    migrations: [],
    migrationDirectories: [],
    ownedTables: []
  },
  permissions: [
    {
      id: "weather.view",
      label: "View weather",
      description: "Read the current weather for the active actor.",
      scope: "user",
      actions: ["view"]
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/weather/today",
      responseSchema: getWeatherTodayRouteSchema.response[200],
      permissionId: "weather.view"
    }
  ]
} satisfies JarvisModuleManifest;
