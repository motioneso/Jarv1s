// packages/news/src/personalization-domain.ts
// #953 Task 2 — pure domain logic for news personalization. Dependency-free by design:
// this is the single parse path for publisher domains (Slice 1 exclusions, Slice 2 custom
// sources), so its security posture is reject-by-default per the spec's SSRF/IDN hardening
// (docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md).

/** Why a candidate publisher domain was refused. Stable machine keys, not UI copy. */
export type PublisherDomainRejection =
  | "empty"
  | "input_too_long"
  | "unparseable"
  | "non_https_scheme"
  | "credentials"
  | "explicit_port"
  | "ip_literal"
  | "single_label"
  | "hostname_too_long"
  | "invalid_label";

export type NormalizePublisherDomainResult =
  | { readonly ok: true; readonly domain: string }
  | { readonly ok: false; readonly reason: PublisherDomainRejection };

/** Hard input bound — matches the create-exclusion request schema's maxLength. */
const MAX_INPUT_LENGTH = 2048;
/** RFC 1035 total hostname bound (after trailing-dot strip). */
const MAX_HOSTNAME_LENGTH = 253;

export const NEWS_MAX_CUSTOM_SOURCES = 10;
export const NEWS_MAX_CUSTOM_TOPICS = 10;

// Anything with a scheme-like prefix is parsed as-is so non-HTTPS schemes (http, ftp,
// javascript, or a bare host:port misread as scheme) are rejected rather than mangled.
const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
// WHATWG URL canonicalizes every IPv4 spelling (hex, octal, integer) to a dotted quad,
// so one post-parse check covers them all.
const IPV4_DOTTED_QUAD = /^\d{1,3}(\.\d{1,3}){3}$/;
// LDH label: 1–63 chars, alphanumeric edges, hyphens only in the middle. The URL parser
// has already lowercased and punycoded, so ASCII-only is correct here.
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalize user input (bare hostname or HTTPS URL) to a canonical publisher domain:
 * lowercase ASCII (punycode for IDN), no trailing dot. Rejects credentials, explicit
 * ports, IP literals, non-HTTPS schemes, single-label hosts, and malformed labels.
 */
export function normalizePublisherDomain(input: string): NormalizePublisherDomainResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_INPUT_LENGTH) return { ok: false, reason: "input_too_long" };

  const candidate = SCHEME_PREFIX.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "non_https_scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  // url.port is "" when the URL uses the scheme default; any explicit non-default port
  // survives canonicalization and is refused (fetchers must only ever hit 443).
  if (url.port !== "") return { ok: false, reason: "explicit_port" };

  // Trailing dot is FQDN notation for the same host, not a distinct domain.
  const hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;

  // IPv6 hosts keep their brackets/colons in url.hostname; IPv4 is canonicalized dotted-quad.
  if (hostname.startsWith("[") || hostname.includes(":"))
    return { ok: false, reason: "ip_literal" };
  if (IPV4_DOTTED_QUAD.test(hostname)) return { ok: false, reason: "ip_literal" };

  if (hostname.length > MAX_HOSTNAME_LENGTH) return { ok: false, reason: "hostname_too_long" };

  const labels = hostname.split(".");
  // Single-label hosts (localhost, intranet names) are never public publishers.
  if (labels.length < 2) return { ok: false, reason: "single_label" };
  // Node's URL parser applies IDNA without DNS length checks, so enforce LDH shape here.
  if (!labels.every((label) => DNS_LABEL.test(label))) {
    return { ok: false, reason: "invalid_label" };
  }

  return { ok: true, domain: hostname };
}

/**
 * True when `candidate` is the excluded domain itself or any subdomain of it.
 * Exclusion is downward-only: excluding news.example.com does not hide example.com,
 * and suffix tricks (notexample.com, example.com.evil.com) never match.
 */
export function publisherDomainMatches(excluded: string, candidate: string): boolean {
  return candidate === excluded || candidate.endsWith(`.${excluded}`);
}

// ---------------------------------------------------------------------------
// Provisional Slice 1 snapshot storage guard. The compiled-feed payload shape is
// fixed by Slice 2; until then this hand-written guard bounds what any writer can
// persist into app.news_compilation_snapshots (jsonb) — article count, string sizes,
// nesting depth, JSON-only values, and total serialized bytes. Deliberately NOT AJV
// and deliberately not a published schema: the article shape stays module-private.
// ---------------------------------------------------------------------------

export const NEWS_SNAPSHOT_MAX_ARTICLES = 40;
export const NEWS_SNAPSHOT_MAX_STRING_LENGTH = 4096;
export const NEWS_SNAPSHOT_MAX_TOTAL_BYTES = 256 * 1024;
export const NEWS_SNAPSHOT_MAX_DEPTH = 8;

export interface NewsSnapshotArticle {
  readonly id: string;
  readonly publisher: string;
  readonly canonicalDomain: string;
  readonly headline: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly excerpt: string | null;
  readonly imageUrl: string | null;
  readonly topics: readonly string[];
  readonly preferred: boolean;
  readonly rank: number;
}

