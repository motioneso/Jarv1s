import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bell,
  Boxes,
  BrainCircuit,
  CalendarDays,
  FolderOpen,
  FolderSearch,
  HeartPulse,
  Link2,
  ListChecks,
  Mail,
  NotebookText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sunrise,
  Unlink,
  Wallet,
  type LucideIcon
} from "lucide-react";

import {
  getModules,
  getMyModules,
  listConnectorAccounts,
  revokeConnectorAccount,
  setMyModuleDisabled
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useGoogleConnectFlow } from "../connectors/use-google-connect-flow";
import {
  sourceBehaviorStatus,
  type DataSource as DataSourceModel
} from "./settings-data-source-model";
import { useFeedback } from "./settings-feedback";
import { settingsModuleControlModel } from "./settings-module-view-model";
import { moduleDescription, readError, type PaneProps } from "./settings-types";
import { Badge, Field, Group, Indicator, Note, PaneHead, Row, Switch } from "./settings-ui";
import type { ConnectorAccountDto } from "@jarv1s/shared";

const MODULE_ICONS: Record<string, LucideIcon> = {
  tasks: ListChecks,
  calendar: CalendarDays,
  briefings: Sunrise,
  knowledge: BrainCircuit,
  wellness: HeartPulse,
  notifications: Bell,
  finance: Wallet,
  email: Mail
};

function moduleIcon(id: string): LucideIcon {
  return MODULE_ICONS[id] ?? Boxes;
}

/* ------------------------------------------------------- Connected accounts */

