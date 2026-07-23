import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Briefcase,
  CalendarDays,
  CheckSquare,
  ChevronUp,
  FileText,
  HeartPulse,
  House,
  Landmark,
  Layers3,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Newspaper,
  Settings,
  Trophy
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { listNotifications, listThemes, sendChatTurn, signOut } from "../api/client";
import { getWeatherToday } from "../api/weather-client";
import { buildShellNavigation, resolvePageHeading } from "../app-route-metadata";
import { useUserLocale } from "../locale/locale-format";
import { queryKeys } from "../api/query-keys";
import { ChatDrawer } from "../chat/chat-drawer";
import {
  AssistantSurfaceHostProvider,
  type AssistantRecordV1,
  type AssistantSurfaceHostValue
} from "../chat/assistant-surface";
import { useChatStream } from "../chat/use-chat-stream";
import { usePageContextSync } from "../chat/use-page-context-sync";
import { BrandMark } from "./brand-mark";
import { ChatControlsProvider } from "./chat-controls-context";
import { ASK_JARVIS_STARTER, consumeAskJarvis } from "../onboarding/ask-jarvis-handoff";
import { HeaderWeather } from "../today/header-weather";
import { applyThemeTokens } from "../theme/theme-runtime";
import { CommandPalette } from "./command-palette";
import {
  loadShellColorMode,
  loadShellTheme,
  saveShellColorMode,
  saveShellTheme,
  type ShellTheme
} from "./theme-storage";
import type { ChatSurface, MeResponse, ModuleDto, ModuleNavigationEntryDto } from "@jarv1s/shared";

interface AppShellProps {
  readonly children: ReactNode;
  readonly me: MeResponse;
  readonly modules: readonly ModuleDto[];
  readonly modulesLoading: boolean;
  readonly disabledModuleIds?: readonly string[];
}

const iconMap: Record<string, ComponentType<{ readonly size?: number }>> = {
  house: House,
  bell: Bell,
  briefcase: Briefcase,
  "calendar-days": CalendarDays,
  "check-square": CheckSquare,
  "file-text": FileText,
  "heart-pulse": HeartPulse,
  landmark: Landmark,
  mail: Mail,
  "message-square": MessageSquare,
  newspaper: Newspaper,
  settings: Settings,
  trophy: Trophy
};

const JOB_SEARCH_SURFACE = "job-search" as ChatSurface;

