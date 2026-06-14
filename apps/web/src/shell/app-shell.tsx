import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronUp,
  FileText,
  HeartPulse,
  House,
  Layers3,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Newspaper,
  Settings,
  Sun
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

import { listNotifications, sendChatTurn, signOut } from "../api/client";
import { buildShellNavigation, resolvePageHeading } from "../app-route-metadata";
import { queryKeys } from "../api/query-keys";
import { ChatDrawer } from "../chat/chat-drawer";
import { useChatStream } from "../chat/use-chat-stream";
import { ChatControlsProvider } from "./chat-controls-context";
import { HeaderWeather } from "../today/header-weather";
import { loadShellTheme, saveShellTheme, type ShellTheme } from "./theme-storage";
import type { MeResponse, ModuleDto, ModuleNavigationEntryDto } from "@jarv1s/shared";

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
  "calendar-days": CalendarDays,
  "check-square": CheckSquare,
  "file-text": FileText,
  "heart-pulse": HeartPulse,
  mail: Mail,
  "message-square": MessageSquare,
  newspaper: Newspaper,
  settings: Settings
};

/** Strata mark — neutral bars in currentColor, the active stratum in Pine. */
function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <rect x="4" y="5.5" width="13" height="3" rx="1.5" fill="currentColor" />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="4" y="15.5" width="9" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function AppShell(props: AppShellProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState<ShellTheme>(() => loadShellTheme());
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveShellTheme(theme);
  }, [theme]);

  const openChatWith = useCallback((prompt: string) => {
    setChatOpen(true);
    void sendChatTurn(prompt);
  }, []);
  // Lifted to the shell so the SSE stream + transcript persist while the drawer is
  // closed and as the user navigates between pages — the chat follows the user.
  const { records, clearRecords } = useChatStream();
  const navSections = useMemo(
    () => buildShellNavigation(props.modules, props.disabledModuleIds ?? []),
    [props.modules, props.disabledModuleIds]
  );
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: () => listNotifications()
  });
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/");
    }
  });

  const { title, subtitle } = resolvePageHeading(location.pathname);
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
            theme={theme}
            unreadCount={unreadCount}
            signOutPending={signOutMutation.isPending}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
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

          {location.pathname.startsWith("/today") ? (
            <div className="topbar-context">
              <HeaderWeather />
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
          <ChatControlsProvider value={{ openChatWith }}>{props.children}</ChatControlsProvider>
        </main>
      </div>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        records={records}
        clearRecords={clearRecords}
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
  readonly theme: "light" | "dark";
  readonly unreadCount: number;
  readonly signOutPending: boolean;
  readonly onToggleTheme: () => void;
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
            <button className="jds-usermenu__item" type="button" onClick={props.onToggleTheme}>
              <span className="jds-usermenu__ic">
                {props.theme === "dark" ? (
                  <Sun size={16} aria-hidden="true" />
                ) : (
                  <Moon size={16} aria-hidden="true" />
                )}
              </span>
              <span className="jds-usermenu__lbl">Dark mode</span>
              <span className="jds-usermenu__tr">
                <span
                  className="jds-miniswitch"
                  {...(props.theme === "dark" ? { "data-on": "" } : {})}
                >
                  <span />
                </span>
              </span>
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
