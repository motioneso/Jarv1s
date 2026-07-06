import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Note, PaneHead } from "@jarv1s/settings-ui";
import type {
  CompetitionRef,
  CreateSportsFollowRequest,
  SportsCatalogResponse,
  SportsFollowDto,
  SportsFollowsResponse,
  TeamRef
} from "@jarv1s/shared";

const CATALOG_KEY = ["sports", "catalog"] as const;
const FOLLOWS_KEY = ["sports", "follows"] as const;

type CompetitionWithTeams = CompetitionRef & { readonly teams: readonly TeamRef[] };

async function requestJson<T>(path: string, init?: RequestInit & { body?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "include",
    headers
  });
  if (!response.ok) throw new Error(response.statusText || "Request failed");
  return (await response.json()) as T;
}

function getCatalog() {
  return requestJson<SportsCatalogResponse>("/api/sports/catalog");
}
function getFollows() {
  return requestJson<SportsFollowsResponse>("/api/sports/follows");
}
function createFollow(body: CreateSportsFollowRequest) {
  return requestJson<{ follow: SportsFollowDto }>("/api/sports/follows", { method: "POST", body });
}
function deleteFollow(id: string) {
  return requestJson<{ ok: boolean }>(`/api/sports/follows/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

function initials(name: string, shortName?: string | null): string {
  if (shortName && shortName.trim().length > 0) return shortName.slice(0, 3).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? name;
  const last = parts[parts.length - 1] ?? name;
  const letters = parts.length >= 2 ? (first[0] ?? "") + (last[0] ?? "") : name.slice(0, 2);
  return letters.toUpperCase();
}

function PickCrest(props: { name: string; shortName?: string | null; crestUrl?: string | null }) {
  if (props.crestUrl) {
    return (
      <span className="sp-pickcrest">
        <img src={props.crestUrl} alt="" width={22} height={22} />
      </span>
    );
  }
  return <span className="sp-pickcrest">{initials(props.name, props.shortName)}</span>;
}

// composite key: teamKey null (whole league) -> "" sentinel
function followKey(competitionKey: string, teamKey: string | null): string {
  return `${competitionKey}::${teamKey ?? ""}`;
}

/* ----- Sports-local, pure search helpers (unit-tested). No generic picker
   abstraction — scoped to this catalog shape on purpose. ----- */

/** Flat team matches for a non-empty query. Empty query returns []. */
export function filterTeams(
  query: string,
  competitions: readonly CompetitionWithTeams[]
): readonly { competition: CompetitionWithTeams; team: TeamRef }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { competition: CompetitionWithTeams; team: TeamRef }[] = [];
  for (const competition of competitions) {
    for (const team of competition.teams) {
      const hay = `${team.name} ${team.shortName} ${competition.label}`.toLowerCase();
      if (hay.includes(q)) out.push({ competition, team });
    }
  }
  return out;
}

/** Competitions whose label matches a non-empty query. Empty query returns []. */
export function leagueMatches(
  query: string,
  competitions: readonly CompetitionWithTeams[]
): readonly CompetitionWithTeams[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return competitions.filter((c) => c.label.toLowerCase().includes(q));
}

/** League rows for search results: direct label matches plus the parent league of every
    matching team (so "cowboys" also offers "Follow all of NFL"), deduped by competitionKey. */
export function searchLeagues(
  query: string,
  competitions: readonly CompetitionWithTeams[]
): readonly CompetitionWithTeams[] {
  const byKey = new Map<string, CompetitionWithTeams>();
  for (const competition of leagueMatches(query, competitions)) {
    byKey.set(competition.competitionKey, competition);
  }
  for (const { competition } of filterTeams(query, competitions)) {
    byKey.set(competition.competitionKey, competition);
  }
  return [...byKey.values()];
}

function FollowedSummary(props: {
  follows: readonly SportsFollowDto[];
  competitionsByKey: Map<string, CompetitionWithTeams>;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) {
  if (props.follows.length === 0) return null;
  return (
    <div className="sp-summary" role="list" aria-label="Followed teams and leagues">
      {props.follows.map((follow) => {
        const competition = props.competitionsByKey.get(follow.competitionKey);
        // A competitionKey with no catalog entry (e.g. a retired/renamed league) would
        // otherwise render as a raw, unhumanized key — call it out instead (#765 M3). Still
        // removable via the same button below.
        const orphan = competition === undefined;
        const wholeLeague = follow.teamKey === null;
        const team = wholeLeague
          ? null
          : competition?.teams.find((t) => t.teamKey === follow.teamKey);
        const label = orphan
          ? `Unrecognized league (${follow.competitionKey})`
          : wholeLeague
            ? `All ${competition?.label ?? follow.competitionKey}`
            : ((team?.shortName || team?.name || follow.teamKey) ?? "");
        const name = orphan
          ? label
          : wholeLeague
            ? (competition?.label ?? follow.competitionKey)
            : (team?.name ?? follow.teamKey ?? "");
        return (
          <span key={follow.id} className="sp-chip" role="listitem">
            <PickCrest
              name={name}
              shortName={wholeLeague ? null : team?.shortName}
              crestUrl={wholeLeague ? null : team?.crestUrl}
            />
            <span className="sp-chip__lbl">{label}</span>
            <button
              type="button"
              className="sp-chip__remove"
              aria-label={`Unfollow ${label}`}
              disabled={props.pending}
              onClick={() => props.onToggle(follow.competitionKey, follow.teamKey)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function SearchResults(props: {
  query: string;
  competitions: readonly CompetitionWithTeams[];
  followsByKey: Map<string, SportsFollowDto>;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) {
  const teams = filterTeams(props.query, props.competitions);
  const leagues = searchLeagues(props.query, props.competitions);
  if (teams.length === 0 && leagues.length === 0) {
    return <Note>No teams or leagues match your search.</Note>;
  }
  return (
    <>
      {leagues.map((competition) => {
        const wholeActive = props.followsByKey.has(followKey(competition.competitionKey, null));
        return (
          <button
            key={`l-${competition.competitionKey}`}
            type="button"
            className={`sp-whole${wholeActive ? " is-active" : ""}`}
            disabled={props.pending}
            onClick={() => props.onToggle(competition.competitionKey, null)}
          >
            <span className="sp-whole__lbl">Follow all of {competition.label}</span>
            <span className="sp-whole__state">{wholeActive ? "Following" : "Follow"}</span>
          </button>
        );
      })}
      <div className="sp-teamgrid">
        {teams.map(({ competition, team }) => {
          const active = props.followsByKey.has(
            followKey(competition.competitionKey, team.teamKey)
          );
          return (
            <button
              key={`${competition.competitionKey}:${team.teamKey}`}
              type="button"
              className={`sp-team${active ? " is-active" : ""}`}
              disabled={props.pending}
              onClick={() => props.onToggle(competition.competitionKey, team.teamKey)}
            >
              <PickCrest name={team.name} shortName={team.shortName} crestUrl={team.crestUrl} />
              <span className="sp-team__name">{team.shortName || team.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function SportsSettings() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: CATALOG_KEY, queryFn: getCatalog });
  const followsQuery = useQuery({ queryKey: FOLLOWS_KEY, queryFn: getFollows });

  const invalidateFollows = () => void queryClient.invalidateQueries({ queryKey: FOLLOWS_KEY });
  const followMutation = useMutation({ mutationFn: createFollow, onSuccess: invalidateFollows });
  const unfollowMutation = useMutation({ mutationFn: deleteFollow, onSuccess: invalidateFollows });

  const competitions = catalogQuery.data?.competitions ?? [];
  const follows = followsQuery.data?.follows ?? [];
  const followsByKey = new Map(
    follows.map((follow) => [followKey(follow.competitionKey, follow.teamKey), follow])
  );
  const competitionsByKey = new Map(competitions.map((c) => [c.competitionKey, c]));
  const pending =
    catalogQuery.isLoading ||
    followsQuery.isLoading ||
    followMutation.isPending ||
    unfollowMutation.isPending;
  const error =
    catalogQuery.isError ||
    followsQuery.isError ||
    followMutation.isError ||
    unfollowMutation.isError;
  // Partial failure (some competitions' teams didn't load) vs. total query failure — the
  // catalog still renders with what succeeded, so this needs its own quiet notice + retry
  // rather than the blanket error message above (#765 M1).
  const catalogDegraded = catalogQuery.data?.degraded === true;

  const [search, setSearch] = useState("");
  const query = search.trim();

  function toggle(competitionKey: string, teamKey: string | null) {
    const existing = followsByKey.get(followKey(competitionKey, teamKey));
    if (existing) unfollowMutation.mutate(existing.id);
    else followMutation.mutate({ competitionKey, teamKey });
  }

  return (
    <>
      <PaneHead
        title="Sports"
        desc="Follow competitions or teams to see them on your Sports page and in briefings."
      />
      <FollowedSummary
        follows={follows}
        competitionsByKey={competitionsByKey}
        onToggle={toggle}
        pending={pending}
      />
      <div className="sp-search">
        <input
          type="search"
          className="sp-search__input"
          aria-label="Find a team or league"
          placeholder="Find a team or league…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {query ? (
        <SearchResults
          query={query}
          competitions={competitions}
          followsByKey={followsByKey}
          onToggle={toggle}
          pending={pending}
        />
      ) : (
        <Note>Search above to find teams or leagues to follow.</Note>
      )}
      {!error && catalogDegraded ? (
        <Note>
          Some leagues didn&rsquo;t load just now.{" "}
          <button
            type="button"
            className="sp-managebtn"
            onClick={() => void catalogQuery.refetch()}
          >
            Retry
          </button>
        </Note>
      ) : null}
      {error ? <Note>Could not load or save sports follows. Try again.</Note> : null}
    </>
  );
}
