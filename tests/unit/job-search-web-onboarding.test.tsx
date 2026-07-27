// Task 19 (#1303): OnboardingScreen in isolation, plain node environment (no jsdom needed —
// this is a pure render, same reasoning as job-search-web-root.test.tsx's header). Uses the
// real ONBOARDING_STEPS from ../../external-modules/job-search/src/domain/criteria.ts (not a
// hardcoded local list) so a future step added there is exercised here for free, and so this
// suite would fail if the screen ever hardcoded its own step list.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { ONBOARDING_STEPS } from "../../external-modules/job-search/src/domain/criteria";
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
async function renderScreen(profileValue: Profile): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(OnboardingScreen, { profile: profileValue }));
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
});
