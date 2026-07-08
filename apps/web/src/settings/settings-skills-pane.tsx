import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";

import {
  createChatSkill,
  deleteChatSkill,
  importChatSkill,
  listChatSkills,
  setChatSkillEnabled,
  updateChatSkill
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Badge, Field, Group, Note, PaneHead, Row, Switch } from "./settings-ui";

/* Same compose form serves create and edit: clicking "Edit" loads a skill's
   name/description/body into the fields and the submit switches to an update.
   The update request never includes `frontmatter`, so the repository leaves a
   skill's existing frontmatter untouched (see packages/chat/src/skills/repository.ts). */
export function SettingsSkillsPane() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const skillsQuery = useQuery({
    queryKey: queryKeys.chat.skills,
    queryFn: listChatSkills,
    retry: false
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.chat.skills });

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setBody("");
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), description: description.trim() || null, body };
      return editingId ? updateChatSkill(editingId, input) : createChatSkill(input);
    },
    onSuccess: () => {
      const wasEditing = editingId !== null;
      resetForm();
      void invalidate();
      toast(wasEditing ? "Skill updated" : "Skill created");
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      setChatSkillEnabled(input.id, { enabled: input.enabled }),
    onSuccess: () => void invalidate(),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteChatSkill(id),
    onSuccess: () => {
      void invalidate();
      toast("Skill deleted", { tone: "drift", icon: <Trash2 size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => importChatSkill(file),
    onSuccess: (data) => {
      void invalidate();
      setUploadStatus(`Imported "${data.skill.name}".`);
    },
    onError: (error) => {
      setUploadStatus(null);
      toast(readError(error), { tone: "drift" });
    }
  });

  const skills = skillsQuery.data?.skills ?? [];

  return (
    <>
      <PaneHead
        title="Skills"
        desc="Reusable prompts you can invoke by name in chat, e.g. /daily-standup."
      />

      <Group title={editingId ? "Edit skill" : "Create skill"}>
        <Field label="Skill name">
          <input
            className="jds-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily standup"
            aria-label="Skill name"
          />
        </Field>
        <Field label="Description" hint="Shown in the skill list. Optional.">
          <input
            className="jds-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Summarize yesterday and today"
            aria-label="Skill description"
          />
        </Field>
        <Field label="Body" hint="Prepended to your message when this skill is invoked.">
          <textarea
            className="jds-textarea"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Skill body"
            placeholder="Ask for yesterday, today, and blockers."
          />
        </Field>
        <Field label="Save">
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="jds-btn jds-btn--pine jds-btn--sm"
              disabled={saveMutation.isPending || !name.trim() || !body.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {editingId ? "Save changes" : "Create skill"}
            </button>
            {editingId ? (
              <button
                type="button"
                className="jds-btn jds-btn--quiet jds-btn--sm"
                onClick={resetForm}
              >
                Cancel
              </button>
            ) : null}
          </span>
        </Field>
        <Row
          name="Upload a skill file"
          desc="Markdown with frontmatter — name, description, and a body."
          control={
            <label>
              <input
                type="file"
                accept=".md,text/markdown"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) uploadMutation.mutate(file);
                }}
              />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                <Upload size={13} aria-hidden="true" />
              </span>
            </label>
          }
        />
        {uploadStatus ? <Note>{uploadStatus}</Note> : null}
      </Group>

      <Group title={`Skills${skills.length > 0 ? ` (${skills.length})` : ""}`}>
        {skills.length === 0 ? (
          <Row name="No skills yet" desc="Create one above, or upload a skill file." />
        ) : (
          skills.map((skill) => (
            <Row
              key={skill.id}
              name={skill.name}
              desc={skill.description ?? undefined}
              control={
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone={skill.enabled ? "pine" : "neutral"}>
                    {skill.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Switch
                    ariaLabel={`Enable ${skill.name}`}
                    checked={skill.enabled}
                    disabled={toggleMutation.isPending}
                    onChange={(enabled) => toggleMutation.mutate({ id: skill.id, enabled })}
                  />
                  <button
                    type="button"
                    className="jds-btn jds-btn--sm jds-btn--ghost"
                    onClick={() => {
                      setEditingId(skill.id);
                      setName(skill.name);
                      setDescription(skill.description ?? "");
                      setBody(skill.body);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="jds-btn jds-btn--sm jds-btn--ghost"
                    disabled={deleteMutation.isPending}
                    onClick={() =>
                      confirm({
                        title: `Delete "${skill.name}"?`,
                        description: "This cannot be undone.",
                        confirmLabel: "Delete",
                        danger: true,
                        onConfirm: () => deleteMutation.mutate(skill.id)
                      })
                    }
                    title="Delete"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </span>
              }
            />
          ))
        )}
      </Group>
    </>
  );
}
