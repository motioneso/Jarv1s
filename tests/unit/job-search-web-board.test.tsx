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

// Mockup rewrite (task #98): rows are match-row.tsx's own `.jsm-row` now — a single button that
// IS the whole row (no separate title button inside it the way the old two-part `.jsm-krow` row
// had), with the title nested three levels down inside `.jsm-row__main > .jsm-row__heading >
// .jds-card-title`. This helper follows that rewrite: find each row by its own `jsm-row` class,
// then read the title span directly rather than "the row's first button" (there is no second
// button to disambiguate from any more — see findRowButton below for opening a row).
function rowTitles(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((item) =>
      String((item.props as { className?: string }).className ?? "")
        .split(" ")
        .includes("jsm-row")
    )
    .map((row) => {
      const titleSpan = row
        .findAllByType("span")
        .find((span) =>
          String((span.props as { className?: string }).className ?? "")
            .split(" ")
            .includes("jds-card-title")
        );
      return flatten(titleSpan?.props.children).trim();
    });
}

// Opens a row by its title. match-row.tsx's row button carries no literal string as a direct
// child (unlike every other button in this screen — Search now, Try again, Fit/Want sort chips,
// bucket tabs, Save/Pass/Discuss — which all still have one and keep using findButton() above), so
// finding "the button whose title text matches" needs a flatten() over the row's own subtree
// rather than a direct-child scan. Scoped to `.jsm-row` so this can't accidentally match Inspector,
// sort, tab or banner buttons that also happen to be on the page.
function findRowButton(renderer: ReactTestRenderer, name: RegExp) {
  return renderer.root
    .findAll((item) =>
      String((item.props as { className?: string }).className ?? "")
        .split(" ")
        .includes("jsm-row")
    )
    .find((row) => name.test(flatten(row.children)));
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

  // Mockup rewrite (task #98, K-D1 superseded): Fit no longer draws a bar or keeps a raw number
  // anywhere — twenty rows of bare digits all weighed the same before this rewrite, and the
  // design already replaced that with a scannable rail colour plus a band word. Want is
  // unchanged and still draws its own jds-score bar with the raw number, but only inside
  // Inspector — match-row.tsx never renders Want at all, so the row itself has nothing left to
  // assert about Want's bar (see the "row itself" assertions below), and reaching Want's bar
  // means opening the row first.
  it("shows Fit as a band word on the row (no bar, no number), and Want as a scored bar with its number once opened", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", fit: 90, want: 10 })];
    matchGetResult = { match: matchDetail({ id: "m1", fit: 90, want: 10 }) };
    const renderer = await renderBoard();
    await flush(renderer);

    // Fit: the row shows "Strong fit" (90 >= 85) — never a bar, never the raw number 90.
    expect(text(renderer)).toMatch(/Strong fit/);
    expect(findByClass(renderer, "jds-score")).toEqual([]);

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    // Opened: Want's bar is the one place either axis still draws one.
    const fill = renderer.root.find(
      (item) => (item.props as { className?: string }).className === "jds-score__fill"
    );
    expect((fill.props as { style?: Record<string, unknown> }).style?.["--jds-score"]).toBe("0.1");
    expect(text(renderer)).toMatch(/10/);
  });

  it("clamps Want's bar to the track when the score is out of range; Fit has no track left to overflow", async () => {
    // Scores originate in a model-authored record, so a render path must treat 0-100 as an
    // assumption it enforces, not one it trusts. Fit has nothing left to clamp — fitBand routes
    // any value into a real band regardless of range (>=85 or <=0 both land on a real word, never
    // a crash) — so the clamp that still matters is Want's own Score component, in Inspector.
    matchesItems = [match({ id: "m1", title: "Role A", fit: 140, want: -20 })];
    matchGetResult = { match: matchDetail({ id: "m1", fit: 140, want: -20 }) };
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/Strong fit/); // 140 >= 85, still a real band

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const fill = renderer.root.find(
      (item) => (item.props as { className?: string }).className === "jds-score__fill"
    );
    expect((fill.props as { style?: Record<string, unknown> }).style?.["--jds-score"]).toBe("0");
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
    // in the same bar as a real one. match-row.tsx (task #98) still draws a rail on every row —
    // it's the leading fit-band colour swatch, always present — but for an unscored row it's the
    // quietest neutral tone (`jds-rail--line`), never one of the four band colours, and the
    // trailing word is "Not read yet", never a band label or a dash pretending to be one. Score's
    // `jds-score` bar (Want) never renders on the row at all, scored or not — see the test above.
    expect(findByClass(renderer, "jds-rail--line")).toHaveLength(1);
    for (const bandRail of ["jds-rail--accent", "jds-rail--steel", "jds-rail--line-strong"]) {
      expect(findByClass(renderer, bandRail)).toEqual([]);
    }
    expect(findByClass(renderer, "jds-score")).toEqual([]);

    await act(async () => {
      findRowButton(renderer, /Unscored Role/)!.props.onClick();
    });
    await flush(renderer);
    expect(text(renderer)).toMatch(/queued for scoring, not dropped/i);
  });

  // Team-lead ask (task #106 follow-up): the retired FitRail's two rendering tests protected "a
  // null Fit must never read as a scored zero" at the component level; fitBand itself never sees
  // null any more (match-row.tsx guards it — see fitBand's own test in job-search-keyline.test.tsx),
  // so the only place left to assert that invariant is here, on a SCORED row (want present, state
  // !== "unscored") with fit: null versus a real fit: 0 — both are isScored === true, but only one
  // has a band. Scoped to each row's own `.jsm-row__aside` (the fit-label slot) rather than the
  // whole row: the row's own meta line uses an em dash as an ordinary separator character
  // ("Remote — US"), which would otherwise falsely satisfy "renders a dash" for either fixture.
  it("on a scored row, a null Fit renders a bare em dash with no digit, distinguishable from a real 0 which renders 'Weak fit'", async () => {
    matchesItems = [
      match({ id: "m1", title: "No Basis", fit: null, want: 50, state: "new" }),
      match({ id: "m2", title: "Rock Bottom", fit: 0, want: 50, state: "new" })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    function asideText(row: ReturnType<typeof findRowButton>): string {
      const aside = row!
        .findAll(
          (item) =>
            String((item.props as { className?: string }).className ?? "")
              .split(" ")
              .includes("jsm-row__aside")
        )[0]!;
      return flatten(aside.children);
    }

    // Null Fit: a bare em dash, no band word, no digit anywhere in the fit-label slot.
    const noBasisAside = asideText(findRowButton(renderer, /No Basis/));
    expect(noBasisAside).toMatch(/—/);
    expect(noBasisAside).not.toMatch(/\d/);
    expect(noBasisAside).not.toMatch(/fit/i);

    // fit: 0 is a real score, not "no basis" — it lands in the weak band and reads as a word, the
    // same as any other real number would, never as the dash above and never as a raw digit.
    const rockBottomAside = asideText(findRowButton(renderer, /Rock Bottom/));
    expect(rockBottomAside).toMatch(/Weak fit/);
    expect(rockBottomAside).not.toMatch(/—/);
    expect(rockBottomAside).not.toMatch(/\d/);
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

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

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

  // Mockup rewrite (task #98/#100): the per-row Dismiss button is gone — Save/Pass now live in
  // the opportunity-detail screen's decision block (inspector.tsx), reached only by opening the
  // row, and "Dismiss" itself was renamed "Pass" in that block (the onDismiss prop name didn't
  // change, only the button's own text). Both tests below now open the row first.
  it("Pass (dismiss) enqueues job-search.match-state/match.set-state and hides the row immediately (optimistic)", async () => {
    matchesItems = [match({ id: "m1", title: "To Dismiss" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    // Never resolves during this test — proves the row hides before the write settles, not after.
    vi.mocked(api.runQueue).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderBoard("p1");
    await flush(renderer);

    await act(async () => {
      findRowButton(renderer, /To Dismiss/)!.props.onClick();
    });
    await flush(renderer);

    const passButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Pass");
    });
    await act(async () => {
      passButton!.props.onClick();
    });

    expect(api.runQueue).toHaveBeenCalledWith("job-search.match-state", "match.set-state", {
      matchId: "m1",
      state: "dismissed"
    });
    // handleDismiss nulls selectedMatchId immediately (board.tsx) — the view swaps straight back
    // to the list, and the same optimistic hide the old inline Dismiss gave still holds there.
    expect(rowTitles(renderer)).not.toContain("To Dismiss");
  });

  it("restores a dismissed match with a plain message if the next read shows it still not dismissed", async () => {
    matchesItems = [match({ id: "m1", title: "Bounces Back", state: "new" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    const renderer = await renderBoard("p1");
    await flush(renderer);

    await act(async () => {
      findRowButton(renderer, /Bounces Back/)!.props.onClick();
    });
    await flush(renderer);

    const passButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Pass");
    });
    // The optimistic hide-then-reconcile round trip is all microtask chaining (no macrotask
    // boundary), so it fully drains within this one act() — the immediate-hide moment itself is
    // covered separately by the never-resolving-runQueue test above. What this test verifies is
    // the far side: matchesItems is unchanged (still "new"), simulating a write that never
    // actually landed, so the row must come back with a plain explanation, back on the list view.
    await act(async () => {
      passButton!.props.onClick();
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
      findRowButton(renderer, /Role A/)!.props.onClick();
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
      findRowButton(renderer, /Role A/)!.props.onClick();
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
      findRowButton(renderer, /Role A/)!.props.onClick();
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
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    // Mockup rewrite (task #99): list and detail are a full view swap now, never shown together
    // (board.tsx: `selectedMatch ? <Inspector/> : <list/>`), so switching to a different row's
    // detail means going back to the list first — Role B's row isn't in the tree at all while
    // Role A's detail is showing. Role A's in-flight fetch keeps running in the background; going
    // back doesn't cancel it, which is exactly the race this test means to exercise.
    await act(async () => {
      findButton(renderer, /Back to matches/)!.props.onClick();
    });
    await flush(renderer);
    // Switch to Role B before Role A's fetch resolves, then let Role B's own fetch land.
    await act(async () => {
      findRowButton(renderer, /Role B/)!.props.onClick();
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
  it("renders Discuss, Open posting, and Pass together once a row's detail has loaded", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    const renderer = await renderBoard("p1", fakeAssistantSurface());
    await flush(renderer);

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const discussButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Discuss");
    });
    // Mockup rewrite (task #100): the decision block's own dismiss button reads "Pass" now, not
    // "Dismiss" — the onDismiss prop it calls didn't rename, only its label (inspector.tsx).
    const passButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Pass");
    });
    const openPostingLink = renderer.root.findAllByType("a").find((item) => item.props.href);

    expect(discussButton).toBeTruthy();
    expect(passButton).toBeTruthy();
    expect(openPostingLink).toBeTruthy();
  });

  // Without assistantSurface, Discuss must not render at all (a hidden control, not a disabled
  // one — discuss.tsx's own "an action that silently does nothing is worse than an action that is
  // not there") while Open posting and Pass are unaffected, since neither depends on it.
  it("hides Discuss (but not Open posting or Pass) when no assistantSurface is provided", async () => {
    matchesItems = [match({ id: "m1", title: "Role A", url: "https://jobs.example.com/role-a" })];
    matchGetResult = { match: matchDetail({ id: "m1" }) };
    const renderer = await renderBoard("p1");
    await flush(renderer);

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const discussButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Discuss");
    });
    const passButton = renderer.root.findAllByType("button").find((item) => {
      const children = Array.isArray(item.props.children)
        ? item.props.children
        : [item.props.children];
      return children.some((child: unknown) => child === "Pass");
    });
    const openPostingLink = renderer.root.findAllByType("a").find((item) => item.props.href);

    expect(discussButton).toBeFalsy();
    expect(passButton).toBeTruthy();
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
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    const link = renderer.root.findAllByType("a").find((item) => item.props.href);
    expect(link).toBeTruthy();
    expect(link!.props.href).toBe("https://jobs.example.com/role-a");
    expect(link!.props.target).toBe("_blank");
    expect(link!.props.rel).toBe("noopener noreferrer");
    expect(link!.props.onClick).toBeUndefined();
  });

  // Mockup rewrite (task #98/#99): the board now renders match-row.tsx's single-button
  // `.jsm-row`s instead of KeyRow, and the row itself carries no score for either axis any more
  // — Fit is a band word, Want doesn't render on the row at all (see the "shows Fit as a band
  // word..." test above). Both replace the old K2-era "carries both numbers" case.

  it("an opened, scored row renders both axis labels, Want's own number, and never a combined figure", async () => {
    // K-D1 superseded (task #98): Fit's raw number (80) never renders anywhere any more — it's a
    // band word only. This genuinely narrows the old invariant, which expected Fit to "keep its
    // number" the same way Want does; that half no longer holds under the new design.
    matchesItems = [match({ id: "m1", title: "Role A", fit: 80, want: 70 })];
    matchGetResult = { match: matchDetail({ id: "m1", fit: 80, want: 70 }) };
    const renderer = await renderBoard();
    await flush(renderer);

    // Before opening: a single Fit band word ("Good fit", 80 falls in [65,85)) and nothing of
    // Want's — Want has no row-level rendering at all (match-row.tsx).
    expect(text(renderer)).toMatch(/Good fit/);
    expect(findByClass(renderer, "jds-score")).toEqual([]);

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    // Opened: both axis labels are present, and there is exactly one jds-score bar — Want's own,
    // never a second one for Fit (fit and want are still never blended into one score, L9).
    expect(text(renderer)).toMatch(/Fit/);
    expect(text(renderer)).toMatch(/Want/);
    expect(findByClass(renderer, "jds-score")).toHaveLength(1);
    expect(text(renderer)).toMatch(/Good fit/);
    expect(text(renderer)).toMatch(/70/);
    expect(text(renderer)).not.toMatch(/\b80\b/);
  });

  // K-D1 superseded (task #98): the old "n-1 dividers for n rows" mechanism — KeyRow's own
  // `divided={i > 0}` sibling-divider bookkeeping — is retired along with KeyRow itself.
  // match-row.tsx draws its own top hairline on EVERY row unconditionally, via the CSS class
  // `jds-hairline-row` (a border, not a DOM sibling — board.tsx's own comment: "No divided/i > 0
  // bookkeeping any more... the trailing divider below closes the list off at the bottom"), and
  // the list closes with exactly one trailing bare `jds-divider` regardless of row count. There is
  // no per-row-count arithmetic left to get wrong, so this replaces the old count-based assertion
  // with the two things that are still real: every row carries the hairline hook, and the list
  // closes with exactly one bare divider, never zero and never one per row.
  it("draws every row's own hairline via CSS and closes the list with exactly one trailing divider", async () => {
    matchesItems = [
      match({ id: "m1", title: "Role A" }),
      match({ id: "m2", title: "Role B" }),
      match({ id: "m3", title: "Role C" })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    const rows = findByClass(renderer, "jsm-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(String((row.props as { className?: string }).className).split(" ")).toContain(
        "jds-hairline-row"
      );
    }

    // Filtered to the bare, single-class "jds-divider" the list's own trailing <hr> renders —
    // board.tsx's hero rule (`jds-divider jds-divider--strong jsm-hero__rule`) also carries the
    // class and would otherwise inflate this count by one regardless of row count.
    const bareDividers = renderer.root.findAll(
      (item) => (item.props as { className?: string }).className === "jds-divider"
    );
    expect(bareDividers).toHaveLength(1);
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

  // Already-approved ruling (commit 3914bd36, applied consistently in both match-row.tsx and
  // inspector.tsx): the outside-frame flag is plain gold-toned text — `jds-eyebrow
  // jds-eyebrow--gold` — never a badge/chip. This test's old target class (`jds-badge--outline`)
  // was superseded before this remediation started; porting it forward is a stale-test fix, not a
  // new design decision.
  it("renders the outside-frame flag as plain gold text in the meta line, not by dimming the whole row", async () => {
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

    // `.jsm-card--outside` (opacity dimming) is deleted — the outside-frame signal sits inline in
    // the row's own meta line beside the existing source/location/posted-date text, none of which
    // regressed when the card wrapper was removed.
    const goldFlag = findByClass(renderer, "jds-eyebrow--gold");
    expect(goldFlag).toHaveLength(1);
    expect(flatten(goldFlag[0]!.props.children)).toMatch(/Outside your stated frame/);

    expect(text(renderer)).toContain("LinkedIn");
    expect(text(renderer)).toContain("Remote — US");
    expect(text(renderer)).toMatch(/Posted Jul 15/);
  });
});
