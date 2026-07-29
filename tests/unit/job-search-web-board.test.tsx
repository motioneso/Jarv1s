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
  MatchDetail,
  PortalListItem
} from "../../external-modules/job-search/src/web/board-types";
import type { FailureCause } from "../../external-modules/job-search/src/domain/records";
import type { AssistantSurfaceHandleV1 } from "../../external-modules/job-search/src/domain/seed-prompt";

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
    outsideFrame: false,
    state: "new",
    url: "https://example.com/jobs/senior-engineer",
    location: "Remote — US",
    source: "LinkedIn",
    postedAt: "2026-07-15T09:00:00.000Z",
    ...overrides
  };
}

// #1330: the untruncated record job-search.match.get answers with, fetched by board.tsx once a
// row is selected. A separate helper from match() — MatchDetail is its own type, not
// BoardMatch-plus-fields (see board-types.ts's own comment on why).
function matchDetail(overrides: Partial<MatchDetail> = {}): MatchDetail {
  return {
    id: "m1",
    title: "Senior Engineer",
    company: "Acme",
    url: "https://example.com/jobs/senior-engineer",
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
// #1330: job-search.match.get's fixture. `undefined` (the default) means "the test never
// exercises this path" and throws, same as any other unmapped tool name below — a test that
// opens the inspector without setting this is deliberately exercising the failure branch, not
// an oversight (see the "queued not dropped" and "never renders a combined score" tests, which
// open a row but only assert on content that never reads detail/detailError).
let matchGetResult: { match: MatchDetail | null } | undefined;
let matchGetShouldReject = false;

function installTransportMock(): void {
  vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
    if (name === "job-search.matches.list") {
      if (matchesShouldReject) throw new Error("Request failed (500)");
      return { items: matchesItems };
    }
    if (name === "job-search.portal.list") {
      return { portals: portalsItems };
    }
    if (name === "job-search.match.get") {
      if (matchGetShouldReject) throw new Error("Request failed (500)");
      if (matchGetResult !== undefined) return matchGetResult;
      throw new Error(`unexpected invokeTool ${name}`);
    }
    throw new Error(`unexpected invokeTool ${name}`);
  });
}

beforeEach(() => {
  installWindowStub();
  matchesShouldReject = false;
  matchesItems = [];
  portalsItems = [];
  matchGetResult = undefined;
  matchGetShouldReject = false;
  vi.mocked(api.invokeTool).mockReset();
  vi.mocked(api.runQueue).mockReset();
  vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
  installTransportMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderBoard(
  profileId = "p1",
  assistantSurface?: AssistantSurfaceHandleV1
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(BoardScreen, { profileId, assistantSurface }));
  });
  return renderer;
}

// Task 20/#1304: a fake satisfying AssistantSurfaceHandleV1 structurally (module isolation means
// board.tsx never imports the host's real handle, only this local mirror) — submitTurn is a spy
// so Discuss's own wiring can be asserted on without a real chat-surface test double.
function fakeAssistantSurface(): AssistantSurfaceHandleV1 {
  return {
    setSurfaceKey: vi.fn(),
    seedContext: vi.fn(async () => undefined),
    submitTurn: vi.fn(async () => undefined),
    Surface: () => null
  };
}

