export interface WebSearchProviderInput {
  readonly query: string;
  readonly limit: number;
  readonly freshness?: "any" | "day" | "week" | "month";
}

export interface WebSearchProviderResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly publishedAt?: string;
}

export interface WebSearchProviderOutput {
  readonly results: readonly WebSearchProviderResult[];
  readonly trace?: Record<string, unknown>;
}

export interface WebSearchProvider {
  readonly name: string;
  search(input: WebSearchProviderInput): Promise<WebSearchProviderOutput>;
}

const unavailableSearchProvider: WebSearchProvider = {
  name: "unavailable",
  search: async () => ({ results: [], trace: { unavailable: true } })
};

// Brave Search provider — requires JARVIS_BRAVE_SEARCH_API_KEY in the server env.
// Free tier: 2000 queries/month. Docs: https://brave.com/search/api/
const BRAVE_FRESHNESS_MAP: Partial<Record<string, string>> = {
  day: "pd",
  week: "pw",
  month: "pm"
};

function createBraveSearchProvider(apiKey: string): WebSearchProvider {
  return {
    name: "brave",
    async search(input) {
      const params = new URLSearchParams({
        q: input.query,
        count: String(Math.min(input.limit, 20)),
        text_decorations: "false",
        extra_snippets: "false"
      });
      if (input.freshness && input.freshness !== "any") {
        const mapped = BRAVE_FRESHNESS_MAP[input.freshness];
        if (mapped) params.set("freshness", mapped);
      }
      const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey
        },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Brave Search API error ${response.status}: ${body.slice(0, 200)}`);
      }
      const data = (await response.json()) as {
        web?: {
          results?: Array<{ title?: string; url?: string; description?: string; age?: string }>;
        };
      };
      const results: WebSearchProviderResult[] = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
        ...(r.age ? { publishedAt: r.age } : {})
      }));
      return {
        results,
        trace: { provider: "brave", count: results.length }
      };
    }
  };
}

let testSearchProvider: WebSearchProvider | undefined;
let _configuredProvider: WebSearchProvider | undefined;

export function getDefaultWebSearchProvider(): WebSearchProvider {
  if (testSearchProvider) return testSearchProvider;
  if (_configuredProvider) return _configuredProvider;
  const apiKey = process.env["JARVIS_BRAVE_SEARCH_API_KEY"];
  if (apiKey) {
    _configuredProvider = createBraveSearchProvider(apiKey);
    return _configuredProvider;
  }
  return unavailableSearchProvider;
}

export function setWebSearchProviderForTests(provider: WebSearchProvider | undefined): void {
  testSearchProvider = provider;
  // Also reset the env-key cache so key rotation takes effect and tests that clear the
  // provider don't get a stale Brave instance from a prior getDefaultWebSearchProvider call.
  _configuredProvider = undefined;
}
