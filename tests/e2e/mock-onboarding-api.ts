import type { Page, Route } from "@playwright/test";
import type { OnboardingFounderStatus } from "@jarv1s/shared";

export interface MockOnboardingApiState {
  // Phase 4 widened the status to a role union; this spine mock serves the FOUNDER variant.
  onboardingStatus?: OnboardingFounderStatus;
}

export function defaultOnboardingStatus(
  overrides: Partial<OnboardingFounderStatus> = {}
): OnboardingFounderStatus {
  return {
    role: "founder",
    state: "pending",
    steps: {
      multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
      cliAuth: {
        done: false,
        providers: [
          { kind: "anthropic", cliPresent: false },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
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
    state.onboardingStatus = {
      ...(state.onboardingStatus ?? defaultOnboardingStatus()),
      state: next
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: next }) // OnboardingStateResponse
    });
  };
  await page.route("**/api/onboarding/status", (route) => get(route));
  await page.route("**/api/onboarding/complete", (route) => setState(route, "completed"));
  await page.route("**/api/onboarding/skip", (route) => setState(route, "skipped"));
  // The multiplexer step writes via the DEDICATED adapter route PUT /api/admin/chat-multiplexer
  // (NOT a generic settings PATCH). Mirror its ChatMultiplexerSettingsDto response shape.
  // This route is ALSO read (GET) by the admin settings panel (getChatMultiplexerSettings),
  // so existing specs that render that panel hit it without a body — handle GET separately
  // (return the current snapshot) instead of assuming every request is a write.
  await page.route(/\/api\/admin\/chat-multiplexer$/, (route) => {
    if (route.request().method() === "GET") {
      const snapshot = state.onboardingStatus ?? defaultOnboardingStatus();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          multiplexer: snapshot.steps.multiplexer.selected ?? "auto",
          available: {
            tmux: snapshot.steps.multiplexer.tmuxUsable,
            herdr: snapshot.steps.multiplexer.herdrUsable
          }
        }) // ChatMultiplexerSettingsDto
      });
    }
    const body = route.request().postDataJSON() as { multiplexer: "auto" | "tmux" | "herdr" };
    const choice = body.multiplexer;
    const prev = state.onboardingStatus ?? defaultOnboardingStatus();
    // Reflect selection; mark done iff the chosen choice maps to a usable backend in the mock's
    // current snapshot (so e2e can drive both the usable and the not-yet-usable paths).
    const usable =
      choice === "tmux"
        ? prev.steps.multiplexer.tmuxUsable
        : choice === "herdr"
          ? prev.steps.multiplexer.herdrUsable
          : prev.steps.multiplexer.tmuxUsable || prev.steps.multiplexer.herdrUsable;
    state.onboardingStatus = {
      ...prev,
      steps: {
        ...prev.steps,
        multiplexer: { ...prev.steps.multiplexer, done: usable, selected: choice }
      }
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        multiplexer: choice,
        available: {
          tmux: state.onboardingStatus.steps.multiplexer.tmuxUsable,
          herdr: state.onboardingStatus.steps.multiplexer.herdrUsable
        }
      }) // ChatMultiplexerSettingsDto
    });
  });
}
