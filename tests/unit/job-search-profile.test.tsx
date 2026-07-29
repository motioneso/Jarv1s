// tests/unit/job-search-profile.test.tsx
//
// K4 (2026-07-28 keyline-restructure plan): ProfileScreen in isolation, same plain node
// environment and api.ts mocking pattern as job-search-web-settings.test.tsx (no jsdom needed —
// job-search-web-onboarding.test.tsx's header explains why). Covers the four cases the plan named
// for this screen: the résumé date renders with no ambient-locale dependence (the fix for the
// settings.tsx:193 defect this move carries forward), the empty-résumé state, every onboarding
// step rendering from completedSteps, and the briefing-detail control (moved here verbatim from
// job-search-web-settings.test.tsx along with the control itself — coverage moved, not dropped).
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import {
  PROFILE_SET_BRIEFING_DETAIL_QUEUE,
  ProfileScreen,
  RESUME_GET_TOOL
} from "../../external-modules/job-search/src/web/screens/profile";
import * as api from "../../external-modules/job-search/src/web/api";
import type { Profile } from "../../external-modules/job-search/src/web/use-profiles";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    profileId: "p1",
    name: "Acme SWE search",
    state: "active",
    briefingDetail: null,
    completedSteps: ["role", "want", "where", "comp", "sources"],
    readyToCrawl: true,
    surfaceKey: "surf-1",
    ...overrides
  };
}

async function renderScreen(profileValue: Profile): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(ProfileScreen, { profile: profileValue }));
  });
  return renderer;
}

// Flushes the microtask queue a few times over — enough for a mocked invokeTool/runQueue's
// resolved promise to reach its .then(setState) (same pattern as job-search-web-settings.test.tsx's
// flush helper, itself copied from job-search-web-root.test.tsx).
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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

describe("ProfileScreen", () => {
  beforeEach(() => {
    vi.mocked(api.invokeTool).mockReset();
    vi.mocked(api.runQueue).mockReset();
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the résumé's saved-on date from a fixed instant with no locale dependence", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({
      resume: { version: 3, content: "x".repeat(1200), updatedAt: "2026-07-15T09:00:00.000Z" }
    });

    const renderer = await renderScreen(profile());
    await flush();

    expect(api.invokeTool).toHaveBeenCalledWith(RESUME_GET_TOOL, { profileId: "p1" });
    // formatPostedOn's string-arithmetic "Jul 15" — never Date#toLocaleDateString, which resolves
    // against the *ambient* locale/timezone of whatever machine runs the test (the exact defect
    // this move fixes, settings.tsx:193 before K4).
    expect(text(renderer)).toContain("Jul 15");
    expect(text(renderer)).toContain("3");
    expect(text(renderer)).toContain("1200 characters");
  });

  it("renders the empty-résumé state with no version number when resume is null", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({ resume: null });

    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered).toMatch(/None yet/);
    expect(rendered).not.toMatch(/Version \d/);
    // "On file" reads No, not a blank or a thrown error.
    expect(rendered).toMatch(/No/);
  });

  it("renders every one of the five onboarding steps, marked from completedSteps", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({ resume: null });

    const renderer = await renderScreen(
      profile({ completedSteps: ["role", "where"], readyToCrawl: false })
    );
    await flush();

    const rendered = text(renderer);
    // All five step labels present regardless of completion.
    for (const label of ["Role", "What you want", "Where", "Pay", "Job boards"]) {
      expect(rendered).toContain(label);
    }

    const pills = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "li" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("jds-badge")
    );
    expect(pills).toHaveLength(5);

    const done = pills.filter((node) => (node.props.className as string).includes("jds-badge--forest"));
    const notDone = pills.filter((node) =>
      (node.props.className as string).includes("jds-badge--outline")
    );
    // completedSteps has exactly "role" and "where" — two done, three not yet.
    expect(done).toHaveLength(2);
    expect(notDone).toHaveLength(3);
  });

  it("changing briefing detail calls runQueue with job-search.profile-set-briefing-detail and the selected level", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({ resume: null });

    const renderer = await renderScreen(profile({ briefingDetail: "top" }));
    await flush();

    const options = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" && node.type === "button" && "aria-pressed" in node.props
    );
    expect(options).toHaveLength(3);

    const fullOption = options.find((node) => flatten(node.props.children).match(/full/i));
    expect(fullOption).toBeDefined();
    await act(async () => {
      (fullOption!.props.onClick as () => void)();
    });
    await flush();

    expect(api.runQueue).toHaveBeenCalledWith(
      PROFILE_SET_BRIEFING_DETAIL_QUEUE,
      "profile.set-briefing-detail",
      { profileId: "p1", detail: "full" }
    );
  });
});
