import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import {
  ApiError,
  getBootstrapStatus,
  getMe,
  getModules,
  getMyModules,
  getOnboardingStatus
} from "./api/client";
import { webRoutePath } from "./app-route-metadata";
import { queryKeys } from "./api/query-keys";
import { AuthScreen } from "./auth/auth-screen";
import { shouldShowOnboarding } from "./onboarding/resume";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
import { AppShell } from "./shell/app-shell";

const CalendarPage = lazy(() =>
  import("./calendar/calendar-page").then((module) => ({ default: module.CalendarPage }))
);
const NotificationsPage = lazy(() =>
  import("./notifications/notifications-page").then((module) => ({
    default: module.NotificationsPage
  }))
);
const SettingsPage = lazy(() =>
  import("./settings/settings-page").then((module) => ({ default: module.SettingsPage }))
);
const TodayPage = lazy(() =>
  import("./today/today-page").then((module) => ({ default: module.TodayPage }))
);
const TaskDetailPage = lazy(() =>
  import("./tasks/task-detail-page").then((module) => ({ default: module.TaskDetailPage }))
);
const TasksPage = lazy(() =>
  import("./tasks/tasks-page").then((module) => ({ default: module.TasksPage }))
);
const WellnessPage = lazy(() =>
  import("./wellness/wellness-page").then((module) => ({ default: module.WellnessPage }))
);

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
  const myModulesQuery = useQuery({
    enabled: meQuery.isSuccess,
    queryKey: queryKeys.myModules,
    queryFn: () => getMyModules(),
    retry: false
  });
  const disabledModuleIds =
    myModulesQuery.data?.modules.filter((m) => !m.active).map((m) => m.id) ?? [];
  // A disabled module's SPA route must not render its UI on a deep-link, not just hide its
  // nav entry — for a health-data module that means the page (and its API calls) never mount
  // for a disabled actor. We can only confirm the module is ENABLED once /api/me/modules
  // resolves successfully; until then the gate shows a loader. The gate FAILS CLOSED: if that
  // request errors we cannot prove the actor is enabled, so we redirect rather than risk
  // rendering the health-data UI for a disabled actor (Codex code-review).
  const myModulesEnabled = (moduleId: string): "loading" | "enabled" | "denied" => {
    if (myModulesQuery.isError) return "denied"; // fail closed: cannot prove enabled
    if (!myModulesQuery.isSuccess) return "loading";
    // Affirmative enablement only: require an explicit active row. "Not listed" (backend skew,
    // partial/malformed response) is NOT proof of enablement for a health-data route — deny it
    // (Codex code-review R3).
    const module = myModulesQuery.data.modules.find((m) => m.id === moduleId);
    return module?.active === true ? "enabled" : "denied";
  };
  const wellnessGate = myModulesEnabled("wellness");
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
      // The wizard is wrapped in BrowserRouter because member steps (api-key-opt-out,
      // section-tour) render react-router <Link> elements; rendering a <Link> outside a Router
      // throws a context invariant and crashes the app the moment the member advances into
      // those steps. The shell below mounts its own BrowserRouter — the two are never mounted
      // at once (this is an early return), so there is no nested-router conflict.
      return (
        <BrowserRouter>
          <OnboardingWizard
            initialStatus={onboardingStatus}
            onDone={() =>
              void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status })
            }
          />
        </BrowserRouter>
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
        disabledModuleIds={disabledModuleIds}
      >
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route index element={<Navigate to={webRoutePath("today")} replace />} />
            <Route path={webRoutePath("today")} element={<TodayPage me={meQuery.data} wellnessEnabled={wellnessGate === "enabled"} />} />
            <Route path={webRoutePath("tasks")} element={<TasksPage />} />
            <Route path={webRoutePath("task-detail")} element={<TaskDetailPage />} />
            <Route path={webRoutePath("notifications")} element={<NotificationsPage />} />
            <Route path={webRoutePath("calendar")} element={<CalendarPage />} />
            <Route
              path={webRoutePath("wellness")}
              element={
                <ModuleGatedRoute gate={wellnessGate}>
                  <WellnessPage />
                </ModuleGatedRoute>
              }
            />
            <Route path={webRoutePath("settings")} element={<SettingsPage me={meQuery.data} />} />
            <Route path="*" element={<Navigate to={webRoutePath("today")} replace />} />
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  );
}

/**
 * Renders a module's SPA route only when the actor's per-user module state proves the module
 * is enabled. "loading" → a loader (no flash of the gated UI); "denied" (disabled OR the
 * state request errored — fail closed) → redirect to /tasks so the gated UI never mounts;
 * "enabled" → render the children.
 */
function ModuleGatedRoute(props: {
  readonly gate: "loading" | "enabled" | "denied";
  readonly children: ReactNode;
}) {
  if (props.gate === "loading") return <LoadingScreen />;
  if (props.gate === "denied") return <Navigate to="/tasks" replace />;
  return <>{props.children}</>;
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
