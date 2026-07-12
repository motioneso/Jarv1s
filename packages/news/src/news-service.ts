import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type {
  NewsCatalogResponse,
  NewsCustomSourceDto,
  NewsCustomTopicDto,
  NewsHeadline,
  NewsOverviewResponse,
  NewsPrefDto,
  NewsSourceExclusionDto,
  NewsSourceGroup,
  NewsTopicKey
} from "@jarv1s/shared";

import {
  assertSnapshotPayload,
  publisherDomainMatches,
  type NewsSnapshotArticle
} from "./personalization-domain.js";
import type { NewsSnapshotRecord } from "./personalization-repository.js";
import { rankStories, type RankInput } from "./ranking.js";
import { NEWS_CATALOG, NEWS_TOPICS, topicOption, type NewsSourceEntry } from "./source/catalog.js";
import type { RssFeedItem } from "./source/rss-source.js";

/** The subset of `DataContextRunner` the service needs (injectable for tests). */
export interface NewsDataContext {
  withDataContext<T>(
    accessContext: AccessContext,
    work: (scopedDb: DataContextDb) => Promise<T>
  ): Promise<T>;
}

/** The subset of `NewsPrefsRepository` the service reads (injectable for tests). */
export interface NewsPrefsReader {
  list(scopedDb: DataContextDb): Promise<NewsPrefDto[]>;
}

/** The subset of `NewsPersonalizationRepository` the service reads (#953 Slice 1). */
export interface NewsPersonalizationReader {
  listExclusions(scopedDb: DataContextDb): Promise<NewsSourceExclusionDto[]>;
  listCustomSources(scopedDb: DataContextDb): Promise<NewsCustomSourceDto[]>;
  listCustomTopics(scopedDb: DataContextDb): Promise<NewsCustomTopicDto[]>;
  readLatestSnapshot(scopedDb: DataContextDb): Promise<NewsSnapshotRecord | null>;
}

export interface NewsServiceDependencies {
  /**
   * The dataset-connector-SDK runtime client bound to the news module's `newsfeeds` external
   * source (composition root: packages/module-registry/src/index.ts). TTL, staleness policy,
   * and host pinning live in the manifest declaration + `@jarv1s/datasets` runtime, not here.
   */
  readonly datasetClient: DatasetClient;
  readonly dataContext: NewsDataContext;
  readonly repository: NewsPrefsReader;
  readonly personalization: NewsPersonalizationReader;
  readonly now?: () => Date;
}

const TOP_STORIES_CAP = 6; // spec: cross-source ranked selection
const GROUP_HEADLINES_CAP = 12; // per-source rail depth; keeps the payload bounded
const NEWS_ARTICLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const NEWS_SNAPSHOT_FRESH_MS = 30 * 60 * 1_000;

export function isNewsSnapshotFresh(
  snapshot: NewsSnapshotRecord | null,
  now: Date = new Date()
): boolean {
  return Boolean(
    snapshot &&
    snapshot.expiresAt.getTime() > now.getTime() &&
    now.getTime() - snapshot.compiledAt.getTime() <= NEWS_SNAPSHOT_FRESH_MS
  );
}

/** Mutable degraded flag threaded through a single composition pass. */
interface DegradeState {
  degraded: boolean;
}

/** One planned feed fetch: an effective source × (topic feed | its top feed). */
interface FeedPlan {
  readonly source: NewsSourceEntry;
  readonly topicKey: NewsTopicKey | null;
}

/**
 * Composes the news page from the user's prefs + the curated catalog. Every feed fetch is
 * wrapped by the dataset runtime's degrade-empty policy, so a failing publisher yields an
 * empty feed and `degraded: true` rather than a 500.
 */
export class NewsService {
  private readonly datasetClient: DatasetClient;
  private readonly dataContext: NewsDataContext;
  private readonly repository: NewsPrefsReader;
  private readonly personalization: NewsPersonalizationReader;
  private readonly now: () => Date;

  constructor(deps: NewsServiceDependencies) {
    this.datasetClient = deps.datasetClient;
    this.dataContext = deps.dataContext;
    this.repository = deps.repository;
    this.personalization = deps.personalization;
    this.now = deps.now ?? (() => new Date());
  }

