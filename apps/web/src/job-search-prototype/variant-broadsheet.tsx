/*
 * PROTOTYPE — THROWAWAY. Variant B: "Broadsheet".
 *
 * Posture: an edition, not a dashboard. Each crawl produces a dated digest with a lede story
 * (the one posting Jarvis actually wants you to look at), a printed rubric for the two axes,
 * and briefs in columns. Chat slides in from the right when you want it. Bet being tested:
 * whether framing the output as a daily read makes "here is what I found and why" land better
 * than a list of cards ever could.
 */

import { useState } from "react";
import { FAKE_PROFILES, profileById, type FakeMatch } from "./fake-data";
import { PortalList } from "./parts";

export function VariantBroadsheet() {
  const [profileId, setProfileId] = useState("swe");
  const [chatOpen, setChatOpen] = useState(false);
  const [selected, setSelected] = useState<FakeMatch | null>(null);
  const profile = profileById(profileId);
  const scored = profile.matches.filter((m) => !m.unscored);
  // The lede is whichever posting has the biggest gap between want and stated intent.
  const lede = scored.find((m) => m.outsideFrame) ?? scored[0];
  const rest = scored.filter((m) => m.id !== lede?.id);
  const pending = profile.matches.filter((m) => m.unscored);
  const degraded = profile.portals.filter((p) => p.status !== "ok");

  return (
    <div className="jp-broad">
      <header className="jp-broad__masthead">
        <h1 className="jp-broad__title">The Job Search</h1>
        <div className="jp-broad__dateline">
          Sunday, 26 July 2026
          <br />
          Crawled {profile.lastCrawl} · {profile.newCount} new of {profile.totalCount}
        </div>
      </header>

      <nav className="jp-broad__tabs">
        {FAKE_PROFILES.map((p) => (
          <button
            key={p.id}
            className={`jp-broad__tab${p.id === profileId ? " is-active" : ""}`}
            onClick={() => {
              setProfileId(p.id);
              setSelected(null);
            }}
          >
            {p.name}
            {p.newCount > 0 ? ` (${p.newCount})` : ""}
          </button>
        ))}
        <button className="jp-broad__tab">+ New search</button>
      </nav>

      {profile.state === "in_conversation" ? (
        <div className="jp-empty">
          <p style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--ink)" }}>
            No edition yet.
          </p>
          <p>
            Jarvis is still in conversation with you about what this search is for. Nothing gets
            crawled until that produces something worth crawling for.
          </p>
          <button className="jp-btn jp-btn--primary" onClick={() => setChatOpen(true)}>
            Continue the conversation
          </button>
        </div>
      ) : (
        <>
          {lede ? (
            <section className="jp-lede">
              <div className="jp-lede__body">
                <div className="jp-lede__kicker">
                  {lede.outsideFrame ? "Not what you asked for" : "Lead match"}
                </div>
                <h2 className="jp-lede__hed">
                  {lede.title}, {lede.company}
                </h2>
                <div className="jp-lede__dek">
                  {lede.location} · posted {lede.posted} · via {lede.source}
                </div>
                <p>{lede.wantReason}</p>
                <p>{lede.fitReason}</p>
                <button className="jp-btn" onClick={() => setChatOpen(true)}>
                  Talk to Jarvis about this one
                </button>
              </div>
              <aside className="jp-rubric">
                <div className="jp-rubric__row">
                  <div className="jp-rubric__label">
                    <span className="jp-rubric__name">Fit</span>
                    <span className="jp-rubric__val">{lede.axes.fit}</span>
                  </div>
                  <div className="jp-rubric__note">Can you do it, and would they want you.</div>
                </div>
                <div className="jp-rubric__row">
                  <div className="jp-rubric__label">
                    <span className="jp-rubric__name">Want</span>
                    <span className="jp-rubric__val">{lede.axes.want}</span>
                  </div>
                  <div className="jp-rubric__note">Would you still want it a year in.</div>
                </div>
              </aside>
            </section>
          ) : null}

          <div className="jp-cols">
            {rest.map((m) => (
              <button key={m.id} className="jp-brief" onClick={() => setSelected(m)}>
                <div className="jp-brief__hed">{m.title}</div>
                <div className="jp-brief__co">
                  {m.company} · {m.location}
                </div>
                <div className="jp-brief__scores">
                  <span>
                    Fit <b>{m.axes.fit}</b>
                  </span>
                  <span>
                    Want <b>{m.axes.want}</b>
                  </span>
                  <span style={{ marginLeft: "auto" }}>{m.posted}</span>
                </div>
                <div className="jp-brief__note">{m.wantReason}</div>
              </button>
            ))}
          </div>

          <section className="jp-broad__standing">
            <div>
              <div className="jp-broad__standinghed">Where this came from</div>
              <PortalList portals={profile.portals} />
              {degraded.length > 0 ? (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)", marginTop: 12 }}>
                  Today&rsquo;s edition is incomplete: {degraded.length} of {profile.portals.length}{" "}
                  sources did not return a full sweep. The counts above are what was actually
                  retrieved, not an estimate.
                </p>
              ) : null}
            </div>
            <div>
              <div className="jp-broad__standinghed">Still to read</div>
              {pending.length > 0 ? (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>
                  {pending.length} posting{pending.length === 1 ? "" : "s"} crawled but not yet
                  scored. Your model queue backed up around 06:40; these will appear in the next
                  edition.
                </p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  Everything crawled has been read.
                </p>
              )}
              <div className="jp-broad__standinghed" style={{ marginTop: 20 }}>
                Résumé on file
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {profile.resume.name} · v{profile.resume.version} · updated {profile.resume.updated}
              </p>
            </div>
          </section>
        </>
      )}

      {!chatOpen ? (
        <button className="jp-fab" onClick={() => setChatOpen(true)}>
          Talk to Jarvis
        </button>
      ) : null}

      {chatOpen ? (
        <div className="jp-slide">
          <div className="jp-slide__head">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{profile.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                This thread stays here — it never shows up in the main drawer.
              </div>
            </div>
            <button className="jp-btn jp-btn--ghost" onClick={() => setChatOpen(false)}>
              Close
            </button>
          </div>
          <div className="jp-slide__body">
            <div className="jp-turn">
              <div className="jp-turn__who">Jarvis</div>
              {selected
                ? `About ${selected.title} at ${selected.company} — the thing I would push on is ${selected.wantReason.toLowerCase()}`
                : "Ask me about anything in today's edition, or tell me the search is drifting and I will re-tune it."}
            </div>
          </div>
          <div className="jp-slide__foot">
            <input
              className="jp-desk__input"
              style={{ width: "100%" }}
              placeholder="Message…"
              readOnly
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
