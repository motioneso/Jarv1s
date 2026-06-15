import { Avatar, Badge, Field, Group, PaneHead, Row } from "./settings-ui";
import type { PaneProps } from "./settings-types";

export function ProfilePane({ me }: PaneProps) {
  const user = me.user;
  const role = user.isBootstrapOwner ? "Owner" : user.isInstanceAdmin ? "Admin" : "Member";
  const firstName = (user.name ?? "").split(/\s+/)[0] ?? "";
  return (
    <>
      <PaneHead
        title="Profile & account"
        desc="Who you are to Jarvis - your identity and account status. How Jarvis sounds and behaves lives in Assistant & AI."
      />
      <Group title="Identity">
        <div className="prof">
          <Avatar name={user.name || user.email} size="lg" />
          <div className="prof__main">
            <div className="prof__name">{user.name || "Unnamed"}</div>
            <div className="prof__email">{user.email}</div>
          </div>
          <div className="prof__badges">
            <Badge tone="pine" dot>
              {user.status === "active" ? "Active" : user.status}
            </Badge>
            <Badge tone="neutral">{role}</Badge>
          </div>
        </div>
        <Field label="Display name">
          <input className="jds-input" defaultValue={user.name} aria-label="Display name" />
        </Field>
        <Field label="How Jarvis addresses you" hint="Used in the briefing and throughout the day.">
          <input
            className="jds-input"
            defaultValue={firstName}
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
              ? "Owner - full access to admin & setup."
              : role === "Admin"
                ? "Admin - instance administration."
                : "Member of this instance."
          }
          control={<Badge tone="neutral">{role}</Badge>}
        />
        <Row name="Active sessions" desc="Devices currently signed in to your account." coming />
        <Row name="Export my data" desc="Download everything Jarvis holds about you." coming />
        <Row name="Security" desc="Password and two-factor authentication." coming />
      </Group>

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
