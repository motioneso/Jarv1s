import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  BrainCircuit,
  CalendarDays,
  FolderCheck,
  FolderOpen,
  FolderSearch,
  HeartPulse,
  Info,
  ListChecks,
  Lock,
  Mail,
  MessagesSquare,
  Newspaper,
  NotebookText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sunrise,
  Trophy,
  Unlink,
  Wallet,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  MODULE_SETTINGS_COMPONENTS,
  MODULE_SETTINGS_SURFACES
} from "virtual:jarvis-module-settings";

import {
  getLocaleSettings,
  getModules,
  getMyModules,
  getQuietHoursSettings,
  listConnectorAccounts,
  putLocaleSettings,
  putQuietHoursSettings,
  revokeConnectorAccount,
  setMyModuleDisabled
} from "../api/client";
import { getConnectorFeatureGrants, updateConnectorFeatureGrants } from "../api/connectors-client";
import {
  getNotesLastSync,
  getNotesSource,
  postNotesSync,
  putNotesSource
} from "../api/notes-client";
import { queryKeys } from "../api/query-keys";
import { GOOGLE_CONNECT_SUCCESS_QUERY_KEYS } from "../connectors/use-google-connect-flow";
import { getConnectorAccountHealth, isConnectorSyncInFlight } from "./settings-connector-sync";
import { GoogleConnect } from "./settings-google-connect";
import {
  BriefingSettings,
  ChatSettingsView,
  NotificationSettings
} from "./settings-module-subviews";
import { useFeedback } from "./settings-feedback";
import { resolveModuleSettingsDeepLink } from "./module-settings-deep-link";
import { settingsModuleControlModel, visibleUserToggleModules } from "./settings-module-view-model";
import { moduleDescription, readError, type PaneProps } from "./settings-types";
import {
  Badge,
  formatTimestamp,
  Group,
  Indicator,
  findModuleSettingsEntrySurface,
  ModuleSettingsRouter,
  Note,
  PaneHead,
  Row,
  Select,
  Switch
} from "./settings-ui";
import { VaultChooser } from "./settings-vault-chooser";
import {
  type ConnectorAccountDto,
  type LocaleSettingsDto,
  type QuietHoursSettingsDto,
  type PutNotesSourceRequest
} from "@jarv1s/shared";

const MODULE_ICONS: Record<string, LucideIcon> = {
  tasks: ListChecks,
  calendar: CalendarDays,
  briefings: Sunrise,
  chat: MessagesSquare,
  knowledge: BrainCircuit,
  wellness: HeartPulse,
  sports: Trophy,
  news: Newspaper,
  notifications: Bell,
  finance: Wallet,
  email: Mail
};

const DEFAULT_LOCALE_SETTINGS: LocaleSettingsDto = {
  timezone: "America/Los_Angeles",
  region: "en-US",
  dateFormat: "24"
};

const DEFAULT_QUIET_HOURS: QuietHoursSettingsDto = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timezone: null
};

