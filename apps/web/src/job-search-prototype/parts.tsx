/* PROTOTYPE — THROWAWAY. Small pieces shared by all three variants so each variant file
 * stays about its layout posture rather than re-declaring the same score bar three times. */

import type { FakeMatch, FakePortal } from "./fake-data";

/** Two axes side by side. Deliberately no combined number anywhere in this file. */
export function Axes({ match }: { match: FakeMatch }) {
  return (
    <div className="jp-axes">
      <div className="jp-axis">
        <div className="jp-axis__head">
          <span className="jp-axis__name">Fit</span>
          <span className="jp-axis__num">{match.axes.fit}</span>
        </div>
        <div className="jp-axis__bar">
          <div className="jp-axis__fill" style={{ width: `${match.axes.fit}%` }} />
        </div>
      </div>
      <div className="jp-axis jp-axis--want">
        <div className="jp-axis__head">
          <span className="jp-axis__name">Want</span>
          <span className="jp-axis__num">{match.axes.want}</span>
        </div>
        <div className="jp-axis__bar">
          <div className="jp-axis__fill" style={{ width: `${match.axes.want}%` }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Portal health. The failure text is assembled from the structured cause fields, not from a
 * canned string — which portal, what kind of failure, when it last worked, what happens next.
 */
export function PortalList({ portals }: { portals: readonly FakePortal[] }) {
  return (
    <div>
      {portals.map((p) => (
        <div className="jp-portal" key={p.id}>
          <span className={`jp-dot${p.status === "ok" ? "" : ` jp-dot--${p.status}`}`} />
          <div className="jp-portal__body">
            <div className="jp-portal__name">{p.name}</div>
            <div className="jp-portal__meta">
              {p.status === "ok"
                ? `Last checked ${p.lastSuccess}`
                : p.status === "degraded"
                  ? `Partial results — last full sweep ${p.lastSuccess}`
                  : `Paused — last worked ${p.lastSuccess}`}
            </div>
            {p.cause ? (
              <div className="jp-portal__cause">
                {p.cause.detail}
                {p.cause.nextAttempt ? (
                  <>
                    {" "}
                    <span className="jp-portal__next">Trying again {p.cause.nextAttempt}.</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One compact health chip, for the Console strip. */
export function PortalChip({ portal }: { portal: FakePortal }) {
  return (
    <span className="jp-chiph" title={portal.cause?.detail ?? `Last checked ${portal.lastSuccess}`}>
      <span className={`jp-dot${portal.status === "ok" ? "" : ` jp-dot--${portal.status}`}`} />
      {portal.name}
      {portal.status !== "ok" ? (
        <em style={{ fontStyle: "normal", opacity: 0.7 }}>· {portal.status}</em>
      ) : null}
    </span>
  );
}
