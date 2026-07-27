// Task 20 (#1304, board half): BoardScreen + Inspector in the plain node environment (no jsdom
// — same reasoning as job-search-web-root.test.tsx's header: a pure render, no document APIs
// needed except the minimal window stub below). api.ts is mocked so every assertion is against
// the transport call itself, never a real fetch. latch.ts is intentionally NOT mocked — test 10
// exercises the real module to prove board.tsx never imports or checks it (see that test).
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import { BoardScreen } from "../../external-modules/job-search/src/web/screens/board";
import * as api from "../../external-modules/job-search/src/web/api";
import { setLatched } from "../../external-modules/job-search/src/web/latch";
import type {
  BoardMatch,
  PortalListItem
} from "../../external-modules/job-search/src/web/board-types";
import type { FailureCause } from "../../external-modules/job-search/src/domain/records";

// A minimal, in-memory window stand-in — installed file-wide so latch.ts's real
// window.localStorage calls (test 10) don't throw under plain node, and so board.tsx's
// window-focus refetch effect (guarded with `typeof window === "undefined"`) has something to
// attach its no-op listener to instead of skipping that branch entirely.
function installWindowStub(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      }
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
}

function match(overrides: Partial<BoardMatch> = {}): BoardMatch {
  return {
    id: "m1",
    title: "Senior Engineer",
    company: "Acme",
    fit: 80,
    want: 70,
    fitReason: "Matches your stated skills.",
    wantReason: "Aligns with your stated priorities.",
    outsideFrame: false,
    state: "new",
    ...overrides
  };
}

function cause(overrides: Partial<FailureCause> = {}): FailureCause {
  return {
    kind: "rate_limited",
    sourceId: "linkedin",
    summary: "LinkedIn rate-limited this run.",
    retrieved: 3,
    expected: 10,
    lastOkAt: null,
    nextAction: "We'll retry automatically.",
    retryAt: null,
    disabled: false,
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

// Mutable transport fixtures the per-test invokeTool implementation reads from — lets a single
// test (14) flip matches.list from rejecting to succeeding between a render and a retry click
// without re-mocking the module.
let matchesShouldReject = false;
let matchesItems: BoardMatch[] = [];
let portalsItems: PortalListItem[] = [];

function installTransportMock(): void {
  vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
    if (name === "job-search.matches.list") {
      if (matchesShouldReject) throw new Error("Request failed (500)");
      return { items: matchesItems };
    }
    if (name === "job-search.portal.list") {
      return { portals: portalsItems };
    }
    throw new Error(`unexpected invokeTool ${name}`);
  });
}

beforeEach(() => {
  installWindowStub();
  matchesShouldReject = false;
  matchesItems = [];
  portalsItems = [];
  vi.mocked(api.invokeTool).mockReset();
  vi.mocked(api.runQueue).mockReset();
  vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
  installTransportMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderBoard(profileId = "p1"): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(BoardScreen, { profileId }));
  });
  return renderer;
}

