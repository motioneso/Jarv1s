import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocaleSettingsDto, NotificationDto } from "@jarv1s/shared";
import { Bell, Check, CheckCheck, Inbox, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { formatDateTime, useUserLocale } from "../locale/locale-format";

const notificationFilters = ["all", "unread"] as const;

type NotificationFilter = (typeof notificationFilters)[number];

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: () => listNotifications()
  });
  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list })
  });
  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list })
  });
  const notifications = useMemo(() => {
    const items = notificationsQuery.data?.notifications ?? [];

    return filter === "unread" ? items.filter((notification) => !notification.readAt) : items;
  }, [filter, notificationsQuery.data?.notifications]);
  const totalCount = notificationsQuery.data?.notifications.length ?? 0;
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  return (
    <section className="page-stack" aria-labelledby="notifications-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1 id="notifications-title">Notifications</h1>
        </div>

        <button
          className="secondary-button"
          disabled={unreadCount === 0 || markAllReadMutation.isPending}
          type="button"
          onClick={() => markAllReadMutation.mutate()}
        >
          {markAllReadMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <CheckCheck size={18} aria-hidden="true" />
          )}
          Mark all read
        </button>
      </div>

      <section className="task-toolbar" aria-label="Notification filters">
        <div className="segmented-control wide" aria-label="Read filter">
          {notificationFilters.map((status) => (
            <button
              className={filter === status ? "active" : ""}
              key={status}
              type="button"
              onClick={() => setFilter(status)}
            >
              {status[0]?.toUpperCase()}
              {status.slice(1)}
              <span>{status === "unread" ? unreadCount : totalCount}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="task-list" aria-live="polite">
        {notificationsQuery.isLoading ? (
          <EmptyState loading title="Loading notifications" />
        ) : notificationsQuery.error ? (
          <EmptyState title={notificationsQuery.error.message} />
        ) : notifications.length === 0 ? (
          <EmptyState title="No notifications" />
        ) : (
          notifications.map((notification) => (
            <NotificationRow
              isUpdating={markReadMutation.isPending}
              key={notification.id}
              notification={notification}
              onMarkRead={() => markReadMutation.mutate(notification.id)}
            />
          ))
        )}
      </section>
    </section>
  );
}

function NotificationRow(props: {
  readonly isUpdating: boolean;
  readonly notification: NotificationDto;
  readonly onMarkRead: () => void;
}) {
  const locale = useUserLocale();
  const unread = !props.notification.readAt;
  const upgrade = props.notification.metadata.kind === "upgrade_available";

  return (
    <article className={`task-row notification-row ${unread ? "unread" : ""}`}>
      <div className="task-status-icon" aria-hidden="true">
        <Bell size={22} />
      </div>
      <div className="task-row-main">
        <strong>{props.notification.title}</strong>
        {props.notification.body ? <p>{props.notification.body}</p> : null}
        {upgrade ? (
          <Link className="jds-btn jds-btn--sm jds-btn--secondary" to="/settings?section=host">
            View changes
          </Link>
        ) : null}
        <div className="task-meta">
          <span>{unread ? "Unread" : "Read"}</span>
          <span>{formatNotificationDate(props.notification.createdAt, locale)}</span>
        </div>
      </div>
      <div className="task-row-actions">
        <button
          aria-label={`Mark ${props.notification.title} read`}
          className="icon-button"
          disabled={props.isUpdating || !unread}
          title="Mark read"
          type="button"
          onClick={props.onMarkRead}
        >
          {props.isUpdating ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </article>
  );
}

function EmptyState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <div className="empty-state">
      {props.loading ? (
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      ) : (
        <Inbox size={22} aria-hidden="true" />
      )}
      <p>{props.title}</p>
    </div>
  );
}

function formatNotificationDate(value: string | null, locale: LocaleSettingsDto): string {
  if (!value) {
    return "No date";
  }

  return formatDateTime(value, locale);
}
