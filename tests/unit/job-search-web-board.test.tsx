// Task 20 (#1304, board half): BoardScreen's list surface — reading, sorting, the two score
// axes, portal banners, Search now, Pass, and the error/empty states. Runs in the plain node
// environment (no jsdom — a pure render needs no document APIs beyond the harness's window stub).
// api.ts is mocked so every assertion is against the transport call itself, never a real fetch.
// latch.ts is intentionally NOT mocked — the "Search now fires even when latched" test exercises
// the real module to prove board.tsx never imports or checks it.
//
// The inspector half of this screen lives in job-search-web-board-inspector.test.tsx; the two were
// one file until it crossed the 1000-line gate. Shared fixtures and DOM helpers are in
// ./helpers/job-search-board-harness.
import "./helpers/install-module-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

import { act } from "react-test-renderer";
import * as api from "../../external-modules/job-search/src/web/api";
import { setLatched } from "../../external-modules/job-search/src/web/latch";

import {
  match,
  matchDetail,
  cause,
  portal,
  fixtures,
  setupBoardHarness,
  renderBoard,
  flush,
  flatten,
  text,
  findButton,
  findByRole,
  rowTitles,
  findRowButton,
  findByClass
} from "./helpers/job-search-board-harness";

setupBoardHarness();

describe("job-search web BoardScreen", () => {
  it("reads matches via job-search.matches.list with explicit profileId and limit", async () => {
    fixtures.matchesItems = [match()];
    const renderer = await renderBoard("p1");
    await flush(renderer);

    expect(api.invokeTool).toHaveBeenCalledWith("job-search.matches.list", {
      profileId: "p1",
      limit: 25
    });
    void renderer;
  });

  it("sorts Fit and Want independently — sorting one never reorders the other", async () => {
    fixtures.matchesItems = [
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
    fixtures.matchesItems = [match({ id: "m1", title: "Role A", fit: 90, want: 10 })];
    fixtures.matchGetResult = { match: matchDetail({ id: "m1", fit: 90, want: 10 }) };
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
    fixtures.matchesItems = [match({ id: "m1", title: "Role A", fit: 140, want: -20 })];
    fixtures.matchGetResult = { match: matchDetail({ id: "m1", fit: 140, want: -20 }) };
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
    fixtures.matchesItems = [
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
    fixtures.matchesItems = [
      match({ id: "m1", title: "No Basis", fit: null, want: 50, state: "new" }),
      match({ id: "m2", title: "Rock Bottom", fit: 0, want: 50, state: "new" })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    function asideText(row: ReturnType<typeof findRowButton>): string {
      const aside = row!.findAll((item) =>
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
    fixtures.matchesItems = [
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
    fixtures.matchesItems = [match({ id: "m1", title: "Frame Breaker", outsideFrame: true })];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/Outside your stated frame/);
  });

  it("never renders a combined or overall score anywhere", async () => {
    fixtures.matchesItems = [
      match({ id: "m1", title: "Role A", fit: 80, want: 20 }),
      match({
        id: "m2",
        title: "Role B",
        fit: null,
        want: null,
        state: "unscored"
      })
    ];
    fixtures.portalsItems = [portal({ cause: cause() })];
    const renderer = await renderBoard();
    await flush(renderer);

    await act(async () => {
      findRowButton(renderer, /Role A/)!.props.onClick();
    });
    await flush(renderer);

    expect(text(renderer)).not.toMatch(/\boverall\b|\bcombined\b/i);
  });

  it("renders a degraded portal's cause.summary and cause.nextAction verbatim", async () => {
    fixtures.matchesItems = [match()];
    const degradedCause = cause({
      summary: "Indeed returned fewer postings than expected.",
      nextAction: "We'll try again on the next scheduled run."
    });
    fixtures.portalsItems = [portal({ sourceId: "indeed", label: "Indeed", cause: degradedCause })];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toContain("Indeed returned fewer postings than expected.");
    expect(text(renderer)).toContain("We'll try again on the next scheduled run.");
  });

  it("renders a self-disabled portal as disabled-with-cause, not an error", async () => {
    fixtures.matchesItems = [match()];
    const disabledCause = cause({
      kind: "login_required",
      summary: "LinkedIn requires signing in, which this module never does.",
      nextAction: "This board keeps working from your other sources.",
      disabled: true
    });
    fixtures.portalsItems = [
      portal({ sourceId: "linkedin", label: "LinkedIn", enabled: false, cause: disabledCause })
    ];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(findByRole(renderer, "alert")).toHaveLength(0);
    expect(findByRole(renderer, "status").length).toBeGreaterThan(0);
    expect(text(renderer)).toContain("LinkedIn requires signing in, which this module never does.");
  });

  it("'Search now' enqueues via runQueue on job-search.crawl-run/crawl.run with the profileId, not local state", async () => {
    fixtures.matchesItems = [match()];
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
    fixtures.matchesItems = [match()];
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
    fixtures.matchesItems = [match()];
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
    fixtures.matchesItems = [match({ id: "m1", title: "To Dismiss" })];
    fixtures.matchGetResult = { match: matchDetail({ id: "m1" }) };
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
    fixtures.matchesItems = [match({ id: "m1", title: "Bounces Back", state: "new" })];
    fixtures.matchGetResult = { match: matchDetail({ id: "m1" }) };
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
    // the far side: fixtures.matchesItems is unchanged (still "new"), simulating a write that never
    // actually landed, so the row must come back with a plain explanation, back on the list view.
    await act(async () => {
      passButton!.props.onClick();
    });
    await flush(renderer);

    expect(rowTitles(renderer)).toContain("Bounces Back");
    expect(text(renderer)).toMatch(/dismissal didn.t go through/i);
  });

  it("renders an error state with a working retry that re-invokes matches.list", async () => {
    fixtures.matchesShouldReject = true;
    const renderer = await renderBoard();
    await flush(renderer);

    expect(findByRole(renderer, "alert").length).toBeGreaterThan(0);
    const retry = findButton(renderer, /Try again/i);
    expect(retry).toBeTruthy();

    fixtures.matchesShouldReject = false;
    fixtures.matchesItems = [match({ id: "m1", title: "Recovered Role" })];
    await act(async () => {
      retry!.props.onClick();
    });
    await flush(renderer);

    expect(findByRole(renderer, "alert")).toHaveLength(0);
    expect(rowTitles(renderer)).toContain("Recovered Role");
  });

  it("renders a distinct empty state for zero matches — not loading, not error", async () => {
    fixtures.matchesItems = [];
    const renderer = await renderBoard();
    await flush(renderer);

    expect(text(renderer)).toMatch(/No matches yet/i);
    expect(text(renderer)).not.toMatch(/Loading/i);
    expect(findByRole(renderer, "alert")).toHaveLength(0);
  });
});
