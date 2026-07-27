// Task 20 (#1304, settings half): SettingsScreen in isolation, plain node environment (no jsdom
// needed — same reasoning as job-search-web-onboarding.test.tsx's header). api.ts is mocked so
// this file exercises only the screen's own logic: portal.list rendering, the forced read/write
// transport split (reads via invokeTool, writes via runQueue — rulings I3/I4), the verbatim
// self-disabled-cause rendering, the exhaustive three-level briefing control, and the absence of
// any combined-score or scoring-weight control.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import {
  PORTAL_LIST_TOOL,
  PORTAL_SET_ENABLED_QUEUE,
  PROFILE_SET_BRIEFING_DETAIL_QUEUE,
  SettingsScreen
} from "../../external-modules/job-search/src/web/screens/settings";
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
    ...overrides
  };
}

interface PortalRowFixture {
  sourceId: string;
  label: string;
  enabled: boolean;
  lastOkAt: string | null;
  cause: { summary: string; nextAction: string; disabled: boolean } | null;
}

function portalRow(overrides: Partial<PortalRowFixture> = {}): PortalRowFixture {
  return {
    sourceId: "linkedin",
    label: "LinkedIn",
    enabled: true,
    lastOkAt: null,
    cause: null,
    ...overrides
  };
}

async function renderScreen(profileValue: Profile): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(SettingsScreen, { profile: profileValue }));
  });
  return renderer;
}

// Flushes the microtask queue a few times over — enough for a mocked invokeTool/runQueue's
// resolved promise to reach its .then(setState) (same pattern as job-search-web-root.test.tsx's
// flush helper).
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

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.mocked(api.invokeTool).mockReset();
    vi.mocked(api.runQueue).mockReset();
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads portals via invokeTool (read) and toggling one calls portal.set-enabled via runQueue (write)", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({
      portals: [portalRow({ sourceId: "linkedin", label: "LinkedIn", enabled: true })]
    });

    const renderer = await renderScreen(profile());
    await flush();

    expect(api.invokeTool).toHaveBeenCalledWith(PORTAL_LIST_TOOL, { profileId: "p1" });
    expect(text(renderer)).toMatch(/LinkedIn/);

    const checkbox = renderer.root.findByProps({ type: "checkbox" });
    await act(async () => {
      checkbox.props.onChange({ target: { checked: false } });
    });
    await flush();

    expect(api.runQueue).toHaveBeenCalledWith(PORTAL_SET_ENABLED_QUEUE, "portal.set-enabled", {
      profileId: "p1",
      sourceId: "linkedin",
      enabled: false
    });
    // invokeTool must never be used for the write itself — only for the list read.
    expect(api.invokeTool).not.toHaveBeenCalledWith(
      "job-search.portal.set-enabled",
      expect.anything()
    );
  });

  it("renders a self-disabled portal's cause verbatim, not a composed sentence", async () => {
    const summary =
      "LinkedIn asked for an account before showing postings, so I stopped. I will not sign in to a job board on your behalf.";
    const nextAction = "Disabled. Turn it back on if you want to try again.";
    vi.mocked(api.invokeTool).mockResolvedValue({
      portals: [
        portalRow({
          sourceId: "linkedin",
          label: "LinkedIn",
          enabled: false,
          cause: { summary, nextAction, disabled: true }
        })
      ]
    });

    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered).toContain(summary);
    expect(rendered).toContain(nextAction);
  });

  it("renders exactly three briefing-detail options and selecting one calls profile.set-briefing-detail via runQueue", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({ portals: [] });

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

  it("renders no combined score and no scoring/weighting control", async () => {
    vi.mocked(api.invokeTool).mockResolvedValue({ portals: [] });

    const renderer = await renderScreen(profile());
    await flush();

    expect(text(renderer)).not.toMatch(/\boverall\b|\bcombined\b/i);
    expect(renderer.root.findAllByProps({ type: "range" })).toHaveLength(0);
    expect(text(renderer)).not.toMatch(/\bweight(ing)?\b/i);
  });
});
