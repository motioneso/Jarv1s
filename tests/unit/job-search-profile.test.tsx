// tests/unit/job-search-profile.test.tsx
//
// K4 (2026-07-28 keyline-restructure plan): ProfileScreen in isolation, same plain node
// environment and api.ts mocking pattern as job-search-web-settings.test.tsx (no jsdom needed —
// job-search-web-onboarding.test.tsx's header explains why). Covers the résumé date rendering
// with no ambient-locale dependence (the fix for the settings.tsx:193 defect this move carries
// forward), the empty-résumé state, and the briefing-detail control (moved here verbatim from
// job-search-web-settings.test.tsx along with the control itself — coverage moved, not dropped).
//
// K6 (same plan) swapped "What it's looking for" from `completedSteps` pills onto real
// `SearchCriteria` fetched via `job-search.profile.get` — the five-onboarding-steps case this
// file used to cover no longer describes what the screen renders, so it is replaced below by a
// real-criteria render test and an empty-criteria test, not deleted outright.
//
// K6 follow-up (same session): team-lead reversed the original call to fetch `contextSummary` and
// not render it — it is now its own section, above the criteria chips, with a stated render cap
// and a "render nothing, not an empty section" absent case. Two more tests below cover that
// section directly; the existing criteria tests above already exercise `mockInvoke`'s default
// `contextSummary: null`, which is why they never had to change.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import {
  CRITERIA_SET_QUEUE,
  PROFILE_GET_TOOL,
  PROFILE_RENAME_QUEUE,
  PROFILE_SET_BRIEFING_DETAIL_QUEUE,
  ProfileScreen,
  RESUME_GET_TOOL
} from "../../external-modules/job-search/src/web/screens/profile";
import * as api from "../../external-modules/job-search/src/web/api";
import type { Profile } from "../../external-modules/job-search/src/web/use-profiles";
import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records";

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

const EMPTY_CRITERIA: SearchCriteria = {
  titles: [],
  seniority: [],
  locations: [],
  remote: "no-preference",
  compFloorCents: null,
  excludeCompanies: [],
  mustHave: [],
  niceToHave: [],
  dealbreakers: [],
  wantNarrative: ""
};

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return { ...EMPTY_CRITERIA, ...overrides };
}

// Discriminates api.invokeTool's single mock by which tool it was called with — this screen now
// calls two read tools (résumé, then criteria) instead of one, so a bare `mockResolvedValue`
// would answer the criteria call with résumé-shaped data and vice versa. Defaults to "nothing on
// file" for both, matching the pre-K6 tests' implicit assumption.
function mockInvoke(
  opts: {
    resume?: unknown;
    criteria?: SearchCriteria;
    contextSummary?: string | null;
    name?: string;
    briefingDetail?: "count" | "top" | "full";
  } = {}
): void {
  vi.mocked(api.invokeTool).mockImplementation(async (tool: string) => {
    if (tool === RESUME_GET_TOOL) return { resume: opts.resume ?? null };
    if (tool === PROFILE_GET_TOOL) {
      return {
        profileId: "p1",
        name: opts.name ?? "Acme SWE search",
        criteria: opts.criteria ?? EMPTY_CRITERIA,
        contextSummary: opts.contextSummary ?? null,
        briefingDetail: opts.briefingDetail ?? "top"
      };
    }
    throw new Error(`unexpected invokeTool call: ${tool}`);
  });
}

