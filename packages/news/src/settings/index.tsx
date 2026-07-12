import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Note, PaneHead } from "@jarv1s/settings-ui";
import { ApiError } from "@jarv1s/module-web-sdk";
import type {
  NewsCatalogSource,
  NewsPersonalizationAvailabilityDto,
  NewsPrefDto,
  NewsPrefKind,
  NewsTopicKey,
  NewsTopicOption
} from "@jarv1s/shared";

import {
  normalizePublisherDomain,
  publisherDomainMatches,
  type PublisherDomainRejection
} from "../personalization-domain.js";
import {
  createNewsPref,
  createNewsSourceExclusion,
  createNewsTopic,
  deleteNewsCustomSource,
  deleteNewsPref,
  deleteNewsSourceExclusion,
  deleteNewsTopic,
  getNewsCatalog,
  getNewsPersonalization,
  listNewsPrefs,
  triggerNewsRevalidation
} from "../web/news-client.js";
import { newsQueryKeys } from "../web/query-keys.js";
import { AddSourceFlow } from "./add-source.js";
import "./news-settings.css";

/* ----- Pure toggle planners (unit-tested). These must mirror the server's
   resolveEffectivePrefs semantics exactly: base = explicit `source` includes when any exist,
   otherwise the catalog defaults; `source_exclude` always subtracts from the base. ----- */

export type PrefOp =
  | { readonly op: "create"; readonly kind: NewsPrefKind; readonly key: string }
  | { readonly op: "delete"; readonly id: string };

/**
 * The planners only read identity + default membership, so they take a structural pick rather
 * than the full API DTO — lets unit tests feed the server-side catalog entries directly (#897).
 */
export type PlannerSource = Pick<NewsCatalogSource, "sourceKey" | "defaultEnabled">;

/** Is this source effective under the current pref rows? (client mirror of the server rule) */
export function sourceEnabled(source: PlannerSource, prefs: readonly NewsPrefDto[]): boolean {
  const includes = prefs.filter((pref) => pref.kind === "source");
  const excluded = prefs.some(
    (pref) => pref.kind === "source_exclude" && pref.key === source.sourceKey
  );
  const inBase =
    includes.length > 0
      ? includes.some((pref) => pref.key === source.sourceKey)
      : source.defaultEnabled;
  return inBase && !excluded;
}

/**
 * Ordered pref mutations that flip one source on/off without disturbing the rest of the
 * user's effective set. The traps this encodes:
 *
 * - Turning ON a non-default source while the user has NO explicit includes: creating that
 *   first `source` row silently flips the base from "catalog defaults" to "includes only",
 *   which would drop every default source. So we FIRST pin the current effective set as
 *   explicit includes, THEN add the toggled source.
 * - Turning OFF the user's only include: deleting that row would flip the base back to
 *   catalog defaults, re-enabling sources the user never asked for. So we exclude instead
 *   of deleting (exclude always wins), leaving the pinned base intact.
 */
export function planSourceToggle(
  sourceKey: string,
  sources: readonly PlannerSource[],
  prefs: readonly NewsPrefDto[]
): readonly PrefOp[] {
  const source = sources.find((entry) => entry.sourceKey === sourceKey);
  if (!source) return [];
  const includes = prefs.filter((pref) => pref.kind === "source");
  const includeRow = includes.find((pref) => pref.key === sourceKey);
  const excludeRow = prefs.find((pref) => pref.kind === "source_exclude" && pref.key === sourceKey);
  const excludedKeys = new Set(
    prefs.filter((pref) => pref.kind === "source_exclude").map((pref) => pref.key)
  );

  if (sourceEnabled(source, prefs)) {
    // OFF. Deleting the include is the tidy path, but only when other includes keep the
    // base pinned; otherwise exclude (see doc comment above).
    if (includeRow && includes.length > 1) return [{ op: "delete", id: includeRow.id }];
    return [{ op: "create", kind: "source_exclude", key: sourceKey }];
  }

  // ON: lift any exclusion, then make sure the base actually contains the source.
  const ops: PrefOp[] = [];
  if (excludeRow) ops.push({ op: "delete", id: excludeRow.id });
  const inBase = includes.length > 0 ? includeRow !== undefined : source.defaultEnabled;
  if (!inBase) {
    if (includes.length === 0) {
      // Pin today's effective defaults before the first include flips base semantics.
      for (const other of sources) {
        if (other.sourceKey === sourceKey) continue;
        if (other.defaultEnabled && !excludedKeys.has(other.sourceKey)) {
          ops.push({ op: "create", kind: "source", key: other.sourceKey });
        }
      }
    }
    ops.push({ op: "create", kind: "source", key: sourceKey });
  }
  return ops;
}

