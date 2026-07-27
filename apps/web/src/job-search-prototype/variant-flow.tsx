/*
 * PROTOTYPE — THROWAWAY. Variant D: "Flow" — the shape Ben picked.
 *
 * Not a fourth posture. It is Console as the profile view, with the two things Console was
 * missing bolted on the way he described them:
 *
 *   1. Onboarding is a full chat interface. A profile with no criteria has nothing to put in a
 *      table, so it shows no table — just the conversation, full width.
 *   2. Once the profile has criteria it is Console, permanently. No mode flip, no continuum.
 *      If the user wants to talk, they open the Jarvis drawer.
 *
 * Drawer scoping: Ben's earlier ruling stands — a job-search thread must never appear in the
 * main drawer transcript. So the drawer here is the same chrome and the same implementation,
 * carrying the profile's thread. Opened from anywhere outside the module it carries the main
 * one. That is the "one stream, two renderings" rule applied to the drawer instead of to a
 * second in-page chat panel.
 */

import { useState } from "react";
import { FAKE_CONVERSATION, FAKE_PROFILES, profileById, type FakeMatch } from "./fake-data";
import { Axes, PortalChip, PortalList } from "./parts";
import "./flow.css";

type SortKey = "fit" | "want" | "posted";

/** Onboarding progress, derived from the profile record so the user always knows how far in
 * they are. A chat with no visible end is the thing that makes onboarding feel infinite. */
const ONBOARDING_STEPS = ["What you do", "What you want", "Where", "Compensation", "Sources"];

export function VariantFlow() {
  const [profileId, setProfileId] = useState("swe");
  const [sort, setSort] = useState<SortKey>("want");
  const [selectedId, setSelectedId] = useState<string | null>("m2");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [discussing, setDiscussing] = useState<FakeMatch | null>(null);

  const profile = profileById(profileId);
  const onboarding = profile.state === "in_conversation";
  const selected = profile.matches.find((m) => m.id === selectedId) ?? null;

  const rows = [...profile.matches].sort((a, b) => {
    if (a.unscored !== b.unscored) return a.unscored ? 1 : -1; // unscored always last
    if (sort === "posted") return 0;
    return b.axes[sort] - a.axes[sort];
  });

  function switchProfile(id: string) {
    setProfileId(id);
    setSelectedId(null);
    setDiscussing(null);
  }

  // "Discuss" is the only bridge from the board to the conversation: it opens the drawer with
  // the posting already in it as a record, so the user never re-types what they are looking at.
  function discuss(match: FakeMatch) {
    setDiscussing(match);
    setDrawerOpen(true);
  }

  return (
    <>
      <div className="jp-con">
        <nav className="jp-con__side">
          <div className="jp-con__sect">Searches</div>
          {FAKE_PROFILES.map((p) => (
            <button
              key={p.id}
              className={`jp-con__item${p.id === profileId ? " is-active" : ""}`}
              onClick={() => switchProfile(p.id)}
            >
              <span>{p.name}</span>
              <span className={`jp-con__count${p.newCount > 0 ? " is-new" : ""}`}>
                {p.state === "in_conversation" ? "…" : p.newCount > 0 ? p.newCount : p.totalCount}
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

        {onboarding ? (
          /* ------------------------------------------------- onboarding: chat, full width */
          <main className="jp-con__main" style={{ gridColumn: "span 2" }}>
            <div className="jp-onb">
              <div className="jp-onb__head">Let&rsquo;s work out what this search is for.</div>
              <div className="jp-onb__sub">
                Nothing gets crawled until we both know what we are looking for. You can stop and
                come back — I keep what we have so far.
              </div>
              <div className="jp-onb__prog">
                {ONBOARDING_STEPS.map((s, i) => (
                  <span key={s} className={`jp-onb__step${i < 2 ? " is-done" : ""}`}>
                    {s}
                  </span>
                ))}
              </div>

              <div className="jp-onb__thread">
                {FAKE_CONVERSATION.map((t, i) => (
                  <div key={i} className={`jp-turn${t.role === "you" ? " jp-turn--you" : ""}`}>
                    {t.role === "jarvis" ? <div className="jp-turn__who">Jarvis</div> : null}
                    {t.text}
                  </div>
                ))}
              </div>

              <div className="jp-onb__composer">
                <input className="jp-desk__input" placeholder="Answer, or ask me why…" readOnly />
                <button className="jp-btn jp-btn--primary">Send</button>
              </div>
            </div>
          </main>
        ) : (
          <>
            {/* -------------------------------------------- steady state: console, unchanged */}
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
                  <button className="jp-btn" onClick={() => setDrawerOpen(true)}>
                    Chat
                  </button>
                </span>
              </div>

              <div className="jp-strip">
                {profile.portals.map((p) => (
                  <PortalChip key={p.id} portal={p} />
                ))}
                <span className="jp-chiph">
                  <span className="jp-dot jp-dot--degraded" />
                  Scoring queue · 1 waiting
                </span>
              </div>

              <div className="jp-table">
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
                          {m.state === "new" ? (
                            <span className="jp-tag jp-tag--new">New</span>
                          ) : null}
                          {m.outsideFrame ? (
                            <span className="jp-tag jp-tag--reach">Reach</span>
                          ) : null}
                          {m.unscored ? (
                            <span className="jp-tag jp-tag--pending">Not read yet</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                    <button className="jp-btn jp-btn--primary" onClick={() => discuss(selected)}>
                      Discuss
                    </button>
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
          </>
        )}
      </div>

      {drawerOpen ? (
        <aside className="jp-drawer">
          <div className="jp-drawer__head">
            <span className="jp-drawer__title">Jarvis</span>
            {/* The scope pill is load-bearing: it is how the user knows this is not the main
             * thread, and why the main thread will not contain any of this later. */}
            <span className="jp-drawer__scope">{profile.name}</span>
            <button className="jp-drawer__close" onClick={() => setDrawerOpen(false)}>
              ×
            </button>
          </div>

          <div className="jp-drawer__body">
            {discussing ? (
              <div className="jp-drawer__pull">
                <div className="jp-drawer__pull-eyebrow">You asked about</div>
                <div className="jp-matchcard__title">{discussing.title}</div>
                <div className="jp-matchcard__co">
                  {discussing.company} · {discussing.location}
                </div>
                <Axes match={discussing} />
              </div>
            ) : null}

            <div className="jp-turn">
              <div className="jp-turn__who">Jarvis</div>
              {discussing
                ? `Fit is ${discussing.axes.fit} and Want is ${discussing.axes.want}. ${discussing.fitReason}`
                : `${profile.newCount} new since last night. LinkedIn stopped at page 8 with a 429 — 112 of about 190 postings — so today is partial there. Retrying in four hours.`}
            </div>

            <div className="jp-turn jp-turn--you">
              What would I need to close the fit gap on this one?
            </div>

            <div className="jp-drawer__note">
              This thread belongs to <strong>{profile.name}</strong>. Open the drawer from anywhere
              else and you get your main conversation instead — these never mix.
            </div>
          </div>

          <div className="jp-drawer__composer">
            <input className="jp-desk__input" placeholder="Message Jarvis…" readOnly />
            <button className="jp-btn jp-btn--primary">Send</button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
