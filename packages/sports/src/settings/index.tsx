import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Group, Note, PaneHead } from "@jarv1s/settings-ui";
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

function CompetitionGroup(props: {
  competition: CompetitionRef & { teams: readonly TeamRef[] };
  followsByKey: Map<string, SportsFollowDto>;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) {
  const { competition, followsByKey, onToggle, pending } = props;
  const wholeActive = followsByKey.has(followKey(competition.competitionKey, null));
  return (
    <Group
      title={
        <span className="sp-pickhead">
          {competition.label}
          {competition.marquee ? <Badge tone="pine">Marquee</Badge> : null}
        </span>
      }
    >
      <button
        type="button"
        className={`sp-whole${wholeActive ? " is-active" : ""}`}
        disabled={pending}
        onClick={() => onToggle(competition.competitionKey, null)}
      >
        <span className="sp-whole__lbl">Follow all of {competition.label}</span>
        <span className="sp-whole__state">{wholeActive ? "Following" : "Follow"}</span>
      </button>
      <div className="sp-teamgrid">
        {competition.teams.map((team) => {
          const active = followsByKey.has(followKey(competition.competitionKey, team.teamKey));
          return (
            <button
              key={team.teamKey}
              type="button"
              className={`sp-team${active ? " is-active" : ""}`}
              disabled={pending}
              onClick={() => onToggle(competition.competitionKey, team.teamKey)}
            >
              <PickCrest name={team.name} shortName={team.shortName} crestUrl={team.crestUrl} />
              <span className="sp-team__name">{team.shortName || team.name}</span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

export default function SportsSettings() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: CATALOG_KEY, queryFn: getCatalog });
  const followsQuery = useQuery({ queryKey: FOLLOWS_KEY, queryFn: getFollows });

  const invalidateFollows = () => void queryClient.invalidateQueries({ queryKey: FOLLOWS_KEY });
  const followMutation = useMutation({ mutationFn: createFollow, onSuccess: invalidateFollows });
  const unfollowMutation = useMutation({ mutationFn: deleteFollow, onSuccess: invalidateFollows });

  const followsByKey = new Map(
    (followsQuery.data?.follows ?? []).map((follow) => [
      followKey(follow.competitionKey, follow.teamKey),
      follow
    ])
  );
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
      {(catalogQuery.data?.competitions ?? []).map((competition) => (
        <CompetitionGroup
          key={competition.competitionKey}
          competition={competition}
          followsByKey={followsByKey}
          onToggle={toggle}
          pending={pending}
        />
      ))}
      {error ? <Note>Could not load or save sports follows. Try again.</Note> : null}
    </>
  );
}
