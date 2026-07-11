import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type {
  GetNewsPersonalizationResponse,
  NewsCatalogResponse,
  NewsPersonalizationAvailabilityDto,
  NewsPrefsResponse
} from "@jarv1s/shared";

import NewsSettings from "../../packages/news/src/settings/index.js";
import { newsQueryKeys } from "../../packages/news/src/web/query-keys.js";

// #953 Task 5: the personalization sections must never present a false affordance —
// custom-source/topic creation has NO write API in Slice 1, so its Add controls are visible
// but disabled regardless of prerequisites, while exclusion management is fully live.
// useQuery reads primed cache synchronously during renderToString (same harness as
// tests/unit/sports-page.test.tsx), so no fetch mocking is needed.

const catalog: NewsCatalogResponse = {
  sources: [
    {
      sourceKey: "bbc",
      label: "BBC News",
      homepageUrl: "https://www.bbc.com/news",
      defaultEnabled: true,
      topics: ["world"]
    },
    {
      sourceKey: "nytimes",
      label: "The New York Times",
      homepageUrl: "https://www.nytimes.com",
      defaultEnabled: false,
      topics: ["world"]
    }
  ],
  topics: [{ topicKey: "world", label: "World" }]
};

const prefs: NewsPrefsResponse = { prefs: [] };

const allOff: NewsPersonalizationAvailabilityDto = {
  aiConfigured: false,
  webSearchConfigured: false,
  customSourceByUrlEnabled: false,
  customSourceByNameEnabled: false,
  freeformTopicsEnabled: false
};

const allOn: NewsPersonalizationAvailabilityDto = {
  aiConfigured: true,
  webSearchConfigured: true,
  customSourceByUrlEnabled: true,
  customSourceByNameEnabled: true,
  freeformTopicsEnabled: true
};

function personalization(
  overrides: Partial<GetNewsPersonalizationResponse> = {}
): GetNewsPersonalizationResponse {
  return {
    availability: allOff,
    customSources: [],
    customTopics: [],
    sourceExclusions: [],
    snapshot: null,
    ...overrides
  };
}

function render(data: GetNewsPersonalizationResponse): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(newsQueryKeys.catalog, catalog);
  client.setQueryData(newsQueryKeys.prefs, prefs);
  client.setQueryData(newsQueryKeys.personalization, data);
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(NewsSettings))
  );
}

describe("NewsSettings personalization sections (#953)", () => {
  it("renders all three new sections alongside the untouched curated controls", () => {
    const html = render(personalization());
    expect(html).toContain("Personalized sources");
    expect(html).toContain("Topics you describe");
    expect(html).toContain("Excluded publishers");
    // Curated V1 controls unchanged.
    expect(html).toContain("BBC News");
    expect(html).toContain('aria-pressed="true"');
  });

  it("prerequisites missing: custom add controls are visible but disabled, with a setup link", () => {
    const html = render(personalization({ availability: allOff }));
    // Both closed-write Add buttons render disabled.
    expect(html).toContain(
      'class="jds-btn jds-btn--sm jds-btn--secondary nw-set__addbtn" disabled=""'
    );
    expect(html).toContain("/settings?section=assistant");
    // The exclusion form stays fully live without any AI prerequisite.
    expect(html).toContain('class="jds-btn jds-btn--sm nw-set__exadd"');
    expect(html).not.toContain('class="jds-btn jds-btn--sm nw-set__exadd" disabled=""');
  });

  it("prerequisites met: custom add controls STAY disabled in Slice 1 (no write APIs yet)", () => {
    const html = render(personalization({ availability: allOn }));
    expect(html).toContain(
      'class="jds-btn jds-btn--sm jds-btn--secondary nw-set__addbtn" disabled=""'
    );
    expect(html).toContain("Coming soon");
    // With prerequisites satisfied there is nothing to set up.
    expect(html).not.toContain("/settings?section=assistant");
  });

  it("renders stored verified sources and described topics read-only", () => {
    const html = render(
      personalization({
        availability: allOn,
        customSources: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            label: "The Atlantic",
            canonicalDomain: "theatlantic.com",
            homepageUrl: "https://www.theatlantic.com",
            feedUrl: null,
            retrievalMethod: "scrape",
            validationStatus: "approved",
            healthStatus: "available",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ],
        customTopics: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            label: "Watches",
            guidance: "Mechanical watches and watchmaking; exclude smartwatches",
            validationStatus: "approved",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      })
    );
    expect(html).toContain("The Atlantic");
    expect(html).toContain("theatlantic.com");
    expect(html).toContain("Watches");
    expect(html).toContain("exclude smartwatches");
  });

  it("lists exclusions with per-row Remove actions and everywhere/neutral copy", () => {
    const html = render(
      personalization({
        sourceExclusions: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            canonicalDomain: "example.com",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      })
    );
    expect(html).toContain("example.com");
    expect(html).toContain('aria-label="Remove example.com"');
    // Spec copy: exclusions apply everywhere; removal returns the publisher to neutral.
    expect(html).toContain("never appear anywhere");
    expect(html).toContain("neutral");
  });

  it("renders an excluded curated tile as Excluded and disabled, never as On", () => {
    const html = render(
      personalization({
        sourceExclusions: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            canonicalDomain: "bbc.com",
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      })
    );
    expect(html).toContain("is-excluded");
    expect(html).toContain("Excluded</span>");
    // The other curated tile still shows its true On/Off state.
    expect(html).toContain('aria-pressed="false"');
  });
});
