/*
 * PROTOTYPE — THROWAWAY. Variant A: "Desk".
 *
 * Posture: conversation-first. The chat is not a drawer bolted onto a dashboard — it IS the
 * page. Profiles are chips across the top; matches live in a right-hand rail you glance at
 * while you talk. Bet being tested: if the coaching conversation is the product, the UI
 * should look like a conversation and let the list be secondary.
 */

import { useState } from "react";
import { FAKE_CONVERSATION, FAKE_PROFILES, profileById, type FakeMatch } from "./fake-data";
import { Axes, PortalList } from "./parts";

export function VariantDesk() {
  const [profileId, setProfileId] = useState("swe");
  const [openMatch, setOpenMatch] = useState<string | null>("m2");
  const profile = profileById(profileId);
  const scored = profile.matches.filter((m) => !m.unscored);
  const pending = profile.matches.filter((m) => m.unscored);
  // The posting the thread is talking about — the one outside the user's stated frame.
  const highlight = scored.find((m) => m.outsideFrame) ?? scored[0];

  return (
    <div className="jp-desk">
      <div className="jp-desk__main">
        <div className="jp-desk__head">
          <div className="jp-desk__profiles">
            {FAKE_PROFILES.map((p) => (
              <button
                key={p.id}
                className={`jp-desk__chip${p.id === profileId ? " is-active" : ""}`}
                onClick={() => {
                  setProfileId(p.id);
                  setOpenMatch(null);
                }}
              >
                {p.name}
                {p.newCount > 0 ? <span className="jp-desk__badge">{p.newCount}</span> : null}
              </button>
            ))}
            <button className="jp-desk__chip">+ New search</button>
          </div>
        </div>

        <div className="jp-desk__thread">
          {profile.state === "in_conversation" ? (
            <>
              {FAKE_CONVERSATION.map((t, i) => (
                <div key={i} className={`jp-turn${t.role === "you" ? " jp-turn--you" : ""}`}>
                  {t.role === "jarvis" ? <div className="jp-turn__who">Jarvis</div> : null}
                  {t.text}
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="jp-turn">
                <div className="jp-turn__who">Jarvis</div>
                Four new postings since last night. One of them I want to point at specifically —
                Halden is not what you asked me to look for, and I think that is the point.
              </div>

              {/* Rendered from the match record, not from model prose. */}
              {highlight ? (
                <div className="jp-inlinecard">
                  <div className="jp-inlinecard__eyebrow">Match · outside your stated frame</div>
                  <div className="jp-matchcard__title">{highlight.title}</div>
                  <div className="jp-matchcard__co">
                    {highlight.company} · {highlight.location}
                  </div>
                  <Axes match={highlight} />
                </div>
              ) : null}

              <div className="jp-turn">
                Fit is only 74 because your hands-on ML is thin. Want is 94 because it is the job
                you described when I asked what you would keep. That gap is worth a conversation
                before you decide whether the ML gap matters.
              </div>

              <div className="jp-turn jp-turn--you">What would I need to close the fit gap?</div>

              {/* Degraded state stated plainly in the thread, with the cause, not just a red dot. */}
              <div className="jp-inlinecard">
                <div className="jp-inlinecard__eyebrow">Heads up</div>
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                  LinkedIn cut me off at page 8 with a 429 this morning, so today&rsquo;s LinkedIn
                  numbers are partial — 112 of about 190 postings. Indeed and freehire ran clean. I
                  will retry LinkedIn in four hours and tell you if anything new turns up.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="jp-desk__composer">
          <input
            className="jp-desk__input"
            placeholder={`Talk to Jarvis about ${profile.name}…`}
            readOnly
          />
          <button className="jp-btn jp-btn--primary">Send</button>
        </div>
      </div>

      <aside className="jp-desk__rail">
        <div className="jp-rail__title">{profile.name}</div>
        <div className="jp-rail__sub">
          {profile.state === "in_conversation"
            ? "Still figuring out what to look for"
            : `${profile.newCount} new · ${profile.totalCount} total · crawled ${profile.lastCrawl}`}
        </div>

        {profile.state === "in_conversation" ? (
          <div className="jp-empty">
            Nothing to crawl yet.
            <br />
            Jarvis is still working out what this search is for.
          </div>
        ) : (
          <>
            {scored.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                open={openMatch === m.id}
                onClick={() => setOpenMatch(openMatch === m.id ? null : m.id)}
              />
            ))}

            {pending.length > 0 ? (
              <div className="jp-matchcard" style={{ cursor: "default" }}>
                <span className="jp-tag jp-tag--pending">{pending.length} waiting to be read</span>
                <div className="jp-matchcard__why" style={{ borderTop: 0, paddingTop: 8 }}>
                  Crawled and saved. Your model has been slow this morning, so these are queued for
                  scoring — nothing is lost.
                </div>
              </div>
            ) : null}

            <div className="jp-rail__title" style={{ marginTop: 24 }}>
              Sources
            </div>
            <PortalList portals={profile.portals} />

            <div className="jp-rail__title" style={{ marginTop: 24 }}>
              Résumé
            </div>
            <div className="jp-rail__sub">
              {profile.resume.name} · v{profile.resume.version} · updated {profile.resume.updated}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function MatchCard({
  match,
  open,
  onClick
}: {
  match: FakeMatch;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`jp-matchcard${open ? " is-open" : ""}`} onClick={onClick}>
      <div className="jp-matchcard__title">{match.title}</div>
      <div className="jp-matchcard__co">
        {match.company} · {match.location}
      </div>
      <Axes match={match} />
      <div className="jp-matchcard__meta">
        {match.state === "new" ? <span className="jp-tag jp-tag--new">New</span> : null}
        {match.outsideFrame ? (
          <span className="jp-tag jp-tag--reach">Outside your frame</span>
        ) : null}
        <span className="jp-tag">{match.source}</span>
        <span className="jp-tag">{match.posted}</span>
      </div>
      {open ? (
        <div className="jp-matchcard__why">
          <p>
            <strong>Fit.</strong> {match.fitReason}
          </p>
          <p>
            <strong>Want.</strong> {match.wantReason}
          </p>
        </div>
      ) : null}
    </button>
  );
}
