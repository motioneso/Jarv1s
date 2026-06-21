import type { Page, Route } from "@playwright/test";
import type { OnboardingFounderStatus, OnboardingStatusResponse } from "@jarv1s/shared";

export interface MockOnboardingApiState {
  // Phase 4 widened the status to a role union; the spine default is the FOUNDER variant, but a
  // member spec can set the MEMBER variant ({ role: "member", completed, steps }) here directly.
  onboardingStatus?: OnboardingStatusResponse;
  onboardingProviderCheckStatus?:
    | "ready"
    | "needs_login"
    | "not_installed"
    | "multiplexer_unavailable"
    | "error";
}

export function defaultOnboardingStatus(
  overrides: Partial<OnboardingFounderStatus> = {}
): OnboardingFounderStatus {
  return {
    role: "founder",
    state: "pending",
    steps: {
      // v0.1.3: the multiplexer onboarding STEP is gone (OnboardingStepsDto = cliAuth + connectors),
      // and only `anthropic` is offered as an onboarding provider (codex/openai-compatible + google
      // are no longer surfaced in the wizard).
      cliAuth: {
        done: false,
        providers: [{ kind: "anthropic", cliPresent: false }]
      },
      connectors: { done: false }
    },
    ...overrides
  };
}

export async function registerMockOnboardingRoutes(
  page: Page,
  state: MockOnboardingApiState
): Promise<void> {
  const get = (route: Route) => {
    // Default to a COMPLETED status so existing specs (which never set onboardingStatus)
    // fall straight through to the app shell — the wizard never hijacks them. The onboarding
    // spec opts in explicitly with onboardingStatus: defaultOnboardingStatus() (state pending).
    const status = state.onboardingStatus ?? defaultOnboardingStatus({ state: "completed" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status)
    });
  };
  const setState = (route: Route, next: "completed" | "skipped") => {
    const current = state.onboardingStatus ?? defaultOnboardingStatus();
    if (current.role === "member") {
      // Member: complete and skip are both terminal "onboarded" (no separate skipped lifecycle).
      // Flip completed:true so the refetched status falls through to the shell, and respond with
      // the member-shaped OnboardingMemberCompleteResponse ({ completed }).
      state.onboardingStatus = { ...current, completed: true };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ completed: true }) // OnboardingMemberCompleteResponse
      });
    }
    // Founder: instance-global lifecycle keyed on OnboardingState.
    state.onboardingStatus = { ...current, state: next };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: next }) // OnboardingStateResponse
    });
  };
  await page.route("**/api/onboarding/status", (route) => get(route));
  await page.route("**/api/onboarding/provider-check", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: state.onboardingProviderCheckStatus ?? "ready" })
    })
  );
  await page.route("**/api/onboarding/complete", (route) => setState(route, "completed"));
  await page.route("**/api/onboarding/skip", (route) => setState(route, "skipped"));
  // The ADMIN chat-multiplexer adapter (PUT/GET /api/admin/chat-multiplexer) is a SEPARATE
  // surface from onboarding — it survived the v0.1.3 removal of the multiplexer onboarding step.
  // It is read (GET) by the admin settings panel (getChatMultiplexerSettings) and written (PUT)
  // when an admin changes the choice. It is NO LONGER tied to the onboarding status snapshot
  // (which no longer carries a multiplexer step); the mock keeps an independent choice and echoes
  // a static `available` map. ChatMultiplexerSettingsDto = { multiplexer, available }.
  let adminMultiplexerChoice: "auto" | "tmux" | "herdr" = "auto";
  const adminMultiplexerAvailable = { tmux: false, herdr: false };
  await page.route(/\/api\/admin\/chat-multiplexer$/, (route) => {
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON() as { multiplexer: "auto" | "tmux" | "herdr" };
      adminMultiplexerChoice = body.multiplexer;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        multiplexer: adminMultiplexerChoice,
        available: adminMultiplexerAvailable
      }) // ChatMultiplexerSettingsDto
    });
  });
}
