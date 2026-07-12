export const DEFAULT_WEB_RESEARCH_CONFIG = {
  maxQueryChars: 200,
  maxSearchResults: 5,
  maxReadUrls: 5,
  maxDownloadBytes: 500_000,
  maxExtractedChars: 12_000,
  timeoutMs: 8_000,
  redirectLimit: 3,
  robotsCacheTtlMs: 30 * 60 * 1_000,
  perHostMinIntervalMs: 1_000
} as const;