// Flushes the microtask queue a few times over — enough for a mocked invokeTool/runQueue's
// resolved promise to reach its own .then() chain (job-search-web-root.test.tsx's own flush()).
async function flush(renderer: ReactTestRenderer): Promise<void> {
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  void renderer;
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

function findButton(renderer: ReactTestRenderer, name: RegExp) {
  return renderer.root.findAllByType("button").find((item) => {
    const children = Array.isArray(item.props.children)
      ? item.props.children
      : [item.props.children];
    return children.some((child: unknown) => typeof child === "string" && name.test(child));
  });
}

// Deliberately not scoped to <p> — the error branch's outer container is a <div role="alert">,
// not a paragraph, so this must match on role alone regardless of host element type.
function findByRole(renderer: ReactTestRenderer, role: string) {
  return renderer.root.findAll(
    (item) => (item.props as { role?: string }).role === role
  );
}

// The title button is always the first button rendered inside a data row (dismiss is the
// second) — scoping to each <tr>'s own buttons keeps this from picking up Inspector or banner
// buttons that also happen to be on the page.
function rowTitles(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType("tr")
    .filter((tr) => tr.findAllByType("td").length > 0)
    .map((tr) => flatten(tr.findAllByType("button")[0]?.props.children).trim());
}

describe("job-search web BoardScreen", () => {
  it("reads matches via job-search.matches.list with explicit profileId and limit", async () => {
    matchesItems = [match()];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    expect(api.invokeTool).toHaveBeenCalledWith("job-search.matches.list", {
      profileId: "p1",
      limit: 40
    });
    void renderer;
  });

  it("sorts Fit and Want independently — sorting one never reorders the other", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A", fit: 90, want: 10 }),
      match({ id: "m2", title: "Role B", fit: 50, want: 95 }),
      match({ id: "m3", title: "Role C", fit: 70, want: 50 })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    const fitHeader = findButton(renderer, /^Fit/);
    await act(async () => {
      fitHeader!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Role A", "Role C", "Role B"]);

    const wantHeader = findButton(renderer, /^Want/);
    await act(async () => {
      wantHeader!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Role B", "Role C", "Role A"]);
  });

  it("renders dashes and a 'Not read yet' flag for an unscored row, and the inspector says queued not dropped", async () => {
    matchesItems = [
      match({
        id: "m1",
        title: "Unscored Role",
        fit: null,
        want: null,
        fitReason: "",
        wantReason: "",
        state: "unscored"
      })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/Not read yet/);
    const cells = renderer.root.findAllByType("td").map((c) => flatten(c.props.children).trim());
    expect(cells.some((c) => c === "—")).toBe(true);

    const titleButton = findButton(renderer, /Unscored Role/);
    await act(async () => {
      titleButton!.props.onClick();
    });
    expect(text(renderer)).toMatch(/queued for scoring, not dropped/i);
  });

  it("sorts unscored rows last regardless of the active sort direction", async () => {
    matchesItems = [
      match({ id: "m1", title: "Scored Low", fit: 10, want: 10 }),
      match({
        id: "m2",
        title: "Unscored",
        fit: null,
        want: null,
        fitReason: "",
        wantReason: "",
        state: "unscored"
      }),
      match({ id: "m3", title: "Scored High", fit: 90, want: 90 })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    const fitHeader = findButton(renderer, /^Fit/);
    await act(async () => {
      fitHeader!.props.onClick(); // first click => desc
    });
    expect(rowTitles(renderer).at(-1)).toBe("Unscored");

    await act(async () => {
      fitHeader!.props.onClick(); // second click => asc
    });
    expect(rowTitles(renderer).at(-1)).toBe("Unscored");
  });

  it("renders a visible flag on an outside-frame row", async () => {
    matchesItems = [match({ id: "m1", title: "Frame Breaker", outsideFrame: true })];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/Outside your stated frame/);
  });

  it("never renders a combined or overall score anywhere", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A", fit: 80, want: 20 }),
      match({
        id: "m2",
        title: "Role B",
        fit: null,
        want: null,
        fitReason: "",
        wantReason: "",
        state: "unscored"
      })
    ];
    portalsItems = [portal({ cause: cause() })];
    const renderer = await renderBoard();
    await flush(renderer);

    const titleButton = findButton(renderer, /Role A/);
    await act(async () => {
      titleButton!.props.onClick();
    });

    expect(text(renderer)).not.toMatch(/\boverall\b|\bcombined\b/i);
  });

  it("renders a degraded portal's cause.summary and cause.nextAction verbatim", async () => {
    matchesItems = [match()];
    const degradedCause = cause({
      summary: "Indeed returned fewer postings than expected.",
      nextAction: "We'll try again on the next scheduled run."
    });
    portalsItems = [portal({ sourceId: "indeed", label: "Indeed", cause: degradedCause })];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toContain("Indeed returned fewer postings than expected.");
    expect(text(renderer)).toContain("We'll try again on the next scheduled run.");
  });

  it("renders a self-disabled portal as disabled-with-cause, not an error", async () => {
    matchesItems = [match()];
    const disabledCause = cause({
      kind: "login_required",
      summary: "LinkedIn requires signing in, which this module never does.",
      nextAction: "This board keeps working from your other sources.",
      disabled: true
    });
    portalsItems = [
      portal({ sourceId: "linkedin", label: "LinkedIn", enabled: false, cause: disabledCause })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(findByRole(renderer, "alert")).toHaveLength(0);
    expect(findByRole(renderer, "status").length).toBeGreaterThan(0);
    expect(text(renderer)).toContain("LinkedIn requires signing in, which this module never does.");
  });

  it("'Search now' enqueues via runQueue on job-search.crawl-run/crawl.run with the profileId, not local state", async () => {
    matchesItems = [match()];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    const searchNow = findButton(renderer, /^Search now/);
    await act(async () => {
      searchNow!.props.onClick();
    });
    await flush(renderer);

    expect(api.runQueue).toHaveBeenCalledWith("job-search.crawl-run", "crawl.run", {
      profileId: "p1"
    });
  });

  it("'Search now' fires even when the enqueue latch is already set for this actor/profile", async () => {
    setLatched("actor-x", "p1");
    matchesItems = [match()];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    const searchNow = findButton(renderer, /^Search now/);
    await act(async () => {
      searchNow!.props.onClick();
    });
    await flush(renderer);

    expect(api.runQueue).toHaveBeenCalledWith("job-search.crawl-run", "crawl.run", {
      profileId: "p1"
    });
  });

  it("renders each RunOutcome distinctly and keeps the button usable after an error", async () => {
    matchesItems = [match()];
    const renderer = await renderBoard();
    await flush(renderer);

    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "queued" });
    await act(async () => {
      findButton(renderer, /^Search now/)!.props.onClick();
    });
    await flush(renderer);
    expect(text(renderer)).toMatch(/new matches will appear here/i);

    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "already-queued" });
    await act(async () => {
      findButton(renderer, /^Search now/)!.props.onClick();
    });
    await flush(renderer);
    expect(text(renderer)).toMatch(/Already searching/);
    expect(findByRole(renderer, "alert")).toHaveLength(0);

    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "disabled" });
    await act(async () => {
      findButton(renderer, /^Search now/)!.props.onClick();
    });
    await flush(renderer);
    expect(text(renderer)).toMatch(/turned off for this account/i);

    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "error", message: "Network error" });
    await act(async () => {
      findButton(renderer, /^Search now/)!.props.onClick();
    });
    await flush(renderer);
    expect(text(renderer)).toMatch(/Couldn't start a search: Network error/);

    // The button must still be present, enabled, and clickable after the error outcome.
    const button = findButton(renderer, /^Search now/);
    expect(button).toBeTruthy();
    expect(button!.props.disabled).toBeFalsy();
    vi.mocked(api.runQueue).mockResolvedValueOnce({ kind: "queued" });
    await act(async () => {
      button!.props.onClick();
    });
    await flush(renderer);
    expect(api.runQueue).toHaveBeenCalledTimes(5);
  });

  it("dismiss enqueues job-search.match-state/match.set-state and hides the row immediately (optimistic)", async () => {
    matchesItems = [match({ id: "m1", title: "To Dismiss" })];
    // Never resolves during this test — proves the row hides before the write settles, not after.
    vi.mocked(api.runQueue).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderBoard("p1");
    await flush(renderer);

    const dismissButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Dismiss");
    });
    await act(async () => {
      dismissButton!.props.onClick();
    });

    expect(api.runQueue).toHaveBeenCalledWith("job-search.match-state", "match.set-state", {
      matchId: "m1",
      state: "dismissed"
    });
    expect(rowTitles(renderer)).not.toContain("To Dismiss");
  });

  it("restores a dismissed match with a plain message if the next read shows it still not dismissed", async () => {
    matchesItems = [match({ id: "m1", title: "Bounces Back", state: "new" })];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    const dismissButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Dismiss");
    });
    // The optimistic hide-then-reconcile round trip is all microtask chaining (no macrotask
    // boundary), so it fully drains within this one act() — the immediate-hide moment itself is
    // covered separately by the never-resolving-runQueue test above. What this test verifies is
    // the far side: matchesItems is unchanged (still "new"), simulating a write that never
    // actually landed, so the row must come back with a plain explanation.
    await act(async () => {
      dismissButton!.props.onClick();
    });
    await flush(renderer);

    expect(rowTitles(renderer)).toContain("Bounces Back");
    expect(text(renderer)).toMatch(/dismissal didn.t go through/i);
  });

  it("renders an error state with a working retry that re-invokes matches.list", async () => {
    matchesShouldReject = true;
    const renderer = await renderBoard();
    await flush(renderer);

    expect(findByRole(renderer, "alert").length).toBeGreaterThan(0);
    const retry = findButton(renderer, /Try again/i);
    expect(retry).toBeTruthy();

    matchesShouldReject = false;
    matchesItems = [match({ id: "m1", title: "Recovered Role" })];
    await act(async () => {
      retry!.props.onClick();
    });
    await flush(renderer);

    expect(findByRole(renderer, "alert")).toHaveLength(0);
    expect(rowTitles(renderer)).toContain("Recovered Role");
  });

  it("renders a distinct empty state for zero matches — not loading, not error", async () => {
    matchesItems = [];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/No matches yet/i);
    expect(text(renderer)).not.toMatch(/Loading/i);
    expect(findByRole(renderer, "alert")).toHaveLength(0);
  });
});
