import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { ApiError, getBootstrapStatus, getMe, getModules } from "./api/client";
import { queryKeys } from "./api/query-keys";
import { AuthScreen } from "./auth/auth-screen";
import { BriefingsPage } from "./briefings/briefings-page";
import { CalendarPage } from "./calendar/calendar-page";
import { ChatPage } from "./chat/chat-page";
import { EmailPage } from "./email/email-page";
import { NotificationsPage } from "./notifications/notifications-page";
import { SettingsPage } from "./settings/settings-page";
import { AppShell } from "./shell/app-shell";
import { TaskDetailPage } from "./tasks/task-detail-page";
import { TasksPage } from "./tasks/tasks-page";

const WORKSPACE_STORAGE_KEY = "jarv1s.activeWorkspaceId";

export function App() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(readStoredWorkspaceId);
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.auth.bootstrap,
    queryFn: getBootstrapStatus
  });
  const meQuery = useQuery({
    queryKey: queryKeys.auth.me(workspaceId),
    queryFn: () => getMe(workspaceId),
    retry: false
  });
  const modulesQuery = useQuery({
    enabled: meQuery.isSuccess,
    queryKey: queryKeys.modules(workspaceId),
    queryFn: () => getModules(workspaceId),
    retry: false
  });

  useEffect(() => {
    if (!(meQuery.error instanceof ApiError) || meQuery.error.status !== 401 || !workspaceId) {
      return;
    }

    setWorkspaceIdState(null);
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }, [meQuery.error, workspaceId]);

  useEffect(() => {
    const workspaces = meQuery.data?.workspaces ?? [];

    if (workspaceId || workspaces.length === 0) {
      return;
    }

    const firstWorkspaceId = workspaces[0]?.id;
    if (firstWorkspaceId) {
      setWorkspaceId(firstWorkspaceId);
    }
  }, [meQuery.data?.workspaces, workspaceId]);

  const setWorkspaceId = (nextWorkspaceId: string | null) => {
    setWorkspaceIdState(nextWorkspaceId);
    if (nextWorkspaceId) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, nextWorkspaceId);
    } else {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  };

  const handleAuthenticated = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.bootstrap }),
      queryClient.invalidateQueries({ queryKey: ["auth"] }),
      queryClient.invalidateQueries({ queryKey: ["ai"] }),
      queryClient.invalidateQueries({ queryKey: ["briefings"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["chat"] }),
      queryClient.invalidateQueries({ queryKey: ["email"] }),
      queryClient.invalidateQueries({ queryKey: ["modules"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    ]);
  };

  if (bootstrapQuery.isLoading || meQuery.isLoading) {
    return <LoadingScreen />;
  }

  if (meQuery.error instanceof ApiError && meQuery.error.status === 401 && !workspaceId) {
    return (
      <AuthScreen
        needsBootstrap={bootstrapQuery.data?.needsBootstrap ?? false}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (!meQuery.data) {
    return (
      <FatalState
        message={readErrorMessage(meQuery.error)}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: ["auth"] })}
      />
    );
  }

  return (
    <BrowserRouter>
      <AppShell
        activeWorkspaceId={workspaceId}
        me={meQuery.data}
        modules={modulesQuery.data?.modules ?? []}
        modulesLoading={modulesQuery.isLoading}
        onWorkspaceChange={setWorkspaceId}
      >
        <Routes>
          <Route index element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TasksPage activeWorkspaceId={workspaceId} />} />
          <Route
            path="/tasks/:taskId"
            element={<TaskDetailPage activeWorkspaceId={workspaceId} />}
          />
          <Route
            path="/notifications"
            element={<NotificationsPage activeWorkspaceId={workspaceId} />}
          />
          <Route path="/calendar" element={<CalendarPage activeWorkspaceId={workspaceId} />} />
          <Route path="/email" element={<EmailPage activeWorkspaceId={workspaceId} />} />
          <Route path="/chat" element={<ChatPage activeWorkspaceId={workspaceId} />} />
          <Route path="/briefings" element={<BriefingsPage activeWorkspaceId={workspaceId} />} />
          <Route
            path="/settings"
            element={<SettingsPage activeWorkspaceId={workspaceId} me={meQuery.data} />}
          />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loading-mark" aria-hidden="true" />
      <p>Loading Jarv1s</p>
    </main>
  );
}

function FatalState(props: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <main className="center-screen">
      <section className="auth-panel">
        <h1>Jarv1s</h1>
        <p className="form-error">{props.message}</p>
        <button className="primary-button" type="button" onClick={props.onRetry}>
          Retry
        </button>
      </section>
    </main>
  );
}

function readStoredWorkspaceId(): string | null {
  return localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Jarv1s";
}