  /** Static catalog for the settings pane — no network. */
  getCatalog(): NewsCatalogResponse {
    return {
      sources: NEWS_CATALOG.map((entry) => ({
        sourceKey: entry.sourceKey,
        label: entry.label,
        homepageUrl: entry.homepageUrl,
        defaultEnabled: entry.defaultEnabled,
        topics: Object.keys(entry.topicFeeds) as NewsTopicKey[]
      })),
      topics: NEWS_TOPICS
    };
  }

  async getOverview(
    accessContext: AccessContext,
    onStale?: (scopedDb: DataContextDb) => Promise<void>
  ): Promise<NewsOverviewResponse> {
    return this.dataContext.withDataContext(accessContext, async (db) => {
      const [prefs, exclusions, customSources, customTopics, snapshot] = await Promise.all([
        this.repository.list(db),
        this.personalization.listExclusions(db),
        this.personalization.listCustomSources(db),
        this.personalization.listCustomTopics(db),
        this.personalization.readLatestSnapshot(db)
      ]);
      const now = this.now();
      const personalized = this.composePersonalized(
        snapshot,
        prefs,
        exclusions,
        customSources,
        customTopics,
        now
      );
      if (!isNewsSnapshotFresh(snapshot, now) || personalized === null) {
        await onStale?.(db);
      }
      return personalized ?? this.composeOverview(prefs, exclusions);
    });
  }

  /** Briefing facts: one compact "Title — Source" line per top story, capped at 5. */
  async getTopHeadlinesForToday(scopedDb: DataContextDb): Promise<{ facts: string[] }> {
    const [prefs, exclusions, customSources, customTopics, snapshot] = await Promise.all([
      this.repository.list(scopedDb),
      this.personalization.listExclusions(scopedDb),
      this.personalization.listCustomSources(scopedDb),
      this.personalization.listCustomTopics(scopedDb),
      this.personalization.readLatestSnapshot(scopedDb)
    ]);
    const overview =
      this.composePersonalized(
        snapshot,
        prefs,
        exclusions,
        customSources,
        customTopics,
        this.now()
      ) ?? (await this.composeOverview(prefs, exclusions));
    return {
      facts: overview.topStories.slice(0, 5).map((h) => `${h.title} — ${h.sourceLabel}`)
    };
  }

