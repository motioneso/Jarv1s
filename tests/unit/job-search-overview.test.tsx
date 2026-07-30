// K3 (2026-07-28 keyline-restructure plan): OverviewScreen in isolation, plain node environment
// (no jsdom needed — same reasoning as job-search-web-onboarding.test.tsx's header). api.ts is
// mocked so this file exercises only the screen's own logic: the four board-count figures (never
// totals — matches.list is capped, see MATCHES_LIST_MAX_LIMIT's own comment), the verbatim
// portal-cause rendering (same discipline job-search-web-settings.test.tsx already covers for
// SettingsScreen), the résumé blocker toggling on the presence of résumé content, and the
// all-clear case rendering no "What's missing" section at all.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import { OverviewScreen } from "../../external-modules/job-search/src/web/screens/overview";
import * as api from "../../external-modules/job-search/src/web/api";
import type { Profile } from "../../external-modules/job-search/src/web/use-profiles";
import type {
  BoardMatch,
  PortalListItem
} from "../../external-modules/job-search/src/web/board-types";

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

function match(overrides: Partial<BoardMatch> = {}): BoardMatch {
  return {
    id: "m1",
    title: "Staff Engineer",
    company: "Acme",
    fit: 70,
    want: 80,
    outsideFrame: false,
    state: "seen",
    url: "https://example.com/job/1",
    location: "Remote",
    source: "linkedin",
    postedAt: "2026-07-15",
    ...overrides
  };
}

function portal(overrides: Partial<PortalListItem> = {}): PortalListItem {
  return {
    sourceId: "linkedin",
    label: "LinkedIn",
    enabled: true,
    lastOkAt: null,
    cause: null,
    ...overrides
  };
}

// invokeTool is called three times by OverviewScreen (matches.list, portal.list, resume.get) —
// unlike settings.tsx's single-call mock, this screen needs the mock to answer differently per
// tool name, so tests build a small routing table instead of one flat mockResolvedValue.
function mockInvoke(responses: {
  matches?: BoardMatch[];
  portals?: PortalListItem[];
  resumeContent?: string | null;
}): void {
  vi.mocked(api.invokeTool).mockImplementation(async (tool: string) => {
    if (tool === "job-search.matches.list") {
      return { items: responses.matches ?? [] };
    }
    if (tool === "job-search.portal.list") {
      return { portals: responses.portals ?? [] };
    }
    if (tool === "job-search.resume.get") {
      const content = responses.resumeContent ?? null;
      return content === null
        ? { profileId: "p1", resume: null }
        : {
            profileId: "p1",
            resume: { version: 1, content, updatedAt: "2026-07-01T00:00:00.000Z" }
          };
    }
    throw new Error(`unexpected tool: ${tool}`);
  });
}

async function renderScreen(profileValue: Profile): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(OverviewScreen, { profileId: profileValue.profileId, profile: profileValue })
    );
  });
  return renderer;
}

// Flushes the microtask queue a few times over — enough for all three mocked invokeTool calls'
// resolved promises to reach their .then(setState) (same pattern as
// job-search-web-settings.test.tsx's own flush helper).
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
  // Distinct from the settings/keyline suites' own flatten: this screen's figures render a raw
  // number as JSX text (`<span>{count}</span>`), which react-test-renderer's JSON tree keeps as a
  // number child rather than a string one — the other suites never hit this because every value
  // they render is already a string.
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join(" ");
  if (typeof node === "object" && "children" in (node as { children?: unknown })) {
    return flatten((node as { children?: unknown }).children);
  }
  return "";
}

function text(renderer: ReactTestRenderer): string {
  return flatten(renderer.toJSON()).replace(/\s+/g, " ").trim();
}

describe("OverviewScreen", () => {
  beforeEach(() => {
    vi.mocked(api.invokeTool).mockReset();
    vi.mocked(api.runQueue).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Board counts, never totals: On your board is the raw row count (matches.list's own handler
  // applies no state filter), Read and scored is isScored's own definition (non-null want), New
  // and Passed key on state directly. A fixture with zero matches must render literal "0"s, not
  // blank fields — an empty board is still a fact worth stating plainly.
  it("figures reflect board counts, including the zero case", async () => {
    mockInvoke({ matches: [], portals: [], resumeContent: "resume text" });
    const renderer = await renderScreen(profile());
    await flush();

    let figures = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        (node.props as { className?: string }).className === "jds-hero-figure"
    );
    expect(figures.map((f) => flatten(f.props.children))).toEqual(["0", "0", "0", "0"]);

    mockInvoke({
      matches: [
        match({ id: "a", state: "new", want: null }),
        match({ id: "b", state: "seen", want: 40 }),
        match({ id: "c", state: "dismissed", want: 10 }),
        match({ id: "d", state: "unscored", want: null })
      ],
      portals: [],
      resumeContent: "resume text"
    });
    const withMatches = await renderScreen(profile());
    await flush();

    figures = withMatches.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        (node.props as { className?: string }).className === "jds-hero-figure"
    );
    // On your board=4 (raw count), Read and scored=2 (b,c have non-null want and a non-unscored
    // state), New=1 (a), Passed=1 (c).
    expect(figures.map((f) => flatten(f.props.children))).toEqual(["4", "2", "1", "1"]);
    // The caption no longer names a row count. It used to say "the 25 matches currently on your
    // board", which was only ever true because the screen read one page and stopped; it now reads
    // every page, so the honest caveat is about what a board holds, not how many rows fit in a read.
    expect(text(withMatches)).toMatch(/what is on your board now/i);
    expect(text(withMatches)).not.toMatch(/\b25\b/);
  });

  it("renders a disabled portal's cause verbatim, not a composed sentence", async () => {
    const summary = "LinkedIn asked for an account before showing postings, so I stopped.";
    const nextAction = "Disabled. Turn it back on if you want to try again.";
    mockInvoke({
      matches: [],
      portals: [
        portal({
          sourceId: "linkedin",
          label: "LinkedIn",
          enabled: false,
          cause: {
            kind: "self-disabled",
            sourceId: "linkedin",
            summary,
            retrieved: null,
            expected: null,
            lastOkAt: null,
            nextAction,
            retryAt: null,
            disabled: true
          }
        })
      ],
      resumeContent: "resume text"
    });
    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered).toContain(summary);
    expect(rendered).toContain(nextAction);
  });

  it("renders the missing-résumé blocker only when no résumé is on file", async () => {
    mockInvoke({ matches: [], portals: [], resumeContent: null });
    const noResume = await renderScreen(profile());
    await flush();
    expect(text(noResume)).toMatch(/no résumé on file/i);

    mockInvoke({ matches: [], portals: [], resumeContent: "resume text" });
    const withResume = await renderScreen(profile());
    await flush();
    expect(text(withResume)).not.toMatch(/no résumé on file/i);
  });

  // The honest-list rule: nothing wrong, nothing rendered — no "all good" filler panel.
  it("renders no What's missing section when nothing is missing", async () => {
    mockInvoke({
      matches: [],
      portals: [portal({ enabled: true })],
      resumeContent: "resume text"
    });
    const renderer = await renderScreen(profile({ readyToCrawl: true }));
    await flush();

    expect(text(renderer)).not.toMatch(/what's missing/i);
  });

  it("computes every displayed date by string arithmetic, never an ambient clock read", () => {
    const source = readFileSync(
      new URL("../../external-modules/job-search/src/web/screens/overview.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/\bnew Date\(/);
    expect(source).not.toMatch(/toLocale[A-Za-z]*\(/);
    expect(source).not.toMatch(/\bIntl\./);
  });
});
