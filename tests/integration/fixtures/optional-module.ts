import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

/** A non-required, fully user-disablable optional module (exercises both drop paths). */
export const optionalModule: JarvisModuleManifest = {
  id: "weather",
  name: "Weather",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: false, supportsUserDisable: true },
  routes: [{ method: "GET", path: "/api/weather/today", permissionId: "weather.view" }]
};

/** Optional but NOT user-disablable: a per-user row must be ignored; instance row still applies. */
export const instanceOnlyDisablableModule: JarvisModuleManifest = {
  id: "wellness",
  name: "Wellness",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: false, supportsUserDisable: false },
  routes: [{ method: "GET", path: "/api/wellness/today", permissionId: "wellness.view" }]
};

/** Required: never droppable by anyone, even with a (defensively-inserted) row. */
export const requiredFixtureModule: JarvisModuleManifest = {
  id: "tasks-fixture",
  name: "Tasks Fixture",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "required",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: true }
};
