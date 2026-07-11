import { randomUUID } from "node:crypto";
import { Parser } from "htmlparser2";

import type { DataContextDb } from "@jarv1s/db";

import {
  normalizePublisherDomain,
  publisherDomainMatches
} from "../personalization-domain.js";
import type { NewsPersonalizationRepository } from "../personalization-repository.js";
import { TITLE_CHAR_CAP, sanitizeFeedText } from "../source/sanitize.js";
import {
  discoverFeedUrls,
  extractListingHeadlines,
  sampleFeedHeadlines
} from "./feed-discovery.js";
import { decideSourcePolicy } from "./policy-validation.js";
import type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./ports.js";
import type { VerifiedSourceCandidate } from "./preview-store.js";

export type SourceResolutionResult =
  | { status: "ok"; candidates: [VerifiedSourceCandidate] }
  | { status: "ambiguous"; candidates: VerifiedSourceCandidate[] }
  | { status: "rejected"; reason: "policy" | "invalid_input" | "unreachable" | "not_https" }
  | { status: "unavailable" };

type ResolutionRepo = Pick<
  NewsPersonalizationRepository,
  "listExclusions" | "readPolicyVerdict" | "upsertPolicyVerdict"
>;

function htmlMetadata(html: string): {
  title: string;
  description: string;
  canonicalUrl: string | null;
} {
  let title = "";
  let inTitle = false;
  let description = "";
  let canonicalUrl: string | null = null;
  const parser = new Parser({
    onopentag(name, attributes) {
      const tag = name.toLowerCase();
      if (tag === "title") inTitle = true;
      if (tag === "link" && (attributes.rel ?? "").toLowerCase() === "canonical") {
        canonicalUrl = attributes.href ?? null;
      }
      if (tag === "meta") {
        const key = (attributes.property ?? attributes.name ?? "").toLowerCase();
        if (key === "og:url") canonicalUrl = attributes.content ?? canonicalUrl;
        if (key === "description" || key === "og:description") {
          description = attributes.content ?? description;
        }
      }
    },
    ontext(text) {
      if (inTitle) title += text;
    },
    onclosetag(name) {
      if (name.toLowerCase() === "title") inTitle = false;
    }
  });
  parser.end(html);
  return {
    title: sanitizeFeedText(title, TITLE_CHAR_CAP),
    description: sanitizeFeedText(description, 300),
    canonicalUrl
  };
}

function isFeed(contentType: string | null, body: string): boolean {
  return /(?:rss|atom|xml)/i.test(contentType ?? "") || /^\s*<(?:\?xml|rss|feed)\b/i.test(body);
}

