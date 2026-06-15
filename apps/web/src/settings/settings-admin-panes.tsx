import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus
} from "lucide-react";
import { useState } from "react";

import {
  approveUser,
  deactivateUser,
  deleteAdminUser,
  demoteUser,
  getChatMultiplexerSettings,
  getRegistrationSettings,
  listAdminAuditEvents,
  listAdminConnectorAccounts,
  listAdminModules,
  listAdminUsers,
  listAuthProviderStatuses,
  promoteUser,
  putRegistrationSettings,
  reactivateUser,
  rejectUser,
  setChatMultiplexerSettings,
  setAdminModuleDisabled
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import {
  adminUserActions,
  createAdminUserPolicyContext,
  type AdminUserAction
} from "./settings-admin-policy";
import { useFeedback } from "./settings-feedback";
import { moduleDescription, readError, type PaneProps } from "./settings-types";
import {
  Avatar,
  Badge,
  Group,
  Indicator,
  Locked,
  Note,
  PaneHead,
  Row,
  Segmented,
  Switch
} from "./settings-ui";
import type { ChatMultiplexerChoice, RegistrationSettingsDto, UserDto } from "@jarv1s/shared";

function roleLabel(user: UserDto): string {
  return user.isBootstrapOwner ? "Owner" : user.isInstanceAdmin ? "Admin" : "Member";
}

/* --------------------------------------------------------- People & access */

function PersonRow(props: {
  readonly user: UserDto;
  readonly isCurrent: boolean;
  readonly actions: readonly AdminUserAction[];
  readonly onAction: (action: AdminUserAction, user: UserDto) => void;
}) {
  const { user } = props;
  const [menu, setMenu] = useState(false);
  const off = user.status === "deactivated";
  const act = (action: AdminUserAction) => {
    setMenu(false);
    props.onAction(action, user);
  };
  const canAdmin = props.actions.includes("admin");
  const statusAction = props.actions.find(
    (action) => action === "deactivate" || action === "reactivate"
  );
  const canRemove = props.actions.includes("remove");
  const rowLabel = props.isCurrent ? "You" : props.actions.length === 0 ? "Protected" : null;
  return (
    <div className={`ppl__row${off ? " ppl__row--off" : ""}`}>
      <div className="ppl__id">
        <Avatar name={user.name || user.email} size="sm" />
        <div className="ppl__idmain">
          <div className="ppl__name">
            {user.name || "Unnamed"}
            {rowLabel ? <span className="ppl__you">{rowLabel}</span> : null}
          </div>
          <div className="ppl__email">{user.email}</div>
        </div>
      </div>
      <div className="ppl__role">{roleLabel(user)}</div>
      <div className="ppl__status">
        {off ? (
          <Badge tone="neutral" dot>
            Deactivated
          </Badge>
        ) : (
          <Badge tone="pine" dot>
            Active
          </Badge>
        )}
      </div>
      <div className="ppl__actions">
        {props.actions.length === 0 ? null : (
          <div className="ppl__menu">
            <button
              type="button"
              className="jds-iconbtn jds-iconbtn--sm"
              aria-label={`Actions for ${user.name || user.email}`}
              onClick={() => setMenu((open) => !open)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menu ? (
              <>
                <div className="ppl__menuscrim" onClick={() => setMenu(false)} />
                <div className="ppl__menupop" role="menu">
                  {canAdmin ? (
                    <button className="ppl__menuitem" role="menuitem" onClick={() => act("admin")}>
                      <ShieldCheck size={15} />
                      {user.isInstanceAdmin ? "Revoke admin" : "Make admin"}
                    </button>
                  ) : null}
                  {statusAction ? (
                    <button
                      className="ppl__menuitem"
                      role="menuitem"
                      onClick={() => act(statusAction)}
                    >
                      {off ? <UserCheck size={15} /> : <UserMinus size={15} />}
                      {off ? "Reactivate" : "Deactivate"}
                    </button>
                  ) : null}
                  {canRemove ? (
                    <>
                      <div className="ppl__menusep" />
                      <button
                        className="ppl__menuitem ppl__menuitem--danger"
                        role="menuitem"
                        onClick={() => act("remove")}
                      >
                        <Trash2 size={15} />
                        Remove from instance
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingRow(props: {
  readonly user: UserDto;
  readonly onApprove: () => void;
  readonly onDecline: () => void;
}) {
  return (
    <div className="pend">
      <div className="pend__main">
        <div className="pend__name">{props.user.name || "Unnamed"}</div>
        <div className="pend__sub">
          <span className="em">{props.user.email}</span>
        </div>
      </div>
      <div className="pend__actions">
        <button
          type="button"
          className="jds-btn jds-btn--primary jds-btn--sm"
          onClick={props.onApprove}
        >
          Approve
        </button>
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={props.onDecline}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

interface ActionVars {
  readonly fn: (id: string) => Promise<unknown>;
  readonly id: string;
  readonly message: string;
  readonly tone?: "ready" | "drift";
}

export function PeoplePane({ me }: PaneProps) {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const usersQuery = useQuery({
    queryKey: queryKeys.settings.adminUsers,
    queryFn: listAdminUsers,
    retry: false
  });
  const actionMutation = useMutation({
    mutationFn: (vars: ActionVars) => vars.fn(vars.id),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminUsers });
      toast(vars.message, { tone: vars.tone });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const onAction = (action: AdminUserAction, user: UserDto) => {
    const name = user.name || user.email;
    if (action === "admin") {
      actionMutation.mutate({
        fn: user.isInstanceAdmin ? demoteUser : promoteUser,
        id: user.id,
        message: user.isInstanceAdmin ? `${name} is no longer an admin` : `${name} is now an admin`
      });
    } else if (action === "reactivate") {
      actionMutation.mutate({ fn: reactivateUser, id: user.id, message: `Reactivated ${name}` });
    } else if (action === "deactivate") {
      confirm({
        title: `Deactivate ${name}?`,
        description:
          "They keep their history but are signed out everywhere and lose access until reactivated.",
        confirmLabel: "Deactivate",
        danger: true,
        onConfirm: () =>
          actionMutation.mutate({
            fn: deactivateUser,
            id: user.id,
            message: `${name} deactivated`,
            tone: "drift"
          })
      });
    } else {
      confirm({
        title: `Remove ${name}?`,
        description:
          "This permanently removes their account and access from this instance. It can't be undone.",
        confirmLabel: "Remove",
        danger: true,
        onConfirm: () =>
          actionMutation.mutate({
            fn: deleteAdminUser,
            id: user.id,
            message: `${name} removed from the instance`,
            tone: "drift"
          })
      });
    }
  };

  const users = usersQuery.data?.users ?? [];
  const pending = users.filter((user) => user.status === "pending");
  const members = users.filter((user) => user.status !== "pending");
  const policy = createAdminUserPolicyContext(members);

  return (
    <>
      <PaneHead
        title="People & access"
        desc="Everyone with access to this instance — their role, their status, and what they can reach."
      />
      {pending.length ? (
        <Group title="Pending approval" desc="New sign-ups waiting for you to let them in.">
          {pending.map((user) => (
            <PendingRow
              key={user.id}
              user={user}
              onApprove={() =>
                actionMutation.mutate({
                  fn: approveUser,
                  id: user.id,
                  message: `Approved ${user.name || user.email}`
                })
              }
              onDecline={() =>
                actionMutation.mutate({
                  fn: rejectUser,
                  id: user.id,
                  message: `Declined ${user.name || user.email}`,
                  tone: "drift"
                })
              }
            />
          ))}
        </Group>
      ) : null}
      <Group
        title="Members"
        action={
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => toast("Invitations are coming soon", { icon: <UserPlus size={17} /> })}
          >
            <span className="jds-btn__icon">
              <UserPlus size={15} />
            </span>
            Invite
          </button>
        }
      >
        <div className="ppl">
          {members.length ? (
            members.map((user) => (
              <PersonRow
                key={user.id}
                user={user}
                isCurrent={user.id === me.user.id}
                actions={adminUserActions(user, me.user, policy)}
                onAction={onAction}
              />
            ))
          ) : (
            <Row name={usersQuery.isLoading ? "Loading people…" : "No members"} />
          )}
        </div>
      </Group>
      <Note icon={<KeyRound size={13} />}>
        Deactivating someone keeps their history but ends all their sessions immediately.
      </Note>
    </>
  );
}

/* ---------------------------------------------------- Identity & registration */

export function IdentityPane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const regQuery = useQuery({
    queryKey: queryKeys.settings.registrationSettings,
    queryFn: getRegistrationSettings,
    retry: false
  });
  const providersQuery = useQuery({
    queryKey: queryKeys.settings.providers,
    queryFn: listAuthProviderStatuses,
    retry: false
  });
  const putMutation = useMutation({
    mutationFn: (next: RegistrationSettingsDto) => putRegistrationSettings(next),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.registrationSettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const reg = regQuery.data;
  const providers = providersQuery.data?.providers ?? [];

  return (
    <>
      <PaneHead
        title="Identity & registration"
        desc="Who can join this instance, and how they sign in."
      />
      <Group title="Registration">
        <Row
          name="Allow new registrations"
          desc="Let people create accounts on this instance."
          control={
            <Switch
              ariaLabel="Allow new registrations"
              checked={reg?.registrationEnabled ?? false}
              onChange={(value) =>
                reg && putMutation.mutate({ ...reg, registrationEnabled: value })
              }
            />
          }
        />
        <Row
          name="Require approval"
          desc="New sign-ups wait in a queue until an admin lets them in."
          control={
            <Switch
              ariaLabel="Require approval"
              checked={reg?.requiresApproval ?? true}
              onChange={(value) => reg && putMutation.mutate({ ...reg, requiresApproval: value })}
            />
          }
        />
      </Group>
      <Group title="Sign-in methods" desc="Which ways people are allowed to sign in.">
        {providers.length ? (
          providers.map((provider) => (
            <Row
              key={provider.id}
              name={provider.displayName}
              control={
                <Badge tone={provider.enabled ? "pine" : "neutral"} dot={provider.enabled}>
                  {provider.enabled ? "Enabled" : "Off"}
                </Badge>
              }
            />
          ))
        ) : (
          <Row
            name={providersQuery.isLoading ? "Loading methods…" : "No sign-in methods configured"}
          />
        )}
      </Group>
      <Note icon={<Terminal size={13} />}>
        Auth provider configuration — client IDs, secrets, callback URLs — is handled in operator
        setup as environment config, not on this screen.
      </Note>
    </>
  );
}

/* ----------------------------------------------------------- Instance modules */

export function InstanceModulesPane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const modulesQuery = useQuery({
    queryKey: queryKeys.settings.adminModules,
    queryFn: listAdminModules,
    retry: false
  });
  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; disabled: boolean }) =>
      setAdminModuleDisabled(input.id, input.disabled),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminModules }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const modules = modulesQuery.data?.modules ?? [];

  return (
    <>
      <PaneHead
        title="Instance modules"
        desc="Turn optional modules on or off for everyone. Required modules are always on."
      />
      <Group title="Modules">
        {modules.length ? (
          modules.map((module) => (
            <Row
              key={module.id}
              name={
                <span className="module-title-with-badge">
                  {module.name}
                  {module.required ? <Badge tone="neutral">Required</Badge> : null}
                </span>
              }
              desc={moduleDescription(module.id)}
              control={
                module.required ? (
                  <Badge tone="pine" dot>
                    On
                  </Badge>
                ) : (
                  <Switch
                    ariaLabel={module.name}
                    checked={!module.instanceDisabled}
                    onChange={(value) => toggleMutation.mutate({ id: module.id, disabled: !value })}
                  />
                )
              }
            />
          ))
        ) : (
          <Row name={modulesQuery.isLoading ? "Loading modules…" : "No modules"} />
        )}
      </Group>
      <Note>
        Disabling a module hides it for everyone and stops it collecting new data. Existing data is
        kept.
      </Note>
    </>
  );
}

/* ---------------------------------------------------------- Audit & operations */

export function AuditPane() {
  const { toast } = useFeedback();
  const auditQuery = useQuery({
    queryKey: queryKeys.settings.adminAuditEvents,
    queryFn: listAdminAuditEvents,
    retry: false
  });
  const events = auditQuery.data?.auditEvents ?? [];
  return (
    <>
      <PaneHead
        title="Audit & operations"
        desc="A record of what's changed, and the operational levers for this instance."
      />
      <Group
        title="Recent activity"
        action={
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={() => toast("Audit export is coming soon", { icon: <Download size={17} /> })}
          >
            <span className="jds-btn__icon">
              <Download size={15} />
            </span>
            Export log
          </button>
        }
      >
        <div className="aud">
          {events.length ? (
            events.map((event) => (
              <div className="aud__row" key={event.id}>
                <div className="aud__when">{new Date(event.createdAt).toLocaleString()}</div>
                <div className="aud__what">
                  <b>{event.action}</b> on {event.targetType}
                  {event.targetId ? ` ${event.targetId}` : ""}
                </div>
              </div>
            ))
          ) : (
            <Row
              name={auditQuery.isLoading ? "Loading activity…" : "No audit events"}
              desc="Admin and system actions appear here once recorded."
            />
          )}
        </div>
      </Group>
      <Group title="Data & backups">
        <Row
          name="Export instance data"
          desc="A full export of all data held on this instance."
          coming
        />
        <Row name="Backup & restore" desc="Scheduled backups and point-in-time restore." coming />
      </Group>
    </>
  );
}

/* ---------------------------------------------------------- Connector oversight */

export function OversightPane() {
  const accountsQuery = useQuery({
    queryKey: queryKeys.settings.adminConnectorAccounts,
    queryFn: listAdminConnectorAccounts,
    retry: false
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  return (
    <>
      <PaneHead
        title="Connector oversight"
        desc="Connection health across the instance — safe metadata only. No private synced data, no secrets."
      />
      <Group title="Connectors">
        <div className="cono">
          {accounts.length ? (
            accounts.map((account) => {
              const health =
                account.status === "active"
                  ? "ready"
                  : account.status === "error"
                    ? "error"
                    : "idle";
              return (
                <div className="cono__row" key={account.id}>
                  <div className="cono__name">
                    <Indicator status={health} /> {account.providerDisplayName}
                  </div>
                  <div className="cono__meta">{account.providerType}</div>
                  <div className="cono__err">
                    {account.status === "error" ? (
                      <Badge tone="amber">Needs attention</Badge>
                    ) : account.status === "revoked" ? (
                      <Badge tone="neutral" dot>
                        Revoked
                      </Badge>
                    ) : (
                      <Badge tone="pine" dot>
                        Healthy
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <Row
              name={accountsQuery.isLoading ? "Loading connectors…" : "No connectors"}
              desc="Connection health appears here once accounts are connected."
            />
          )}
        </div>
      </Group>
      <Note>
        Lower priority — this view exists mainly so a failing connection surfaces before anyone
        notices it broke.
      </Note>
    </>
  );
}

/* --------------------------------------------------------- Advanced host setup */

export function HostPane({ advanced }: PaneProps) {
  const { toast, confirm } = useFeedback();
  const queryClient = useQueryClient();
  const muxQuery = useQuery({
    queryKey: queryKeys.settings.chatMultiplexer,
    queryFn: getChatMultiplexerSettings,
    enabled: advanced,
    retry: false
  });
  const muxMutation = useMutation({
    mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.chatMultiplexer, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  if (!advanced) {
    return (
      <>
        <PaneHead
          title="Advanced host setup"
          desc="Multiplexer, CLI availability, restart-required settings, and diagnostics."
        />
        <Locked icon={<ServerCog size={24} />} title="Host diagnostics are hidden">
          These are low-level operational controls. Turn on <b>Advanced</b> at the top of settings
          to view and edit them.
        </Locked>
      </>
    );
  }

  const mux = muxQuery.data;
  return (
    <>
      <PaneHead
        title="Advanced host setup"
        desc="Low-level operational controls. Some changes here take effect only after a server restart."
      />
      <Group title="Runtime">
        <Row
          name="Session multiplexer"
          desc="The backend that hosts your chat sessions."
          control={
            <Segmented<ChatMultiplexerChoice>
              value={mux?.multiplexer ?? "auto"}
              options={[
                { value: "auto", label: "Auto" },
                { value: "tmux", label: "tmux" },
                { value: "herdr", label: "herdr" }
              ]}
              ariaLabel="Session multiplexer"
              onChange={(value) => muxMutation.mutate(value)}
            />
          }
        />
        <Row
          name="tmux available"
          desc="Whether tmux is usable on this host."
          control={
            <Badge tone={mux?.available.tmux ? "pine" : "neutral"} dot={mux?.available.tmux}>
              {mux?.available.tmux ? "Yes" : "No"}
            </Badge>
          }
        />
        <Row
          name="herdr available"
          desc="Whether herdr is usable on this host."
          control={
            <Badge tone={mux?.available.herdr ? "pine" : "neutral"} dot={mux?.available.herdr}>
              {mux?.available.herdr ? "Yes" : "No"}
            </Badge>
          }
        />
      </Group>
      <Group title="Diagnostics">
        <Row name="Verbose logging" desc="Capture detailed logs for troubleshooting." coming />
        <Row
          name="Restart-required settings"
          desc="A few changes wait for the next restart to apply."
          control={<Badge tone="amber">Restart needed</Badge>}
        />
      </Group>
      <div className="host-actions">
        <button
          type="button"
          className="jds-btn jds-btn--secondary jds-btn--sm"
          onClick={() =>
            confirm({
              title: "Restart the server?",
              description:
                "Active sessions will briefly disconnect and reconnect. This usually takes a few seconds.",
              confirmLabel: "Restart",
              danger: true,
              onConfirm: () =>
                toast("Server restart is coming soon", {
                  tone: "drift",
                  icon: <RefreshCw size={17} />
                })
            })
          }
        >
          <span className="jds-btn__icon">
            <RefreshCw size={15} />
          </span>
          Restart server
        </button>
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={() => toast("Diagnostics are coming soon", { icon: <Stethoscope size={17} /> })}
        >
          <span className="jds-btn__icon">
            <Stethoscope size={15} />
          </span>
          Run diagnostics
        </button>
      </div>
    </>
  );
}
