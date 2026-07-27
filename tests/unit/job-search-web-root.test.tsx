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
import type { AssistantSurfaceHandleV1 } from "../../external-modules/job-search/src/domain/seed-prompt";
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

// Only the two methods Root's useProfileThread actually calls — the narrow local mirror of the
// host's real AssistantSurfaceHandleV1 (module isolation: no import of host chat internals).
function assistantSurface(): AssistantSurfaceHandleV1 {
  return {
    setSurfaceKey: vi.fn(),
    seedContext: vi.fn().mockResolvedValue(undefined)
  };
}

// Flushes the microtask queue a few times over — enough for a mocked
// runQueue's resolved promise to reach its .then(setQueueNotice).
async function flush(renderer: ReactTestRenderer): Promise<void> {
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
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
    // makes the two pre-existing "renders ... table" assertions below still true; individual
    // tests don't otherwise care what the board or settings screens render.
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
              fitReason: "Matches your stated skills.",
              wantReason: "Aligns with your stated priorities.",
              outsideFrame: false,
              state: "new"
            }
          ]
        };
      }
      if (name === "job-search.portal.list") return { portals: [] };
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

  it("bootstrap only ever opens the assistant composer, never invokes a tool directly", async () => {
    mockUseProfiles.mockReturnValue(empty());
    const actions = hostActions();
    const renderer = await renderRoot(actions);

    const start = findButton(renderer, /Start your job search/i);
    expect(start).toBeTruthy();
    await act(async () => {
      start!.props.onClick();
    });

    expect(actions.openAssistant).toHaveBeenCalledTimes(1);
    const call = (actions.openAssistant as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.starterPrompt).toMatch(/job search profile/i);
    expect(api.invokeTool).not.toHaveBeenCalled();

    // Root re-renders with pollArmed flipped true — Root's own arming signal,
    // not the hook's (mocked) internal timing.
    const lastCallProps = mockUseProfiles.mock.calls.at(-1)![0];
    expect(lastCallProps.pollArmed).toBe(true);
    expect(text(renderer)).toMatch(/Setting up your job search profile/);
  });

  it("renders the real onboarding screen for a profile with no criteria yet", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "in_conversation" })]));
    const renderer = await renderRoot();

    expect(text(renderer)).toMatch(/work out what this search is for/);
    expect(renderer.root.findAllByType("table")).toHaveLength(0);
  });

  it("renders the real board screen for a profile with criteria", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ state: "active" })]));
    const renderer = await renderRoot();
    await flush(renderer);

    expect(renderer.root.findAllByType("table")).toHaveLength(1);
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
    expect(status.some((p) => flatten(p.props.children).match(/search run has been queued/))).toBe(
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
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));
    const surface = assistantSurface();
    const actions = hostActions();
    const renderer = await renderRoot(actions, surface);
    await flush(renderer);

    expect(surface.setSurfaceKey).toHaveBeenCalledWith("p1");
    expect(surface.seedContext).toHaveBeenCalledTimes(1);
    const [seedText, idempotencyKey] = vi.mocked(surface.seedContext).mock.calls[0];
    expect(idempotencyKey).toBe("job-search:p1:v1");
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

  it("renders fine when the host gives it no assistant surface", async () => {
    mockUseProfiles.mockReturnValue(ready([profile({ profileId: "p1", state: "active" })]));
    const renderer = await renderRoot(hostActions());
    await flush(renderer);

    expect(renderer.root.findAllByType("table")).toHaveLength(1);
  });
});
