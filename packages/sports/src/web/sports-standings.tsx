import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StandingsGroup, StandingsRow, StandingsSection } from "@jarv1s/shared";

import { SPORTS_CATALOG } from "../source/catalog.js";
import { getStandingsByLeague } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { isFollowed } from "./sports-news.js";
import { TrophyIcon } from "./sports-parts.js";

export function StandingsRail(props: {
  groups: readonly StandingsGroup[];
  followedPairs: ReadonlySet<string>;
}) {
  const byKey = useMemo(
    () => new Map(props.groups.map((g) => [g.competitionKey, g])),
    [props.groups]
  );
  const firstKey = props.groups[0]?.competitionKey ?? SPORTS_CATALOG[0]?.competitionKey ?? "";
  const [selectedKey, setSelectedKey] = useState(firstKey);
  const [sectionIndex, setSectionIndex] = useState(0);

  // The overview payload only carries standings for followed leagues; selecting a league
  // outside that set lazily fetches it via the dedicated standings route (#842).
  const lazy = useQuery({
    queryKey: sportsQueryKeys.standings(selectedKey),
    queryFn: () => getStandingsByLeague(selectedKey),
    enabled: !byKey.has(selectedKey)
  });

  const group = byKey.get(selectedKey) ?? lazy.data ?? null;
  const sections = group?.sections ?? [];
  const safeIndex = Math.min(sectionIndex, Math.max(0, sections.length - 1));
  const section = sections[safeIndex] ?? null;
  const hasPages = sections.length > 1;
  const label = section?.label ?? group?.competitionLabel ?? "";

  function selectLeague(competitionKey: string) {
    setSelectedKey(competitionKey);
    setSectionIndex(0);
  }
  const showPrev = () => setSectionIndex((index) => Math.max(0, index - 1));
  const showNext = () =>
    setSectionIndex((index) => Math.min(Math.max(0, sections.length - 1), index + 1));

  // ESPN can send a note with no description (advancement flagged, nothing to label) — such
  // rows still get the qualifying-row marker in the table but are omitted from the legend, which
  // only explains notes that actually have text (#841).
  const legendNotes = section
    ? Array.from(
        new Map(
          section.rows
            .filter((row) => row.qualificationNote)
            .map((row) => [row.qualificationNote as string, row])
        ).values()
      )
    : [];

  return (
    <section className="sp-standings" aria-label="Standings">
      <div className="sp-standings__hd">
        <span className="sp-standings__title">
          <TrophyIcon />
          Standings
        </span>
        <span className="sp-standings__nav">
          <select
            className="sp-standings__select"
            aria-label="Select standings league"
            value={selectedKey}
            onChange={(event) => selectLeague(event.currentTarget.value)}
          >
            {SPORTS_CATALOG.map((entry) => (
              <option key={entry.competitionKey} value={entry.competitionKey}>
                {entry.label}
              </option>
            ))}
          </select>
          {hasPages ? (
            <>
              <button
                type="button"
                className="sp-iconbtn"
                onClick={showPrev}
                disabled={safeIndex === 0}
                aria-label="Previous standings"
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <span className="sp-standings__count">
                {safeIndex + 1}/{sections.length}
              </span>
              <button
                type="button"
                className="sp-iconbtn"
                onClick={showNext}
                disabled={safeIndex >= sections.length - 1}
                aria-label="Next standings"
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </span>
      </div>
      {group && section ? (
        <StandingsTable
          group={group}
          section={section}
          label={label}
          followedPairs={props.followedPairs}
        />
      ) : (
        <p className="sp-standings__empty">
          {lazy.isLoading ? "Loading standings…" : "No standings available."}
        </p>
      )}
      {legendNotes.length > 0 ? (
        <ul className="sp-legend" aria-label="Qualification key">
          {legendNotes.map((row) => (
            <li className="sp-legend__item" key={row.qualificationNote}>
              <span className="sp-legend__marker" aria-hidden="true" />
              {row.qualificationNote}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StandingsTable(props: {
  group: StandingsGroup;
  section: StandingsSection;
  label: string;
  followedPairs: ReadonlySet<string>;
}) {
  const { group, section, label } = props;
  return (
    <table className="sp-tbl">
      <thead>
        <tr>
          {group.standingsShape !== "record" ? <th className="pos">#</th> : null}
          <th className="tm">{label}</th>
          {group.standingsShape === "record" ? (
            <>
              <th>W-L</th>
              <th>{section.rows.some((r) => r.points !== null) ? "Pts" : "Pct"}</th>
            </>
          ) : (
            <th>Pts</th>
          )}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row) => (
          <tr
            key={row.teamKey}
            className={
              isFollowed(props.followedPairs, group.competitionKey, row.teamKey)
                ? "is-you"
                : undefined
            }
          >
            {group.standingsShape !== "record" ? (
              <td className="pos">
                {row.qualifies ? <span className="sp-tbl__adv" /> : null}
                {row.rank}
              </td>
            ) : null}
            <td className="tm">
              <span className="nm">{row.name}</span>
            </td>
            {group.standingsShape === "record" ? (
              <>
                <td>{recordLine(row)}</td>
                <td>{row.points ?? formatPct(row.winPercent)}</td>
              </>
            ) : (
              <td>{row.points ?? "–"}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function recordLine(row: StandingsRow): string {
  return row.draws !== null && row.draws > 0
    ? `${row.wins}-${row.losses}-${row.draws}`
    : `${row.wins}-${row.losses}`;
}

function formatPct(winPercent: number | null): string {
  return winPercent === null ? "–" : winPercent.toFixed(3).replace(/^0/, "");
}
