/*
 * PROTOTYPE — THROWAWAY. Variant C: "Console".
 *
 * Posture: an operator view. Everything on one screen, dense, sortable, comparable. The two
 * axes are columns you can sort by independently — which is the only layout here where you
 * can ask "show me the highest Want regardless of Fit" without reading prose. Portal health
 * is a permanent strip. Chat is docked, not primary. Bet being tested: whether a person mid-
 * search wants to compare twenty postings at once more than they want to be talked to.
 */

import { useState } from "react";
import { FAKE_PROFILES, profileById } from "./fake-data";
import { Axes, PortalChip, PortalList } from "./parts";

type SortKey = "fit" | "want" | "posted";

export function VariantConsole() {
  const [profileId, setProfileId] = useState("swe");
  const [sort, setSort] = useState<SortKey>("want");
  const [selectedId, setSelectedId] = useState<string | null>("m2");
  const profile = profileById(profileId);

  const rows = [...profile.matches].sort((a, b) => {
    if (a.unscored !== b.unscored) return a.unscored ? 1 : -1; // unscored always last
    if (sort === "posted") return 0;
    return b.axes[sort] - a.axes[sort];
  });
  const selected = profile.matches.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="jp-con">
      <nav className="jp-con__side">
        <div className="jp-con__sect">Searches</div>
        {FAKE_PROFILES.map((p) => (
          <button
            key={p.id}
            className={`jp-con__item${p.id === profileId ? " is-active" : ""}`}
            onClick={() => {
              setProfileId(p.id);
              setSelectedId(null);
            }}
          >
            <span>{p.name}</span>
            <span className={`jp-con__count${p.newCount > 0 ? " is-new" : ""}`}>
              {p.newCount > 0 ? p.newCount : p.totalCount}
            </span>
          </button>
        ))}
        <button className="jp-con__item">+ New search</button>

        <div className="jp-con__sect">Sources</div>
        <div style={{ padding: "0 var(--space-4)" }}>
          <PortalList portals={profile.portals} />
          {profile.portals.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "8px 0" }}>
              None yet — nothing to crawl until the search is defined.
            </div>
          ) : null}
        </div>
      </nav>

      <main className="jp-con__main">
        <div className="jp-con__bar">
          <strong>{profile.name}</strong>
          <span>
            {profile.newCount} new · {profile.totalCount} total
          </span>
          <span>Crawled {profile.lastCrawl}</span>
          <span>{profile.schedule}</span>
          <span style={{ marginLeft: "auto" }}>
            Sort:{" "}
            {(["want", "fit", "posted"] as const).map((k) => (
              <button
                key={k}
                className="jp-btn jp-btn--ghost"
                style={{ padding: "2px 8px", fontWeight: sort === k ? 600 : 400 }}
                onClick={() => setSort(k)}
              >
                {k}
              </button>
            ))}
          </span>
        </div>

        {profile.portals.length > 0 ? (
          <div className="jp-strip">
            {profile.portals.map((p) => (
              <PortalChip key={p.id} portal={p} />
            ))}
            <span className="jp-chiph">
              <span className="jp-dot jp-dot--degraded" />
              Scoring queue · 1 waiting
            </span>
          </div>
        ) : null}

        <div className="jp-table">
          {profile.state === "in_conversation" ? (
            <div className="jp-empty">
              This search has no criteria yet.
              <br />
              Open the conversation on the right and tell Jarvis what you are after.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Location</th>
                  <th className="jp-num">Fit</th>
                  <th className="jp-num">Want</th>
                  <th>Source</th>
                  <th>Posted</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr
                    key={m.id}
                    className={m.id === selectedId ? "is-active" : ""}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <td>
                      <div className="jp-table__title">{m.title}</div>
                      <div className="jp-table__co">{m.company}</div>
                    </td>
                    <td>{m.location}</td>
                    <td className="jp-num">
                      {m.unscored ? (
                        <span className="jp-score--low">—</span>
                      ) : (
                        <span className="jp-score">{m.axes.fit}</span>
                      )}
                    </td>
                    <td className="jp-num">
                      {m.unscored ? (
                        <span className="jp-score--low">—</span>
                      ) : (
                        <span className="jp-score">{m.axes.want}</span>
                      )}
                    </td>
                    <td>{m.source}</td>
                    <td>{m.posted}</td>
                    <td>
                      {m.state === "new" ? <span className="jp-tag jp-tag--new">New</span> : null}
                      {m.outsideFrame ? <span className="jp-tag jp-tag--reach">Reach</span> : null}
                      {m.unscored ? (
                        <span className="jp-tag jp-tag--pending">Not read yet</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <aside className="jp-con__insp">
        {selected && !selected.unscored ? (
          <>
            <div className="jp-insp__title">{selected.title}</div>
            <div className="jp-insp__co">
              {selected.company} · {selected.location}
            </div>
            <Axes match={selected} />
            <div className="jp-insp__block">
              <div className="jp-insp__h">Fit</div>
              <p className="jp-insp__p">{selected.fitReason}</p>
              <div className="jp-insp__h">Want</div>
              <p className="jp-insp__p">{selected.wantReason}</p>
            </div>
            <div className="jp-insp__actions">
              <button className="jp-btn jp-btn--primary">Discuss</button>
              <button className="jp-btn">Open posting</button>
              <button className="jp-btn jp-btn--ghost">Dismiss</button>
            </div>
          </>
        ) : selected?.unscored ? (
          <div className="jp-empty">
            Crawled, saved, not yet read.
            <br />
            <br />
            Your model queue backed up at 06:40 and this one is still in line. It has not been
            skipped — it will be scored on the next pass and will show up as new when it is.
          </div>
        ) : (
          <div className="jp-empty">Pick a row to see why it scored the way it did.</div>
        )}
      </aside>
    </div>
  );
}
