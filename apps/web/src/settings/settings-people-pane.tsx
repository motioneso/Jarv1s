import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus, RefreshCw, Save, X } from "lucide-react";

import {
  acceptCandidate,
  archivePerson,
  createPerson,
  getPeopleNotesSettings,
  listMatchCandidates,
  listPeople,
  putPeopleNotesSettings,
  refreshPeopleNotes,
  rejectCandidate,
  updatePerson,
  type MatchCandidateDto
} from "../api/people-client";
import { listSourceBehaviors, putSourceBehavior } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import {
  PEOPLE_NOTES_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled,
  writeSourceBehaviorCache
} from "./settings-source-behaviors";
import { readError } from "./settings-types";
import { Badge, Group, Note, PaneHead, Row, Switch } from "./settings-ui";
import { VaultChooser } from "./settings-vault-chooser";

function candidateKindLabel(kind: MatchCandidateDto["candidateKind"]): string {
  switch (kind) {
    case "create_person":
      return "New person";
    case "link_identity":
      return "Link identity";
    case "merge_people":
      return "Merge people";
    case "split_identity":
      return "Split identity";
  }
}

const DESTRUCTIVE_KINDS: ReadonlySet<MatchCandidateDto["candidateKind"]> = new Set([
  "merge_people",
  "split_identity"
]);

