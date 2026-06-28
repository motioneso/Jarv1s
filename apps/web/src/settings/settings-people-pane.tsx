import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptCandidate,
  listMatchCandidates,
  listPeople,
  refreshIndex,
  rejectCandidate,
  type MatchCandidateDto,
} from "../api/people-client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Badge, Group, Note, PaneHead, Row } from "./settings-ui";

function candidateKindLabel(kind: MatchCandidateDto["candidateKind"]): string {
  switch (kind) {
    case "create_person": return "New person";
    case "link_identity": return "Link identity";
    case "merge_people": return "Merge people";
    case "split_identity": return "Split identity";
  }
}

const DESTRUCTIVE_KINDS: ReadonlySet<MatchCandidateDto["candidateKind"]> = new Set([
  "merge_people",
  "split_identity",
]);

export function SettingsPeoplePane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();

  const candidatesQuery = useQuery({
    queryKey: queryKeys.people.matchCandidates,
    queryFn: listMatchCandidates,
    retry: false,
  });

  const peopleQuery = useQuery({
    queryKey: queryKeys.people.list,
    queryFn: () => listPeople({ limit: 50 }),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptCandidate(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.people.matchCandidates }),
    onError: (error) => toast(readError(error), { tone: "drift" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectCandidate(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.people.matchCandidates }),
    onError: (error) => toast(readError(error), { tone: "drift" }),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshIndex(),
    onSuccess: (data) => toast(`Queued ${data.enqueued} sources for indexing.`),
    onError: (error) => toast(readError(error), { tone: "drift" }),
  });

  const candidates = candidatesQuery.data?.candidates ?? [];
  const pending = candidates.filter((c) => c.status === "pending");
  const people = peopleQuery.data?.people ?? [];

  return (
    <>
      <PaneHead
        title="People & context"
        desc="Everyone Jarvis knows about — people extracted from your emails, calendar, and notes."
      />

      <Group title={`Review matches${pending.length > 0 ? ` (${pending.length})` : ""}`}>
        {pending.length === 0 ? (
          <Row name="Nothing to review" desc="All match candidates are up to date." />
        ) : (
          pending.map((candidate) => (
            <div key={candidate.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
              {DESTRUCTIVE_KINDS.has(candidate.candidateKind) && (
                <Note>
                  This action is irreversible — confirm in chat before accepting.
                </Note>
              )}
              <Row
                name={candidate.suggestedDisplayName ?? "Unnamed"}
                desc={[candidateKindLabel(candidate.candidateKind), candidate.reasonSummary]
                  .filter(Boolean)
                  .join(" — ")}
                control={
                  <span style={{ display: "flex", gap: 8 }}>
                    <Badge tone="neutral">
                      {Math.round(candidate.confidence * 100)}%
                    </Badge>
                    {!DESTRUCTIVE_KINDS.has(candidate.candidateKind) && (
                      <button
                        type="button"
                        className="jds-btn jds-btn--sm jds-btn--pine"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(candidate.id)}
                      >
                        Accept
                      </button>
                    )}
                    <button
                      type="button"
                      className="jds-btn jds-btn--sm jds-btn--ghost"
                      disabled={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate(candidate.id)}
                    >
                      Reject
                    </button>
                  </span>
                }
              />
            </div>
          ))
        )}
      </Group>

      <Group title={`People${people.length > 0 ? ` (${people.length})` : ""}`}>
        {people.length === 0 ? (
          <Row name="No people yet" desc="Jarvis builds this list from your connected data sources." />
        ) : (
          people.map((person) => (
            <Row
              key={person.id}
              name={person.displayName}
              desc={person.relationshipSummary ?? person.contextSummary ?? undefined}
              control={<Badge tone={person.status === "active" ? "pine" : "neutral"}>{person.status}</Badge>}
            />
          ))
        )}
      </Group>

      <Group title="Index">
        <Row
          name="Refresh index"
          desc="Re-scan all connected sources for new contacts. Runs in the background."
          control={
            <button
              type="button"
              className="jds-btn jds-btn--sm jds-btn--ghost"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              {refreshMutation.isPending ? "Queuing…" : "Refresh"}
            </button>
          }
        />
      </Group>
    </>
  );
}
