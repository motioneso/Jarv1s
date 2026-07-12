// external-modules/job-search/src/web/screens/opportunity-detail.tsx
// JS-08 (#937): owner-only detail over opportunities.get. Everything under
// `posting` is external, adversary-controlled content: the description renders
// as pre-wrap TEXT (never markup, #960) and the posting URL only becomes a
// link when it is plain http(s) — a javascript:/data: scheme must never reach
// an href. decisionReason appears here by ruling: this get response is the one
// owner-only surface allowed to carry it. No write actions: save/pass go
// through the assistant confirm flow, never a web button.
import { h, type ReactNodeLike } from "../runtime";
import { ModuleLink } from "../router";
import { useToolQuery } from "../store";
import { EmptyState, ErrorState, outcomeGate } from "../states";
import { whenLabel } from "../format";
import type { Bucket } from "./opportunities";

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
  createdAt?: string;
}

export interface OpportunityDetail {
  identityHash: string;
  status: string;
  statusAt?: string;
  decisionReason?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  freshness?: string;
  lastLivenessAt?: string;
  posting: PostingDetail;
  evaluation?: EvaluationDetail;
}

export interface OpportunityDetailResult extends Record<string, unknown> {
  status: string;
  message?: string;
  opportunity?: OpportunityDetail;
}

// Scheme allowlist for the outbound posting link. The URL is captured from an
// external source, so anything but plain http(s) is dropped entirely.
function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function bucketLabel(bucket: Bucket): string {
  return bucket.charAt(0).toUpperCase() + bucket.slice(1);
}

/** dt/dd pair that renders only when the value is present. */
function MetaPair(props: { label: string; value?: string; key?: string }): ReactNodeLike {
  if (!props.value) return null;
  return (
    <div className="jsm-row">
      <dt className="jds-eyebrow">{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function NamedList(props: { label: string; items?: string[]; key?: string }): ReactNodeLike {
  if (!props.items || props.items.length === 0) return null;
  return (
    <div>
      <span className="jds-eyebrow">{props.label}</span>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvaluationBlock(props: { evaluation?: EvaluationDetail }): ReactNodeLike {
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
    <div className="jds-card jds-card--flush jsm-state">
      <span className="jds-eyebrow">Evaluation</span>
      {evaluation.outdated ? (
        <p role="status">
          <span className="jds-badge jds-badge--amber">Evaluation outdated</span> Your profile or
          resume changed since this was scored.
        </p>
      ) : null}
      <div className="jsm-row">
        <span className="jds-badge jds-badge--neutral">{`Fit: ${evaluation.fitBand}`}</span>
        <span className="jds-badge jds-badge--forest">
          {`Recommendation: ${evaluation.recommendation}`}
        </span>
      </div>
      <dl className="jsm-meta">
        <MetaPair label="Posting confidence" value={evaluation.postingConfidence} />
        <MetaPair label="Overall confidence" value={evaluation.overallConfidence} />
      </dl>
      <p>{evaluation.summary}</p>
      {evaluation.evidence && evaluation.evidence.length > 0 ? (
        <table className="jsm-table">
          <thead>
            <tr>
              <th className="jds-eyebrow">Requirement</th>
              <th className="jds-eyebrow">Evidence</th>
              <th className="jds-eyebrow">Source</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.evidence.map((row) => (
              <tr key={row.requirement}>
                <td>{row.requirement}</td>
                <td>{row.evidence}</td>
                <td>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <NamedList label="Blockers" items={evaluation.blockers} />
      <NamedList label="Gaps" items={evaluation.gaps} />
      <NamedList label="Unknowns" items={evaluation.unknowns} />
      <NamedList label="Preference matches" items={evaluation.preferenceMatches} />
      <NamedList label="Preference conflicts" items={evaluation.preferenceConflicts} />
      {evaluation.inputs ? (
        <p className="jds-eyebrow">
          {`Scored against profile ${evaluation.inputs.profileRevisionId} · resume ${evaluation.inputs.resumeRevisionId}`}
        </p>
      ) : null}
    </div>
  );
}

export function OpportunityDetailView(props: {
  bucket: Bucket;
  result: OpportunityDetailResult;
}): ReactNodeLike {
  const opportunity = props.result.opportunity;
  if (props.result.status !== "ok" || !opportunity) {
    return <ErrorState message={props.result.message ?? "Could not load this opportunity."} />;
  }
  const posting = opportunity.posting;
  const url = safeHttpUrl(posting.url);
  const meta = [posting.location, posting.workMode, posting.employmentType, posting.compensation]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="jsm-stack" aria-labelledby="jsm-opp-detail-title">
      <header className="jsm-header">
        <span className="jds-eyebrow">
          {`${posting.company} · first seen ${whenLabel(opportunity.firstSeenAt)}`}
        </span>
        <h2 id="jsm-opp-detail-title">{posting.title}</h2>
        {meta ? <p>{meta}</p> : null}
        {url ? (
          <p>
            <a href={url} target="_blank" rel="noreferrer noopener">
              View original posting
            </a>
          </p>
        ) : null}
      </header>
      <div className="jds-card jds-card--flush jsm-state">
        <span className="jds-eyebrow">Description</span>
        {posting.descriptionTruncated ? (
          <p className="jds-eyebrow">The stored description was truncated at capture.</p>
        ) : null}
        {posting.descriptionClipped ? (
          <p className="jds-eyebrow">Shortened for display — ask Jarvis for the full text.</p>
        ) : null}
        <p className="jsm-prewrap">{posting.description}</p>
      </div>
      <EvaluationBlock evaluation={opportunity.evaluation} />
      <div className="jds-card jds-card--flush jsm-state">
        <span className="jds-eyebrow">Decision</span>
        <dl className="jsm-meta">
          <MetaPair label="Status" value={opportunity.status} />
          <MetaPair
            label="Decided"
            value={opportunity.statusAt && whenLabel(opportunity.statusAt)}
          />
          <MetaPair label="Reason" value={opportunity.decisionReason} />
          <MetaPair label="Freshness" value={opportunity.freshness} />
          <MetaPair
            label="Last seen"
            value={opportunity.lastSeenAt && whenLabel(opportunity.lastSeenAt)}
          />
        </dl>
        <p>Ask the assistant to save or pass this opportunity — decisions are confirmed there.</p>
      </div>
    </article>
  );
}

export function OpportunityDetailScreen(props: {
  bucket: Bucket;
  identityHash: string;
}): ReactNodeLike {
  const detail = useToolQuery<OpportunityDetailResult>("job-search.opportunities.get", {
    identityHash: props.identityHash
  });
  return (
    <section className="jsm-stack">
      <nav className="jsm-nav" aria-label="Opportunity detail">
        <ModuleLink
          to={`/opportunities/${props.bucket}`}
          className="jds-btn jds-btn--ghost jds-btn--sm"
        >
          {`Back to ${bucketLabel(props.bucket)}`}
        </ModuleLink>
      </nav>
      {outcomeGate(
        detail,
        (result) => (
          <OpportunityDetailView bucket={props.bucket} result={result} />
        ),
        { loadingLabel: "Loading opportunity" }
      )}
    </section>
  );
}
