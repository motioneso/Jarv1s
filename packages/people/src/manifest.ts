import { fileURLToPath } from "node:url";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { PEOPLE_TOOLS } from "./tools.js";

export const PEOPLE_MODULE_ID = "people";
export const PEOPLE_MODULE_VERSION = "0.1.0";

export const peopleModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const peopleModuleManifest: JarvisModuleManifest = {
  id: PEOPLE_MODULE_ID,
  name: "People & Context",
  publisher: "jarv1s",
  version: PEOPLE_MODULE_VERSION,
  lifecycle: "user-toggleable",
  availability: { defaultEnabled: true },
  compatibility: { jarv1s: ">=0.0.0" },
  database: {
    migrations: ["XXXX_person_context.sql"],
    ownedTables: [
      "app.person_context_people",
      "app.person_context_identities",
      "app.person_context_links",
      "app.person_context_link_sources",
      "app.person_context_match_candidates",
      "app.person_context_events",
      "app.person_context_indexing_state"
    ]
  },
  routes: [
    { method: "GET", path: "/api/people" },
    { method: "GET", path: "/api/people/resolve" },
    { method: "GET", path: "/api/people/match-candidates" },
    { method: "POST", path: "/api/people/match-candidates/:id/accept" },
    { method: "POST", path: "/api/people/match-candidates/:id/reject" },
    { method: "POST", path: "/api/people/match-candidates/:id/suppress" },
    { method: "POST", path: "/api/people/index/refresh" },
    { method: "GET", path: "/api/people/:id" },
    { method: "GET", path: "/api/people/:id/links" },
    { method: "PATCH", path: "/api/people/:id" },
    { method: "POST", path: "/api/people/:id/archive" },
    { method: "POST", path: "/api/people/:id/merge" },
    { method: "POST", path: "/api/people/:id/split-identity" }
  ],
  assistantTools: PEOPLE_TOOLS
};