export async function resolveSourceInput(
  scopedDb: DataContextDb,
  deps: {
    fetch: NewsSafeFetchPort;
    search: NewsWebSearchPort;
    ai: NewsAiPort;
    repo: ResolutionRepo;
  },
  input: { raw: string; hasWebSearch: boolean }
): Promise<SourceResolutionResult> {
  const raw = input.raw.trim();
  const exclusions = (await deps.repo.listExclusions(scopedDb)).map(
    (item) => item.canonicalDomain
  );
  const normalized = normalizePublisherDomain(raw);
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(raw) || (!raw.includes(" ") && raw.includes("."));
  if (looksLikeUrl) {
    if (!normalized.ok) {
      return {
        status: "rejected",
        reason: normalized.reason === "non_https_scheme" ? "not_https" : "invalid_input"
      };
    }
    if (exclusions.some((domain) => publisherDomainMatches(normalized.domain, domain))) {
      return { status: "rejected", reason: "policy" };
    }
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const resolved = await verifyPublisher(scopedDb, deps, url, exclusions);
    if (resolved.status !== "candidate") return resolved.result;
    return { status: "ok", candidates: [resolved.candidate] };
  }

  if (!input.hasWebSearch) return { status: "unavailable" };
  const search = await deps.search.search(
    scopedDb,
    `"${sanitizeFeedText(raw, 80)}" news publisher official site`,
    { limit: 5 }
  );
  const candidates: VerifiedSourceCandidate[] = [];
  const seen = new Set<string>();
  let providerUnavailable = false;
  for (const result of search.results) {
    if (candidates.length >= 3) break;
    const domain = normalizePublisherDomain(result.url);
    if (!domain.ok || seen.has(domain.domain)) continue;
    seen.add(domain.domain);
    const resolved = await verifyPublisher(scopedDb, deps, result.url, exclusions);
    if (resolved.status === "candidate") candidates.push(resolved.candidate);
    else if (resolved.result.status === "unavailable") providerUnavailable = true;
  }
  if (candidates.length === 1) return { status: "ok", candidates: [candidates[0]!] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return providerUnavailable
    ? { status: "unavailable" }
    : { status: "rejected", reason: "unreachable" };
}

async function verifyPublisher(
  scopedDb: DataContextDb,
  deps: {
    fetch: NewsSafeFetchPort;
    ai: NewsAiPort;
    repo: ResolutionRepo;
  },
  rawUrl: string,
  exclusions: readonly string[]
): Promise<
  | { status: "candidate"; candidate: VerifiedSourceCandidate }
  | { status: "failed"; result: SourceResolutionResult }
> {
  const fetched = await deps.fetch(new URL(rawUrl).toString());
  if (!fetched.ok) {
    return { status: "failed", result: { status: "rejected", reason: "unreachable" } };
  }
  const fetchedUrl = new URL(fetched.finalUrl);
  let homepageUrl = new URL("/", fetchedUrl).toString();
  let homepageBody = fetched.body;
  let feedUrl: string | null = null;
  let headlines: { headline: string; url: string; publishedAt?: string | null }[] = [];

  if (isFeed(fetched.contentType, fetched.body)) {
    feedUrl = fetchedUrl.toString();
    headlines = sampleFeedHeadlines(fetched.body, 10);
  } else {
    const initialMetadata = htmlMetadata(fetched.body);
    if (initialMetadata.canonicalUrl) {
      try {
        homepageUrl = new URL("/", new URL(initialMetadata.canonicalUrl, fetchedUrl)).toString();
      } catch {
        return { status: "failed", result: { status: "rejected", reason: "invalid_input" } };
      }
    }
    const canonical = normalizePublisherDomain(homepageUrl);
    if (
      !canonical.ok ||
      exclusions.some((domain) => publisherDomainMatches(canonical.domain, domain))
    ) {
      return { status: "failed", result: { status: "rejected", reason: "policy" } };
    }
    if (fetchedUrl.toString() !== homepageUrl) {
      const homepage = await deps.fetch(homepageUrl);
      if (!homepage.ok) {
        return { status: "failed", result: { status: "rejected", reason: "unreachable" } };
      }
      homepageBody = homepage.body;
    }
    for (const discovered of discoverFeedUrls(homepageBody, homepageUrl)) {
      const feedResponse = await deps.fetch(discovered);
      if (!feedResponse.ok) continue;
      const samples = sampleFeedHeadlines(feedResponse.body, 10);
      if (samples.length > 0) {
        feedUrl = discovered;
        headlines = samples;
        break;
      }
    }
    if (!feedUrl) headlines = extractListingHeadlines(homepageBody, homepageUrl, 10);
  }
  if (headlines.length === 0) {
    return { status: "failed", result: { status: "rejected", reason: "unreachable" } };
  }
  const domain = normalizePublisherDomain(homepageUrl);
  if (!domain.ok) {
    return { status: "failed", result: { status: "rejected", reason: "invalid_input" } };
  }
  const metadata = htmlMetadata(homepageBody);
  const policy = await decideSourcePolicy(scopedDb, { ai: deps.ai, repo: deps.repo }, {
    canonicalDomain: domain.domain,
    description: metadata.description,
    sampleHeadlines: headlines.map((item) => item.headline)
  });
  if (policy.verdict === "unavailable") {
    return { status: "failed", result: { status: "unavailable" } };
  }
  if (policy.verdict === "rejected") {
    return { status: "failed", result: { status: "rejected", reason: "policy" } };
  }
  return {
    status: "candidate",
    candidate: {
      candidateId: randomUUID(),
      label: metadata.title || domain.domain,
      canonicalDomain: domain.domain,
      homepageUrl,
      feedUrl,
      retrievalMethod: feedUrl ? "feed" : "scrape",
      sampleCount: headlines.length,
      validationFingerprint: policy.fingerprint
    }
  };
}
