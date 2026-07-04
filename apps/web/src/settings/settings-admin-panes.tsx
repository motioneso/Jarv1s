import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { compareJarvisVersions } from "@jarv1s/module-sdk/core-version";
import {
  Download,
  KeyRound,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Trash2,
  UserCheck,
  UserMinus
} from "lucide-react";
import { useState } from "react";

import {
  approveUser,
  deactivateUser,
  deleteAdminUser,
  demoteUser,
  getChatMultiplexerSettings,
  getHostDiagnostics,
  getRegistrationSettings,
  listAdminConnectorAccounts,
  listAdminModules,
  listAdminUsers,
  promoteUser,
  putRegistrationSettings,
  putAdminYoloInstance,
  putAdminYoloUser,
  postAdminYoloAllowAll,
  postHostRestart,
  postInstallHerdr,
  reactivateUser,
  revokeAdminUserSessions,
  rejectUser,
  setChatMultiplexerSettings,
  setAdminModuleDisabled
} from "../api/client";
import { getAdminUserAiPin, putAdminUserAiPin } from "../api/client-admin";
import { queryKeys } from "../api/query-keys";
import {
  adminUserActions,
  createAdminUserPolicyContext,
  type AdminUserAction
} from "./settings-admin-policy";
import { getConnectorAccountHealth } from "./settings-connector-sync";
import { useFeedback } from "./settings-feedback";
import { moduleDescription, readError, type PaneProps } from "./settings-types";
import { MarkdownMessage } from "../chat/markdown-message";
import {
  Avatar,
  Badge,
  formatTimestamp,
  Group,
  Indicator,
  Note,
  PaneHead,
  Row,
  Segmented,
  Select,
  Switch,
  type BadgeTone
} from "./settings-ui";
import type {
  ChatMultiplexerChoice,
  HostDiagnosticStatus,
  RegistrationSettingsDto,
  UserDto
} from "@jarv1s/shared";

function roleLabel(user: UserDto): string {
  return user.isBootstrapOwner ? "Owner" : user.isInstanceAdmin ? "Admin" : "Member";
}

function diagnosticTone(status: HostDiagnosticStatus): BadgeTone {
  return status === "pass" ? "pine" : status === "warn" ? "amber" : "red";
}

function diagnosticLabel(status: HostDiagnosticStatus): string {
  return status === "pass" ? "Pass" : status === "warn" ? "Warn" : "Fail";
}

function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
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
  const [aiOpen, setAiOpen] = useState(false);
  const off = user.status === "deactivated";
  const act = (action: AdminUserAction) => {
    setMenu(false);
    props.onAction(action, user);
  };
  const canAdmin = props.actions.includes("admin");
  const statusAction = props.actions.find(
    (action) => action === "deactivate" || action === "reactivate"
  );
  const canRevokeSessions = props.actions.includes("revokeSessions");
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
                  <button
                    className="ppl__menuitem"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setAiOpen((open) => !open);
                    }}
                  >
                    <ServerCog size={15} />
                    AI provider
                  </button>
                  {canRevokeSessions || canRemove ? <div className="ppl__menusep" /> : null}
                  {canRevokeSessions ? (
                    <button
                      className="ppl__menuitem ppl__menuitem--danger"
                      role="menuitem"
                      onClick={() => act("revokeSessions")}
                    >
                      <LogOut size={15} />
                      Sign out everywhere
                    </button>
                  ) : null}
                  {canRemove ? (
                    <button
                      className="ppl__menuitem ppl__menuitem--danger"
                      role="menuitem"
                      onClick={() => act("remove")}
                    >
                      <Trash2 size={15} />
                      Remove from instance
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
      {aiOpen ? <AiPinRow user={user} /> : null}
    </div>
  );
}

