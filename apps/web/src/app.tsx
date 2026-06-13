import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { ApiError, getBootstrapStatus, getMe, getModules, getOnboardingStatus } from "./api/client";
import { queryKeys } from "./api/query-keys";
import { AuthScreen } from "./auth/auth-screen";
import { shouldShowOnboarding } from "./onboarding/resume";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
import { BriefingsPage } from "./briefings/briefings-page";
import { CalendarPage } from "./calendar/calendar-page";
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
  // Phase 4: onboarding is no longer founder-only. Any ACTIVE authenticated user fetches their
  // role-appropriate status (founder = instance-global; member = per-user). Pending/deactivated
  // identities never reach here (handled by the error branches below before the shell renders).
  const activeForOnboarding = meQuery.data?.user.status === "active";
  const onboardingQuery = useQuery({
    enabled: activeForOnboarding,
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false // getOnboardingStatus is itself bounded by a 4s timeout (client.ts)
  });

  const handleAuthenticated = async () => {
    // Data-isolation on the shared house instance: a newly authenticated identity
    // must never inherit the previous user's cached data. resetQueries() evicts
    // every cached query to its initial state — including inactive entries the
    // prior user left behind — and refetches the mounted identity queries under
    // the new session cookie. invalidateQueries was insufficient on two counts:
    // (1) it kept the prior user's data visible while refetching, and (2) its
    // prefix list omitted the "settings" and "connectors" namespaces, so that
    // cached data was never refreshed at all. (We use resetQueries, not clear():
    // clear() destroys queries without notifying their observers, so the mounted
    // `me`/`bootstrap` queries would never refetch and sign-in would hang.)
    await queryClient.resetQueries();
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

  if (meQuery.error instanceof ApiError && meQuery.error.code === "account_pending_approval") {
    return <PendingApprovalScreen />;
  }

  if (meQuery.error instanceof ApiError && meQuery.error.code === "account_deactivated") {
    return <DeactivatedScreen />;
  }

  if (!meQuery.data) {
    return (
      <FatalState
        message={readErrorMessage(meQuery.error)}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: ["auth"] })}
      />
    );
  }

  if (activeForOnboarding) {
    // A hung status read cannot trap the user: getOnboardingStatus is bounded to 4s, so
    // isLoading resolves to data-or-error within that window. We show a bounded loader only
    // on first boot (avoids a shell flash before the wizard); on error/timeout
    // onboardingQuery.data is undefined ⇒ we fall through to the app shell below.
    if (onboardingQuery.isLoading) {
      return <LoadingScreen />;
    }
    const onboardingStatus = onboardingQuery.data;
    // Phase 4: the gate fires for any active user whose role-appropriate onboarding is incomplete.
    //   Founder: shouldShowOnboarding (bootstrap owner + instance-global state === "pending").
    //   Member:  per-user completion — the wizard shows until app.member_onboarding.completed_at
    //            is stamped (skip == complete).
    // On a status error/timeout onboardingStatus is undefined ⇒ neither branch fires ⇒ shell.
    const incomplete =
      onboardingStatus !== undefined &&
      (onboardingStatus.role === "founder"
        ? shouldShowOnboarding(meQuery.data, onboardingStatus)
        : !onboardingStatus.completed);
    if (incomplete) {
      return (
        <OnboardingWizard
          initialStatus={onboardingStatus}
          onDone={() =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status })
          }
        />
      );
    }
    // else: terminal/complete state OR errored/timed-out ⇒ fall through to the shell.
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

function PendingApprovalScreen() {
  return (
    <main className="center-screen">
      <section className="auth-panel">
        <h1>Jarv1s</h1>
        <p>Your account is pending approval by an administrator.</p>
        <p className="form-hint">
          You will be able to sign in once your account has been approved.
        </p>
      </section>
    </main>
  );
}

function DeactivatedScreen() {
  return (
    <main className="center-screen">
      <section className="auth-panel">
        <h1>Jarv1s</h1>
        <p className="form-error">Your account has been deactivated.</p>
        <p className="form-hint">Please contact your administrator for assistance.</p>
      </section>
    </main>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Jarv1s";
}