/**
 * #953 Task 5: domain exclusions override the curated On/Off vocabulary. A curated tile whose
 * publisher homepage falls under an excluded domain renders "excluded" (not contributing)
 * regardless of the V1 pref rows — the server suppresses that source before fetch (two-layer
 * filtering in NewsService), so showing "On" would be a lie.
 */
export type CuratedTileState = "on" | "off" | "excluded";

export function curatedTileState(
  source: Pick<NewsCatalogSource, "sourceKey" | "defaultEnabled" | "homepageUrl">,
  prefs: readonly NewsPrefDto[],
  excludedDomains: readonly string[]
): CuratedTileState {
  const normalized = normalizePublisherDomain(source.homepageUrl);
  if (
    normalized.ok &&
    excludedDomains.some((domain) => publisherDomainMatches(domain, normalized.domain))
  ) {
    return "excluded";
  }
  return sourceEnabled(source, prefs) ? "on" : "off";
}

/**
 * UI copy per rejection key from `normalizePublisherDomain`. The Record is exhaustive by
 * type — adding a rejection key without copy is a compile error. Keys are stable machine
 * identifiers (the POST route 400s carry the same keys, never the raw input), so this map is
 * the single place raw reasons become human sentences.
 */
const EXCLUSION_REJECTION_COPY: Record<PublisherDomainRejection, string> = {
  empty: "Enter a publisher domain or HTTPS link.",
  input_too_long: "That input is too long to be a web address.",
  unparseable: "That doesn't look like a web address.",
  non_https_scheme: "Only HTTPS links or bare domains are accepted.",
  credentials: "Web addresses with embedded credentials aren't accepted.",
  explicit_port: "Web addresses with an explicit port aren't accepted.",
  ip_literal: "IP addresses aren't accepted — use the publisher's domain name.",
  single_label: "Enter a full domain, like example.com.",
  hostname_too_long: "That domain name is too long.",
  invalid_label: "That domain name contains characters that aren't allowed."
};

export function exclusionRejectionMessage(reason: PublisherDomainRejection): string {
  return EXCLUSION_REJECTION_COPY[reason];
}

/** Topic chips are simple membership rows: one `topic` pref per followed topic. */
export function planTopicToggle(
  topicKey: NewsTopicKey,
  prefs: readonly NewsPrefDto[]
): readonly PrefOp[] {
  const row = prefs.find((pref) => pref.kind === "topic" && pref.key === topicKey);
  if (row) return [{ op: "delete", id: row.id }];
  return [{ op: "create", kind: "topic", key: topicKey }];
}

async function runOps(ops: readonly PrefOp[]): Promise<void> {
  // Sequential on purpose: the planner's op order is load-bearing (pin includes before
  // adding the first one), and the server's create is idempotent so retries are safe.
  for (const op of ops) {
    if (op.op === "create") await createNewsPref({ kind: op.kind, key: op.key });
    else await deleteNewsPref(op.id);
  }
}

/**
 * #975 Task 9 flipped the writes live, so the Slice-1 "coming soon" branch is gone: this gate
 * now renders ONLY when a prerequisite is missing, pointing at Assistant settings. Sections
 * with satisfied prerequisites render the real add forms instead.
 */
function PrereqGate(props: { readonly requirement: string }) {
  return (
    <span className="nw-set__gate">
      {props.requirement}{" "}
      <a className="nw-set__gatelink" href="/settings?section=assistant">
        Set it up in Assistant settings
      </a>
      .
    </span>
  );
}

