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

/**
 * Resolves the instance-wide Brave key per request. Injected by the composition root (module
 * isolation: web-research must not import settings/db internals). `scopedDb` is the tool's
 * DataContextDb, typed `unknown` here to keep web-research free of a `@jarv1s/db` dependency;
 * the resolver narrows it. Returns the decrypted key, or null when no instance key is set.
 */
export type WebSearchKeyResolver = (scopedDb: unknown) => Promise<string | null>;

let testSearchProvider: WebSearchProvider | undefined;
let keyResolver: WebSearchKeyResolver | undefined;
// Tiny cache keyed by the resolved key VALUE: when the admin saves/rotates/revokes, the next
// request resolves a different key (or null) → cache miss → fresh provider, so a new key takes
// effect without a restart. invalidateWebSearchProviderCache() is the explicit save/revoke hook.
let providerCache: { apiKey: string; provider: WebSearchProvider } | undefined;

/** Composition-root seam: install the resolver that reads the encrypted instance key. */
export function setWebSearchKeyResolver(resolver: WebSearchKeyResolver | undefined): void {
  keyResolver = resolver;
  providerCache = undefined;
}

/** Drop the cached provider so the next request re-resolves the key (save/revoke hook). */
export function invalidateWebSearchProviderCache(): void {
  providerCache = undefined;
}

function providerForKey(apiKey: string): WebSearchProvider {
  if (providerCache && providerCache.apiKey === apiKey) return providerCache.provider;
  const provider = createBraveSearchProvider(apiKey);
  providerCache = { apiKey, provider };
  return provider;
}

/**
 * Resolve the active web-search provider for a request. Precedence: test override → decrypted
 * instance key → `JARVIS_BRAVE_SEARCH_API_KEY` env fallback → unavailable. Decrypt-at-use means
 * a freshly-saved key works without a restart. A failing resolver (bad keyring/envelope) falls
 * back to the env key rather than breaking chat.
 */
export async function resolveWebSearchProvider(scopedDb: unknown): Promise<WebSearchProvider> {
  if (testSearchProvider) return testSearchProvider;

  let apiKey: string | null = null;
  if (keyResolver) {
    try {
      apiKey = await keyResolver(scopedDb);
    } catch {
      apiKey = null;
    }
  }
  if (!apiKey) {
    apiKey = process.env["JARVIS_BRAVE_SEARCH_API_KEY"] || null;
  }
  if (!apiKey) return unavailableSearchProvider;
  return providerForKey(apiKey);
}

export function setWebSearchProviderForTests(provider: WebSearchProvider | undefined): void {
  testSearchProvider = provider;
  // Reset the resolved-key cache so tests that swap or clear the provider never get a stale
  // Brave instance from a prior resolveWebSearchProvider call.
  providerCache = undefined;
}