  private composePersonalized(
    snapshot: NewsSnapshotRecord | null,
    prefs: readonly NewsPrefDto[],
    exclusions: readonly NewsSourceExclusionDto[],
    customSources: readonly NewsCustomSourceDto[],
    customTopics: readonly NewsCustomTopicDto[],
    now: Date
  ): NewsOverviewResponse | null {
    if (!snapshot || snapshot.expiresAt.getTime() <= now.getTime()) return null;
    try {
      assertSnapshotPayload(snapshot.payload);
    } catch {
      return null;
    }

    const excludedDomains = exclusions.map((item) => item.canonicalDomain);
    const cutoff = now.getTime() - NEWS_ARTICLE_MAX_AGE_MS;
    const seen = new Set<string>();
    const articles = snapshot.payload.articles.filter((article) => {
      if (Date.parse(article.publishedAt) < cutoff) return false;
      if (hostnameIsExcluded(article.canonicalDomain, excludedDomains)) return false;
      if (seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    });
    const headlines = articles.map(toPersonalizedHeadline);
    const configuredSources = personalizedSources(prefs, customSources, excludedDomains);
    const configuredByDomain = new Map(configuredSources.map((source) => [source.domain, source]));
    const preferredGroups = new Map<string, NewsSnapshotArticle[]>();
    for (const article of articles) {
      if (!article.preferred) continue;
      const group = preferredGroups.get(article.canonicalDomain) ?? [];
      group.push(article);
      preferredGroups.set(article.canonicalDomain, group);
    }

    return {
      topStories: headlines.slice(0, TOP_STORIES_CAP),
      rankedStories: headlines,
      sourceGroups: [...preferredGroups].map(([domain, group]) => {
        const source = configuredByDomain.get(domain);
        return {
          sourceKey: source?.sourceKey ?? domain,
          sourceLabel: source?.label ?? group[0]!.publisher,
          homepageUrl: source?.homepageUrl ?? `https://${domain}`,
          headlines: group.map(toPersonalizedHeadline).slice(0, GROUP_HEADLINES_CAP)
        };
      }),
      activeTopics: [
        ...resolveEffectivePrefs(prefs).topics,
        ...customTopics
          .filter((topic) => topic.validationStatus === "approved")
          .map((topic) => topic.label)
      ],
      enabledSources: configuredSources.map(({ sourceKey, label }) => ({ sourceKey, label })),
      degraded: false
    };
  }

  private async composeOverview(
    prefs: readonly NewsPrefDto[],
    exclusions: readonly NewsSourceExclusionDto[]
  ): Promise<NewsOverviewResponse> {
    const excludedDomains = exclusions.map((e) => e.canonicalDomain);
    // #953: domain exclusions apply at two layers so an excluded publisher never appears
    // through ANY curated feed — (1) drop whole curated sources whose homepage lives on an
    // excluded domain before feed planning, (2) drop individual composed headlines whose
    // article URL hostname matches (syndicated copies in another source's feed).
    const { sources: effectiveSources, topics } = resolveEffectivePrefs(prefs);
    const sources = effectiveSources.filter(
      (entry) => !hostnameIsExcluded(urlHostname(entry.homepageUrl), excludedDomains)
    );
    const state: DegradeState = { degraded: false };

    // Fetch every planned feed in parallel; each one degrades independently to [].
    const groups = await Promise.all(
      sources.map(async (source) => {
        const plans: FeedPlan[] =
          topics.length > 0
            ? topics
                .filter((topicKey) => source.topicFeeds[topicKey] !== undefined)
                .map((topicKey) => ({ source, topicKey }))
            : [{ source, topicKey: null }];
        const feeds = await Promise.all(
          plans.map(async (plan) => ({
            plan,
            items: await this.feedFor(plan, state)
          }))
        );
        // Dedupe by URL hash WITHIN the source (a story often sits in `top` + a topic feed;
        // no cross-source dedupe in V1 — differing coverage of one event is a feature here).
        const seen = new Set<string>();
        const inputs: RankInput<NewsHeadline>[] = [];
        for (const { plan, items } of feeds) {
          items.forEach((item, feedPosition) => {
            // Layer (2): a syndicated copy hosted on an excluded domain is dropped even
            // when it arrives via a non-excluded curated feed.
            if (hostnameIsExcluded(urlHostname(item.url), excludedDomains)) return;
            if (seen.has(item.id)) return;
            seen.add(item.id);
            inputs.push({
              feedPosition,
              item: {
                ...item,
                sourceKey: source.sourceKey,
                sourceLabel: source.label,
                topicKey: plan.topicKey,
                topicLabel: plan.topicKey ? (topicOption(plan.topicKey)?.label ?? null) : null
              }
            });
          });
        }
        return { source, inputs };
      })
    );

    const allInputs = groups.flatMap((group) => group.inputs);
    const sourceGroups: NewsSourceGroup[] = groups
      .map((group) => ({
        sourceKey: group.source.sourceKey,
        sourceLabel: group.source.label,
        homepageUrl: group.source.homepageUrl,
        headlines: rankStories(group.inputs).slice(0, GROUP_HEADLINES_CAP)
      }))
      .filter((group) => group.headlines.length > 0);

    return {
      topStories: rankStories(allInputs).slice(0, TOP_STORIES_CAP),
      sourceGroups,
      activeTopics: topics,
      enabledSources: sources.map((s) => ({ sourceKey: s.sourceKey, label: s.label })),
      degraded: state.degraded
    };
  }

  private async feedFor(plan: FeedPlan, state: DegradeState): Promise<readonly RssFeedItem[]> {
    const result = await this.datasetClient.getDataset<RssFeedItem[]>(
      "feed",
      { sourceKey: plan.source.sourceKey, topicKey: plan.topicKey },
      { fallback: [] }
    );
    if (result.degraded) state.degraded = true;
    return result.data;
  }
}

function toPersonalizedHeadline(article: NewsSnapshotArticle): NewsHeadline {
  const topicLabels = article.topics.slice(0, 3);
  return {
    id: article.id,
    sourceKey: article.canonicalDomain,
    sourceLabel: article.publisher,
    topicKey: null,
    topicLabel: topicLabels[0] ?? null,
    topicLabels,
    title: article.headline,
    url: article.url,
    publishedAt: article.publishedAt,
    imageUrl: article.imageUrl ? `/api/news/images/${encodeURIComponent(article.id)}` : null,
    summary: article.excerpt ?? ""
  };
}

interface PersonalizedSource {
  readonly sourceKey: string;
  readonly label: string;
  readonly homepageUrl: string;
  readonly domain: string;
}

function personalizedSources(
  prefs: readonly NewsPrefDto[],
  customSources: readonly NewsCustomSourceDto[],
  excludedDomains: readonly string[]
): PersonalizedSource[] {
  const curated = resolveEffectivePrefs(prefs)
    .sources.map((source) => ({
      sourceKey: source.sourceKey,
      label: source.label,
      homepageUrl: source.homepageUrl,
      domain: urlHostname(source.homepageUrl)
    }))
    .filter(
      (source): source is PersonalizedSource =>
        source.domain !== null && !hostnameIsExcluded(source.domain, excludedDomains)
    );
  const custom = customSources
    .filter(
      (source) =>
        source.validationStatus === "approved" &&
        source.healthStatus === "available" &&
        !hostnameIsExcluded(source.canonicalDomain, excludedDomains)
    )
    .map((source) => ({
      sourceKey: source.id,
      label: source.label,
      homepageUrl: source.homepageUrl,
      domain: source.canonicalDomain
    }));
  return [...curated, ...custom];
}

/**
 * Hostname of a feed/homepage URL for exclusion matching, or null when unparseable.
 * WHATWG URL lowercases and punycodes the hostname, matching normalizePublisherDomain's
 * canonical form; the trailing-dot strip mirrors it for FQDN-notation links.
 */
function urlHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  } catch {
    return null;
  }
}

