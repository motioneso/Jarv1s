import { useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@jarv1s/shared";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { updateMyProfile } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { DataExport, Sessions } from "./settings-profile-subviews";
import type { PaneProps } from "./settings-types";
import { Avatar, Badge, Field, Group, PaneHead, Row } from "./settings-ui";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ProfileFields {
  name: string;
  addressed: string;
}

function useProfileAutoSave(initial: ProfileFields) {
  const [fields, setFields] = useState<ProfileFields>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const dirty = useRef(false);
  const clearTimer = useRef<number | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!dirty.current) return;
    setStatus("saving");
    const save = window.setTimeout(() => {
      updateMyProfile({ name: fields.name, addressed: fields.addressed })
        .then((data: MeResponse) => {
          queryClient.setQueryData(queryKeys.auth.me, data);
          setStatus("saved");
          if (clearTimer.current) window.clearTimeout(clearTimer.current);
          clearTimer.current = window.setTimeout(() => setStatus("idle"), 1600);
        })
        .catch(() => {
          setStatus("error");
          if (clearTimer.current) window.clearTimeout(clearTimer.current);
          clearTimer.current = window.setTimeout(() => setStatus("idle"), 3000);
        });
    }, 600);
    return () => window.clearTimeout(save);
  }, [fields, queryClient]);

  useEffect(
    () => () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    },
    []
  );

  const set = (patch: Partial<ProfileFields>) => {
    dirty.current = true;
    setFields((f) => ({ ...f, ...patch }));
  };
  return { fields, set, status };
}

function SaveStatusChip({ status }: { readonly status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <span className="psona-save__state" style={{ fontSize: 12, color: "var(--color-error)" }}>
        Save failed
      </span>
    );
  }
  return (
    <span className="psona-save__state" style={{ fontSize: 12 }}>
      {status === "saving" ? (
        <>
          <LoaderCircle size={13} className="dexp__spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        <>
          <Check size={13} aria-hidden="true" />
          Saved
        </>
      )}
    </span>
  );
}

export function ProfilePane({ me }: PaneProps) {
  const user = me.user;
  const role = user.isBootstrapOwner ? "Owner" : user.isInstanceAdmin ? "Admin" : "Member";
  const firstName = (user.name ?? "").split(/\s+/)[0] ?? "";
  const { fields, set, status } = useProfileAutoSave({
    name: user.name ?? "",
    addressed: me.profilePrefs.addressed ?? firstName
  });

  return (
    <>
      <PaneHead
        title="Profile & account"
        desc="Who you are to Jarvis — your identity and account status. How Jarvis sounds and behaves lives in Assistant & AI."
      />
      <Group title="Identity" action={<SaveStatusChip status={status} />}>
        <div className="prof">
          <Avatar name={fields.name || user.email} size="lg" />
          <div className="prof__main">
            <div className="prof__name">{fields.name || "Unnamed"}</div>
            <div className="prof__email">{user.email}</div>
          </div>
          <div className="prof__badges">
            <Badge tone="pine" dot>
              {user.status === "active" ? "Active" : user.status}
            </Badge>
            <Badge tone="neutral">{role}</Badge>
          </div>
        </div>
        <Field label="Display name" hint="Changes save automatically.">
          <input
            className="jds-input"
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
            aria-label="Display name"
          />
        </Field>
        <Field label="How Jarvis addresses you" hint="Used in the briefing and throughout the day.">
          <input
            className="jds-input"
            value={fields.addressed}
            onChange={(e) => set({ addressed: e.target.value })}
            aria-label="How Jarvis addresses you"
          />
        </Field>
      </Group>

      <Group title="Account">
        <Row
          name="Email"
          desc={user.email}
          control={
            <Badge tone="pine" dot>
              Verified
            </Badge>
          }
        />
        <Row
          name="Role"
          desc={
            role === "Owner"
              ? "Owner — full access to admin & setup."
              : role === "Admin"
                ? "Admin — instance administration."
                : "Member of this instance."
          }
          control={<Badge tone="neutral">{role}</Badge>}
        />
        <Row name="Security" desc="Password and two-factor authentication." coming />
      </Group>

      <Sessions />

      <DataExport />

      <Group title="Danger zone">
        <Row
          name="Delete account"
          desc="Permanently remove your account and personal data."
          coming
        />
      </Group>
    </>
  );
}
