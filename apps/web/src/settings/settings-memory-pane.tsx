import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";

import {
  confirmMemoryFact,
  deleteMemoryFact,
  getMemoryFacts,
  getMemorySettings,
  patchMemorySettings,
  rejectMemoryFact,
  type MemoryFact,
  type MemorySettings
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { partitionMemoryFacts } from "./memory-facts-view";
import { getMemoryFactProvenanceLabel, getMemoryFactProvenanceTone } from "./memory-provenance";
import { useFeedback } from "./settings-feedback";
import { readError, type PaneProps } from "./settings-types";
import { Group, PaneHead, Row, Switch } from "./settings-ui";

export function MemoryPane(_props: PaneProps) {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [expanded, setExpanded] = useState(false);
  const [inferredExpanded, setInferredExpanded] = useState(false);

  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings,
    retry: false
  });
  const factsQuery = useQuery({
    queryKey: queryKeys.chat.memoryFacts,
    queryFn: getMemoryFacts,
    retry: false
  });
  const patchMutation = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => patchMemorySettings(patch),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.memorySettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemoryFact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memoryFacts });
      toast("Memory forgotten");
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmMemoryFact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memoryFacts });
      toast("Pattern confirmed");
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectMemoryFact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memoryFacts });
      toast("Pattern rejected");
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const settings = settingsQuery.data;
  const facts: MemoryFact[] = factsQuery.data?.facts ?? [];
  const { remembered: rememberedFacts, inferred: inferredFacts } = partitionMemoryFacts(facts);
  const factCount = rememberedFacts.length;

  function handleForget(fact: MemoryFact) {
    const preview = fact.content.length > 120 ? `${fact.content.slice(0, 120)}…` : fact.content;
    confirm({
      title: "Forget this memory?",
      description: preview,
      confirmLabel: "Forget",
      danger: true,
      onConfirm: () => deleteMutation.mutate(fact.id)
    });
  }

  function handleReject(fact: MemoryFact) {
    const preview = fact.content.length > 120 ? `${fact.content.slice(0, 120)}…` : fact.content;
    confirm({
      title: "Reject this pattern?",
      description: preview,
      confirmLabel: "Reject",
      danger: true,
      onConfirm: () => rejectMutation.mutate(fact.id)
    });
  }

  return (
    <>
      <PaneHead
        title="Memory & context"
        desc="Everything Jarvis remembers, believes and infers - in the open, and yours to correct."
      />

      <Group title="What Jarvis can use">
        <Row
          name="Conversation recall"
          desc="Remember past conversations so you don't have to repeat yourself."
          control={
            <Switch
              ariaLabel="Conversation recall"
              checked={settings?.recallEnabled ?? true}
              onChange={(value) => patchMutation.mutate({ recallEnabled: value })}
            />
          }
        />
        <Row
          name="Learn patterns"
          desc="Notice habits over time and offer them as inferred patterns you can confirm."
          control={
            <Switch
              ariaLabel="Learn patterns"
              checked={settings?.factsEnabled ?? true}
              onChange={(value) => patchMutation.mutate({ factsEnabled: value })}
            />
          }
        />
        <Row
          name="Show provenance"
          desc="Always show where a belief came from - what you said, or what was inferred."
        />
      </Group>

      <Group
        title="What Jarvis knows"
        desc="Confirmed facts stay until you change them. Inferred patterns decay on their own over time."
      >
        <Row
          name="Remembered facts"
          desc="Things you've told Jarvis, or it confirmed with you."
          control={<span className="memory-count">{factCount}</span>}
        />
        <Row
          name="Inferred patterns"
          desc="Guesses from your behaviour, awaiting your yes or no."
          control={
            <button
              type="button"
              className="jds-btn jds-btn--quiet jds-btn--sm"
              onClick={() => setInferredExpanded((v) => !v)}
            >
              {inferredExpanded ? "Hide" : `Review (${inferredFacts.length})`}
            </button>
          }
        />
        {inferredExpanded ? (
          <div className="memory-facts-list">
            {inferredFacts.length === 0 ? (
              <p className="memory-facts-empty">No inferred patterns waiting.</p>
            ) : (
              inferredFacts.map((fact) => (
                <div key={fact.id} className="memory-fact">
                  <span className="memory-fact__category">{fact.category}</span>
                  <span className="memory-fact__content">{fact.content}</span>
                  <span className="memory-fact__actions">
                    <button
                      type="button"
                      className="jds-btn jds-btn--quiet jds-btn--sm"
                      aria-label={`Confirm inferred pattern: ${fact.content}`}
                      onClick={() => confirmMutation.mutate(fact.id)}
                      disabled={confirmMutation.isPending || rejectMutation.isPending}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="jds-btn jds-btn--quiet jds-btn--sm"
                      aria-label={`Reject inferred pattern: ${fact.content}`}
                      onClick={() => handleReject(fact)}
                      disabled={confirmMutation.isPending || rejectMutation.isPending}
                    >
                      <X size={14} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
        <Row
          name="Corrections"
          desc="Times you've put Jarvis right. It learns from every one."
          coming
        />
      </Group>

      <Group title="Forget">
        <Row
          name="Review & delete memories"
          desc="See everything Jarvis holds and remove anything you'd rather it forgot."
          control={
            <button
              type="button"
              className="jds-btn jds-btn--quiet jds-btn--sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : `Review (${factCount})`}
            </button>
          }
        />
        {expanded ? (
          <div className="memory-facts-list">
            {rememberedFacts.length === 0 ? (
              <p className="memory-facts-empty">No remembered facts stored yet.</p>
            ) : (
              rememberedFacts.map((fact) => (
                <div key={fact.id} className="memory-fact">
                  <span className="memory-fact__category">{fact.category}</span>
                  <span
                    className={`memory-fact__provenance ${getMemoryFactProvenanceTone(
                      fact.provenance
                    )}`}
                  >
                    {getMemoryFactProvenanceLabel(fact.provenance)}
                  </span>
                  <span className="memory-fact__content">{fact.content}</span>
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet jds-btn--sm"
                    aria-label={`Forget: ${fact.content}`}
                    onClick={() => handleForget(fact)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
        <Row
          name="Memory retention window"
          desc="Automatically forget low-value details after a set time."
          coming
        />
        <Row
          name="Per-topic memory controls"
          desc="Choose what Jarvis may remember, topic by topic."
          coming
        />
      </Group>
    </>
  );
}
