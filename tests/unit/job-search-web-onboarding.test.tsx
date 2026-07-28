// Task 19 (#1303): OnboardingScreen in isolation, plain node environment (no jsdom needed —
// this is a pure render, same reasoning as job-search-web-root.test.tsx's header). Uses the
// real ONBOARDING_STEPS from ../../external-modules/job-search/src/domain/criteria.ts (not a
// hardcoded local list) so a future step added there is exercised here for free, and so this
// suite would fail if the screen ever hardcoded its own step list.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { ONBOARDING_STEPS } from "../../external-modules/job-search/src/domain/criteria";
import type { AssistantSurfaceHandleV1 } from "../../external-modules/job-search/src/domain/seed-prompt";
import { OnboardingScreen } from "../../external-modules/job-search/src/web/screens/onboarding";
import type { Profile } from "../../external-modules/job-search/src/web/use-profiles";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    profileId: "p1",
    name: "Acme SWE search",
    state: "in_conversation",
    briefingDetail: null,
    completedSteps: [],
    readyToCrawl: false,
    ...overrides
  };
}

// react-test-renderer's create() must run inside act() — without it, React 19's function
// component render is scheduled rather than flushed synchronously and toJSON() reads back null.
// Async act (job-search-web-root.test.tsx's renderRoot precedent) avoids the "testing
// environment not configured to support act" warning a sync act callback triggers here.
async function renderScreen(
  profileValue: Profile,
  assistantSurface?: AssistantSurfaceHandleV1
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(OnboardingScreen, { profile: profileValue, assistantSurface }));
  });
  return renderer;
}

function flatten(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flatten).join(" ");
  if (typeof node === "object" && "children" in (node as { children?: unknown })) {
    return flatten((node as { children?: unknown }).children);
  }
  return "";
}

function text(renderer: ReactTestRenderer): string {
  return flatten(renderer.toJSON()).replace(/\s+/g, " ").trim();
}

function chips(renderer: ReactTestRenderer): { text: string; done: boolean }[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "span" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("jds-badge")
    )
    .map((node) => ({
      text: flatten(node.props.children as unknown).trim(),
      done: (node.props.className as string).includes("jds-badge--forest")
    }));
}

describe("OnboardingScreen", () => {
  it("renders one chip per ONBOARDING_STEPS entry, with the done ones marked from completedSteps", async () => {
    const completed = [ONBOARDING_STEPS[0], ONBOARDING_STEPS[2]];
    const renderer = await renderScreen(profile({ completedSteps: completed }));

    const rendered = chips(renderer);
    expect(rendered.map((c) => c.text)).toEqual([...ONBOARDING_STEPS]);
    for (const step of ONBOARDING_STEPS) {
      const chip = rendered.find((c) => c.text === step);
      expect(chip?.done).toBe(completed.includes(step));
    }
  });

  it("renders the calm copy for an empty profile, not a spinner", async () => {
    const renderer = await renderScreen(profile({ completedSteps: [] }));

    expect(text(renderer)).toMatch(
      /nothing gets crawled until we both know what we.re looking for/i
    );
    expect(text(renderer)).not.toMatch(/loading/i);
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  });

  it("renders no table, rail, or source strip during onboarding", async () => {
    const renderer = await renderScreen(profile({ completedSteps: [...ONBOARDING_STEPS] }));

    expect(renderer.root.findAllByType("table")).toHaveLength(0);
    const classNames = renderer.root
      .findAll((node) => typeof node.props.className === "string")
      .map((node) => node.props.className as string);
    expect(classNames.some((c) => /rail|strip|board/.test(c))).toBe(false);
  });

  it("renders the conversation as the host's own Surface, with the composer turned on", async () => {
    // A plain function, not a mock of the real AssistantSurface — this test only needs to prove
    // OnboardingScreen hands the host's Surface to h() and turns its composer on, not that the
    // host's own chat UI works (that's surface.tsx's suite).
    function SurfaceSpy(_props: { composer?: unknown }) {
      return createElement("div", { "data-testid": "job-search-onboarding-surface" });
    }
    const surface: AssistantSurfaceHandleV1 = {
      setSurfaceKey: vi.fn(),
      seedContext: vi.fn().mockResolvedValue(undefined),
      Surface: SurfaceSpy
    };

    const renderer = await renderScreen(profile(), surface);

    const rendered = renderer.root.findAllByType(SurfaceSpy);
    expect(rendered).toHaveLength(1);
    // AssistantSurface (surface.tsx) renders no input box at all when `composer` is absent, so a
    // truthy `composer` prop is what makes this an actual chat rather than a read-only transcript.
    expect(rendered[0].props.composer).toBeTruthy();
  });

  it("with no assistantSurface, still renders chips and copy, and says the conversation is unavailable rather than throwing", async () => {
    const completed = [ONBOARDING_STEPS[0]];

    const renderer = await renderScreen(profile({ completedSteps: completed }));

    const rendered = chips(renderer);
    expect(rendered.map((c) => c.text)).toEqual([...ONBOARDING_STEPS]);
    expect(text(renderer)).toMatch(
      /nothing gets crawled until we both know what we.re looking for/i
    );
    expect(text(renderer)).toMatch(/conversation isn.t available/i);
  });
});