/**
 * Human copy for a failed topic create. 422/503 are the route's deliberate policy/availability
 * signals (fixed copy, never model output); other ApiErrors carry friendly server messages
 * (limit/duplicate) that are safe to surface verbatim.
 */
export function topicCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "That topic isn't allowed by the content policy.";
    if (error.status === 503) {
      return "Topic checking is unavailable right now — try again shortly.";
    }
    if (error.message) return error.message;
  }
  return "Could not add that topic. Try again.";
}

export default function NewsSettings() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: newsQueryKeys.catalog, queryFn: getNewsCatalog });
  const prefsQuery = useQuery({ queryKey: newsQueryKeys.prefs, queryFn: listNewsPrefs });
  const personalizationQuery = useQuery({
    queryKey: newsQueryKeys.personalization,
    queryFn: getNewsPersonalization
  });

  const [exclusionInput, setExclusionInput] = useState("");
  const [exclusionValidation, setExclusionValidation] = useState<string | null>(null);

  const opsMutation = useMutation({
    mutationFn: runOps,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.prefs });
      // The front page recomposes from prefs server-side, so its cache is stale too.
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.overview });
    }
  });

  // Personalization writes (exclusions, custom sources/topics) reshape both the pane AND the
  // composed front page (server drops/adds publishers pre-fetch), so both caches must refetch.
  const invalidateAfterPersonalizationChange = () => {
    void queryClient.invalidateQueries({ queryKey: newsQueryKeys.personalization });
    void queryClient.invalidateQueries({ queryKey: newsQueryKeys.overview });
  };
  const addExclusionMutation = useMutation({
    mutationFn: createNewsSourceExclusion,
    onSuccess: () => {
      setExclusionInput("");
      invalidateAfterPersonalizationChange();
    }
  });
  const removeExclusionMutation = useMutation({
    mutationFn: deleteNewsSourceExclusion,
    onSuccess: invalidateAfterPersonalizationChange
  });

  // --- #975 Task 9: custom source/topic removal, topic creation, revalidation retry ---
  const [topicLabel, setTopicLabel] = useState("");
  const [topicGuidance, setTopicGuidance] = useState("");

  const removeSourceMutation = useMutation({
    mutationFn: deleteNewsCustomSource,
    onSuccess: invalidateAfterPersonalizationChange
  });
  const removeTopicMutation = useMutation({
    mutationFn: deleteNewsTopic,
    onSuccess: invalidateAfterPersonalizationChange
  });
  const addTopicMutation = useMutation({
    mutationFn: createNewsTopic,
    onSuccess: () => {
      setTopicLabel("");
      setTopicGuidance("");
      invalidateAfterPersonalizationChange();
    }
  });
  // Owner-wide re-check; no cache invalidation on success — the job runs async and statuses
  // only change after the worker finishes, so an immediate refetch would show nothing new.
  const revalidateMutation = useMutation({ mutationFn: triggerNewsRevalidation });

  const sources = catalogQuery.data?.sources ?? [];
  const topics = catalogQuery.data?.topics ?? [];
  const prefs = prefsQuery.data?.prefs ?? [];
  const personalization = personalizationQuery.data ?? null;
  const availability: NewsPersonalizationAvailabilityDto | null =
    personalization?.availability ?? null;
  const customSources = personalization?.customSources ?? [];
  const customTopics = personalization?.customTopics ?? [];
  const exclusions = personalization?.sourceExclusions ?? [];
  const excludedDomains = exclusions.map((exclusion) => exclusion.canonicalDomain);
  const followedTopics = new Set(
    prefs.filter((pref) => pref.kind === "topic").map((pref) => pref.key)
  );
  const pending = catalogQuery.isLoading || prefsQuery.isLoading || opsMutation.isPending;
  const error = catalogQuery.isError || prefsQuery.isError || opsMutation.isError;

  const tileStates = new Map(
    sources.map((source) => [source.sourceKey, curatedTileState(source, prefs, excludedDomains)])
  );
  const enabledCount = sources.filter((source) => tileStates.get(source.sourceKey) === "on").length;
  const anyTileExcluded = sources.some((source) => tileStates.get(source.sourceKey) === "excluded");

  function submitExclusion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side pre-validation for instant feedback only — the route re-normalizes and is
    // the actual gate (its 400s carry reason keys, never the raw input).
    const normalized = normalizePublisherDomain(exclusionInput);
    if (!normalized.ok) {
      setExclusionValidation(exclusionRejectionMessage(normalized.reason));
      return;
    }
    setExclusionValidation(null);
    addExclusionMutation.mutate({ source: exclusionInput.trim() });
  }

  const exclusionError =
    exclusionValidation ??
    (addExclusionMutation.isError
      ? (addExclusionMutation.error?.message ?? "Could not exclude that publisher.")
      : null);

  const sourcesNeedAttention = customSources.some(
    (source) => source.validationStatus !== "approved" || source.healthStatus === "unavailable"
  );
  const topicsNeedAttention = customTopics.some((topic) => topic.validationStatus !== "approved");

  function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = topicLabel.trim();
    if (!label) return;
    const guidance = topicGuidance.trim();
    // Omit empty guidance entirely — the route treats absent and blank differently (cleanTopic
    // rejects an empty string but tolerates a missing field).
    addTopicMutation.mutate(guidance ? { label, guidance } : { label });
  }

  // One owner-wide revalidation job covers sources AND topics, but the button renders inside
  // whichever section is actually showing amber/red badges so the action sits next to the
  // problem it fixes. Both sections may show it; either click queues the same job.
  const retryRow = () => (
    <div className="nw-set__addrow">
      <button
        type="button"
        className="jds-btn jds-btn--sm jds-btn--secondary"
        disabled={revalidateMutation.isPending}
        onClick={() => revalidateMutation.mutate()}
      >
        {revalidateMutation.isPending ? "Queuing…" : "Retry validation"}
      </button>
      {revalidateMutation.isSuccess ? (
        <span className="nw-set__gate">
          Revalidation queued — statuses update after the next check.
        </span>
      ) : null}
      {revalidateMutation.isError ? (
        <span className="nw-set__exerr">Could not queue revalidation. Try again.</span>
      ) : null}
    </div>
  );

  return (
    <>
      <PaneHead
        title="News"
        desc="Pick the publications your front page draws from, and optionally narrow it to the topics you follow. These choices also shape news in briefings."
      />

      <section className="nw-set" aria-label="News sources">
        <p className="nw-set__kicker">Sources</p>
        <div className="nw-set__grid">
          {sources.map((source) => {
            const state = tileStates.get(source.sourceKey) ?? "off";
            // An excluded tile is inert: its V1 toggle would silently do nothing (the server
            // suppresses the domain pre-fetch), so it renders disabled + "Excluded" instead
            // of a fake On/Off.
            const excluded = state === "excluded";
            const active = state === "on";
            return (
              <button
                key={source.sourceKey}
                type="button"
                className={`nw-setsrc${active ? " is-active" : ""}${excluded ? " is-excluded" : ""}`}
                disabled={pending || excluded}
                aria-pressed={active}
                onClick={() =>
                  opsMutation.mutate(planSourceToggle(source.sourceKey, sources, prefs))
                }
              >
                <span className="nw-setsrc__name">{source.label}</span>
                <span className="nw-setsrc__state">
                  {excluded ? "Excluded" : active ? "On" : "Off"}
                </span>
              </button>
            );
          })}
        </div>
        {anyTileExcluded ? (
          <Note>
            Excluded publishers override these toggles — manage them under Excluded publishers
            below.
          </Note>
        ) : null}
        {!pending && enabledCount === 0 ? (
          <Note>No sources enabled — your News page will be empty until you turn one on.</Note>
        ) : null}
      </section>

      <section className="nw-set" aria-label="News topics">
        <p className="nw-set__kicker">Topics</p>
        <p className="nw-set__hint">
          Follow topics to narrow every source to those desks. With none followed you get each
          source&rsquo;s general front page.
        </p>
        <div className="nw-set__chips">
          {topics.map((topic: NewsTopicOption) => {
            const active = followedTopics.has(topic.topicKey);
            return (
              <button
                key={topic.topicKey}
                type="button"
                className={`nw-settopic${active ? " is-active" : ""}`}
                disabled={pending}
                aria-pressed={active}
                onClick={() => opsMutation.mutate(planTopicToggle(topic.topicKey, prefs))}
              >
                {topic.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="nw-set" aria-label="Personalized sources">
        <p className="nw-set__kicker">Personalized sources</p>
        <p className="nw-set__hint">
          Publications you add yourself, verified before they join your feed. Verified sources
          contribute recent headlines to News and briefings.
        </p>
        {availability ? (
          <p className="nw-set__prereq">
            <Badge tone={availability.aiConfigured ? "pine" : "amber"} dot>
              AI model {availability.aiConfigured ? "ready" : "needed"}
            </Badge>
            <Badge tone={availability.webSearchConfigured ? "pine" : "amber"} dot>
              Web search {availability.webSearchConfigured ? "ready" : "needed"}
            </Badge>
          </p>
        ) : null}
        {customSources.length > 0 ? (
          <ul className="nw-set__list">
            {customSources.map((source) => {
              const removing =
                removeSourceMutation.isPending && removeSourceMutation.variables === source.id;
              return (
                <li key={source.id} className="nw-set__item">
                  <span className="nw-set__item-label">{source.label}</span>
                  <span className="nw-set__item-meta">{source.canonicalDomain}</span>
                  {source.validationStatus !== "approved" ? (
                    <Badge tone="amber">Needs revalidation</Badge>
                  ) : source.healthStatus === "unavailable" ? (
                    <Badge tone="red">Unavailable</Badge>
                  ) : null}
                  <button
                    type="button"
                    className="jds-btn jds-btn--sm jds-btn--secondary"
                    aria-label={`Remove ${source.label}`}
                    disabled={removing}
                    onClick={() => removeSourceMutation.mutate(source.id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {removeSourceMutation.isError ? (
          <Note>Could not remove that source. Try again.</Note>
        ) : null}
        {sourcesNeedAttention ? retryRow() : null}
        {availability?.customSourceByUrlEnabled ? (
          <AddSourceFlow />
        ) : (
          <div className="nw-set__addrow">
            <button
              type="button"
              className="jds-btn jds-btn--sm jds-btn--secondary nw-set__addbtn"
              disabled
            >
              Add source
            </button>
            {availability ? (
              <PrereqGate requirement="Adding sources needs an AI model with structured output." />
            ) : null}
          </div>
        )}
      </section>

      <section className="nw-set" aria-label="Topics you describe">
        <p className="nw-set__kicker">Topics you describe</p>
        <p className="nw-set__hint">
          Freeform topics in your own words — like &ldquo;mechanical watches, not
          smartwatches&rdquo; — discovered across the web, not just your sources.
        </p>
        {customTopics.length > 0 ? (
          <ul className="nw-set__list">
            {customTopics.map((topic) => {
              const removing =
                removeTopicMutation.isPending && removeTopicMutation.variables === topic.id;
              return (
                <li key={topic.id} className="nw-set__item">
                  <span className="nw-set__item-label">{topic.label}</span>
                  {topic.guidance ? (
                    <span className="nw-set__item-meta">{topic.guidance}</span>
                  ) : null}
                  {topic.validationStatus !== "approved" ? (
                    <Badge tone="amber">Needs revalidation</Badge>
                  ) : null}
                  <button
                    type="button"
                    className="jds-btn jds-btn--sm jds-btn--secondary"
                    aria-label={`Remove ${topic.label}`}
                    disabled={removing}
                    onClick={() => removeTopicMutation.mutate(topic.id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {removeTopicMutation.isError ? <Note>Could not remove that topic. Try again.</Note> : null}
        {topicsNeedAttention ? retryRow() : null}
        {availability?.freeformTopicsEnabled ? (
          <form className="nw-set__exform" onSubmit={submitTopic}>
            <label className="nw-set__exlabel" htmlFor="nw-addtopic-label">
              Topic in your own words
            </label>
            <div className="nw-set__exrow">
              <input
                id="nw-addtopic-label"
                className="jds-input"
                type="text"
                value={topicLabel}
                placeholder="mechanical watches"
                disabled={addTopicMutation.isPending}
                onChange={(event) => setTopicLabel(event.target.value)}
              />
            </div>
            <label className="nw-set__exlabel" htmlFor="nw-addtopic-guidance">
              Optional guidance — what to include or leave out
            </label>
            <div className="nw-set__exrow">
              <input
                id="nw-addtopic-guidance"
                className="jds-input"
                type="text"
                value={topicGuidance}
                placeholder="not smartwatches"
                disabled={addTopicMutation.isPending}
                onChange={(event) => setTopicGuidance(event.target.value)}
              />
              <button
                type="submit"
                className="jds-btn jds-btn--sm"
                disabled={addTopicMutation.isPending || !topicLabel.trim()}
              >
                {addTopicMutation.isPending ? "Checking…" : "Add topic"}
              </button>
            </div>
          </form>
        ) : (
          <div className="nw-set__addrow">
            <button
              type="button"
              className="jds-btn jds-btn--sm jds-btn--secondary nw-set__addbtn"
              disabled
            >
              Add topic
            </button>
            {availability ? (
              <PrereqGate requirement="Described topics need an AI model and web search." />
            ) : null}
          </div>
        )}
        {addTopicMutation.isError ? (
          <p className="nw-set__exerr" role="alert">
            {topicCreateErrorMessage(addTopicMutation.error)}
          </p>
        ) : null}
      </section>

      <section className="nw-set" aria-label="Excluded publishers">
        <p className="nw-set__kicker">Excluded publishers</p>
        <p className="nw-set__hint">
          Excluded publishers never appear anywhere in News, Today, or briefings — including through
          topics. Removing one returns it to neutral; it may show up again, but is not preferred.
        </p>
        <form className="nw-set__exform" onSubmit={submitExclusion}>
          <label className="nw-set__exlabel" htmlFor="nw-exclusion-input">
            Publisher domain or HTTPS link
          </label>
          <div className="nw-set__exrow">
            <input
              id="nw-exclusion-input"
              className="jds-input"
              type="text"
              value={exclusionInput}
              placeholder="example.com"
              disabled={addExclusionMutation.isPending}
              aria-describedby={exclusionError ? "nw-exclusion-error" : undefined}
              onChange={(event) => {
                setExclusionInput(event.target.value);
                // Stale validation copy beside fresh input reads as a new failure — clear it.
                setExclusionValidation(null);
              }}
            />
            <button
              type="submit"
              className="jds-btn jds-btn--sm nw-set__exadd"
              disabled={addExclusionMutation.isPending}
            >
              Add
            </button>
          </div>
        </form>
        {exclusionError ? (
          <p id="nw-exclusion-error" className="nw-set__exerr" role="alert">
            {exclusionError}
          </p>
        ) : null}
        {exclusions.length > 0 ? (
          <ul className="nw-set__list">
            {exclusions.map((exclusion) => {
              const removing =
                removeExclusionMutation.isPending &&
                removeExclusionMutation.variables === exclusion.id;
              return (
                <li key={exclusion.id} className="nw-set__item">
                  <span className="nw-set__item-label">{exclusion.canonicalDomain}</span>
                  <button
                    type="button"
                    className="jds-btn jds-btn--sm jds-btn--secondary"
                    aria-label={`Remove ${exclusion.canonicalDomain}`}
                    disabled={removing}
                    onClick={() => removeExclusionMutation.mutate(exclusion.id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {removeExclusionMutation.isError ? (
          <Note>Could not remove that exclusion. Try again.</Note>
        ) : null}
      </section>

      {personalizationQuery.isError ? (
        <Note>Could not load personalization details. Try again.</Note>
      ) : null}
      {error ? <Note>Could not load or save news preferences. Try again.</Note> : null}
    </>
  );
}