export function isValidQuietHoursTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

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
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const health = getConnectorAccountHealth(account);
  const hasEmail = hasEmailScope(account.scopes);
  const hasCalendar = hasCalendarScope(account.scopes);
  const featureQuery = useQuery({
    queryKey: queryKeys.connectors.featureGrants(account.id),
    queryFn: () => getConnectorFeatureGrants(account.id),
    enabled: account.status !== "revoked" && (hasEmail || hasCalendar),
    retry: false
  });
  const featureMutation = useMutation({
    mutationFn: (input: { readonly email?: boolean; readonly calendar?: boolean }) =>
      updateConnectorFeatureGrants(account.id, input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.connectors.featureGrants(account.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
      toast("Access saved", { icon: <ShieldCheck size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const grants = featureQuery.data;
  return (
    <div className="acct">
      <div className="acct__logo" style={{ background: "var(--text-faint)" }}>
        {account.providerDisplayName[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="acct__main">
        <div className="acct__name">{account.providerDisplayName}</div>
        <div className="acct__sub">
          <span>{account.providerType}</span>
          <span className="acct__dot">·</span>
          <span>Live connection</span>
          <Indicator status={health.indicator} label={health.label} />
        </div>
        {account.scopes.length ? (
          <div className="acct__scopes">{account.scopes.join(" · ")}</div>
        ) : null}
        <div className="acct__scopes">
          Fallback cache{" "}
          {account.lastSyncFinishedAt
            ? `updated ${formatTimestamp(account.lastSyncFinishedAt, account.lastSyncFinishedAt)}`
            : "not yet populated"}
        </div>
        {health.alert ? <div className="acct__alert">{health.alert}</div> : null}
        {account.status !== "revoked" && (hasEmail || hasCalendar) ? (
          <div className="acct__features">
            {hasEmail ? (
              <FeatureGrantSwitch
                label="Email access"
                desc="Jarvis may read your email from this account."
                checked={grants?.email ?? true}
                disabled={featureQuery.isLoading || featureMutation.isPending}
                onChange={(email) => featureMutation.mutate({ email })}
              />
            ) : null}
            {hasCalendar ? (
              <FeatureGrantSwitch
                label="Calendar access"
                desc="Jarvis may read your calendar from this account."
                checked={grants?.calendar ?? true}
                disabled={featureQuery.isLoading || featureMutation.isPending}
                onChange={(calendar) => featureMutation.mutate({ calendar })}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="acct__actions">
        {health.canReconnect ? (
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

function FeatureGrantSwitch(props: {
  readonly label: string;
  readonly desc: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="acct-feature">
      <div>
        <div className="acct-feature__label">{props.label}</div>
        <div className="acct-feature__desc">{props.desc}</div>
      </div>
      <Switch
        ariaLabel={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </div>
  );
}

function hasEmailScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.includes("gmail") || scope.includes("mail"));
}

function hasCalendarScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.includes("calendar"));
}

const CONNECT_SERVICES: readonly { name: string; go?: boolean }[] = [
  { name: "Google", go: true },
  { name: "GitHub" },
  { name: "Apple" },
  { name: "Other (OAuth)" }
];

function ServicePicker(props: { readonly onGoogle: () => void }) {
  const { toast } = useFeedback();
  return (
    <div className="provpick" style={{ marginTop: 14 }}>
      <div className="provpick__hd">Connect an account</div>
      <div className="provpick__grid">
        {CONNECT_SERVICES.map((s) => (
          <button
            key={s.name}
            type="button"
            className="provpick__item"
            onClick={() =>
              s.go
                ? props.onGoogle()
                : toast(`${s.name} uses the same OAuth flow — coming soon`, {
                    icon: <Plus size={17} />
                  })
            }
          >
            <span className="provpick__dot" />
            {s.name}
          </button>
        ))}
      </div>
      <div className="provpick__foot">
        Google connects through a developer OAuth app you create and own. The others connect the
        same way.
      </div>
    </div>
  );
}

function ConnectedPane() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [flow, setFlow] = useState<null | "picker" | "google">(null);
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: listConnectorAccounts,
    retry: false,
    // Background refresh keeps the fallback-cache line honest while a first
    // snapshot is still landing after connect; there is no manual sync anymore.
    refetchInterval: (query) => {
      const accounts = query.state.data?.accounts ?? [];
      return accounts.some(isConnectorSyncInFlight) ? 2000 : false;
    },
    refetchIntervalInBackground: false
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeConnectorAccount(id),
    onSuccess: () => {
      // Revoking a connector flips connectors.done (derived from "an account exists"), so refresh
      // onboarding.status too — not just the accounts list — or the onboarding recap stays stale.
      // Same shared key set the Google connect/disconnect flow uses, so all revoke entry points
      // invalidate the onboarding status consistently.
      for (const queryKey of GOOGLE_CONNECT_SUCCESS_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast("Access revoked", { tone: "drift", icon: <Unlink size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  if (flow === "google") {
    return <GoogleConnect onBack={() => setFlow(null)} />;
  }

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
            onClick={() => setFlow((f) => (f === "picker" ? null : "picker"))}
          >
            <span className="jds-btn__icon">
              <Plus size={15} />
            </span>
            Connect account
          </button>
        }
      >
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
              onReconnect={() => setFlow("google")}
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
        {flow === "picker" ? <ServicePicker onGoogle={() => setFlow("google")} /> : null}
      </Group>
      <Note icon={<ShieldCheck size={13} />}>
        These are your accounts and their trust state — not backend provider definitions. What each
        account powers is set in its module settings.
      </Note>
    </>
  );
}

/* ----------------------------------------------------------- Data sources */

function formatLastSync(at: string | null, lastError?: string): string {
  if (!at) return "Never synced";
  const relative = formatTimestamp(at, at);
  return lastError ? `Last sync failed: ${relative}` : `Last sync: ${relative}`;
}

function SourcesPane() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();

  // Notes source (#449): real API calls replace the prior NotWired stub.
  const notesSourceQuery = useQuery({
    queryKey: queryKeys.settings.notesSource,
    queryFn: getNotesSource,
    retry: false
  });
  const putNotesSourceMutation = useMutation({
    mutationFn: (body: PutNotesSourceRequest) => putNotesSource(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.notesSource, data);
      // Clear the stale last-sync read so it refetches after the next sync.
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.notesLastSync });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  // Self-correcting poll after "Sync now" (#449): the job runs async, so a fixed
  // setTimeout invalidate is wrong (cold/embedding load >2s, fires once, leaks on
  // unmount). Instead, flip a recently-started flag and poll the last-sync read
  // every 2s while it's up. The flag auto-clears after a bounded 30s window; the
  // poll observes the fresh `at` timestamp and the card updates without a remount.
  // refetchInterval reads `recentlySynced` (state) and `syncMutation.isPending`
  // DIRECTLY — both changes trigger a re-render, which is what makes React Query
  // re-evaluate the interval. A ref would be updated in an effect that fires no
  // re-render, so the poll would never start.
  const [recentlySynced, setRecentlySynced] = useState(false);
  // Bumped on every successful "Sync now" so a repeat sync within the 30s window
  // restarts the auto-clear timer. `setRecentlySynced(true)` no-ops when already
  // true (no re-render), so the clear effect must also depend on this counter —
  // otherwise the first timer fires mid-second-sync and cuts the poll short.
  const [syncTick, setSyncTick] = useState(0);
  const syncMutation = useMutation({
    mutationFn: () => postNotesSync(),
    onSuccess: () => {
      toast("Sync started", { icon: <FolderCheck size={17} /> });
      setRecentlySynced(true);
      setSyncTick((tick) => tick + 1);
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const notesLastSyncQuery = useQuery({
    queryKey: queryKeys.settings.notesLastSync,
    queryFn: getNotesLastSync,
    retry: false,
    refetchInterval: () => (syncMutation.isPending || recentlySynced ? 2000 : false),
    refetchIntervalInBackground: false
  });
  // Auto-clear the poll window 30s after the last "Sync now" (cleared on unmount).
  useEffect(() => {
    if (!recentlySynced) return;
    const stop = setTimeout(() => setRecentlySynced(false), 30_000);
    return () => clearTimeout(stop);
  }, [recentlySynced, syncTick]);

  const linkedPath = notesSourceQuery.data?.path ?? null;
  const lastSync = notesLastSyncQuery.data?.lastSync ?? null;
  const [choosing, setChoosing] = useState(false);

  const choose = (folder: string) => {
    putNotesSourceMutation.mutate(
      { path: folder },
      {
        onSuccess: () => {
          setChoosing(false);
          toast(`Linked ${folder}`, { icon: <FolderCheck size={17} /> });
        }
      }
    );
  };
  const unlink = () =>
    confirm({
      title: "Unlink this folder?",
      description: "Jarvis will stop reading your notes. Your files are untouched.",
      confirmLabel: "Unlink",
      danger: true,
      onConfirm: () => {
        putNotesSourceMutation.mutate({ path: null });
        toast("Folder unlinked", { tone: "drift", icon: <Unlink size={17} /> });
      }
    });

  if (choosing) {
    return (
      <VaultChooser
        current={linkedPath ?? ""}
        onCancel={() => setChoosing(false)}
        onChoose={choose}
      />
    );
  }

  return (
    <>
      <PaneHead
        title="Data sources"
        desc="Connect a notes folder Jarvis can index and use as context."
      />

      <Group
        title={
          <span className="src-title">
            <NotebookText size={18} aria-hidden="true" />
            Notes &amp; documents
          </span>
        }
        desc="Point Jarvis at a folder of notes on this server — a Markdown vault, a plain folder of text files, anything. Tool-agnostic by design."
      >
        <div className="vault">
          <span className="vault__ic">
            {linkedPath ? (
              <FolderCheck size={18} aria-hidden="true" />
            ) : (
              <FolderOpen size={18} aria-hidden="true" />
            )}
          </span>
          <div className="vault__main">
            {linkedPath ? (
              <>
                <div className="vault__path">
                  {linkedPath}
                  <span className="vault__ro">
                    <Lock size={11} aria-hidden="true" />
                    delete approval
                  </span>
                </div>
                <div className="vault__meta">
                  {lastSync
                    ? lastSync.lastError
                      ? formatLastSync(lastSync.at, lastSync.lastError)
                      : `${lastSync.ingested} ingested · ${lastSync.skipped} unchanged · ${lastSync.errors} errors · ${formatLastSync(lastSync.at)}`
                    : "Linked — run Sync now to ingest."}
                </div>
              </>
            ) : (
              <>
                <div className="vault__path vault__path--empty">No folder linked</div>
                <div className="vault__meta">
                  Choose a folder on the server to include your notes as context.
                </div>
              </>
            )}
          </div>
          <div className="vault__act">
            <button
              type="button"
              className="jds-btn jds-btn--secondary jds-btn--sm"
              onClick={() => setChoosing(true)}
              disabled={putNotesSourceMutation.isPending}
            >
              <span className="jds-btn__icon">
                <FolderSearch size={15} />
              </span>
              {linkedPath ? "Change folder" : "Browse…"}
            </button>
            {linkedPath ? (
              <>
                <button
                  type="button"
                  className="jds-btn jds-btn--secondary jds-btn--sm"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  <span className="jds-btn__icon">
                    <RefreshCw size={15} className={syncMutation.isPending ? "spin" : ""} />
                  </span>
                  {syncMutation.isPending ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  className="jds-btn jds-btn--quiet jds-btn--sm"
                  onClick={unlink}
                  disabled={putNotesSourceMutation.isPending}
                >
                  Unlink
                </button>
              </>
            ) : null}
          </div>
        </div>
      </Group>
      <Note icon={<ShieldCheck size={13} />}>
        Jarvis can create and edit Markdown notes in this folder. Deleting notes requires approval.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- Modules */

const CONFIG_IDS = new Set(["briefings", "chat", "notifications"]);
const CAT_BY_ID: Record<string, string> = { knowledge: "memory" };
const CONTRIBUTED_SETTINGS_MODULE_IDS = new Set(
  MODULE_SETTINGS_SURFACES.filter((surface) => surface.hasEntry).map((surface) => surface.moduleId)
);
type ModuleSub = "briefings" | "chat" | "notifications";
type ModuleSettingsView = ModuleSub | { readonly moduleId: string };

function ModulesPane({ onNavigate, onSelectSection }: PaneProps) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ModuleSettingsView | null>(null);
  const myQuery = useQuery({ queryKey: queryKeys.myModules, queryFn: getMyModules, retry: false });
  const modulesQuery = useQuery({ queryKey: queryKeys.modules, queryFn: getModules, retry: false });
  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; disabled: boolean }) =>
      setMyModuleDisabled(input.id, input.disabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.myModules }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  useEffect(() => {
    const requested = resolveModuleSettingsDeepLink(searchParams.get("module"), (moduleId) =>
      Boolean(findModuleSettingsEntrySurface(moduleId, MODULE_SETTINGS_SURFACES))
    );
    if (!requested) return;
    setView(requested);
    const next = new URLSearchParams(searchParams);
    next.delete("module");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (view === "briefings") return <BriefingSettings onBack={() => setView(null)} />;
  if (view === "chat")
    return <ChatSettingsView onBack={() => setView(null)} onCat={onSelectSection} />;
  if (view === "notifications")
    return (
      <NotificationSettings
        onBack={() => setView(null)}
        onCat={onSelectSection}
        onModuleSettings={(id) => setView(id)}
      />
    );
  if (view && typeof view === "object") {
    return (
      <ModuleSettingsRouter
        moduleId={view.moduleId}
        surfaces={MODULE_SETTINGS_SURFACES}
        components={MODULE_SETTINGS_COMPONENTS}
        onBack={() => setView(null)}
        onSelectSection={onSelectSection}
        onNavigate={onNavigate}
      />
    );
  }

  const modules = visibleUserToggleModules(myQuery.data?.modules ?? []);
  const pathFor = (id: string): string | null =>
    modulesQuery.data?.modules.find((m) => m.id === id)?.navigation[0]?.path ?? null;

  const renderRow = (module: (typeof modules)[number]) => {
    const Icon = moduleIcon(module.id);
    const control = settingsModuleControlModel(module);
    const locked = control.kind === "locked";
    const available = module.active || control.kind === "required";
    const config = CONFIG_IDS.has(module.id);
    const contributedSettings =
      CONTRIBUTED_SETTINGS_MODULE_IDS.has(module.id) &&
      findModuleSettingsEntrySurface(module.id, MODULE_SETTINGS_SURFACES);
    const cat = CAT_BY_ID[module.id];
    const path = pathFor(module.id);

    // Core modules are all required/always-on, so no status tag — only optional
    // (toggleable) modules show an Enabled badge, and instance-off ones show Unavailable.
    const badge = locked ? (
      <Badge tone="neutral">Unavailable</Badge>
    ) : control.kind === "toggle" && module.active ? (
      <Badge tone="pine" dot>
        Enabled
      </Badge>
    ) : null;

    let action: React.ReactNode = null;
    if (locked) {
      action = (
        <span className="modrow__locked">
          <Lock size={13} aria-hidden="true" />
          Off for this instance
        </span>
      );
    } else if (!available) {
      action = <span className="modrow__disabled">Switch on to set up</span>;
    } else if (config) {
      action = (
        <button
          type="button"
          className="modrow__link"
          onClick={() => setView(module.id as ModuleSub)}
        >
          Configure <ArrowRight size={14} aria-hidden="true" />
        </button>
      );
    } else if (contributedSettings) {
      action = (
        <button
          type="button"
          className="modrow__link"
          onClick={() => setView({ moduleId: module.id })}
        >
          Configure <ArrowRight size={14} aria-hidden="true" />
        </button>
      );
    } else if (cat) {
      action = (
        <button type="button" className="modrow__link" onClick={() => onSelectSection?.(cat)}>
          Configure <ArrowRight size={14} aria-hidden="true" />
        </button>
      );
    } else if (path) {
      action = (
        <button type="button" className="modrow__link" onClick={() => onNavigate(path)}>
          Open <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      );
    }

    return (
      <div className={`modrow${locked ? " modrow--locked" : ""}`} key={module.id}>
        <div className="modrow__ic">
          <Icon size={19} aria-hidden="true" />
        </div>
        <div className="modrow__main">
          <div className="modrow__name">
            {module.name}
            {badge}
          </div>
          <div className="modrow__desc">
            {locked
              ? "An admin has turned this off for the whole instance."
              : moduleDescription(module.id)}
          </div>
        </div>
        <div className="modrow__act">
          {control.kind === "toggle" ? (
            <Switch
              ariaLabel={`Use ${module.name}`}
              checked={control.checked}
              onChange={(value) => toggleMutation.mutate({ id: module.id, disabled: !value })}
            />
          ) : null}
          {action}
        </div>
      </div>
    );
  };

  return (
    <>
      <PaneHead title="Modules" desc="Additional parts of Jarvis you can turn on or off." />
      <Group title="Additional modules" desc="Switch on the extras you want to use.">
        {modules.length ? (
          modules.map(renderRow)
        ) : (
          <Row
            name={myQuery.isLoading ? "Loading modules…" : "No additional modules"}
            desc="Additional modules will appear here when available."
          />
        )}
      </Group>
      <Note icon={<Info size={13} />}>
        Real app screens open in place; settings-only modules — Briefings, Chat, Notifications —
        configure right here.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- General */

function GeneralPane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const localeQuery = useQuery({
    queryKey: queryKeys.settings.locale,
    queryFn: getLocaleSettings,
    retry: false
  });
  const locale = localeQuery.data?.locale ?? DEFAULT_LOCALE_SETTINGS;
  const localeMutation = useMutation({
    mutationFn: (next: LocaleSettingsDto) => putLocaleSettings({ locale: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.locale, data);
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const quietHoursQuery = useQuery({
    queryKey: queryKeys.settings.quietHours,
    queryFn: getQuietHoursSettings,
    retry: false
  });
  const quietHours = quietHoursQuery.data?.quietHours ?? DEFAULT_QUIET_HOURS;
  const quietHoursMutation = useMutation({
    mutationFn: (next: QuietHoursSettingsDto) => putQuietHoursSettings({ quietHours: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.quietHours, data);
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const updateLocale = (patch: Partial<LocaleSettingsDto>) => {
    localeMutation.mutate({ ...locale, ...patch });
  };
  const updateQuietHours = (patch: Partial<QuietHoursSettingsDto>) => {
    quietHoursMutation.mutate({ ...quietHours, ...patch });
  };

  return (
    <>
      <PaneHead title="General" desc="The few things that apply across all of Jarvis." />
      <Group title="Locale">
        <div className="fld">
          <div className="fld__lbl">Time zone</div>
          <div className="fld__row">
            <Select
              value={locale.timezone}
              aria-label="Time zone"
              disabled={localeQuery.isLoading || localeMutation.isPending}
              onChange={(event) => updateLocale({ timezone: event.currentTarget.value })}
            >
              <option value="America/Los_Angeles">Pacific — America/Los_Angeles</option>
              <option value="America/New_York">Eastern — America/New_York</option>
              <option value="Europe/London">GMT — Europe/London</option>
              <option value="Europe/Berlin">CET — Europe/Berlin</option>
            </Select>
          </div>
        </div>
        <div className="fld">
          <div className="fld__lbl">Language &amp; region</div>
          <div className="fld__row">
            <Select
              value={locale.region}
              aria-label="Language & region"
              disabled={localeQuery.isLoading || localeMutation.isPending}
              onChange={(event) => updateLocale({ region: event.currentTarget.value })}
            >
              <option value="en-US">English (United States)</option>
              <option value="en-GB">English (United Kingdom)</option>
              <option value="fr-FR">Français (France)</option>
              <option value="de-DE">Deutsch (Deutschland)</option>
            </Select>
          </div>
        </div>
        <div className="fld">
          <div className="fld__lbl">Date &amp; time format</div>
          <div className="fld__row">
            <Select
              value={locale.dateFormat}
              aria-label="Date and time format"
              disabled={localeQuery.isLoading || localeMutation.isPending}
              onChange={(event) =>
                updateLocale({
                  dateFormat: event.currentTarget.value as LocaleSettingsDto["dateFormat"]
                })
              }
            >
              <option value="24">13 Jun · 24-hour</option>
              <option value="12">Jun 13 · 12-hour</option>
            </Select>
          </div>
        </div>
      </Group>

      <Group
        title="Quiet hours"
        desc="Jarvis stays silent during these hours — no nudges unless something is genuinely urgent."
      >
        <Row
          name="Enable quiet hours"
          control={
            <Switch
              ariaLabel="Enable quiet hours"
              checked={quietHours.enabled}
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(enabled) => updateQuietHours({ enabled })}
            />
          }
        />
        <div className="fld">
          <div className="fld__lbl">From / to</div>
          <div className="fld__row">
            <input
              className="jds-input"
              type="time"
              value={quietHours.start}
              aria-label="Quiet hours from"
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isValidQuietHoursTime(value)) updateQuietHours({ start: value });
              }}
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
            <span style={{ color: "var(--text-faint)" }}>→</span>
            <input
              className="jds-input"
              type="time"
              value={quietHours.end}
              aria-label="Quiet hours to"
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isValidQuietHoursTime(value)) updateQuietHours({ end: value });
              }}
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
          </div>
        </div>
      </Group>
    </>
  );
}

export { ConnectedPane, SourcesPane, ModulesPane, GeneralPane };
