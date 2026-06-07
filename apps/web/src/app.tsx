import { useQuery, useQueryClient } from "@tanstack/react-query";
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

export function App() {
  const queryClient = useQueryClient();
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.auth.bootstrap,
    queryFn: getBootstrapStatus
  });
  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => getMe(),
    retry: false
  });
  const modulesQuery = useQuery({
    enabled: meQuery.isSuccess,
    queryKey: queryKeys.modules,
    queryFn: () => getModules(),
    retry: false
  });

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

  if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
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
        me={meQuery.data}
        modules={modulesQuery.data?.modules ?? []}
        modulesLoading={modulesQuery.isLoading}
      >
        <Routes>
          <Route index element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/briefings" element={<BriefingsPage />} />
          <Route path="/settings" element={<SettingsPage me={meQuery.data} />} />
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Jarv1s";
}
