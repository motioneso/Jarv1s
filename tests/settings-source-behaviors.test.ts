import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import type { ListSourceBehaviorsResponse } from "@jarv1s/shared";

import { queryKeys } from "../apps/web/src/api/query-keys";
import {
  BRIEFING_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled,
  writeSourceBehaviorCache
} from "../apps/web/src/settings/settings-source-behaviors";

const response: ListSourceBehaviorsResponse = {
  sources: [
    {
      id: "email",
      name: "Email",
      description: "Email source",
      behaviors: [
        {
          id: "email.briefings",
          sourceId: "email",
          name: "Include in briefings",
          description: "Email briefing signal",
          default: "default-on",
          enabled: false,
          toggleable: true
        }
      ]
    },
    {
      id: "calendar",
      name: "Calendar",
      description: "Calendar source",
      behaviors: [
        {
          id: "calendar.briefings",
          sourceId: "calendar",
          name: "Include in briefings",
          description: "Calendar briefing signal",
          default: "default-on",
          enabled: true,
          toggleable: true
        }
      ]
    }
  ]
};

it("uses the existing module briefing behavior ids", () => {
  expect(BRIEFING_SOURCE_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
    "email.briefings",
    "calendar.briefings"
  ]);
});

it("reads behavior state and defaults on when the backend row is absent", () => {
  expect(findSourceBehaviorEnabled(response.sources, "email.briefings")).toBe(false);
  expect(findSourceBehaviorEnabled(response.sources, "calendar.briefings")).toBe(true);
  expect(findSourceBehaviorEnabled(response.sources, "missing.behavior")).toBe(true);
});

it("writes source-behavior mutation results to the shared settings cache key", () => {
  const queryClient = new QueryClient();
  writeSourceBehaviorCache(queryClient, response);
  expect(queryClient.getQueryData(queryKeys.settings.sourceBehaviors)).toEqual(response);
});
