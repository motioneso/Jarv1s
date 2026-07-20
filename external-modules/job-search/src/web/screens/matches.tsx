// #1197: Park Press Matches list + detail. All posting fields are external,
// adversary-controlled text; no captured HTML is rendered and outbound URLs
// are limited to http(s). Web reads tools only; decisions hand off to Jarvis.
import { h, type ReactNodeLike } from "../runtime";
import { ModuleLink } from "../router";
import { useToolQuery } from "../store";
import { EmptyState, ErrorState, outcomeGate } from "../states";
import { whenLabel } from "../format";
import { Confidence, Eyebrow, FitBadge, Meta, SectionHead, Strap } from "../kit";
import type { HostActions } from "../root";

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

export function hashFromPath(path: string): string | null {
  return path.split("/")[3] || null;
}

export function listInputForBucket(bucket: Bucket): Record<string, unknown> {
  return { view: bucket };
}

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
  fitBand?: string;
  confidence?: string;
  evaluationPending?: boolean;
  topEvidence?: string;
  topGap?: string;
}

export interface OpportunityListResult extends Record<string, unknown> {
  status: string;
  message?: string;
  total?: number;
  opportunities?: OpportunityCard[];
}

export interface PostingDetail {
  title: string;
  company: string;
  location?: string;
  url?: string;
  workMode?: string;
  employmentType?: string;
  compensation?: string;
  publishedAt?: string;
  description: string;
  descriptionTruncated?: boolean;
  descriptionClipped?: boolean;
}

export interface EvidenceRow {
  requirement: string;
  evidence: string;
  source: string;
}

export interface EvaluationDetail {
  fitBand: string;
  recommendation: string;
  postingConfidence?: string;
  overallConfidence?: string;
  summary: string;
  evidence?: EvidenceRow[];
  blockers?: string[];
  gaps?: string[];
  unknowns?: string[];
  preferenceMatches?: string[];
  preferenceConflicts?: string[];
  outdated: boolean;
  inputs?: {
    opportunityContentHash: string;
    profileRevisionId: string;
    resumeRevisionId: string;
  };
}

export interface OpportunityDetail {
  identityHash: string;
  status: string;
  statusAt?: string;
  decisionReason?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  freshness?: string;
  posting: PostingDetail;
  evaluation?: EvaluationDetail;
}

export interface OpportunityDetailResult extends Record<string, unknown> {
  status: string;
  message?: string;
  opportunity?: OpportunityDetail;
}

const EMPTY_BODY: Record<Bucket, string> = {
  new: "Nothing credible has landed here yet. New matches appear after your monitors run each morning.",
  saved:
    "Ask Jarvis to save an opportunity and it lands here — decisions happen in the conversation.",
  passed: "Roles you've passed on file here, with the reason kept.",
  stale: "Nothing has gone stale. Postings that drop off their source board move here."
};