// Flushes the microtask queue a few times over — enough for a mocked invokeTool/runQueue's
// resolved promise to reach its own .then() chain (job-search-web-root.test.tsx's own flush()).
async function flush(renderer: ReactTestRenderer): Promise<void> {
  for (let i = 0; i < 4; i++) {
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
  return renderer.root.findAll((item) => (item.props as { role?: string }).role === role);
}

// K2: rows are keyline rows now (KeyRow's own `.jsm-krow`, from keyline.tsx), not cards — this
// helper follows that rename. KeyRow renders `.jsm-krow__main` (title button first, matching
// MatchRow's own children order) before `.jsm-krow__aside` (Dismiss), so the first button found
// inside `.jsm-krow` is still the title button, same as it was inside `.jsm-card`. Scoping to
// each row's own buttons keeps this from picking up Inspector, sort, tab or banner buttons that
// also happen to be on the page. Matched on the `jsm-krow` hook rather than on <article>, because
// the element type is a rendering detail and the hook is the contract the CSS also uses.
function rowTitles(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((item) =>
      String((item.props as { className?: string }).className ?? "")
        .split(" ")
        .includes("jsm-krow")
    )
    .map((row) => flatten(row.findAllByType("button")[0]?.props.children).trim());
}

// K2/K1 (job-search-keyline.test.tsx's own copy): a class-membership predicate over
// renderer.root, not over the toJSON() tree flatten()/text() walk — needed whenever a test cares
// about *how many* elements carry a class (a tab's own count span, a divider count) rather than
// just whether the class's text appears anywhere in the page.
function findByClass(renderer: ReactTestRenderer, className: string) {
  return renderer.root.findAll((item) =>
    String((item.props as { className?: string }).className ?? "")
      .split(" ")
      .includes(className)
  );
}

describe("job-search web BoardScreen", () => {
  it("reads matches via job-search.matches.list with explicit profileId and limit", async () => {
    matchesItems = [match()];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    expect(api.invokeTool).toHaveBeenCalledWith("job-search.matches.list", {
      profileId: "p1",
      limit: 25
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

    // The board opens sorted by Fit descending — an unsorted board leads with whatever the store
    // returned, which reads as a broken matcher rather than an unsorted table.
    expect(rowTitles(renderer)).toEqual(["Role A", "Role C", "Role B"]);

    // So the first click on Fit flips it, rather than re-applying the order already on screen and
    // appearing to do nothing.
    const fitHeader = findButton(renderer, /^Fit/);
    await act(async () => {
      fitHeader!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Role B", "Role C", "Role A"]);

    // Want sorts on its own axis and does not inherit Fit's direction (L9: the two are never
    // blended). A fresh column starts descending, highest want first.
    const wantHeader = findButton(renderer, /^Want/);
    await act(async () => {
      wantHeader!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Role B", "Role C", "Role A"]);

    // And back to Fit descending, proving the two axes are independent rather than one ordering
    // shared between two labels.
    await act(async () => {
      fitHeader!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Role A", "Role C", "Role B"]);
  });

  it("draws each score as a bar whose length is the score, and keeps the number", async () => {
    // Twenty rows of bare digits all weigh the same, so 90 and 10 are equally loud and the strong
    // matches can only be found by reading every row. The bar is the thing that makes the column
    // scannable; the number stays because a bar alone can't be compared precisely or read aloud.
    matchesItems = [match({ id: "m1", title: "Role A", fit: 90, want: 10 })];
    const renderer = await renderBoard();
    await flush(renderer);

    const fills = renderer.root
      .findAll((item) => (item.props as { className?: string }).className === "jds-score__fill")
      .map((item) => (item.props as { style?: Record<string, unknown> }).style?.["--jds-score"]);
    // Fit first, then Want — the two axes are never blended (L9), so they carry their own values.
    expect(fills).toEqual(["0.9", "0.1"]);

    expect(text(renderer)).toMatch(/90/);
    expect(text(renderer)).toMatch(/10/);
  });

  it("clamps an out-of-range score to the track instead of overflowing it", async () => {
    // Scores originate in a model-authored record, so a render path must treat 0-100 as an
    // assumption it enforces rather than one it trusts: a bad value draws a wrong-looking bar,
    // never a bar that spills past its track.
    matchesItems = [match({ id: "m1", title: "Role A", fit: 140, want: -20 })];
    const renderer = await renderBoard();
    await flush(renderer);

    const fills = renderer.root
      .findAll((item) => (item.props as { className?: string }).className === "jds-score__fill")
      .map((item) => (item.props as { style?: Record<string, unknown> }).style?.["--jds-score"]);
    expect(fills).toEqual(["1", "0"]);
  });

  it("renders dashes and a 'Not read yet' flag for an unscored row, and the inspector says queued not dropped", async () => {
    matchesItems = [
      match({
        id: "m1",
        title: "Unscored Role",
        fit: null,
        want: null,
        state: "unscored"
      })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/Not read yet/);
    // An unscored row carries no number on either axis, and never a 0 — a zero is a score, drawn
    // in the same bar as a real one. The row now says "Not read yet" in place of the whole axes
    // block rather than drawing two em-dashes inside it (two blank instruments read as a
    // measurement that came back empty; the sentence says why there is no measurement yet). K2
    // retargets this from the old `.jsm-card__value` class (deleted with the rest of the card
    // vocabulary) to the two classes that could carry a score today — neither FitRail's own
    // `jsm-fit-rail` wrapper nor Score's `jds-score` bar renders at all for an unscored row.
    expect(findByClass(renderer, "jsm-fit-rail")).toEqual([]);
    expect(findByClass(renderer, "jds-score")).toEqual([]);

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

  // #1330: the inspector's "Open posting" link uses BoardMatch's own url field, so it must not
  // wait on the job-search.match.get round trip the reasons below depend on.
  it("renders the 'Open posting' link from the row's own url, before the detail fetch resolves", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    // Never resolves — proves the link is present before, not because of, this response landing.
    matchGetResult = undefined;
    vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
      if (name === "job-search.matches.list") return { items: matchesItems };
      if (name === "job-search.portal.list") return { portals: [] };
      if (name === "job-search.match.get") return new Promise(() => undefined);
      throw new Error(`unexpected invokeTool ${name}`);
    });
    const renderer = await renderBoard();
    await flush(renderer);

    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });

    const link = renderer.root.findAllByType("a").find((item) => item.props.href);
    expect(link).toBeTruthy();
    expect(link!.props.href).toBe("https://jobs.example.com/role-a");
  });

  it("fetches job-search.match.get with the selected matchId and renders its fitReason/wantReason once resolved", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", fit: 80, want: 20 })];
    matchGetResult = {
      match: matchDetail({
        id: "m1",
        fitReason: "Matches your stated skills.",
        wantReason: "Aligns with your stated priorities."
      })
    };
    const renderer = await renderBoard();
    await flush(renderer);

    // Deliberately not asserting the "Loading the reason…" text here: this test harness's
    // act(async () => {...}) drains the mock's already-resolved promise within the same act
    // call, so the loading frame isn't independently observable — the loading branch itself is
    // simple JSX with nothing left to verify beyond what TypeScript already checks.
    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    expect(api.invokeTool).toHaveBeenCalledWith("job-search.match.get", { matchId: "m1" });
    expect(text(renderer)).toContain("Matches your stated skills.");
    expect(text(renderer)).toContain("Aligns with your stated priorities.");
    expect(findByRole(renderer, "alert")).toHaveLength(0);
  });

  it("shows a plain error message, not a crash, when job-search.match.get fails", async () => {
    matchesItems = [match({ id: "m1", title: "Role A" })];
    matchGetShouldReject = true;
    const renderer = await renderBoard();
    await flush(renderer);

    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    // board.tsx's catch surfaces the real Error's own message (same pattern as fetchMatches's
    // catch above) rather than papering over it with the generic fallback, which only applies
    // to a non-Error throw or a match.get response that resolves to { match: null }.
    expect(findByRole(renderer, "alert").length).toBeGreaterThan(0);
    expect(text(renderer)).toMatch(/Request failed \(500\)/i);
  });

  it("never shows a stale row's detail after the selection moves to a different row", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A", fit: 80, want: 20 }),
      match({ id: "m2", title: "Role B", fit: 60, want: 40 })
    ];
    let resolveFirst!: (value: { match: MatchDetail | null }) => void;
    let callCount = 0;
    vi.mocked(api.invokeTool).mockImplementation(async (name: string, params?: unknown) => {
      if (name === "job-search.matches.list") return { items: matchesItems };
      if (name === "job-search.portal.list") return { portals: [] };
      if (name === "job-search.match.get") {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return { match: matchDetail({ id: (params as { matchId: string }).matchId }) };
      }
      throw new Error(`unexpected invokeTool ${name}`);
    });
    const renderer = await renderBoard();
    await flush(renderer);

    // Open Role A — its match.get call is left pending on purpose.
    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    // Switch to Role B before Role A's fetch resolves, then let Role B's own fetch land.
    await act(async () => {
      findButton(renderer, /Role B/)!.props.onClick();
    });
    await flush(renderer);

    // Now the stale Role A response arrives — it must not overwrite Role B's already-ready state.
    await act(async () => {
      resolveFirst({ match: matchDetail({ id: "m1", fitReason: "Stale reason for Role A." }) });
    });
    await flush(renderer);

    expect(text(renderer)).not.toContain("Stale reason for Role A.");
  });

  // Task 20/#1304: the plan's three-actions requirement — Discuss, Open posting, and Dismiss must
  // all be reachable from one opened row, not just individually wired. Discuss needs the full
  // MatchDetail (fitReason/wantReason) the same way the fit/want reasons do, so this only asserts
  // once matchGetResult has resolved, matching how the other two already behave once a row opens.
  it("renders Discuss, Open posting, and Dismiss together once a row's detail has loaded", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    const renderer = await renderBoard("p1", fakeAssistantSurface());
    await flush(renderer);

    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const discussButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Discuss");
    });
    const dismissButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Dismiss");
    });
    const openPostingLink = renderer.root.findAllByType("a").find((item) => item.props.href);

    expect(discussButton).toBeTruthy();
    expect(dismissButton).toBeTruthy();
    expect(openPostingLink).toBeTruthy();
  });

  // Without assistantSurface, Discuss must not render at all (a hidden control, not a disabled
  // one — discuss.tsx's own "an action that silently does nothing is worse than an action that is
  // not there") while Open posting and Dismiss are unaffected, since neither depends on it.
  it("hides Discuss (but not Open posting or Dismiss) when no assistantSurface is provided", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    const renderer = await renderBoard("p1");
    await flush(renderer);

    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const discussButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Discuss");
    });
    const dismissButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Dismiss");
    });
    const openPostingLink = renderer.root.findAllByType("a").find((item) => item.props.href);

    expect(discussButton).toBeFalsy();
    expect(dismissButton).toBeTruthy();
    expect(openPostingLink).toBeTruthy();
  });

  // #1330 built the link; Task 20/#1304's own board-screen gap named this assertion explicitly —
  // a real external `<a>`, not an onClick-driven button, so the browser's own noopener/noreferrer
  // guarantees apply rather than anything this module would have to reimplement.
  it("'Open posting' is a real link with rel=\"noopener noreferrer\", not an onClick button", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    const renderer = await renderBoard();
    await flush(renderer);

    await act(async () => {
      findButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const link = renderer.root.findAllByType("a").find((item) => item.props.href);
    expect(link).toBeTruthy();
    expect(link!.props.href).toBe("https://jobs.example.com/role-a");
    expect(link!.props.target).toBe("_blank");
    expect(link!.props.rel).toBe("noopener noreferrer");
    expect(link!.props.onClick).toBeUndefined();
  });

  // K2 (2026-07-28 keyline-restructure plan): the board now renders match-row.tsx's KeyRow-based
  // rows instead of `.jsm-card`. This block covers the six K2 cases the plan names explicitly.
  // Case 1 ("an unscored row carries no score-value class") is already covered above by the
  // retargeted "renders dashes and a 'Not read yet' flag..." test — it now asserts against
  // jsm-fit-rail/jds-score, the two classes that could carry a score, rather than the deleted
  // jsm-card__value — so it is not duplicated here.

  it("a scored row renders both axis labels and both numbers, never a combined figure", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", fit: 80, want: 70 })];
    const renderer = await renderBoard();
    await flush(renderer);

    // Two independent FitRails (L9: fit and want are never blended into one score) — one
    // jds-score per axis, never a single shared bar.
    expect(findByClass(renderer, "jds-score")).toHaveLength(2);
    expect(text(renderer)).toMatch(/Fit/);
    expect(text(renderer)).toMatch(/Want/);
    expect(text(renderer)).toMatch(/80/);
    expect(text(renderer)).toMatch(/70/);
  });

  it("renders exactly n-1 dividers for n rows in the open bucket", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A" }),
      match({ id: "m2", title: "Role B" }),
      match({ id: "m3", title: "Role C" })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    // KeyRow renders its own jds-divider as a sibling above every row but the first
    // (`divided={i > 0}`, board.tsx's own map) — three rows means two rules, not three, since the
    // module cannot draw a keyline of its own and the list itself carries no gap (styles.css's
    // K2 comment on .jsm-list). Filtered to the bare, single-class "jds-divider" KeyRow itself
    // renders — board.tsx's own hero rule (`jds-divider jds-divider--strong jsm-hero__rule`) also
    // carries the class and would otherwise inflate this count by one regardless of row count.
    const rowDividers = renderer.root.findAll(
      (item) => (item.props as { className?: string }).className === "jds-divider"
    );
    expect(rowDividers).toHaveLength(2);
  });

  it("bucket tabs count each state correctly and filter the visible rows on click", async () => {
    matchesItems = [
      match({ id: "m1", title: "New Role", state: "new" }),
      match({ id: "m2", title: "Unscored Role", state: "unscored", fit: null, want: null }),
      match({ id: "m3", title: "Saved Role", state: "seen" }),
      match({ id: "m4", title: "Passed Role", state: "dismissed" })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    // "New" absorbs both `new` and `unscored` (board.tsx's own bucketOf) — two rows there, one
    // each in Saved and Passed.
    const counts = findByClass(renderer, "jds-tab__count").map((item) => item.props.children);
    expect(counts).toEqual([2, 1, 1]);

    // The board opens on New — Saved and Passed rows are not part of the initial render.
    expect(rowTitles(renderer)).toEqual(["New Role", "Unscored Role"]);

    const savedTab = findButton(renderer, /^Saved/);
    await act(async () => {
      savedTab!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Saved Role"]);

    const passedTab = findButton(renderer, /^Passed/);
    await act(async () => {
      passedTab!.props.onClick();
    });
    expect(rowTitles(renderer)).toEqual(["Passed Role"]);
  });

  it("never renders any element carrying a jsm-card* class anywhere in the tree", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A", outsideFrame: true }),
      match({ id: "m2", title: "Role B", state: "unscored", fit: null, want: null })
    ];
    portalsItems = [portal({ cause: cause() })];
    const renderer = await renderBoard();
    await flush(renderer);

    // The whole point of K2: `.jsm-card`/`.jsm-card__head`/`.jsm-card__axes`/`.jsm-card__axis`/
    // `.jsm-card__value`/`.jsm-card__foot`/`.jsm-card__pending`/`.jsm-card--outside` are all gone,
    // from styles.css and from every render path — a class-prefix scan is the one assertion that
    // covers all eight without naming each individually (and would also catch a future regression
    // reintroducing any of them under the same family).
    const cardClasses = renderer.root
      .findAll((item) => {
        const className = (item.props as { className?: string }).className;
        return typeof className === "string" && /(^|\s)jsm-card/.test(className);
      })
      .map((item) => (item.props as { className?: string }).className);
    expect(cardClasses).toEqual([]);
  });

  it("renders the outside-frame flag as a chip in the meta line, not by dimming the whole row", async () => {
    matchesItems = [
      match({
        id: "m1",
        title: "Frame Breaker",
        outsideFrame: true,
        source: "LinkedIn",
        location: "Remote — US",
        postedAt: "2026-07-15T09:00:00.000Z"
      })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    // `.jsm-card--outside` (opacity dimming) is deleted — the outside-frame signal is now a
    // jds-badge--outline chip that sits inside .jsm-meta beside the existing source/location/
    // posted-date pills, none of which regressed when the card wrapper was removed.
    const outsideBadge = findByClass(renderer, "jds-badge--outline");
    expect(outsideBadge).toHaveLength(1);
    expect(flatten(outsideBadge[0]!.props.children)).toMatch(/Outside your stated frame/);

    expect(text(renderer)).toContain("LinkedIn");
    expect(text(renderer)).toContain("Remote — US");
    expect(text(renderer)).toMatch(/Posted Jul 15/);
  });
});