/**
 * FAIL CLOSED (PR #955 Codex finding): a malformed or missing URL yields a null hostname,
 * which cannot be proven NOT-excluded, so it is treated as excluded and dropped — never
 * allowed to fall through the exclusion filter. Slice 1 only string-compares these
 * hostnames (no fetch/connect consumes them); resolved-IP re-validation of DNS names is a
 * binding Slice 2 requirement enforced at its fetch boundary, not here.
 */
function hostnameIsExcluded(hostname: string | null, excludedDomains: readonly string[]): boolean {
  if (hostname === null) return true;
  return excludedDomains.some((excluded) => publisherDomainMatches(excluded, hostname));
}

/**
 * Preference semantics (spec "Preference semantics"): effective sources =
 * (`source` includes if any, else catalog defaults) minus `source_exclude`;
 * effective topics = `topic` rows ([] = "top" front-page mode). Keys that no longer
 * exist in the catalog are ignored, so a removed source can't wedge a user's page.
 */
export function resolveEffectivePrefs(prefs: readonly NewsPrefDto[]): {
  sources: NewsSourceEntry[];
  topics: NewsTopicKey[];
} {
  const includes = new Set(prefs.filter((p) => p.kind === "source").map((p) => p.key));
  const excludes = new Set(prefs.filter((p) => p.kind === "source_exclude").map((p) => p.key));
  const base =
    includes.size > 0
      ? NEWS_CATALOG.filter((entry) => includes.has(entry.sourceKey))
      : NEWS_CATALOG.filter((entry) => entry.defaultEnabled);
  const sources = base.filter((entry) => !excludes.has(entry.sourceKey));
  const topics = prefs
    .filter((p) => p.kind === "topic")
    .map((p) => topicOption(p.key)?.topicKey)
    .filter((key): key is NewsTopicKey => key !== undefined);
  return { sources, topics };
}
