import { Parser } from "htmlparser2";

import { parseFeedXml } from "../source/rss-source.js";
import {
  TITLE_CHAR_CAP,
  sanitizeFeedText,
  sanitizeItemUrl,
  sanitizePublishedAt
} from "../source/sanitize.js";

const COMMON_COUNTRY_SECOND_LEVELS = new Set(["ac", "co", "com", "gov", "net", "org"]);

function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  // ponytail: compact public-suffix heuristic; use a PSL library if exotic ccTLD feeds matter.
  const count =
    labels.length >= 3 &&
    labels.at(-1)?.length === 2 &&
    COMMON_COUNTRY_SECOND_LEVELS.has(labels.at(-2) ?? "")
      ? 3
      : 2;
  return labels.slice(-count).join(".");
}

function isSamePublisher(left: URL, right: URL): boolean {
  return registrableDomain(left.hostname) === registrableDomain(right.hostname);
}

function resolvePublisherHttps(raw: string, base: URL): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" && isSamePublisher(url, base) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function discoverFeedUrls(homepageHtml: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const urls: string[] = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name.toLowerCase() !== "link" || urls.length >= 3) return;
      const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
      const type = (attributes.type ?? "").toLowerCase();
      if (!rel.includes("alternate") || !/^application\/(rss|atom)\+xml$/.test(type)) return;
      const resolved = resolvePublisherHttps(attributes.href ?? "", base);
      if (resolved && !urls.includes(resolved)) urls.push(resolved);
    }
  });
  parser.end(homepageHtml);
  return urls;
}

export function extractListingHeadlines(
  html: string,
  baseUrl: string,
  cap: number
): { headline: string; url: string }[] {
  const base = new URL(baseUrl);
  const results: { headline: string; url: string }[] = [];
  let anchor: { href: string; text: string } | null = null;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name.toLowerCase() === "a" && results.length < cap) {
        anchor = { href: attributes.href ?? "", text: "" };
      }
    },
    ontext(text) {
      if (anchor) anchor.text += text;
    },
    onclosetag(name) {
      if (name.toLowerCase() !== "a" || !anchor) return;
      const headline = sanitizeFeedText(anchor.text, TITLE_CHAR_CAP);
      const url = resolvePublisherHttps(anchor.href, base);
      if (headline.length >= 20 && url && !results.some((item) => item.url === url)) {
        results.push({ headline, url });
      }
      anchor = null;
    }
  });
  parser.end(html);
  return results.slice(0, cap);
}

export function sampleFeedHeadlines(
  feedXml: string,
  cap: number
): { headline: string; url: string; publishedAt: string | null }[] {
  const results: { headline: string; url: string; publishedAt: string | null }[] = [];
  for (const item of parseFeedXml(feedXml)) {
    if (results.length >= cap) break;
    const headline = sanitizeFeedText(item.title, TITLE_CHAR_CAP);
    const url = sanitizeItemUrl(item.link);
    if (!headline || !url || !url.startsWith("https://")) continue;
    results.push({ headline, url, publishedAt: sanitizePublishedAt(item.publishedAt) });
  }
  return results;
}
