// Task 18 (#1302): Root itself, in the plain node environment (no jsdom — Root needs no real
// document; see tests/unit/job-search-use-profiles.test.tsx's header for why THAT file needs
// jsdom and this one doesn't). use-profiles.ts, api.ts, latch.ts, and styles.css are all mocked
// so this file exercises only Root's own logic: the bootstrap handoff, the empty/onboarding/
// board branch, the enqueue latch's call sites (not its storage — that's latch.ts's own
// concern, mocked here), and queue-outcome rendering.
//
// Test 11 (assistant-surface binding) belongs to Task 17, not this file.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseProfiles } = vi.hoisted(() => ({ mockUseProfiles: vi.fn() }));
vi.mock("../../external-modules/job-search/src/web/use-profiles", () => ({
  useProfiles: mockUseProfiles
}));

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

// A module-scope Set standing in for latch.ts's real localStorage-backed storage — real
// storage would silently no-op in this node environment (no `window`), which would make
// tests 6-9 unable to observe latching at all. See latch.ts's own header for why it was
// split out of root.tsx in the first place.
const { latchStore } = vi.hoisted(() => ({ latchStore: new Set<string>() }));
vi.mock("../../external-modules/job-search/src/web/latch", () => ({
  isLatched: (actorScopeKey: string, profileId: string) =>
    latchStore.has(`${actorScopeKey}:${profileId}`),
  setLatched: (actorScopeKey: string, profileId: string) => {
    latchStore.add(`${actorScopeKey}:${profileId}`);
  }
}));

vi.mock("../../external-modules/job-search/src/web/styles.css", () => ({ default: "" }));

import { Root, type HostActions } from "../../external-modules/job-search/src/web/root";
import * as api from "../../external-modules/job-search/src/web/api";
import {
  seedIdempotencyKey,
  type AssistantSurfaceHandleV1
} from "../../external-modules/job-search/src/domain/seed-prompt";
import type {
  Profile,
  ProfilesState
} from "../../external-modules/job-search/src/web/use-profiles";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    profileId: "p1",
    name: "Acme SWE search",
    state: "active",
    briefingDetail: null,
    completedSteps: ["role", "want", "where", "comp", "sources"],
    readyToCrawl: true,
    // Deliberately distinct from profileId — Task 17/#1301's thread binding uses this field,
    // not profileId, and a fixture where the two values happened to match would let a
    // regression back to profileId-based binding pass silently.
    surfaceKey: "surf-1",
    ...overrides
  };
}

function hostActions(overrides: Partial<HostActions> = {}): HostActions {
  return {
    actorScopeKey: "actor-1",
    openAssistant: vi.fn(),
    ...overrides
  };
}

type MockedProfilesState = ProfilesState & { refetch(): void; select(id: string): void };

function ready(
  profiles: Profile[],
  selectedId = profiles[0]?.profileId ?? ""
): MockedProfilesState {
  return { status: "ready", profiles, selectedId, refetch: vi.fn(), select: vi.fn() };
}

function empty(): MockedProfilesState {
  return { status: "empty", refetch: vi.fn(), select: vi.fn() };
}

async function renderRoot(
  actions: HostActions = hostActions(),
  assistantSurface?: AssistantSurfaceHandleV1
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Root, { hostActions: actions, assistantSurface }));
  });
  return renderer;
}

// setSurfaceKey/seedContext are the two methods Root's useProfileThread actually calls; every
// test in this file uses an "active" profile (the board branch), so Surface itself is never
// rendered here (that's job-search-web-onboarding.test.tsx's job) and submitTurn is never
// invoked (no test here opens a row's detail panel or clicks Discuss — that's
// job-search-web-board.test.tsx's job) — but AssistantSurfaceHandleV1 is now a four-member
// interface (Surface added for #1331, submitTurn added for #1304), and a fixture typed against
// it must satisfy all four or it's silently wrong the moment a .tsx test (never typechecked,
// #1335) is trusted to catch a shape mismatch.
function assistantSurface(): AssistantSurfaceHandleV1 {
  return {
    setSurfaceKey: vi.fn(),
    seedContext: vi.fn().mockResolvedValue(undefined),
    Surface: vi.fn(),
    submitTurn: vi.fn().mockResolvedValue(undefined)
  };
}

