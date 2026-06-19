import type { ToolExecute } from "@jarv1s/module-sdk";

import { DEFAULT_WEB_RESEARCH_CONFIG } from "./config.js";
import { getDefaultWebSearchProvider } from "./providers.js";
import { readWebPage } from "./reader.js";

function domainFor(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

export const webSearchExecute: ToolExecute = async (_scopedDb, input) => {
  const rawQuery = typeof input.query === "string" ? input.query : "";
  const query = rawQuery.slice(0, DEFAULT_WEB_RESEARCH_CONFIG.maxQueryChars);
  const requestedLimit = typeof input.limit === "number" ? input.limit : 5;
  const limit = Math.min(
    Math.max(1, Math.trunc(requestedLimit)),
    DEFAULT_WEB_RESEARCH_CONFIG.maxSearchResults
  );
  const freshness =
    input.freshness === "day" ||
    input.freshness === "week" ||
    input.freshness === "month" ||
    input.freshness === "any"
      ? input.freshness
      : undefined;
  const provider = getDefaultWebSearchProvider();
  const providerOutput = await provider.search({ query, limit, freshness });
  const results = providerOutput.results.slice(0, limit).map((result, index) => ({
    resultId: `web-${index + 1}`,
    title: result.title,
    url: result.url,
    domain: domainFor(result.url),
    snippet: result.snippet,
    publishedAt: result.publishedAt
  }));

  return {
    data: {
      query,
      results,
      trace: {
        ...(providerOutput.trace ?? {}),
        provider: provider.name,
        resultCount: results.length,
        limitApplied: requestedLimit > limit || providerOutput.results.length > results.length,
        queryTruncated: rawQuery.length > query.length
      }
    }
  };
};

export const webReadExecute: ToolExecute = async (_scopedDb, input) => {
  const rawUrls = Array.isArray(input.urls)
    ? input.urls.filter((url) => typeof url === "string")
    : [];
  const urls = rawUrls.slice(0, DEFAULT_WEB_RESEARCH_CONFIG.maxReadUrls);
  const results = await Promise.all(urls.map((url) => readWebPage(url)));
  const documents = results.flatMap((result) => (result.ok ? [result.document] : []));
  const skipped = results.flatMap((result) =>
    result.ok ? [] : [{ url: result.url, status: "skipped", reason: result.reason }]
  );
  return {
    data: {
      documents,
      trace: {
        requestedUrlCount: rawUrls.length,
        fetchedUrlCount: documents.length,
        skippedUrlCount: skipped.length + Math.max(0, rawUrls.length - urls.length),
        urlLimitApplied: rawUrls.length > urls.length,
        documents: [
          ...documents.map((document) => ({
            url: document.url,
            status: document.status,
            truncated: document.truncated
          })),
          ...skipped
        ]
      }
    }
  };
};
