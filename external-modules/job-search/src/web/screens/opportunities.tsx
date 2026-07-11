// external-modules/job-search/src/web/screens/opportunities.tsx
// JS-06 (#935): route shell only — new/saved/passed/stale exist and are
// bookmarkable so JS-08 can fill them with captured opportunities. No listing
// UI yet (spec non-goal; opportunities.list stays a JS-05 stub).
import { h, type ReactNodeLike } from "../runtime";
import { ModuleLink } from "../router";
import { EmptyState } from "../states";

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

export function OpportunitiesScreen(props: { path: string }): ReactNodeLike {
  const bucket = bucketFromPath(props.path);
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
      <EmptyState
        title={`No ${BUCKET_LABELS[bucket].toLowerCase()} opportunities yet`}
        body="Opportunities arrive with monitoring runs in an upcoming release."
      />
    </section>
  );
}