// Flushes the microtask queue a few times over — enough for a mocked
// runQueue's resolved promise to reach its .then(setQueueNotice).
async function flush(renderer: ReactTestRenderer): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  void renderer;
}

function text(renderer: ReactTestRenderer): string {
  // Adjacent JSX text expressions (e.g. QueueNotice's "Couldn't queue a search
  // run: {outcome.message}") render as separate string children that
  // flatten() joins with a space — collapse runs of whitespace so assertions
  // don't have to guess the exact split.
  return flatten(renderer.toJSON()).replace(/\s+/g, " ").trim();
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

function findButton(renderer: ReactTestRenderer, name: RegExp) {
  return renderer.root.findAllByType("button").find((item) => {
    const children = Array.isArray(item.props.children)
      ? item.props.children
      : [item.props.children];
    return children.some((child: unknown) => typeof child === "string" && name.test(child));
  });
}

function findParagraphsByRole(renderer: ReactTestRenderer, role: string) {
  return renderer.root.findAllByType("p").filter((item) => item.props.role === role);
}

describe("job-search web Root", () => {
  beforeEach(() => {
    mockUseProfiles.mockReset();
    vi.mocked(api.invokeTool).mockReset();
    // Default transport for the real BoardScreen/SettingsScreen now rendered once a profile is
    // "active" (Task 20 replaced BoardPlaceholder) — a non-empty matches.list result is what
    // makes this file's "renders the real board" assertions still true (checked by matching on
    // the match's title text, not a <table> element — K2's keyline restructure replaced board.tsx's
    // table with a .jsm-list of rule-separated rows); individual tests don't otherwise care what
    // the board or settings screens render.
    //
    // Shape matches the real BoardMatch (board-types.ts / worker/handlers/matches.ts) as of N39:
    // no fitReason/wantReason on the list row (those moved to MatchDetail, fetched separately by
    // job-search.match.get), and url is required — found missing here by #1335's follow-up audit,
    // since board.tsx:219-223 casts this response with no runtime validation, so a stale fixture
    // shape here would have kept passing silently. location/source/postedAt added by K5 — K2's
    // match-row.tsx (unmocked here; the real BoardScreen renders through it) calls
    // formatPostedOn(item.postedAt) unconditionally, and formatPostedOn only guards against
    // `null`, not `undefined`, so an omitted field crashed every test in this file that reaches
    // the Matches tab the moment K2's row extraction landed — the same #1335 trap (.tsx fixtures
    // aren't typechecked) catching a second field.
    vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
      if (name === "job-search.matches.list") {
        return {
          items: [
            {
              id: "m1",
              title: "Senior Engineer",
              company: "Acme",
              fit: 80,
              want: 70,
              outsideFrame: false,
              state: "new",
              url: "https://example.com/jobs/m1",
              location: "Remote — US",
              source: "LinkedIn",
              postedAt: "2026-07-15T09:00:00.000Z"
            }
          ]
        };
      }
      if (name === "job-search.portal.list") return { portals: [] };
      // K5: the Overview and Profile tabs (screens/overview.tsx, screens/profile.tsx) each make
      // their own resume.get read the moment they mount — every K5 test below visits at least one
      // of those tabs, so this needs a real answer rather than falling through to the catch-all
      // throw below (that would still render, since both screens swallow a rejected fetch into an
      // "error" state, but a passing suite that only exercises the error branch would be worthless
      // as K5 coverage).
      if (name === "job-search.resume.get") return { resume: null };
      throw new Error(`unexpected invokeTool ${name}`);
    });
    vi.mocked(api.runQueue).mockReset();
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
    latchStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the bootstrap panel with zero profiles, no board table", async () => {
    mockUseProfiles.mockReturnValue(empty());
    const renderer = await renderRoot();

    expect(text(renderer)).toMatch(/Find roles that match/);
    expect(findButton(renderer, /Start your job search/i)).toBeTruthy();
    expect(renderer.root.findAllByType("table")).toHaveLength(0);
  });

  // The bootstrap writes its own first record through the module's queue. It must not invoke a
  // write tool directly (the browser REST path 403s those), and it must not depend on the model
  // choosing to call one — on a live instance that dead-ended the module's very first click:
  // the assistant opened an interview, no row was ever written, and this panel polled forever.
  it("bootstrap enqueues profile.bootstrap and never invokes a tool directly", async () => {
    mockUseProfiles.mockReturnValue(empty());
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
    const actions = hostActions();
    const renderer = await renderRoot(actions);

    const start = findButton(renderer, /Start your job search/i);
    expect(start).toBeTruthy();
    await act(async () => {
      start!.props.onClick();
    });

    expect(api.runQueue).toHaveBeenCalledTimes(1);
    expect(api.runQueue).toHaveBeenCalledWith("job-search.profile-bootstrap", "profile.bootstrap");
    expect(api.invokeTool).not.toHaveBeenCalled();
    // The user is never made to say anything to bootstrap the module.
    expect(actions.openAssistant).not.toHaveBeenCalled();

    // Root re-renders with pollArmed flipped true — Root's own arming signal,
    // not the hook's (mocked) internal timing.
    const lastCallProps = mockUseProfiles.mock.calls.at(-1)![0];
    expect(lastCallProps.pollArmed).toBe(true);
    expect(text(renderer)).toMatch(/Setting up your job search profile/);
  });

  // A queue turned off for the account can never produce a profile, so waiting is the wrong
  // answer: say so and offer the retry rather than spinning on "Setting up…" indefinitely.
  it("stops waiting and surfaces the notice when the bootstrap queue is disabled", async () => {
    mockUseProfiles.mockReturnValue(empty());
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "disabled" });
    const renderer = await renderRoot();

    await act(async () => {
      findButton(renderer, /Start your job search/i)!.props.onClick();
    });

    expect(mockUseProfiles.mock.calls.at(-1)![0].pollArmed).toBe(false);
    expect(text(renderer)).toMatch(/turned off for this account/);
    expect(findButton(renderer, /Try again/i)).toBeTruthy();
  });

  // "Try again" is the panel's only escape from a failed bootstrap. Re-arming the poll without
  // re-running the queue would just wait harder against the same empty table.
  it("re-runs the bootstrap queue on retry", async () => {
    mockUseProfiles.mockReturnValue(empty());
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "error", message: "boom" });
    const renderer = await renderRoot();

    await act(async () => {
      findButton(renderer, /Start your job search/i)!.props.onClick();
    });
    await act(async () => {
      findButton(renderer, /Try again/i)!.props.onClick();
    });

    expect(api.runQueue).toHaveBeenCalledTimes(2);
  });

  it("renders the real onboarding screen for a profile with no criteria yet", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "in_conversation" })]));
    const renderer = await renderRoot();

    expect(text(renderer)).toMatch(/work out what this search is for/);
    expect(renderer.root.findAllByType("table")).toHaveLength(0);
  });

  // #1331: OnboardingScreen's own test file (job-search-web-onboarding.test.tsx) proves the
  // screen renders Surface when handed one directly — that alone doesn't prove Root ever hands
  // it one for real. This asserts through root.tsx's prop threading itself, not just the prop.
  it("threads the host's assistantSurface through to the real onboarding screen", async () => {
    function SurfaceSpy() {
      return createElement("div", { "data-testid": "job-search-onboarding-surface" });
    }
    mockUseProfiles.mockReturnValue(
      ready([profile({ profileId: "p1", state: "in_conversation" })])
    );
    const surface: AssistantSurfaceHandleV1 = {
      setSurfaceKey: vi.fn(),
      seedContext: vi.fn().mockResolvedValue(undefined),
      Surface: SurfaceSpy
    };

    const renderer = await renderRoot(hostActions(), surface);

    expect(renderer.root.findAllByType(SurfaceSpy)).toHaveLength(1);
  });

  it("renders the real board screen for a profile with criteria", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "active" })]));
    const renderer = await renderRoot();
    await flush(renderer);

    // K2's keyline restructure replaced board.tsx's <table> with a rule-separated .jsm-list —
    // check for the real match's title text instead of a table element.
    expect(text(renderer)).toMatch(/Senior Engineer/);
    expect(text(renderer)).not.toMatch(/work out what this search is for/);
  });

  it("never renders a chat button anywhere on the surface", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "active" })]));
    const renderer = await renderRoot();
    await flush(renderer);

    expect(findButton(renderer, /chat/i)).toBeUndefined();
  });

  it("enqueues exactly one crawl.run for a profile that arrives active, and stays at one across a re-render", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));
    const actions = hostActions({ actorScopeKey: "actor-1" });
    const renderer = await renderRoot(actions);
    await flush(renderer);

    expect(api.runQueue).toHaveBeenCalledTimes(1);
    expect(api.runQueue).toHaveBeenCalledWith("job-search.crawl-run", "crawl.run", {
      profileId: "p1"
    });

    // A subsequent refetch/re-render with the same (now-latched) profile must
    // not enqueue a second time.
    await act(async () => {
      renderer.update(createElement(Root, { hostActions: actions }));
    });
    await flush(renderer);
    expect(api.runQueue).toHaveBeenCalledTimes(1);
  });

  it("the enqueue latch survives an unmount/remount for the same actor", async () => {
    const actions = hostActions({ actorScopeKey: "actor-A" });
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));

    const first = await renderRoot(actions);
    await flush(first);
    expect(api.runQueue).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = await renderRoot(actions);
    await flush(second);
    expect(api.runQueue).toHaveBeenCalledTimes(1);
  });

  it("does not carry a latch across different actorScopeKeys", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));

    const first = await renderRoot(hostActions({ actorScopeKey: "actor-A" }));
    await flush(first);
    expect(api.runQueue).toHaveBeenCalledTimes(1);

    const second = await renderRoot(hostActions({ actorScopeKey: "actor-B" }));
    await flush(second);
    expect(api.runQueue).toHaveBeenCalledTimes(2);
    expect(api.runQueue).toHaveBeenLastCalledWith("job-search.crawl-run", "crawl.run", {
      profileId: "p1"
    });
  });

  it("enqueues nothing for a profile still in_conversation", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "in_conversation" })]));
    const renderer = await renderRoot();
    await flush(renderer);

    expect(api.runQueue).not.toHaveBeenCalled();
  });

  it("renders a calm queued notice for already-queued, and an explicit notice for disabled", async () => {
    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "already-queued" });
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));
    const renderer = await renderRoot(hostActions({ actorScopeKey: "actor-queued" }));
    await flush(renderer);

    const status = findParagraphsByRole(renderer, "status");
    // The copy says what the user is waiting for and where it will appear, rather than naming the
    // internal event ("a search run has been queued") — a queue is our word, not theirs.
    expect(status.some((p) => flatten(p.props.children).match(/Searching for new roles/))).toBe(
      true
    );
    expect(findParagraphsByRole(renderer, "alert")).toHaveLength(0);

    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "disabled" });
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p2", state: "active" })]));
    const renderer2 = await renderRoot(hostActions({ actorScopeKey: "actor-disabled" }));
    await flush(renderer2);

    expect(text(renderer2)).toMatch(/Manual search runs are turned off for this account/);
  });

  // Test 11 (Task 17, #1301): assistant-surface binding.
  it("binds the surface before framing it, and frames it only once across a re-render", async () => {
    // surfaceKey deliberately differs from profileId here (Task 17/#1301's own constraint): the
    // thread binding below must key off surfaceKey, and the idempotency key must still key off
    // profileId — a fixture where the two matched couldn't catch a regression back to
    // profileId-based binding.
    mockUseProfiles.mockReturnValue(
      ready([profile({ profileId: "p1", surfaceKey: "surf-p1", state: "active" })])
    );
    const surface = assistantSurface();
    const actions = hostActions();
    const renderer = await renderRoot(actions, surface);
    await flush(renderer);

    expect(surface.setSurfaceKey).toHaveBeenCalledWith("surf-p1");
    expect(surface.seedContext).toHaveBeenCalledTimes(1);
    const [seedText, idempotencyKey] = vi.mocked(surface.seedContext).mock.calls[0];
    // Derived, not literal: the key carries a version suffix that is bumped every time the
    // seed text changes, and a hardcoded "v1" here silently rotted this suite red for three
    // bumps before anyone ran it. What matters is that the key is the one the module mints.
    expect(idempotencyKey).toBe(seedIdempotencyKey("p1"));
    expect(seedText).toContain("job-search.criteria.set");

    // Ordering, not just presence: seeding before binding frames the drawer instead of this
    // module's own thread (H4 — the consent boundary).
    const setSurfaceKeyOrder = vi.mocked(surface.setSurfaceKey).mock.invocationCallOrder[0];
    const seedContextOrder = vi.mocked(surface.seedContext).mock.invocationCallOrder[0];
    expect(setSurfaceKeyOrder).toBeLessThan(seedContextOrder);

    // A re-render with the same surface and the same profile must not re-seed.
    await act(async () => {
      renderer.update(createElement(Root, { hostActions: actions, assistantSurface: surface }));
    });
    await flush(renderer);
    expect(surface.seedContext).toHaveBeenCalledTimes(1);
  });

  // Ruling N46: the surface key is what the drawer's own backfill path (packages/chat's
  // repository lookup) uses to pick the persisted thread — rotating surfaceKey while the
  // profile row stays put is exactly what lets a profile start a fresh conversation without
  // deleting the profile. A test that only checked "some key was set" would pass identically
  // whether the binding used surfaceKey or profileId, since this file's other fixtures give both
  // fields a value; this one is written specifically to fail if the binding ever goes back to
  // profileId; profileId itself never moves.
  it("rebinds to a new surface when surfaceKey changes while profileId stays the same", async () => {
    mockUseProfiles.mockReturnValue(
      ready([profile({ profileId: "p1", surfaceKey: "surf-a", state: "active" })])
    );
    const surface = assistantSurface();
    const actions = hostActions();
    const renderer = await renderRoot(actions, surface);
    await flush(renderer);

    expect(surface.setSurfaceKey).toHaveBeenLastCalledWith("surf-a");

    // Same profileId, rotated surfaceKey — simulates the profile's thread identity being reset
    // independently of the row, the capability the plan required and the deviation removed.
    mockUseProfiles.mockReturnValue(
      ready([profile({ profileId: "p1", surfaceKey: "surf-b", state: "active" })])
    );
    await act(async () => {
      renderer.update(createElement(Root, { hostActions: actions, assistantSurface: surface }));
    });
    await flush(renderer);

    // Binding followed surfaceKey to a genuinely different value. If this ever rebinds by
    // profileId instead, profileId is unchanged across the two renders and this call simply
    // never happens.
    expect(surface.setSurfaceKey).toHaveBeenLastCalledWith("surf-b");
    expect(surface.setSurfaceKey).toHaveBeenCalledWith("surf-a");

    // The seed re-fires (surfaceKey is a real effect dependency), but its idempotencyKey stays
    // pinned to profileId in both calls — the two axes documented in seed-prompt.ts stay
    // independent even as the surface rotates.
    expect(surface.seedContext).toHaveBeenCalledTimes(2);
    const [, firstIdempotencyKey] = vi.mocked(surface.seedContext).mock.calls[0];
    const [, secondIdempotencyKey] = vi.mocked(surface.seedContext).mock.calls[1];
    expect(firstIdempotencyKey).toBe(seedIdempotencyKey("p1"));
    expect(secondIdempotencyKey).toBe(seedIdempotencyKey("p1"));
  });

  it("renders fine when the host gives it no assistant surface", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));
    const renderer = await renderRoot(hostActions());
    await flush(renderer);

    // See the K2 keyline-restructure note above: board.tsx has no <table> anymore.
    expect(text(renderer)).toMatch(/Senior Engineer/);
  });

  // K5 (2026-07-28 keyline-restructure plan): the four-tab shell. These four tests are the plan's
  // own list for this task, in the plan's own order.
  describe("K5 four-tab shell", () => {
    it("renders all four tabs for an active profile, with Matches selected on mount", async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "active" })]));
      const renderer = await renderRoot();
      await flush(renderer);

      const matchesTab = findButton(renderer, /^Matches$/);
      const overviewTab = findButton(renderer, /^Overview$/);
      const profileTab = findButton(renderer, /^Profile$/);
      const monitorsTab = findButton(renderer, /^Monitors$/);
      expect(matchesTab).toBeTruthy();
      expect(overviewTab).toBeTruthy();
      expect(profileTab).toBeTruthy();
      expect(monitorsTab).toBeTruthy();

      // aria-selected is what jds-tab draws its underline off — this asserts the actual attribute
      // the design system reads, not just "some tab looks selected".
      expect(matchesTab!.props["aria-selected"]).toBe(true);
      expect(overviewTab!.props["aria-selected"]).toBe(false);
      expect(profileTab!.props["aria-selected"]).toBe(false);
      expect(monitorsTab!.props["aria-selected"]).toBe(false);

      // Matches is the board — the pre-existing title-text assertion elsewhere in this file
      // already covers that it's the real BoardScreen, not a placeholder. (board.tsx has no
      // <table> — K2's keyline restructure draws a rule-separated .jsm-list instead.)
      expect(text(renderer)).toMatch(/Senior Engineer/);
    });

    it("selecting each tab renders that screen and unmounts the previous one", async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "active" })]));
      const renderer = await renderRoot();
      await flush(renderer);

      // Matches (default): the board's match content is present, no other screen's own copy is.
      expect(text(renderer)).toMatch(/Senior Engineer/);
      expect(text(renderer)).not.toMatch(/Your board at a glance/);
      expect(text(renderer)).not.toMatch(/knows about you/);
      expect(text(renderer)).not.toMatch(/Which job boards this search crawls/);

      await act(async () => {
        findButton(renderer, /^Overview$/)!.props.onClick();
      });
      await flush(renderer);
      // The board is gone — a real unmount, not a second screen layered on top.
      expect(text(renderer)).not.toMatch(/Senior Engineer/);
      expect(text(renderer)).toMatch(/Your board at a glance/);

      await act(async () => {
        findButton(renderer, /^Profile$/)!.props.onClick();
      });
      await flush(renderer);
      expect(text(renderer)).not.toMatch(/Your board at a glance/);
      expect(text(renderer)).toMatch(/knows about you/);

      await act(async () => {
        findButton(renderer, /^Monitors$/)!.props.onClick();
      });
      await flush(renderer);
      expect(text(renderer)).not.toMatch(/knows about you/);
      expect(text(renderer)).toMatch(/Which job boards this search crawls/);

      await act(async () => {
        findButton(renderer, /^Matches$/)!.props.onClick();
      });
      await flush(renderer);
      expect(text(renderer)).not.toMatch(/Which job boards this search crawls/);
      expect(text(renderer)).toMatch(/Senior Engineer/);
    });

    it("switching profile preserves the selected tab; switching tab preserves the selected profile", async () => {
      const profiles = [
        profile({ profileId: "p1", name: "Search A", state: "active" }),
        profile({ profileId: "p2", name: "Search B", state: "active" })
      ];
      const actions = hostActions();
      mockUseProfiles.mockReturnValue(ready(profiles, "p1"));
      const renderer = await renderRoot(actions);
      await flush(renderer);

      // Move off the default tab first — if switching profile ever reset view state, staying on
      // "matches" (already the default) couldn't tell the difference.
      await act(async () => {
        findButton(renderer, /^Overview$/)!.props.onClick();
      });
      await flush(renderer);
      expect(findButton(renderer, /^Overview$/)!.props["aria-selected"]).toBe(true);

      // Switch profile — same shape as this file's own surfaceKey-rebind test above: a real
      // profile switch happens via useProfiles handing Root a new selectedId, so simulate that by
      // re-rendering with an updated ready() fixture rather than clicking the mocked select().
      mockUseProfiles.mockReturnValue(ready(profiles, "p2"));
      await act(async () => {
        renderer.update(createElement(Root, { hostActions: actions }));
      });
      await flush(renderer);

      // The tab survived the profile switch — ActiveProfilePanel isn't remounted or reset by a
      // change in which profile is selected.
      expect(findButton(renderer, /^Overview$/)!.props["aria-selected"]).toBe(true);

      // Now the reverse: switch tab again, then switch profile back, and confirm the profile
      // switcher (not the view switcher) is what changed — ProfileBar's own selected button.
      await act(async () => {
        findButton(renderer, /^Monitors$/)!.props.onClick();
      });
      await flush(renderer);
      mockUseProfiles.mockReturnValue(ready(profiles, "p1"));
      await act(async () => {
        renderer.update(createElement(Root, { hostActions: actions }));
      });
      await flush(renderer);

      expect(findButton(renderer, /^Monitors$/)!.props["aria-selected"]).toBe(true);
      const searchA = findButton(renderer, /^Search A$/);
      expect(searchA!.props["aria-selected"]).toBe(true);
    });

    it("renders onboarding and no tab bar for an in_conversation profile", async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "in_conversation" })]));
      const renderer = await renderRoot();

      expect(text(renderer)).toMatch(/work out what this search is for/);
      // None of the four view-tab labels exist anywhere — the tab bar itself isn't rendered, not
      // just hidden or disabled.
      expect(findButton(renderer, /^Matches$/)).toBeUndefined();
      expect(findButton(renderer, /^Overview$/)).toBeUndefined();
      expect(findButton(renderer, /^Profile$/)).toBeUndefined();
      expect(findButton(renderer, /^Monitors$/)).toBeUndefined();
    });
  });

  // K8 (2026-07-28 keyline-restructure plan): the module masthead. The eyebrow/title are static
  // and already covered indirectly everywhere else in this file (every renderRoot call would fail
  // these two assertions if the masthead didn't mount) — what's worth testing on purpose is the
  // status line, since that's the one piece of this task with real logic behind it (mastheadStatus
  // in root.tsx) rather than markup.
  describe("K8 masthead", () => {
    // Finds the jds-indicator wrapper span itself, not its __dot child — an exact className match
    // rather than a substring test, since "jds-indicator__dot" also contains the substring
    // "jds-indicator" and a loose match would find the wrong node.
    function findIndicator(renderer: ReactTestRenderer, modifier: string) {
      return renderer.root.findAll(
        (item) =>
          typeof item.type === "string" &&
          item.props.className === `jds-indicator jds-indicator--${modifier}`
      );
    }

    it("renders the module identity even before any profile exists", async () => {
      mockUseProfiles.mockReturnValue(empty());
      const renderer = await renderRoot();

      expect(text(renderer)).toMatch(/Jarvis · Module/);
      expect(text(renderer)).toMatch(/Job Search/);
      // No profile to derive a status from yet, and no fetch exists to go get one — the aside is
      // omitted entirely rather than rendered empty or guessed at.
      expect(
        renderer.root.findAll(
          (item) =>
            typeof item.type === "string" &&
            typeof item.props.className === "string" &&
            item.props.className.startsWith("jds-indicator")
        )
      ).toHaveLength(0);
    });

    it('reads "Monitoring on" for an active, ready-to-crawl profile', async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "active", readyToCrawl: true })]));
      const renderer = await renderRoot();
      await flush(renderer);

      expect(text(renderer)).toMatch(/Monitoring on/);
      expect(findIndicator(renderer, "ready")).toHaveLength(1);
      // Never the invented "next run" clock from the design source — no schedule is knowable here.
      expect(text(renderer)).not.toMatch(/next run/i);
    });

    it('reads "Paused" for a paused profile', async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "paused" })]));
      const renderer = await renderRoot();
      await flush(renderer);

      expect(text(renderer)).toMatch(/Paused/);
      expect(findIndicator(renderer, "idle")).toHaveLength(1);
    });

    it('reads "Setup incomplete" for a profile still in_conversation', async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "in_conversation" })]));
      const renderer = await renderRoot();

      expect(text(renderer)).toMatch(/Setup incomplete/);
      expect(findIndicator(renderer, "drift")).toHaveLength(1);
    });

    it('reads "Setup incomplete" for an active profile that somehow isn\'t ready to crawl', async () => {
      mockUseProfiles.mockReturnValue(ready([profile({ state: "active", readyToCrawl: false })]));
      const renderer = await renderRoot();
      await flush(renderer);

      expect(text(renderer)).toMatch(/Setup incomplete/);
      expect(findIndicator(renderer, "drift")).toHaveLength(1);
      expect(text(renderer)).not.toMatch(/Monitoring on/);
    });
  });
});