export function SettingsPeoplePane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [folderDraft, setFolderDraft] = useState("");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [refreshResult, setRefreshResult] = useState<Awaited<
    ReturnType<typeof refreshPeopleNotes>
  > | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const candidatesQuery = useQuery({
    queryKey: queryKeys.people.matchCandidates,
    queryFn: listMatchCandidates,
    retry: false
  });

  const peopleQuery = useQuery({
    queryKey: queryKeys.people.list,
    queryFn: () => listPeople({ limit: 50 }),
    retry: false
  });

  const notesSettingsQuery = useQuery({
    queryKey: queryKeys.people.notesSettings,
    queryFn: getPeopleNotesSettings,
    retry: false
  });

  const sourceBehaviorsQuery = useQuery({
    queryKey: queryKeys.settings.sourceBehaviors,
    queryFn: listSourceBehaviors,
    retry: false
  });

  const sourceBehaviorMutation = useMutation({
    mutationFn: (input: { readonly id: string; readonly enabled: boolean }) =>
      putSourceBehavior(input.id, { enabled: input.enabled }),
    onSuccess: (data) => writeSourceBehaviorCache(queryClient, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptCandidate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.people.matchCandidates }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectCandidate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.people.matchCandidates }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const saveFolderMutation = useMutation({
    mutationFn: (folder: string | null = folderDraft.trim() || null) =>
      putPeopleNotesSettings({ folder }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.people.notesSettings, data);
      toast(data.folder ? `People folder set to ${data.folder}.` : "People folder cleared.");
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshPeopleNotes(),
    onSuccess: (data) => {
      setRefreshResult(data);
      queryClient.invalidateQueries({ queryKey: queryKeys.people.list });
      queryClient.invalidateQueries({ queryKey: queryKeys.people.matchCandidates });
      toast(`Projected ${data.projected}; ${data.candidates} review candidates.`);
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createPerson({
        displayName: createName.trim(),
        emails: createEmail.trim() ? [createEmail.trim()] : undefined
      }),
    onSuccess: () => {
      setCreateName("");
      setCreateEmail("");
      queryClient.invalidateQueries({ queryKey: queryKeys.people.list });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; displayName: string }) =>
      updatePerson(input.id, { displayName: input.displayName }),
    onSuccess: () => {
      setEditingId(null);
      setEditingName("");
      queryClient.invalidateQueries({ queryKey: queryKeys.people.list });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archivePerson(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.people.list }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const candidates = candidatesQuery.data?.candidates ?? [];
  const pending = candidates.filter((c) => c.status === "pending");
  const people = peopleQuery.data?.people ?? [];
  const configuredFolder = notesSettingsQuery.data?.folder ?? null;
  const folderValue = folderDraft || configuredFolder || "";

  if (choosingFolder) {
    return (
      <VaultChooser
        mode="people"
        current={folderValue}
        onCancel={() => setChoosingFolder(false)}
        onChoose={(folder) => {
          setFolderDraft(folder);
          setChoosingFolder(false);
          saveFolderMutation.mutate(folder);
        }}
      />
    );
  }

  return (
    <>
      <PaneHead
        title="People & context"
        desc="Everyone Jarvis knows about — people extracted from your emails, calendar, and notes."
      />

      <Group title="People notes">
        <Row
          name="Folder"
          desc={
            configuredFolder ? `Vault folder: ${configuredFolder}` : "No People folder configured."
          }
          control={
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span>{folderValue || "No folder selected"}</span>
              <button
                type="button"
                className="jds-btn jds-btn--sm jds-btn--ghost"
                onClick={() => setChoosingFolder(true)}
              >
                Choose folder
              </button>
            </span>
          }
        />
        {refreshResult ? (
          <Note>
            Discovered {refreshResult.discovered}; projected {refreshResult.projected}; ignored{" "}
            {refreshResult.ignored}; candidates {refreshResult.candidates}.
            {refreshResult.discovered === 0
              ? " Choose a folder with People notes or add a person manually."
              : null}
            {refreshResult.ignored > 0
              ? " Ignored files need valid People-note frontmatter."
              : null}
            {refreshResult.candidates > 0 ? (
              <button
                type="button"
                className="jds-btn jds-btn--quiet jds-btn--sm"
                onClick={() => reviewRef.current?.focus()}
              >
                Review matches
              </button>
            ) : null}
          </Note>
        ) : null}
        <Row
          name="Refresh from notes"
          desc="Scan the configured folder and update projected People records."
          control={
            <button
              type="button"
              className="jds-btn jds-btn--sm jds-btn--ghost"
              disabled={refreshMutation.isPending || !configuredFolder}
              onClick={() => refreshMutation.mutate()}
              title="Refresh"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          }
        />
        {PEOPLE_NOTES_SOURCE_BEHAVIORS.map((behavior) => (
          <Row
            key={behavior.id}
            name={behavior.label}
            desc={behavior.description}
            control={
              <Switch
                ariaLabel={behavior.label}
                checked={findSourceBehaviorEnabled(
                  sourceBehaviorsQuery.data?.sources ?? [],
                  behavior.id
                )}
                disabled={sourceBehaviorMutation.isPending}
                onChange={(enabled) => sourceBehaviorMutation.mutate({ id: behavior.id, enabled })}
              />
            }
          />
        ))}
      </Group>

      <div ref={reviewRef} tabIndex={-1}>
        <Group title={`Review matches${pending.length > 0 ? ` (${pending.length})` : ""}`}>
          {pending.length === 0 ? (
            <Row name="Nothing to review" desc="All match candidates are up to date." />
          ) : (
            pending.map((candidate) => (
              <div key={candidate.id} style={{ borderBottom: "1px solid var(--border)" }}>
                {DESTRUCTIVE_KINDS.has(candidate.candidateKind) && (
                  <Note>This action is irreversible — confirm in chat before accepting.</Note>
                )}
                <Row
                  name={candidate.suggestedDisplayName ?? "Unnamed"}
                  desc={[candidateKindLabel(candidate.candidateKind), candidate.reasonSummary]
                    .filter(Boolean)
                    .join(" — ")}
                  control={
                    <span style={{ display: "flex", gap: 8 }}>
                      <Badge tone="neutral">{Math.round(candidate.confidence * 100)}%</Badge>
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
      </div>

      <Group title="Add a person manually">
        <Row
          name="Add a person manually"
          desc="Creates a canonical note in the configured folder."
          control={
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="jds-input"
                value={createName}
                placeholder="Name"
                aria-label="Person name"
                onChange={(event) => setCreateName(event.target.value)}
                style={{ width: 160 }}
              />
              <input
                className="jds-input"
                value={createEmail}
                placeholder="Email"
                aria-label="Person email"
                onChange={(event) => setCreateEmail(event.target.value)}
                style={{ width: 180 }}
              />
              <button
                type="button"
                className="jds-btn jds-btn--sm jds-btn--pine"
                disabled={createMutation.isPending || !configuredFolder || !createName.trim()}
                onClick={() => createMutation.mutate()}
                title="Create person"
              >
                <Plus size={15} aria-hidden="true" />
              </button>
            </span>
          }
        />
      </Group>

      <Group title={`People${people.length > 0 ? ` (${people.length})` : ""}`}>
        {people.length === 0 ? (
          <Row
            name="No people yet"
            desc="Jarvis builds this list from your connected data sources."
          />
        ) : (
          people.map((person) => (
            <Row
              key={person.id}
              name={
                editingId === person.id ? (
                  <input
                    className="jds-input"
                    value={editingName}
                    aria-label="Display name"
                    onChange={(event) => setEditingName(event.target.value)}
                    style={{ width: 220 }}
                  />
                ) : (
                  person.displayName
                )
              }
              desc={person.relationshipSummary ?? person.contextSummary ?? undefined}
              control={
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone={person.status === "active" ? "pine" : "neutral"}>
                    {person.status}
                  </Badge>
                  {editingId === person.id ? (
                    <>
                      <button
                        type="button"
                        className="jds-btn jds-btn--sm jds-btn--pine"
                        disabled={updateMutation.isPending || !editingName.trim()}
                        onClick={() =>
                          updateMutation.mutate({ id: person.id, displayName: editingName.trim() })
                        }
                        title="Save name"
                      >
                        <Save size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="jds-btn jds-btn--sm jds-btn--ghost"
                        onClick={() => setEditingId(null)}
                        title="Cancel"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="jds-btn jds-btn--sm jds-btn--ghost"
                        disabled={!configuredFolder}
                        onClick={() => {
                          setEditingId(person.id);
                          setEditingName(person.displayName);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="jds-btn jds-btn--sm jds-btn--ghost"
                        disabled={archiveMutation.isPending || !configuredFolder}
                        onClick={() => archiveMutation.mutate(person.id)}
                        title="Archive"
                      >
                        <Archive size={15} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </span>
              }
            />
          ))
        )}
      </Group>
    </>
  );
}
