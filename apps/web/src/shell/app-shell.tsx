import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  FileText,
  Layers3,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Newspaper,
  Settings,
  UserCircle
} from "lucide-react";
import { type ComponentType, type ReactNode, useMemo, useState } from "react";
import { NavLink } from "react-router";

import { listNotifications, signOut } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ChatDrawer } from "../chat/chat-drawer";
import { useChatStream } from "../chat/use-chat-stream";
import type { MeResponse, ModuleDto, ModuleNavigationEntryDto } from "@jarv1s/shared";

/** Module-nav id of the chat entry, which the shell renders as a drawer toggle. */
const CHAT_NAV_ID = "chat";

interface AppShellProps {
  readonly children: ReactNode;
  readonly me: MeResponse;
  readonly modules: readonly ModuleDto[];
  readonly modulesLoading: boolean;
}

const iconMap: Record<string, ComponentType<{ readonly size?: number }>> = {
  bell: Bell,
  "calendar-days": CalendarDays,
  "check-square": CheckSquare,
  "file-text": FileText,
  mail: Mail,
  "message-square": MessageSquare,
  newspaper: Newspaper,
  settings: Settings
};

export function AppShell(props: AppShellProps) {
  const queryClient = useQueryClient();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Lifted to the shell so the SSE stream + transcript persist while the drawer is
  // closed and as the user navigates between pages — the chat follows the user.
  const { records, clearRecords } = useChatStream();
  const navigation = useMemo(() => readNavigation(props.modules), [props.modules]);
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

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            J
          </div>
          <div>
            <p className="eyebrow">Jarv1s</p>
          </div>
        </div>

        <nav className="module-nav" aria-label="Modules">
          {navigation.map((entry) =>
            entry.id === CHAT_NAV_ID ? (
              <ChatNavToggle
                key={entry.id}
                entry={entry}
                active={chatOpen}
                onToggle={() => {
                  setChatOpen((open) => !open);
                  setMobileNavOpen(false);
                }}
              />
            ) : (
              <NavItem key={entry.id} entry={entry} onClick={() => setMobileNavOpen(false)} />
            )
          )}
          {props.modulesLoading ? <span className="nav-loading">Loading modules</span> : null}
        </nav>
      </aside>

      {mobileNavOpen ? (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          type="button"
          onClick={() => setMobileNavOpen(false)}
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

          <div className="topbar-account">
            <UserCircle size={20} aria-hidden="true" />
            <span>{props.me.user.email}</span>
          </div>

          <NavLink
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className={({ isActive }) =>
              `icon-button notification-link ${isActive ? "active" : ""}`
            }
            title="Notifications"
            to="/notifications"
          >
            <Bell size={19} aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="notification-badge">{formatUnreadCount(unreadCount)}</span>
            ) : null}
          </NavLink>

          <button
            className="ghost-button"
            disabled={signOutMutation.isPending}
            title={signOutMutation.error ? signOutMutation.error.message : undefined}
            type="button"
            onClick={() => signOutMutation.mutate()}
          >
            <LogOut size={18} aria-hidden="true" />
            {signOutMutation.error ? "Sign out failed — retry?" : "Sign out"}
          </button>
        </header>

        <main className="content-surface">{props.children}</main>
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
      <Icon size={18} />
      <span>{props.entry.label}</span>
    </NavLink>
  );
}

function ChatNavToggle(props: {
  readonly entry: ModuleNavigationEntryDto;
  readonly active: boolean;
  readonly onToggle: () => void;
}) {
  const Icon = props.entry.icon ? (iconMap[props.entry.icon] ?? Layers3) : Layers3;

  return (
    <button
      type="button"
      className={`module-link ${props.active ? "active" : ""}`}
      aria-pressed={props.active}
      onClick={props.onToggle}
    >
      <Icon size={18} />
      <span>{props.entry.label}</span>
    </button>
  );
}

function readNavigation(modules: readonly ModuleDto[]): ModuleNavigationEntryDto[] {
  return modules
    .flatMap((module) => module.navigation)
    .sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    });
}