function MatchCard(props: { bucket: Bucket; card: OpportunityCard; key?: string }): ReactNodeLike {
  const card = props.card;
  const meta = [card.location, card.workMode].filter(Boolean);
  return (
    <li className="jds-card jds-card--interactive jsm-match-card">
      <div className="jsm-row">
        <span className="jds-eyebrow">
          {`${card.source} · ${whenLabel(card.publishedAt ?? card.firstSeenAt)}`}
        </span>
        {card.freshness ? (
          <span
            className={`jds-badge ${card.freshness === "fresh" ? "jds-badge--forest" : "jds-badge--neutral"}`}
          >
            {card.freshness}
          </span>
        ) : null}
      </div>
      <div className="jsm-match-card__head">
        <div>
          <h3 className="jsm-match-card__title">
            <ModuleLink to={`/matches/${props.bucket}/${card.identityHash}`}>
              {card.title}
            </ModuleLink>
          </h3>
          <p className="jsm-match-card__company">{card.company}</p>
          <div className="jsm-pill-row">
            {meta.map((value) => (
              <span key={value} className="jsm-meta-pill">
                {value}
              </span>
            ))}
          </div>
        </div>
        <div className="jsm-match-card__score">
          {card.evaluationPending ? (
            <span className="jds-badge jds-badge--amber">Evaluation pending</span>
          ) : (
            <FitBadge band={card.fitBand} />
          )}
          {card.evaluationPending ? null : <Confidence level={card.confidence} />}
        </div>
      </div>
      {card.topEvidence || card.topGap ? (
        <div className="jsm-evidence-grid">
          {card.topEvidence ? (
            <div>
              <span className="jds-eyebrow jsm-text-accent">Why it fits</span>
              <p>{card.topEvidence}</p>
            </div>
          ) : null}
          {card.topGap ? (
            <div>
              <span className="jds-eyebrow jsm-text-gold">Watch out</span>
              <p>{card.topGap}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function BucketNav(props: { bucket: Bucket }): ReactNodeLike {
  return (
    <nav className="jsm-buckets" aria-label="Match buckets">
      {BUCKETS.map((bucket) => (
        <ModuleLink
          key={bucket}
          to={`/matches/${bucket}`}
          className={`jds-btn jds-btn--sm ${props.bucket === bucket ? "jds-btn--primary" : "jds-btn--secondary"}`}
          aria-current={props.bucket === bucket ? "page" : undefined}
        >
          {BUCKET_LABELS[bucket]}
        </ModuleLink>
      ))}
    </nav>
  );
}

export function MatchesListView(props: {
  bucket: Bucket;
  result: OpportunityListResult;
  hasMonitors: boolean;
}): ReactNodeLike {
  if (props.result.status !== "ok") {
    return <ErrorState message={props.result.message ?? "Could not load matches."} />;
  }
  const cards = props.result.opportunities ?? [];
  const total = props.result.total ?? cards.length;
  return (
    <div className="jsm-screen">
      <section className="jsm-hero" aria-labelledby="jsm-matches-title">
        <div>
          <Eyebrow tone="gold">Daily discovery · credible matches</Eyebrow>
          <h2 id="jsm-matches-title" className="jsm-display">
            {`${total} ${BUCKET_LABELS[props.bucket].toLowerCase()}`}
          </h2>
          <Strap />
          <p className="jsm-hero__copy">
            I&apos;ve scored each role against your profile and resume; the rest of the board
            wasn&apos;t worth your time.
          </p>
        </div>
        <div className="jds-card jsm-stack">
          <Eyebrow>{props.hasMonitors ? "Monitoring on" : "Monitoring off"}</Eyebrow>
          <div className="jsm-stats">
            <div>
              <span className="jds-eyebrow">Showing</span>
              <div className="jsm-stat__value">{cards.length}</div>
            </div>
            <div>
              <span className="jds-eyebrow">Total</span>
              <div className="jsm-stat__value">{total}</div>
            </div>
          </div>
        </div>
      </section>
      <div className="jsm-rule" aria-hidden="true" />
      <BucketNav bucket={props.bucket} />
      {cards.length === 0 ? (
        <EmptyState
          title={`No ${BUCKET_LABELS[props.bucket].toLowerCase()} opportunities yet`}
          body={
            props.hasMonitors
              ? EMPTY_BODY[props.bucket]
              : "Set up monitoring with Jarvis to start capturing opportunities."
          }
        />
      ) : (
        <ul className="jsm-card-list" aria-label="Matches">
          {cards.map((card) => (
            <MatchCard key={card.identityHash} bucket={props.bucket} card={card} />
          ))}
        </ul>
      )}
    </div>
  );
}

function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function NamedList(props: {
  label: string;
  items?: string[];
  tone?: "accent" | "amber";
  key?: string;
}): ReactNodeLike {
  if (!props.items || props.items.length === 0) return null;
  return (
    <div className={`jsm-named-list${props.tone ? ` jsm-named-list--${props.tone}` : ""}`}>
      <span className="jds-eyebrow">{props.label}</span>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvaluationCard(props: { evaluation?: EvaluationDetail }): ReactNodeLike {
  const evaluation = props.evaluation;
  if (!evaluation) {
    return (
      <EmptyState
        title="Evaluation pending"
        body="Jarvis has not scored this opportunity against your profile yet."
      />
    );
  }
  return (
    <div className="jsm-evaluation">
      <div className="jsm-row">
        <Eyebrow tone="gold">Jarvis evaluation</Eyebrow>
        <span className="jds-badge jds-badge--forest">{evaluation.recommendation}</span>
      </div>
      {evaluation.outdated ? (
        <p role="status">
          <span className="jds-badge jds-badge--amber">Evaluation outdated</span>
        </p>
      ) : null}
      <div className="jsm-row">
        <FitBadge band={evaluation.fitBand} />
        <Confidence level={evaluation.overallConfidence ?? evaluation.postingConfidence} />
      </div>
      <div className="jsm-pill-row">
        {evaluation.postingConfidence ? (
          <Meta>{`Posting confidence · ${evaluation.postingConfidence}`}</Meta>
        ) : null}
        {evaluation.overallConfidence ? (
          <Meta>{`Overall confidence · ${evaluation.overallConfidence}`}</Meta>
        ) : null}
      </div>
      <p className="jsm-card-copy">{evaluation.summary}</p>
      {evaluation.evidence && evaluation.evidence.length > 0 ? (
        <div className="jsm-evaluation__evidence">
          <span className="jds-eyebrow">Evidence</span>
          {evaluation.evidence.map((row) => (
            <div key={row.requirement}>
              <strong>{row.requirement}</strong>
              <p>
                {row.evidence} <span className="jds-eyebrow">{`· ${row.source}`}</span>
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <NamedList label="Blockers" items={evaluation.blockers} tone="amber" />
      <NamedList label="Gaps" items={evaluation.gaps} tone="amber" />
      <NamedList label="Preference matches" items={evaluation.preferenceMatches} tone="accent" />
      <NamedList label="Preference conflicts" items={evaluation.preferenceConflicts} tone="amber" />
      <NamedList label="Open questions" items={evaluation.unknowns} />
      {evaluation.inputs ? (
        <p className="jds-eyebrow">
          {`Scored against profile ${evaluation.inputs.profileRevisionId} · resume ${evaluation.inputs.resumeRevisionId}`}
        </p>
      ) : null}
    </div>
  );
}

function DetailMeta(props: { label: string; value?: string; key?: string }): ReactNodeLike {
  if (!props.value) return null;
  return (
    <div>
      <dt className="jds-eyebrow">{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

export function MatchDetailView(props: {
  bucket: Bucket;
  result: OpportunityDetailResult;
  hostActions: HostActions;
}): ReactNodeLike {
  const opportunity = props.result.opportunity;
  if (props.result.status !== "ok" || !opportunity) {
    return <ErrorState message={props.result.message ?? "Could not load this match."} />;
  }
  const posting = opportunity.posting;
  const url = safeHttpUrl(posting.url);
  const meta = [
    posting.location,
    posting.workMode,
    posting.employmentType,
    posting.compensation
  ].filter((value): value is string => Boolean(value));
  const decisionPrompt = (decision: "save" | "pass") =>
    `Please help me ${decision} job opportunity ${opportunity.identityHash} and confirm the decision.`;
  return (
    <article className="jsm-screen" aria-labelledby="jsm-match-detail-title">
      <header>
        <Eyebrow>{`${posting.company} · first seen ${whenLabel(opportunity.firstSeenAt)}`}</Eyebrow>
        <h2 id="jsm-match-detail-title" className="jsm-detail-title">
          {posting.title}
        </h2>
        <div className="jsm-pill-row">
          {meta.map((value) => (
            <span key={value} className="jsm-meta-pill">
              {value}
            </span>
          ))}
        </div>
        <div className="jsm-detail-score">
          <FitBadge band={opportunity.evaluation?.fitBand} />
          <Confidence
            level={
              opportunity.evaluation?.overallConfidence ?? opportunity.evaluation?.postingConfidence
            }
          />
          {url ? (
            <a href={url} target="_blank" rel="noreferrer noopener">
              View original posting
            </a>
          ) : null}
        </div>
      </header>
      <div className="jsm-detail-grid">
        <section>
          <SectionHead>The role</SectionHead>
          {posting.descriptionTruncated ? (
            <p className="jds-eyebrow">The stored description was truncated at capture.</p>
          ) : null}
          {posting.descriptionClipped ? (
            <p className="jds-eyebrow">Shortened for display — ask Jarvis for the full text.</p>
          ) : null}
          <p className="jsm-prewrap jsm-role-copy">{posting.description}</p>
        </section>
        <aside className="jsm-stack">
          <EvaluationCard evaluation={opportunity.evaluation} />
          <div className="jds-card jsm-stack">
            <Eyebrow>Your decision</Eyebrow>
            <dl className="jsm-detail-meta">
              <DetailMeta label="Status" value={opportunity.status} />
              <DetailMeta
                label="Decided"
                value={opportunity.statusAt ? whenLabel(opportunity.statusAt) : undefined}
              />
              <DetailMeta label="Reason" value={opportunity.decisionReason} />
              <DetailMeta label="Freshness" value={opportunity.freshness} />
            </dl>
            <div className="jsm-button-row">
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                onClick={() =>
                  props.hostActions.openAssistant({ starterPrompt: decisionPrompt("save") })
                }
              >
                Save
              </button>
              <button
                type="button"
                className="jds-btn jds-btn--secondary jds-btn--sm"
                onClick={() =>
                  props.hostActions.openAssistant({ starterPrompt: decisionPrompt("pass") })
                }
              >
                Pass
              </button>
            </div>
            <p className="jsm-card-copy">
              Decisions are confirmed with Jarvis in the conversation — this is a preview.
            </p>
          </div>
        </aside>
      </div>
    </article>
  );
}

export function MatchesScreen(props: { path: string; hostActions: HostActions }): ReactNodeLike {
  const bucket = bucketFromPath(props.path);
  const identityHash = hashFromPath(props.path);
  if (identityHash) {
    return (
      <MatchDetailScreen
        bucket={bucket}
        identityHash={identityHash}
        hostActions={props.hostActions}
      />
    );
  }
  return <MatchesListScreen bucket={bucket} />;
}

function MatchesListScreen(props: { bucket: Bucket }): ReactNodeLike {
  const list = useToolQuery<OpportunityListResult>(
    "job-search.opportunities.list",
    listInputForBucket(props.bucket)
  );
  const monitors = useToolQuery<Record<string, unknown>>("job-search.monitor.list");
  const hasMonitors =
    monitors.status === "settled" &&
    monitors.outcome.kind === "ok" &&
    Array.isArray((monitors.outcome.result as { monitors?: unknown[] }).monitors) &&
    (monitors.outcome.result as { monitors: unknown[] }).monitors.length > 0;
  if (list.status === "loading") {
    return (
      <div className="jsm-stack">
        <BucketNav bucket={props.bucket} />
        {outcomeGate(list, () => null, { loadingLabel: "Loading matches" })}
      </div>
    );
  }
  return outcomeGate(
    list,
    (result) => <MatchesListView bucket={props.bucket} result={result} hasMonitors={hasMonitors} />,
    { loadingLabel: "Loading matches" }
  );
}

function MatchDetailScreen(props: {
  bucket: Bucket;
  identityHash: string;
  hostActions: HostActions;
}): ReactNodeLike {
  const detail = useToolQuery<OpportunityDetailResult>("job-search.opportunities.get", {
    identityHash: props.identityHash
  });
  return (
    <section className="jsm-stack">
      <ModuleLink to={`/matches/${props.bucket}`} className="jds-btn jds-btn--quiet jds-btn--sm">
        Back to matches
      </ModuleLink>
      {outcomeGate(
        detail,
        (result) => (
          <MatchDetailView bucket={props.bucket} result={result} hostActions={props.hostActions} />
        ),
        { loadingLabel: "Loading match" }
      )}
    </section>
  );
}