export function AppShell(props: AppShellProps) {
  usePageContextSync();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // #368: the onboarding "Ask Jarvis" finish action drops a one-shot sessionStorage flag and
  // navigates here (the wizard lives outside the shell, so this is a fresh mount). On mount we
  // read-and-clear it: if set, open the drawer pre-filled with the setup-check starter (never
  // auto-sent). A refresh does not re-trigger it (the flag was consumed).
  const [askJarvisStarter, setAskJarvisStarter] = useState<string | undefined>(undefined);
  // #916 — a module-authored starter draft handed up via ChatControls.openAssistantWithDraft. One-
  // shot, mirrors #368's askJarvisStarter: seeds the composer on drawer open, cleared on close.
  const [moduleDraft, setModuleDraft] = useState<string | undefined>(undefined);
  const [focusActionRequestId, setFocusActionRequestId] = useState<string | null>(null);
  const embeddedComposerRef = useRef<((draft: string) => void) | null>(null);
  const [theme] = useState<ShellTheme>(() => loadShellTheme());
  const [colorMode] = useState(() => loadShellColorMode());
  useEffect(() => {
    if (consumeAskJarvis()) {
      setAskJarvisStarter(ASK_JARVIS_STARTER);
      setChatOpen(true);
    }
  }, []);
  const openChatWith = useCallback((prompt: string) => {
    setChatOpen(true);
    void sendChatTurn(prompt);
  }, []);
  const openChat = useCallback(() => setChatOpen(true), []);
  // #916 — open the drawer with a module-authored draft the user edits + submits (NEVER auto-sent;
  // contrast openChatWith, which sends). Direct setState in an event handler is correct here — this
  // is NOT a render-phase updater, so it is not the StrictMode double-fire trap #368 warned about.
  const openAssistantWithDraft = useCallback((draft: string) => {
    const embeddedComposer = embeddedComposerRef.current;
    if (embeddedComposer) {
      embeddedComposer(draft);
      return;
    }
    setModuleDraft(draft);
    setChatOpen(true);
  }, []);
  // Lifted to the shell so the SSE stream + transcript persist while the drawer is
  // closed and as the user navigates between pages — the chat follows the user.
  const { records, clearRecords, streamErrorCount } = useChatStream();
  // #1232 — the Job Search page has a second shell-owned stream. It keeps drawer and module
  // transcripts isolated while the app frame remains mounted around both.
  const { records: jobSearchRecords } = useChatStream(
    JOB_SEARCH_SURFACE,
    location.pathname.startsWith("/m/job-search")
  );
  const assistantRecordListeners = useRef({
    drawer: new Set<(records: readonly AssistantRecordV1[]) => void>(),
    "job-search": new Set<(records: readonly AssistantRecordV1[]) => void>()
  });
  const recordsRef = useRef({ drawer: records, "job-search": jobSearchRecords });
  recordsRef.current = { drawer: records, "job-search": jobSearchRecords };
  const subscribeAssistantRecords = useCallback<AssistantSurfaceHostValue["subscribeRecords"]>(
    (listener, surface) => {
      const key = surface === JOB_SEARCH_SURFACE ? "job-search" : "drawer";
      const listeners = assistantRecordListeners.current[key];
      listeners.add(listener);
      listener(recordsRef.current[key]);
      return () => listeners.delete(listener);
    },
    []
  );
  useEffect(() => {
    for (const listener of assistantRecordListeners.current.drawer) listener(records);
  }, [records]);
  useEffect(() => {
    for (const listener of assistantRecordListeners.current["job-search"])
      listener(jobSearchRecords);
  }, [jobSearchRecords]);
  // #1196/#1232 — one external route mounts at a time. Route hosts receive drafts inline while
  // the ordinary shell controls remain available for the visible drawer-isolation check.
  const registerAssistantComposer = useCallback<AssistantSurfaceHostValue["registerComposer"]>(
    (acceptDraft) => {
      embeddedComposerRef.current = acceptDraft;
      setChatOpen(false);
      setAskJarvisStarter(undefined);
      setModuleDraft(undefined);
      setFocusActionRequestId(null);
      return () => {
        if (embeddedComposerRef.current !== acceptDraft) return;
        embeddedComposerRef.current = null;
      };
    },
    []
  );
  const assistantSurfaceHost = useMemo<AssistantSurfaceHostValue>(
    () => ({
      records,
      recordsForSurface: (surface) => (surface === JOB_SEARCH_SURFACE ? jobSearchRecords : records),
      registerComposer: registerAssistantComposer,
      subscribeRecords: subscribeAssistantRecords
    }),
    [records, jobSearchRecords, registerAssistantComposer, subscribeAssistantRecords]
  );
  const pendingNotesDelete = useMemo(() => {
    const results = new Set(
      records
        .filter((record) => record.kind === "action_result" && record.actionRequestId)
        .map((record) => record.actionRequestId)
    );
    return (
      [...records]
        .reverse()
        .find(
          (record) =>
            record.kind === "action_request" &&
            record.toolName === "notes.delete" &&
            Boolean(record.actionRequestId) &&
            !results.has(record.actionRequestId)
        ) ?? null
    );
  }, [records]);
  const openActionRequest = useCallback((actionRequestId: string) => {
    setFocusActionRequestId(actionRequestId);
    setChatOpen(true);
  }, []);
  const navSections = useMemo(
    () => buildShellNavigation(props.modules, props.disabledModuleIds ?? []),
    [props.modules, props.disabledModuleIds]
  );
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: () => listNotifications()
  });
  const themesQuery = useQuery({
    queryKey: queryKeys.settings.themes,
    queryFn: () => listThemes()
  });
  const activeThemeId = themesQuery.data?.activeId ?? theme;
  useEffect(() => {
    const customTheme =
      themesQuery.data?.custom.find((custom) => custom.id === activeThemeId) ?? null;
    const isCustomTheme = Boolean(customTheme);
    const mode = isCustomTheme ? "light" : (themesQuery.data?.mode ?? colorMode);
    document.documentElement.setAttribute(
      "data-theme",
      isCustomTheme ? activeThemeId : activeThemeId === "dark" ? "light" : activeThemeId
    );
    document.documentElement.setAttribute("data-color-mode", mode);
    applyThemeTokens(document.documentElement.style, customTheme?.tokens ?? null);
    saveShellTheme(activeThemeId);
    saveShellColorMode(mode);
  }, [activeThemeId, colorMode, themesQuery.data?.custom, themesQuery.data?.mode]);
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const onTodayPage = location.pathname.startsWith("/today");
  const weatherQuery = useQuery({
    queryKey: queryKeys.weather.today,
    queryFn: getWeatherToday,
    staleTime: 30 * 60 * 1000,
    enabled: onTodayPage
  });
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/");
    }
  });

  const locale = useUserLocale();
  const { title, subtitle } = resolvePageHeading(location.pathname, new Date(), locale);
  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span className="brand-wordmark">Jarvis</span>
        </div>

        <nav className="module-nav" aria-label="Modules">
          {navSections.map((section) => (
            <div className="nav-group" key={section.key}>
              {section.label ? <p className="nav-group__label">{section.label}</p> : null}
              {section.items.map((entry) => (
                <NavItem key={entry.id} entry={entry} onClick={closeMobileNav} />
              ))}
            </div>
          ))}
          {props.modulesLoading ? <span className="nav-loading">Loading modules</span> : null}
        </nav>

        <div className="rail-foot">
          <RailUserMenu
            me={props.me}
            unreadCount={unreadCount}
            signOutPending={signOutMutation.isPending}
            onSignOut={() => signOutMutation.mutate()}
            onNavigate={(to) => {
              closeMobileNav();
              navigate(to);
            }}
          />
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          type="button"
          onClick={closeMobileNav}
        />
      ) : null}

      <div className="workspace-area">
        <header className="topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-only"
            title="Open navigation"
            type="button"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>

          <div className="topbar-titles">
            <span className="topbar-title">{title}</span>
            {subtitle ? <span className="topbar-subtitle">{subtitle}</span> : null}
          </div>

          {onTodayPage ? (
            <div className="topbar-context">
              <HeaderWeather weather={weatherQuery.data?.data ?? null} />
            </div>
          ) : null}

          <div className="topbar-actions">
            <button
              aria-label="Chat with Jarvis"
              aria-pressed={chatOpen}
              className={`icon-button ${chatOpen ? "active" : ""}`}
              title="Ask Jarvis"
              type="button"
              onClick={() => setChatOpen((open) => !open)}
            >
              <MessageSquare size={19} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="content-surface">
          <AssistantSurfaceHostProvider value={assistantSurfaceHost}>
            <ChatControlsProvider
              value={{
                openChat,
                openChatWith,
                openAssistantWithDraft,
                pendingNotesDelete: pendingNotesDelete
                  ? {
                      actionRequestId: pendingNotesDelete.actionRequestId!,
                      summary: pendingNotesDelete.summary ?? pendingNotesDelete.text
                    }
                  : null,
                openActionRequest
              }}
            >
              {props.children}
            </ChatControlsProvider>
          </AssistantSurfaceHostProvider>
        </main>
      </div>

      <CommandPalette
        modules={props.modules}
        disabledModuleIds={props.disabledModuleIds ?? []}
        themes={themesQuery.data}
        navigate={navigate}
      />

      <ChatDrawer
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setFocusActionRequestId(null);
          // #368: the starter is a one-shot — once the drawer closes, a later manual open starts
          // from a blank composer, not the setup-check chip.
          setAskJarvisStarter(undefined);
          // #368 + #916: starters are one-shot — a later manual open starts from a blank composer.
          setModuleDraft(undefined);
        }}
        records={records}
        clearRecords={clearRecords}
        streamErrorCount={streamErrorCount}
        isFounder={props.me.user.isBootstrapOwner}
        initialText={moduleDraft ?? askJarvisStarter}
        focusActionRequestId={focusActionRequestId}
        onActionRequestFocused={() => setFocusActionRequestId(null)}
      />
    </div>
  );
}

