import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type {
  NewsCatalogResponse,
  NewsHeadline,
  NewsOverviewResponse,
  NewsPrefDto,
  NewsSourceGroup,
  NewsTopicKey
} from "@jarv1s/shared";

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

export interface NewsServiceDependencies {
  /**
   * The dataset-connector-SDK runtime client bound to the news module's `newsfeeds` external
   * source (composition root: packages/module-registry/src/index.ts). TTL, staleness policy,
   * and host pinning live in the manifest declaration + `@jarv1s/datasets` runtime, not here.
   */
  readonly datasetClient: DatasetClient;
  readonly dataContext: NewsDataContext;
  readonly repository: NewsPrefsReader;
}

const TOP_STORIES_CAP = 6; // spec: cross-source ranked selection
const GROUP_HEADLINES_CAP = 12; // per-source rail depth; keeps the payload bounded

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

  constructor(deps: NewsServiceDependencies) {
    this.datasetClient = deps.datasetClient;
    this.dataContext = deps.dataContext;
    this.repository = deps.repository;
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

  async getOverview(accessContext: AccessContext): Promise<NewsOverviewResponse> {
    const prefs = await this.dataContext.withDataContext(accessContext, (db) =>
      this.repository.list(db)
    );
    return this.composeOverview(prefs);
  }

  /** Briefing facts: one compact "Title — Source" line per top story, capped at 5. */
  async getTopHeadlinesForToday(scopedDb: DataContextDb): Promise<{ facts: string[] }> {
    const prefs = await this.repository.list(scopedDb);
    const overview = await this.composeOverview(prefs);
    return {
      facts: overview.topStories.slice(0, 5).map((h) => `${h.title} — ${h.sourceLabel}`)
    };
  }

  private async composeOverview(prefs: readonly NewsPrefDto[]): Promise<NewsOverviewResponse> {
    const { sources, topics } = resolveEffectivePrefs(prefs);
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