function AiPinRow(props: { readonly user: UserDto }) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const queryKey = queryKeys.ai.adminUserAiPin(props.user.id);
  const pinQuery = useQuery({
    queryKey,
    queryFn: () => getAdminUserAiPin(props.user.id),
    retry: false
  });
  const mutation = useMutation({
    mutationFn: (modelId: string | null) => putAdminUserAiPin(props.user.id, { modelId }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      toast(data.pin.pinnedModelId ? "AI provider pinned" : "AI provider pin cleared", {
        icon: <ServerCog size={17} />
      });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const pin = pinQuery.data?.pin;
  const models = pin?.availableModels ?? [];
  const value = pin?.pinnedModelId ?? "";
  const busy = pinQuery.isLoading || mutation.isPending;
  const disabled = busy || models.length === 0;
  const effective = pin?.effectiveChatModel
    ? `${pin.effectiveChatModel.displayName} (${pin.effectiveChatReason})`
    : "No active model";

  return (
    <div className="ppl__ai">
      <Row
        name="AI provider"
        desc={
          models.length
            ? `Effective chat model: ${effective}. Pinning forces this model for all AI features.`
            : "No active models configured by this user."
        }
        control={
          <Select
            aria-label={`Pinned AI provider for ${props.user.name || props.user.email}`}
            value={value}
            disabled={disabled}
            onChange={(event) => mutation.mutate(event.currentTarget.value || null)}
          >
            <option value="">Clear pin</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </Select>
        }
      />
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
  readonly message: string | ((data: unknown) => string);
  readonly tone?: "ready" | "drift";
  readonly refetchUsers?: boolean;
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
    onSuccess: (data, vars) => {
      if (vars.refetchUsers ?? true) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminUsers });
      }
      toast(typeof vars.message === "function" ? vars.message(data) : vars.message, {
        tone: vars.tone
      });
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
    } else if (action === "revokeSessions") {
      confirm({
        title: `Sign out ${name} everywhere?`,
        description:
          "This ends their active sessions without changing their role, status, or history.",
        confirmLabel: "Sign out everywhere",
        danger: true,
        onConfirm: () =>
          actionMutation.mutate({
            fn: revokeAdminUserSessions,
            id: user.id,
            message: (data) => {
              const count = (data as { count: number }).count;
              return `${name} signed out everywhere (${count} session${count === 1 ? "" : "s"} revoked)`;
            },
            tone: "drift",
            refetchUsers: false
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
      <Group title="Members" desc="New people create an account, then wait for approval here.">
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
  const putMutation = useMutation({
    mutationFn: (next: RegistrationSettingsDto) => putRegistrationSettings(next),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.registrationSettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const reg = regQuery.data;

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
    // Also refresh myModules/modules so the side-nav (driven by `active`) updates
    // live for the admin — disabling instance-wide drops the nav entry immediately.
    onSuccess: () =>
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminModules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.myModules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modules })
      ]),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  // Only optional modules are shown — required ones are always on and can't be
  // toggled, so there's nothing for the admin to do with them.
  const modules = (modulesQuery.data?.modules ?? []).filter((module) => !module.required);

  return (
    <>
      <PaneHead
        title="Instance modules"
        desc="Turn optional modules on or off for everyone. Core modules are always on and aren't listed."
      />
      <Group title="Optional modules">
        {modules.length ? (
          modules.map((module) => (
            <Row
              key={module.id}
              name={module.name}
              desc={moduleDescription(module.id)}
              control={
                <Switch
                  ariaLabel={module.name}
                  checked={!module.instanceDisabled}
                  onChange={(value) => toggleMutation.mutate({ id: module.id, disabled: !value })}
                />
              }
            />
          ))
        ) : (
          <Row
            name={modulesQuery.isLoading ? "Loading modules…" : "No optional modules"}
            desc={modulesQuery.isLoading ? undefined : "Every module on this instance is core."}
          />
        )}
      </Group>
      <Note>
        Disabling a module hides it for everyone and stops it collecting new data. Existing data is
        kept.
      </Note>
    </>
  );
}

/* Audit & operations now lives in ./settings-audit-pane (AuditPane) — it gained
   filters, category tags and CSV export against the AdminAuditEventDto shape. */

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
              // Health now derives from durable sync outcome, not just `status`. Revoked wins;
              // a partial run shows "Partial"; a failed run or an error status needs attention;
              // otherwise healthy. The bounded error label shows only for partial/failed.
              const health = getConnectorAccountHealth(account);
              const lastFinished = account.lastSyncFinishedAt
                ? formatTimestamp(account.lastSyncFinishedAt, account.lastSyncFinishedAt)
                : null;
              const errorLabel =
                (account.lastSyncStatus === "partial" || account.lastSyncStatus === "failed") &&
                account.lastSyncError
                  ? account.lastSyncError
                  : null;
              return (
                <div className="cono__row" key={account.id}>
                  <div className="cono__name">
                    <Indicator status={health.indicator} /> {account.providerDisplayName}
                  </div>
                  <div className="cono__meta">
                    {account.providerType}
                    {lastFinished ? ` · Fallback cache updated ${lastFinished}` : ""}
                    {errorLabel ? ` · ${errorLabel}` : ""}
                  </div>
                  <div className="cono__err">
                    <Badge tone={health.badgeTone} dot={health.badgeTone !== "amber"}>
                      {health.label}
                    </Badge>
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

export function HostPane() {
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const [ranDiagnostics, setRanDiagnostics] = useState(false);
  const muxQuery = useQuery({
    queryKey: queryKeys.settings.chatMultiplexer,
    queryFn: getChatMultiplexerSettings,
    retry: false
  });
  const diagQuery = useQuery({
    queryKey: queryKeys.settings.hostDiagnostics,
    queryFn: getHostDiagnostics,
    enabled: ranDiagnostics,
    retry: false
  });
  const muxMutation = useMutation({
    mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.chatMultiplexer, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const installHerdrMutation = useMutation({
    mutationFn: postInstallHerdr,
    onSuccess: () => {
      toast("Herdr installed. Restart Jarvis to use it.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.chatMultiplexer });
      void muxQuery.refetch();
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const restartMutation = useMutation({
    mutationFn: postHostRestart,
    onSuccess: () => toast("Restart requested"),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const runDiagnostics = () => {
    setRanDiagnostics(true);
    void diagQuery.refetch();
  };

  const mux = muxQuery.data;
  const diag = diagQuery.data;
  const herdrAvailable = mux?.available.herdr === true;
  const herdrPendingRestart = !herdrAvailable && installHerdrMutation.isSuccess;
  const herdrDesc = herdrAvailable
    ? "Herdr is usable on this host."
    : herdrPendingRestart
      ? "Restart Jarvis to make Herdr available."
      : "Install Herdr to use it as a session backend.";
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
          desc={herdrDesc}
          control={
            herdrAvailable ? (
              <Badge tone="pine" dot>
                Yes
              </Badge>
            ) : herdrPendingRestart ? (
              <Badge tone="amber">Restart required</Badge>
            ) : (
              <button
                type="button"
                className="jds-btn jds-btn--secondary jds-btn--sm"
                disabled={installHerdrMutation.isPending}
                onClick={() => installHerdrMutation.mutate()}
              >
                <span className="jds-btn__icon">
                  <Download size={15} />
                </span>
                {installHerdrMutation.isPending ? "Installing..." : "Install Herdr"}
              </button>
            )
          }
        />
      </Group>
      <Group
        title="Diagnostics"
        desc="A safe, read-only health check of this host. No secrets, env values, or paths."
        action={
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={runDiagnostics}
            disabled={diagQuery.isFetching}
          >
            <span className="jds-btn__icon">
              <Stethoscope size={15} />
            </span>
            {diagQuery.isFetching ? "Running…" : "Run diagnostics"}
          </button>
        }
      >
        {!ranDiagnostics ? (
          <Row name="Not run yet" desc="Run diagnostics to check this host." />
        ) : diagQuery.isError ? (
          <Row name="Couldn't run diagnostics" desc={readError(diagQuery.error)} />
        ) : !diag ? (
          <Row name="Running diagnostics…" />
        ) : (
          <>
            {diag.checks.map((check) => (
              <Row
                key={check.id}
                name={check.label}
                desc={check.detail}
                control={
                  <Badge tone={diagnosticTone(check.status)} dot={check.status === "pass"}>
                    {diagnosticLabel(check.status)}
                  </Badge>
                }
              />
            ))}
            <Row name="Uptime" control={formatUptime(diag.uptimeSeconds)} />
            <Row name="Environment" control={diag.environment} />
            <Row
              name="Version"
              control={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {diag.version ?? "—"}
                  {diag.latestAvailableVersion &&
                    compareJarvisVersions(diag.latestAvailableVersion, diag.version ?? "") > 0 && (
                      <Badge tone="pine">Update Available ({diag.latestAvailableVersion})</Badge>
                    )}
                </div>
              }
            />
            {diag.releaseNotes ? (
              <Row
                name="Release notes"
                desc={
                  <div className="set-release-notes">
                    <MarkdownMessage text={diag.releaseNotes} />
                  </div>
                }
              />
            ) : null}
            <Row name="Commit" control={diag.commit ?? "—"} />
            <Row name="Bind address" control={`${diag.host}:${diag.port}`} />
          </>
        )}
      </Group>
      <Group title="Logging">
        <Row
          name="Log level"
          desc="Set with the LOG_LEVEL environment variable. Changing it takes effect after a restart."
          control={<Badge tone="neutral">{diag?.logLevel ?? "Run diagnostics to view"}</Badge>}
        />
      </Group>
      <Group title="Restart">
        <Row
          name="Restart API"
          desc="Restart Jarvis so restart-required host settings take effect."
          control={
            <button
              type="button"
              className="jds-btn jds-btn--secondary jds-btn--sm"
              disabled={restartMutation.isPending}
              onClick={() => restartMutation.mutate()}
            >
              <span className="jds-btn__icon">
                <RefreshCw size={15} />
              </span>
              {restartMutation.isPending ? "Restarting..." : "Restart"}
            </button>
          }
        />
      </Group>
    </>
  );
}