async function renderScreen(
  profileValue: Profile,
  onChangeInChat?: () => void,
  onProfileChanged?: () => void
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(ProfileScreen, { profile: profileValue, onChangeInChat, onProfileChanged })
    );
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses the full module width instead of the narrow settings column", async () => {
    mockInvoke();

    const renderer = await renderScreen(profile());

    expect(
      renderer.root.findByProps({ className: "jsm-settings jsm-settings--profile" })
    ).toBeDefined();
  });

  it("renders the résumé's saved-on date from a fixed instant with no locale dependence", async () => {
    mockInvoke({
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
    mockInvoke();

    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered).toMatch(/None yet/);
    expect(rendered).not.toMatch(/Version \d/);
    // "On file" reads No, not a blank or a thrown error.
    expect(rendered).toMatch(/No/);
  });

  it("renders real criteria as chips, remote preference, pay floor, and prose (K6)", async () => {
    mockInvoke({
      criteria: criteria({
        titles: ["Staff Engineer", "Principal Engineer"],
        seniority: ["Staff"],
        locations: ["Remote"],
        remote: "required",
        compFloorCents: 18_000_000,
        mustHave: ["Equity"],
        niceToHave: ["4-day week"],
        dealbreakers: ["On-call rotation"],
        wantNarrative: "Something meaningful, not just a paycheck."
      })
    });

    const renderer = await renderScreen(profile());
    await flush();

    expect(api.invokeTool).toHaveBeenCalledWith(PROFILE_GET_TOOL, { profileId: "p1" });
    const rendered = text(renderer);
    expect(rendered).toContain("Staff Engineer");
    expect(rendered).toContain("Principal Engineer");
    expect(rendered).toContain("Remote required");
    expect(renderer.root.findByProps({ "aria-label": "Remote preference" }).props.value).toBe(
      "required"
    );
    // 18,000,000 cents = $180,000 in the direct dollar input.
    const payFloor = renderer.root.findByProps({ "aria-label": "Pay floor" });
    expect(payFloor.props.value).toBe("180000");
    expect(payFloor.props.className).toContain("jsm-pay-floor-input");
    expect(rendered).toContain("Equity");
    expect(rendered).toContain("4-day week");
    expect(rendered).toContain("On-call rotation");
    expect(rendered).toContain("Something meaningful, not just a paycheck.");

    const chips = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "button" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("jds-chip")
    );
    // Two titles + one seniority + one location + one must-have + one nice-to-have + one
    // dealbreaker = 7 tags; not an exact count this test depends on beyond "more than zero" for
    // any single group, but the full set confirms every group actually rendered its tags.
    // Long removable values use the criteria variant rather than the generic rounded pill.
    expect(chips).toHaveLength(7);
    expect(chips.every((chip) => chip.props.className.includes("jds-chip--criteria"))).toBe(true);
  });

  it("saves a direct remote-preference change through the criteria queue", async () => {
    mockInvoke({ criteria: criteria({ remote: "preferred" }) });
    vi.mocked(api.runQueue).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen(profile());
    await flush();

    await act(async () => {
      renderer.root
        .findByProps({ "aria-label": "Remote preference" })
        .props.onChange({ target: { value: "required" } });
    });

    expect(api.runQueue).toHaveBeenCalledWith(CRITERIA_SET_QUEUE, "criteria.set", {
      profileId: "p1",
      criteriaJson: JSON.stringify(criteria({ remote: "required" }))
    });
  });

  it("saves a direct pay-floor edit as cents when the field blurs", async () => {
    mockInvoke({ criteria: criteria({ compFloorCents: 20_000_000 }) });
    vi.mocked(api.runQueue).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen(profile());
    await flush();

    const input = renderer.root.findByProps({ "aria-label": "Pay floor" });
    await act(async () => {
      input.props.onChange({ target: { value: "225000" } });
    });
    await act(async () => {
      input.props.onBlur();
    });

    expect(api.runQueue).toHaveBeenCalledWith(CRITERIA_SET_QUEUE, "criteria.set", {
      profileId: "p1",
      criteriaJson: JSON.stringify(criteria({ compFloorCents: 22_500_000 }))
    });
  });

  it("leads with criteria and résumé fields without repeating the ceremonial page hero", async () => {
    mockInvoke({ criteria: criteria({ titles: ["Staff Engineer"] }) });

    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered.indexOf("What it's looking for")).toBeLessThan(rendered.indexOf("Résumé"));
    expect(rendered).not.toContain("What this search knows about you");
    expect(renderer.root.findAllByProps({ className: "jds-strap jds-strap--gold" })).toHaveLength(
      0
    );
  });

  it("opens a direct criteria editor instead of requiring chat", async () => {
    mockInvoke({ criteria: criteria({ titles: ["Staff Engineer"] }) });
    const renderer = await renderScreen(profile());
    await flush();

    const editButton = renderer.root
      .findAllByType("button")
      .find((node) => flatten(node.props.children) === "Edit");
    expect(editButton).toBeDefined();

    await act(async () => {
      editButton!.props.onClick();
    });

    expect(text(renderer)).toContain("Save changes");
    expect(renderer.root.findAllByType("input").length).toBeGreaterThan(0);
  });

  it("returns to the criteria view as soon as an editor save is queued", async () => {
    let profileReads = 0;
    vi.mocked(api.invokeTool).mockImplementation(async (tool: string) => {
      if (tool === RESUME_GET_TOOL) return { resume: null };
      if (tool === PROFILE_GET_TOOL && profileReads++ === 0) {
        return {
          profileId: "p1",
          name: "Acme SWE search",
          criteria: criteria({ titles: ["Staff Engineer"] }),
          contextSummary: null,
          briefingDetail: "top"
        };
      }
      return new Promise(() => undefined);
    });
    const renderer = await renderScreen(profile());
    await flush();

    const editButton = renderer.root
      .findAllByType("button")
      .find((node) => flatten(node.props.children) === "Edit");
    await act(async () => editButton!.props.onClick());
    const editor = renderer.root.findByProps({ className: "jsm-criteria-editor" });
    await act(async () => editor.props.onSubmit({ preventDefault: vi.fn() }));
    await flush();

    expect(text(renderer)).not.toContain("Save changes");
    expect(text(renderer)).toContain("Staff Engineer");
  });

  it("keeps rescoring existing matches until the board catches up", async () => {
    vi.useFakeTimers();
    let profileReads = 0;
    let countReads = 0;
    vi.mocked(api.invokeTool).mockImplementation(async (tool: string) => {
      if (tool === RESUME_GET_TOOL) return { resume: null };
      if (tool === PROFILE_GET_TOOL) {
        return {
          profileId: "p1",
          criteria: criteria({ remote: profileReads++ === 0 ? "preferred" : "required" }),
          contextSummary: null
        };
      }
      if (tool === "job-search.matches.count") {
        countReads++;
        return { profileId: "p1", active: 2, scored: countReads === 1 ? 1 : 2 };
      }
      throw new Error("unexpected invokeTool call");
    });

    const renderer = await renderScreen(profile());
    await flush();
    await act(async () => {
      renderer.root
        .findByProps({ "aria-label": "Remote preference" })
        .props.onChange({ target: { value: "required" } });
    });
    await flush();

    expect(api.runQueue).toHaveBeenNthCalledWith(
      2,
      "job-search.crawl-sweep",
      "job-search.rescore-sweep"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();

    expect(countReads).toBe(2);
    expect(api.runQueue).toHaveBeenCalledTimes(2);
    renderer.unmount();
    vi.useRealTimers();
  });

  it("renames the search directly and reports the confirmed name", async () => {
    mockInvoke({ name: "Platform architecture" });
    const changed = vi.fn();
    const renderer = await renderScreen(profile(), undefined, changed);
    await flush();

    const input = renderer.root.findByProps({ "aria-label": "Search name" });
    await act(async () => {
      input.props.onChange({ target: { value: "Platform architecture" } });
    });
    const form = renderer.root.findByProps({ className: "jsm-profile-name" });
    await act(async () => {
      form.props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(api.runQueue).toHaveBeenCalledWith(PROFILE_RENAME_QUEUE, "profile.rename", {
      profileId: "p1",
      name: "Platform architecture"
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(text(renderer)).toContain("Saved.");
  });

  it("removes a criterion directly and enqueues the complete updated criteria", async () => {
    mockInvoke({ criteria: criteria({ titles: ["Staff Engineer", "Principal Engineer"] }) });
    vi.mocked(api.runQueue).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen(profile());
    await flush();

    const remove = renderer.root.findByProps({ "aria-label": "Remove Staff Engineer" });
    await act(async () => {
      remove.props.onClick();
    });

    expect(api.runQueue).toHaveBeenCalledWith(CRITERIA_SET_QUEUE, "criteria.set", {
      profileId: "p1",
      criteriaJson: JSON.stringify(criteria({ titles: ["Principal Engineer"] }))
    });
    expect(text(renderer)).not.toContain("Staff Engineer");
  });

  it("renders a graceful empty state for a brand-new profile's empty criteria, not a wall of empty headings (K6)", async () => {
    mockInvoke({ criteria: EMPTY_CRITERIA });

    const renderer = await renderScreen(profile());
    await flush();

    const rendered = text(renderer);
    expect(rendered).toContain("No titles yet.");
    expect(rendered).toContain("No seniority level yet.");
    expect(rendered).toContain("No locations yet.");
    expect(renderer.root.findByProps({ "aria-label": "Remote preference" }).props.value).toBe(
      "no-preference"
    );
    expect(renderer.root.findByProps({ "aria-label": "Pay floor" }).props.value).toBe("");
    expect(rendered).toContain("Nothing marked must-have yet.");
    expect(rendered).toContain("Nothing marked nice-to-have yet.");
    expect(rendered).toContain("No dealbreakers marked yet.");
    expect(rendered).toContain("Nothing said yet about what you actually want out of this search.");

    // No tag rendered anywhere — every empty group falls back to a one-line prose hint instead
    // of an empty tag row, which is the "wall of empty headings" this test guards against.
    const chips = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "span" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("jds-badge--pill")
    );
    expect(chips).toHaveLength(0);
  });

  it("renders the context summary as framing prose above the criteria, truncated at the stated cap (K6 follow-up)", async () => {
    const long = "A".repeat(400);
    mockInvoke({ contextSummary: long });

    const renderer = await renderScreen(profile());
    await flush();

    expect(text(renderer)).toContain("What I understand you’re after");
    // Truncated to the 320-char cap plus an ellipsis, not the full 400-char string — proves the
    // cap actually bites rather than just existing as an unused constant.
    const truncated = `${"A".repeat(320)}…`;
    expect(text(renderer)).toContain(truncated);
    expect(text(renderer)).not.toContain("A".repeat(321));
  });

  it("renders nothing for the context-summary section when there is no summary on file (K6 follow-up)", async () => {
    mockInvoke({ contextSummary: null });

    const renderer = await renderScreen(profile());
    await flush();

    // Not an empty heading, not a placeholder — the section is absent outright, same "prefer
    // nothing over an empty section" rule LookingForSection's own empty states already follow.
    expect(text(renderer)).not.toContain("What I understand you’re after");
  });

  it("confirms a briefing-detail save and refreshes the parent profile", async () => {
    mockInvoke({ briefingDetail: "full" });
    const changed = vi.fn();

    const renderer = await renderScreen(profile({ briefingDetail: "top" }), undefined, changed);
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
    expect(changed).toHaveBeenCalledOnce();
    expect(text(renderer)).toContain("Saved.");

    await act(async () => {
      renderer.update(
        createElement(ProfileScreen, {
          profile: profile({ briefingDetail: "full" }),
          onProfileChanged: changed
        })
      );
    });
    expect(text(renderer)).toContain("Saved.");
  });
});