function formatUnreadCount(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

function initialOf(value: string): string {
  return (value.trim()[0] ?? "?").toUpperCase();
}

/** Account quick-menu at the rail foot: click the profile to open Notifications,
    Settings, the dark-mode toggle, and Log out in a popover. */
function RailUserMenu(props: {
  readonly me: MeResponse;
  readonly unreadCount: number;
  readonly signOutPending: boolean;
  readonly onSignOut: () => void;
  readonly onNavigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const name = props.me.user.name.trim() || props.me.user.email;

  return (
    <div className={`jds-usermenu ${open ? "is-open" : ""}`} ref={ref}>
      <button
        className={`jds-usermenu__trigger ${open ? "is-open" : ""}`}
        type="button"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="jds-usermenu__av">
          <span className="jds-avatar jds-avatar--sm">{initialOf(name)}</span>
        </span>
        <span className="jds-usermenu__id">
          <span className="jds-usermenu__nm">{name}</span>
          <span className="jds-usermenu__sub">{props.me.user.email}</span>
        </span>
        <span className="jds-usermenu__chev">
          <ChevronUp size={16} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="jds-usermenu__pop">
          <div className="jds-usermenu__list">
            <button
              className="jds-usermenu__item"
              type="button"
              onClick={() => {
                setOpen(false);
                props.onNavigate("/notifications");
              }}
            >
              <span className="jds-usermenu__ic">
                <Bell size={16} aria-hidden="true" />
              </span>
              <span className="jds-usermenu__lbl">Notifications</span>
              {props.unreadCount > 0 ? (
                <span className="jds-usermenu__tr">
                  <span className="jds-badge-count">{formatUnreadCount(props.unreadCount)}</span>
                </span>
              ) : null}
            </button>
            <button
              className="jds-usermenu__item"
              type="button"
              onClick={() => {
                setOpen(false);
                props.onNavigate("/settings");
              }}
            >
              <span className="jds-usermenu__ic">
                <Settings size={16} aria-hidden="true" />
              </span>
              <span className="jds-usermenu__lbl">Settings &amp; permissions</span>
            </button>
            <div className="jds-usermenu__div" />
            <button
              className="jds-usermenu__item is-danger"
              type="button"
              disabled={props.signOutPending}
              onClick={props.onSignOut}
            >
              <span className="jds-usermenu__ic">
                <LogOut size={16} aria-hidden="true" />
              </span>
              <span className="jds-usermenu__lbl">Log out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NavItem(props: {
  readonly entry: ModuleNavigationEntryDto;
  readonly onClick: () => void;
}) {
  const Icon = props.entry.icon ? (iconMap[props.entry.icon] ?? Layers3) : Layers3;

  return (
    <NavLink
      className={({ isActive }) => `module-link ${isActive ? "active" : ""}`}
      to={props.entry.path}
      onClick={props.onClick}
    >
      <Icon size={17} />
      <span>{props.entry.label}</span>
    </NavLink>
  );
}
