import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Note, PaneHead } from "@jarv1s/settings-ui";
import type {
  NewsCatalogSource,
  NewsPrefDto,
  NewsPrefKind,
  NewsTopicKey,
  NewsTopicOption
} from "@jarv1s/shared";

import {
  createNewsPref,
  deleteNewsPref,
  getNewsCatalog,
  listNewsPrefs
} from "../web/news-client.js";
import { newsQueryKeys } from "../web/query-keys.js";
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

export default function NewsSettings() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: newsQueryKeys.catalog, queryFn: getNewsCatalog });
  const prefsQuery = useQuery({ queryKey: newsQueryKeys.prefs, queryFn: listNewsPrefs });

  const opsMutation = useMutation({
    mutationFn: runOps,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.prefs });
      // The front page recomposes from prefs server-side, so its cache is stale too.
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.overview });
    }
  });

  const sources = catalogQuery.data?.sources ?? [];
  const topics = catalogQuery.data?.topics ?? [];
  const prefs = prefsQuery.data?.prefs ?? [];
  const followedTopics = new Set(
    prefs.filter((pref) => pref.kind === "topic").map((pref) => pref.key)
  );
  const pending = catalogQuery.isLoading || prefsQuery.isLoading || opsMutation.isPending;
  const error = catalogQuery.isError || prefsQuery.isError || opsMutation.isError;

  const enabledCount = sources.filter((source) => sourceEnabled(source, prefs)).length;

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
            const active = sourceEnabled(source, prefs);
            return (
              <button
                key={source.sourceKey}
                type="button"
                className={`nw-setsrc${active ? " is-active" : ""}`}
                disabled={pending}
                aria-pressed={active}
                onClick={() =>
                  opsMutation.mutate(planSourceToggle(source.sourceKey, sources, prefs))
                }
              >
                <span className="nw-setsrc__name">{source.label}</span>
                <span className="nw-setsrc__state">{active ? "On" : "Off"}</span>
              </button>
            );
          })}
        </div>
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

      {error ? <Note>Could not load or save news preferences. Try again.</Note> : null}
    </>
  );
}