function AccountRow(props: {
  readonly account: ConnectorAccountDto;
  readonly onRevoke: () => void;
  readonly onReconnect: () => void;
}) {
  const { account } = props;
  const health =
    account.status === "active" ? "ready" : account.status === "error" ? "error" : "idle";
  const label = health === "ready" ? "Healthy" : health === "error" ? "Needs attention" : "Revoked";
  return (
    <div className="acct">
      <div className="acct__logo">{account.providerDisplayName[0]?.toUpperCase() ?? "?"}</div>
      <div className="acct__main">
        <div className="acct__name">{account.providerDisplayName}</div>
        <div className="acct__sub">
          <span>{account.providerType}</span>
          <span className="acct__dot">·</span>
          <Indicator status={health} label={label} />
        </div>
        {account.scopes.length ? (
          <div className="acct__scopes">{account.scopes.join(" · ")}</div>
        ) : null}
      </div>
      <div className="acct__actions">
        {account.status === "error" ? (
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={props.onReconnect}
          >
            Reconnect
          </button>
        ) : null}
        {account.status !== "revoked" ? (
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={props.onRevoke}
          >
            Revoke
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ConnectedPane() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const googleConnect = useGoogleConnectFlow({
    onAuthorizationReady: () =>
      toast("Google authorization link ready", { icon: <Link2 size={17} /> }),
    onConnected: () => toast("Google account connected", { icon: <Link2 size={17} /> }),
    onError: (message) => toast(message, { tone: "drift" })
  });
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: listConnectorAccounts,
    retry: false
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeConnectorAccount(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
      toast("Access revoked", { tone: "drift", icon: <Unlink size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <>
      <PaneHead
        title="Connected accounts"
        desc="The external accounts Jarvis can reach, and how healthy each connection is. You stay in control — reconnect or revoke at any time."
      />
      <Group
        title="Accounts"
        action={
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={googleConnect.startAuthorization}
            disabled={
              !googleConnect.clientId.trim() ||
              !googleConnect.clientSecret.trim() ||
              googleConnect.authorizationPending
            }
          >
            <span className="jds-btn__icon">
              <Plus size={15} />
            </span>
            Start Google connect
          </button>
        }
      >
        <Field label="Google OAuth desktop client">
          <input
            className="jds-input"
            value={googleConnect.clientId}
            onChange={(event) => googleConnect.setClientId(event.target.value)}
            placeholder="Client ID"
            aria-label="Google client ID"
          />
          <input
            className="jds-input"
            type="password"
            value={googleConnect.clientSecret}
            onChange={(event) => googleConnect.setClientSecret(event.target.value)}
            placeholder="Client secret"
            aria-label="Google client secret"
          />
        </Field>
        {googleConnect.authUrl ? (
          <div className="google-connect">
            <a
              className="modrow__link"
              href={googleConnect.authUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Google consent <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <Field label="Pasted redirect URL">
              <input
                className="jds-input"
                value={googleConnect.redirectUrl}
                onChange={(event) => googleConnect.setRedirectUrl(event.target.value)}
                placeholder="http://localhost:1/?code=..."
                aria-label="Pasted redirect URL"
              />
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                disabled={!googleConnect.redirectUrl.trim() || googleConnect.completionPending}
                onClick={googleConnect.finishConnection}
              >
                Finish connecting
              </button>
            </Field>
          </div>
        ) : null}
        {accounts.length === 0 ? (
          <Row
            name="No accounts connected"
            desc="Connect Google or another account to give Jarvis context."
          />
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onReconnect={() =>
                toast(`Reconnecting ${account.providerDisplayName}…`, {
                  icon: <RefreshCw size={17} />
                })
              }
              onRevoke={() =>
                confirm({
                  title: `Revoke ${account.providerDisplayName} access?`,
                  description:
                    "Jarvis will lose access to this account until you reconnect it. Nothing on the account itself is changed.",
                  confirmLabel: "Revoke",
                  danger: true,
                  onConfirm: () => revokeMutation.mutate(account.id)
                })
              }
            />
          ))
        )}
      </Group>
      <Note icon={<ShieldCheck size={13} />}>
        These are your accounts and their trust state — not backend provider definitions. What each
        account powers is set in <b>Data sources</b>.
      </Note>
    </>
  );
}

/* ----------------------------------------------------------- Data sources */

interface DataSource extends DataSourceModel {
  readonly icon: LucideIcon;
}

const DATA_SOURCES: readonly DataSource[] = [
  {
    id: "calendar",
    name: "Calendar",
    icon: CalendarDays,
    powered:
      "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
    behaviors: [
      {
        id: "briefings",
        name: "Include in briefings",
        description: "Surface today's events in the morning reading.",
        status: "default-on"
      },
      {
        id: "planning",
        name: "Use for planning",
        description: "Jarvis schedules its own focus blocks around your events.",
        status: "default-on"
      },
      {
        id: "detect",
        name: "Detect commitments",
        description: "Turn “let's meet Tuesday” into a tracked commitment.",
        status: "default-on"
      },
      {
        id: "writeback",
        name: "Write events back",
        description: "Let Jarvis create and move calendar events for you.",
        status: "coming-soon"
      }
    ]
  },
  {
    id: "email",
    name: "Email",
    icon: Mail,
    powered:
      "What Jarvis is allowed to do with your email — independent of whichever service powers it.",
    behaviors: [
      {
        id: "briefings",
        name: "Include in briefings",
        description: "Flag threads that need a reply today.",
        status: "default-on"
      },
      {
        id: "capture",
        name: "Capture tasks",
        description: "Turn emails into tasks when they imply an action.",
        status: "default-on"
      },
      {
        id: "summaries",
        name: "Thread summaries",
        description: "Condense long threads before you open them.",
        status: "default-off"
      },
      {
        id: "send",
        name: "Send on my behalf",
        description: "Draft and send replies, with your approval.",
        status: "coming-soon"
      }
    ]
  }
];

function SourcesPane() {
  const { toast } = useFeedback();
  return (
    <>
      <PaneHead
        title="Data sources"
        desc="Calendar, email and your notes as Jarvis sees them. Not provider settings — what Jarvis is allowed to do with each source."
      />
      {DATA_SOURCES.map((source) => {
        const Icon = source.icon;
        return (
          <Group
            key={source.id}
            title={
              <span className="src-title">
                <Icon size={18} aria-hidden="true" />
                {source.name}
              </span>
            }
            desc={source.powered}
          >
            {source.behaviors.map((behavior) => {
              const status = sourceBehaviorStatus(behavior);
              return (
                <Row
                  key={behavior.id}
                  name={behavior.name}
                  desc={behavior.description}
                  control={<Badge tone={status.tone}>{status.label}</Badge>}
                />
              );
            })}
          </Group>
        );
      })}

      <Group
        title={
          <span className="src-title">
            <NotebookText size={18} aria-hidden="true" />
            Notes &amp; documents
          </span>
        }
        desc="Point Jarvis at a folder of notes — a Markdown vault, a plain folder of text files, anything. Tool-agnostic by design."
      >
        <div className="vault">
          <span className="vault__ic">
            <FolderOpen size={18} aria-hidden="true" />
          </span>
          <div className="vault__main">
            <div className="vault__path vault__path--empty">No folder linked</div>
            <div className="vault__meta">Choose a folder to include your notes as context.</div>
          </div>
          <div className="vault__act">
            <button
              type="button"
              className="jds-btn jds-btn--secondary jds-btn--sm"
              onClick={() =>
                toast("Folder linking is coming soon", { icon: <FolderOpen size={17} /> })
              }
            >
              <span className="jds-btn__icon">
                <FolderSearch size={15} />
              </span>
              Browse…
            </button>
          </div>
        </div>
        <Row
          name="Use for context & answers"
          desc="Read your notes to ground answers and the briefing in what you already know."
          coming
        />
      </Group>
      <Note icon={<ShieldCheck size={13} />}>
        Jarvis only reads your notes — it never moves, edits, or deletes your files.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- Modules */

function ModulesPane({ onNavigate }: PaneProps) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const myQuery = useQuery({ queryKey: queryKeys.myModules, queryFn: getMyModules, retry: false });
  const modulesQuery = useQuery({ queryKey: queryKeys.modules, queryFn: getModules, retry: false });
  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; disabled: boolean }) =>
      setMyModuleDisabled(input.id, input.disabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.myModules }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const modules = myQuery.data?.modules ?? [];
  const core = modules.filter((module) => !module.supportsUserDisable);
  const optional = modules.filter((module) => module.supportsUserDisable);
  const pathFor = (id: string): string | null =>
    modulesQuery.data?.modules.find((module) => module.id === id)?.navigation[0]?.path ?? null;

  const renderRow = (module: (typeof modules)[number]) => {
    const Icon = moduleIcon(module.id);
    const path = pathFor(module.id);
    const control = settingsModuleControlModel(module);
    const badge =
      control.kind === "required" ? (
        <Badge tone="neutral">{control.label}</Badge>
      ) : control.kind === "locked" ? (
        <Badge tone="amber">{control.label}</Badge>
      ) : module.active ? (
        <Badge tone="pine" dot>
          Enabled
        </Badge>
      ) : null;
    return (
      <div className="modrow" key={module.id}>
        <div className="modrow__ic">
          <Icon size={19} aria-hidden="true" />
        </div>
        <div className="modrow__main">
          <div className="modrow__name">
            {module.name}
            {badge}
          </div>
          <div className="modrow__desc">{moduleDescription(module.id)}</div>
        </div>
        <div className="modrow__act">
          {control.kind === "toggle" ? (
            <Switch
              ariaLabel={`Use ${module.name}`}
              checked={control.checked}
              onChange={(value) => toggleMutation.mutate({ id: module.id, disabled: !value })}
            />
          ) : null}
          {path && control.canOpenSettings ? (
            <button type="button" className="modrow__link" onClick={() => onNavigate(path)}>
              Open settings <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <span className="modrow__disabled">
              {control.kind === "locked"
                ? control.label
                : module.active
                  ? "No settings"
                  : "Enable to set up"}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <PaneHead
        title="Modules"
        desc="Choose which optional modules you personally use. Each module keeps its own settings — open it to tune the details."
      />
      <Group title="Active modules" desc="Core to Jarvis — open any one to tune its own settings.">
        {core.length ? core.map(renderRow) : <Row name="Loading modules…" />}
      </Group>
      <Group title="Optional modules" desc="Switch on the extras you want to use.">
        {optional.length ? (
          optional.map(renderRow)
        ) : (
          <Row
            name="No optional modules"
            desc="Optional modules will appear here when available."
          />
        )}
      </Group>
      <Note>
        Per-module settings — task views, briefing cadence, notification sensitivity — live inside
        each module, not here.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- General */

function GeneralPane() {
  return (
    <>
      <PaneHead title="General" desc="The few things that apply across all of Jarvis." />
      <Group title="Locale">
        <Row name="Time zone" desc="Pacific — America/Los_Angeles" coming />
        <Row name="Language & region" desc="English (United States)" coming />
        <Row name="Date & time format" desc="13 Jun · 24-hour" coming />
      </Group>

      <Group
        title="Quiet hours"
        desc="Jarvis stays silent during these hours — no nudges unless something is genuinely urgent."
      >
        <Row name="Enable quiet hours" desc="Silence routine nudges overnight." coming />
        <Row name="From / to" desc="21:00 → 07:00" coming />
      </Group>
      <Note>Saving locale and quiet hours is coming soon — these don't persist yet.</Note>
    </>
  );
}

export { ConnectedPane, SourcesPane, ModulesPane, GeneralPane };
