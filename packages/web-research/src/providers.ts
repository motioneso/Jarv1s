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

let testSearchProvider: WebSearchProvider | undefined;

export function getDefaultWebSearchProvider(): WebSearchProvider {
  return testSearchProvider ?? unavailableSearchProvider;
}

export function setWebSearchProviderForTests(provider: WebSearchProvider | undefined): void {
  testSearchProvider = provider;
}