export interface NewsSnapshotPayload {
  readonly articles: readonly NewsSnapshotArticle[];
}

const SNAPSHOT_ARTICLE_KEYS = [
  "canonicalDomain",
  "excerpt",
  "headline",
  "id",
  "imageUrl",
  "preferred",
  "publishedAt",
  "publisher",
  "rank",
  "topics",
  "url"
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonValue(value: unknown, depth: number, path: string): void {
  if (depth > NEWS_SNAPSHOT_MAX_DEPTH) {
    throw new Error(
      `snapshot payload exceeds max nesting depth ${NEWS_SNAPSHOT_MAX_DEPTH} at ${path}`
    );
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > NEWS_SNAPSHOT_MAX_STRING_LENGTH) {
      throw new Error(
        `snapshot payload string at ${path} exceeds ${NEWS_SNAPSHOT_MAX_STRING_LENGTH} chars`
      );
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`snapshot payload has non-finite number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, depth + 1, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, depth + 1, `${path}.${key}`);
    }
    return;
  }
  // functions, undefined, bigint, symbols, class instances, Dates, Maps, ...
  throw new Error(`snapshot payload has non-JSON value (${typeof value}) at ${path}`);
}

/**
 * Throws unless `payload` is a bounded, JSON-only snapshot object:
 * `{ articles: object[] (≤ NEWS_SNAPSHOT_MAX_ARTICLES), ... }` within the string,
 * depth, and total-byte caps above. Callers MUST run this before any snapshot SQL.
 */
export function assertSnapshotPayload(payload: unknown): asserts payload is NewsSnapshotPayload {
  if (!isPlainObject(payload)) {
    throw new Error("snapshot payload must be a plain JSON object");
  }
  if (Object.keys(payload).length !== 1 || !("articles" in payload)) {
    throw new Error("snapshot payload must contain only articles");
  }
  const { articles } = payload;
  if (!Array.isArray(articles)) {
    throw new Error("snapshot payload articles must be an array");
  }
  if (articles.length > NEWS_SNAPSHOT_MAX_ARTICLES) {
    throw new Error(`snapshot payload articles exceeds max ${NEWS_SNAPSHOT_MAX_ARTICLES} entries`);
  }
  for (const [index, article] of articles.entries()) {
    if (!isPlainObject(article)) {
      throw new Error(`snapshot payload articles[${index}] must be a plain JSON object`);
    }
    const path = `snapshot payload articles[${index}]`;
    if (Object.keys(article).sort().join(",") !== SNAPSHOT_ARTICLE_KEYS.join(",")) {
      throw new Error(`${path} has an invalid shape`);
    }
    for (const key of [
      "id",
      "publisher",
      "canonicalDomain",
      "headline",
      "url",
      "publishedAt"
    ] as const) {
      if (typeof article[key] !== "string" || article[key].length === 0) {
        throw new Error(`${path}.${key} must be a non-empty string`);
      }
    }
    const domain = normalizePublisherDomain(article.canonicalDomain as string);
    if (!domain.ok || domain.domain !== article.canonicalDomain) {
      throw new Error(`${path}.canonicalDomain must be canonical`);
    }
    try {
      const url = new URL(article.url as string);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error(`${path}.url must be HTTPS`);
    }
    if (
      Number.isNaN(Date.parse(article.publishedAt as string)) ||
      new Date(article.publishedAt as string).toISOString() !== article.publishedAt
    ) {
      throw new Error(`${path}.publishedAt must be an ISO timestamp`);
    }
    if (article.excerpt !== null && typeof article.excerpt !== "string") {
      throw new Error(`${path}.excerpt must be a string or null`);
    }
    if (article.imageUrl !== null) {
      try {
        const image = new URL(article.imageUrl as string);
        if (image.protocol !== "https:") throw new Error();
      } catch {
        throw new Error(`${path}.imageUrl must be HTTPS or null`);
      }
    }
    if (
      !Array.isArray(article.topics) ||
      !article.topics.every((topic) => typeof topic === "string")
    ) {
      throw new Error(`${path}.topics must be a string array`);
    }
    if (typeof article.preferred !== "boolean") {
      throw new Error(`${path}.preferred must be boolean`);
    }
    if (
      !Number.isInteger(article.rank) ||
      (article.rank as number) < 1 ||
      (article.rank as number) > NEWS_SNAPSHOT_MAX_ARTICLES
    ) {
      throw new Error(`${path}.rank is invalid`);
    }
  }

  assertJsonValue(payload, 1, "$");

  // Values are already proven JSON-safe, so stringify is faithful (nothing dropped).
  const totalBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (totalBytes > NEWS_SNAPSHOT_MAX_TOTAL_BYTES) {
    throw new Error(
      `snapshot payload serialized size ${totalBytes} bytes exceeds max ${NEWS_SNAPSHOT_MAX_TOTAL_BYTES} bytes`
    );
  }
}
