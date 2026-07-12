// external-modules/job-search/src/web/screens/opportunities.tsx
// JS-08 (#937): bucketed opportunity feed over opportunities.list. Cards show
// bounded, sanitized fields only (the list handler strips descriptions); every
// string is rendered as a text node — posting titles/evidence are external,
// adversary-controlled content (#960). No write actions here: save/pass go
// through the assistant confirm flow, never a web button (Coordinator ruling).
import { h, type ReactNodeLike } from "../runtime";
import { ModuleLink } from "../router";
import { useToolQuery } from "../store";
import { EmptyState, ErrorState, outcomeGate } from "../states";
import { whenLabel } from "../format";

const BUCKETS = ["new", "saved", "passed", "stale"] as const;
export type Bucket = (typeof BUCKETS)[number];

const BUCKET_LABELS: Record<Bucket, string> = {
  new: "New",
  saved: "Saved",
  passed: "Passed",
  stale: "Stale"
};

export function bucketFromPath(path: string): Bucket {
  const segment = path.split("/")[2] ?? "new";
  return (BUCKETS as readonly string[]).includes(segment) ? (segment as Bucket) : "new";
}

// Exported so tests can pin that the bucket route drives the tool input.
export function listInputForBucket(bucket: Bucket): Record<string, unknown> {
  return { view: bucket };
}

// Mirrors the manifest card outputSchema (required: identityHash, status,
// title, company, source); everything else renders only when present.
export interface OpportunityCard {
  identityHash: string;
  status: string;
  title: string;
  company: string;
  location?: string;
  workMode?: string;
  source: string;
  publishedAt?: string;
  firstSeenAt?: string;
  freshness?: string;
  eligibility?: string;
  fitBand?: string;
  confidence?: string;
  evaluationPending?: boolean;
  topEvidence?: string;
  topGap?: string;
}

export interface OpportunityListResult extends Record<string, unknown> {
  status: string;
  message?: string;
  view?: string;
  total?: number;
  limit?: number;
  offset?: number;
  opportunities?: OpportunityCard[];
}

// Bodies for an empty bucket when monitoring IS configured — "no credible
// matches yet", per bucket, as opposed to unconfigured emptiness.
const MONITORED_EMPTY_BODY: Record<Bucket, string> = {
  new: "Nothing credible has landed here yet. New matches appear after monitoring runs.",
  saved: "Decisions happen in the assistant — ask Jarvis to save an opportunity and it lands here.",
  passed:
    "Decisions happen in the assistant — ask Jarvis to pass on an opportunity to file it here.",
  stale: "Nothing has gone stale. Postings that disappear from their source move here."
};

// `key?` mirrors ModuleLink: the runtime's loose JSX typing has no implicit
// React key slot on custom components, so list callers declare it explicitly.
function OpportunityCardRow(props: {
  bucket: Bucket;
  card: OpportunityCard;
  key?: string;
}): ReactNodeLike {
  const card = props.card;
  const meta = [card.company, card.location, card.workMode].filter(Boolean).join(" · ");
  return (
    <li className="jds-card jds-card--flush jsm-state">
      <span className="jds-eyebrow">
        {`${card.source} · ${whenLabel(card.publishedAt ?? card.firstSeenAt)}`}
      </span>
      <div className="jsm-row">
        <h3>
          <ModuleLink to={`/opportunities/${props.bucket}/${card.identityHash}`}>
            {card.title}
          </ModuleLink>
        </h3>
        <span className="jsm-row">
          {card.freshness ? (
            <span
              className={`jds-badge ${card.freshness === "fresh" ? "jds-badge--forest" : "jds-badge--neutral"}`}
            >
              {card.freshness}
            </span>
          ) : null}
          {card.evaluationPending ? (
            <span className="jds-badge jds-badge--amber">Evaluation pending</span>
          ) : (
            <span className="jsm-row">
              {card.fitBand ? (
                <span className="jds-badge jds-badge--neutral">{`Fit: ${card.fitBand}`}</span>
              ) : null}
              {card.confidence ? (
                <span className="jds-badge jds-badge--outline">
                  {`Confidence: ${card.confidence}`}
                </span>
              ) : null}
            </span>
          )}
        </span>
      </div>
      <p>{meta}</p>
      {card.topEvidence || card.topGap ? (
        <dl className="jsm-meta">
          {card.topEvidence ? <dt className="jds-eyebrow">Evidence</dt> : null}
          {card.topEvidence ? <dd>{card.topEvidence}</dd> : null}
          {card.topGap ? <dt className="jds-eyebrow">Gap</dt> : null}
          {card.topGap ? <dd>{card.topGap}</dd> : null}
        </dl>
      ) : null}
    </li>
  );
}

export function OpportunitiesView(props: {
  bucket: Bucket;
  result: OpportunityListResult;
  hasMonitors: boolean;
}): ReactNodeLike {
  if (props.result.status !== "ok") {
    return <ErrorState message={props.result.message ?? "Could not load opportunities."} />;
  }
  const cards = props.result.opportunities ?? [];
  if (cards.length === 0) {
    return (
      <EmptyState
        title={`No ${BUCKET_LABELS[props.bucket].toLowerCase()} opportunities yet`}
        body={
          props.hasMonitors
            ? MONITORED_EMPTY_BODY[props.bucket]
            : "Set up monitoring with Jarvis to start capturing opportunities."
        }
      />
    );
  }
  return (
    <ul className="jsm-steps" aria-label="Opportunities">
      {cards.map((card) => (
        <OpportunityCardRow key={card.identityHash} bucket={props.bucket} card={card} />
      ))}
    </ul>
  );
}

export function OpportunitiesScreen(props: { path: string }): ReactNodeLike {
  const bucket = bucketFromPath(props.path);
  const list = useToolQuery<OpportunityListResult>(
    "job-search.opportunities.list",
    listInputForBucket(bucket)
  );
  // monitor.list only tunes the empty-state copy; its failure never blocks
  // the feed (treat as "no monitors" and let the list gate the screen).
  const monitors = useToolQuery<Record<string, unknown>>("job-search.monitor.list");
  const hasMonitors =
    monitors.status === "settled" &&
    monitors.outcome.kind === "ok" &&
    Array.isArray((monitors.outcome.result as { monitors?: unknown[] }).monitors) &&
    (monitors.outcome.result as { monitors: unknown[] }).monitors.length > 0;
  return (
    <section className="jsm-stack" aria-labelledby="jsm-opps-title">
      <h2 id="jsm-opps-title" className="jsm-visually-hidden">
        Opportunities
      </h2>
      <nav className="jsm-nav" aria-label="Opportunity buckets">
        {BUCKETS.map((candidate) => (
          <ModuleLink
            key={candidate}
            to={`/opportunities/${candidate}`}
            className={`jds-btn jds-btn--ghost jds-btn--sm${bucket === candidate ? " jds-btn--secondary" : ""}`}
            aria-current={bucket === candidate ? "page" : undefined}
          >
            {BUCKET_LABELS[candidate]}
          </ModuleLink>
        ))}
      </nav>
      {outcomeGate(
        list,
        (result) => (
          <OpportunitiesView bucket={bucket} result={result} hasMonitors={hasMonitors} />
        ),
        { loadingLabel: "Loading opportunities" }
      )}
    </section>
  );
}
