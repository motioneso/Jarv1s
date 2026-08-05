// @vitest-environment jsdom
// The real useSearchRun hook, api.ts mocked. Same harness idiom as
// tests/unit/job-search-use-profiles.test.tsx (which carries the note on why a DOM environment is
// needed at all); this suite needs it for setInterval under fake timers inside act().
//
// What is under test is the answer to "is a search still running", because the control's disabled
// state and its notice are both derived from it: the enqueue POST resolves in milliseconds and the
// run it starts takes minutes, and there is no host route that reports a module job's state, so the
// hook infers the end of the run from the module's own read tools.
//
// The two tools it polls are mocked by NAME rather than by call order, because the poll's whole
// design is about which tool it reaches for: `job-search.matches.count` is the cheap change
// detector it may call every tick, and the expensive whole-board read (`refreshBoard`) is called
// only when that count moves. A single blanket `mockResolvedValue` could not tell those apart, and
// it was exactly that conflation — using a seven-request board read as the change detector — that
// spent ~80 requests a minute against the host's 60-a-minute AI-tools budget and collected 429s
// mid-crawl.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fullReadInterval,
  LONG_QUIET_TICKS,
  MAX_TICKS,
  STABLE_TICKS,
  TICK_MS,
  useSearchRun,
  type SearchRunState
} from "../../external-modules/job-search/src/web/use-search-run";
import * as api from "../../external-modules/job-search/src/web/api";

vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: vi.fn(),
  runQueue: vi.fn()
}));

const PROFILE_ID = "p1";
const COUNT_TOOL = "job-search.matches.count";
const PORTAL_TOOL = "job-search.portal.list";

/** A portal list shaped like job-search.portal.list's real response. */
function portals(lastOkAt: string | null) {
  return {
    portals: [{ sourceId: "linkedin", label: "LinkedIn", enabled: true, lastOkAt, cause: null }]
  };
}

/**
 * Two enabled sources, each with its own last-ok time. The crawl walks sources one at a time and
 * writes each as it completes, so this is the shape that tells a half-finished crawl from a finished
 * one — a single-source fixture cannot express the difference.
 */
function twoPortals(linkedInOkAt: string | null, freehireOkAt: string | null) {
  return {
    portals: [
      {
        sourceId: "linkedin",
        label: "LinkedIn",
        enabled: true,
        lastOkAt: linkedInOkAt,
        cause: null
      },
      {
        sourceId: "freehire",
        label: "freehire.me",
        enabled: true,
        lastOkAt: freehireOkAt,
        cause: null
      }
    ]
  };
}

/**
 * The two read tools the poll uses, answered independently and mutably.
 *
 * `count` is a function rather than a value so a test can express "the board is still being written
 * to" the way the real thing does — a different answer on each read — without reaching for call-order
 * mocks. Returning `null` from it makes the tool reject, which is how a 429 arrives.
 */
function createWorld(initial: { active: number; scored: number }) {
  const world = {
    count: (): { active: number; scored: number } | null => ({ ...initial }),
    portals: portals(null) as unknown,
    countCalls: 0,
    portalCalls: 0
  };
  vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
    if (name === COUNT_TOOL) {
      world.countCalls += 1;
      const counts = world.count();
      if (counts === null) throw new Error("429 Too Many Requests");
      return { profileId: PROFILE_ID, ...counts };
    }
    if (name === PORTAL_TOOL) {
      world.portalCalls += 1;
      return world.portals;
    }
    throw new Error(`unexpected tool: ${name}`);
  });
  return world;
}

function createHarness(refreshBoard: () => Promise<void>) {
  const box: { value: { state: SearchRunState; start(): void } | null } = { value: null };
  function Harness() {
    box.value = useSearchRun(PROFILE_ID, refreshBoard);
    return null;
  }
  return { Harness, box };
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_MS);
    });
  }
}

describe("job-search use-search-run", () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer!.unmount();
      });
      renderer = null;
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // The defect this hook exists for: the button used to re-enable itself the moment the POST
  // resolved, so it looked ready for the whole three-minute run it had just started.
  it("stays running after the enqueue resolves", async () => {
    createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });

    expect(box.value!.state.status).toBe("idle");
    await act(async () => {
      box.value!.start();
    });
    await settle();
    expect(box.value!.state.status).toBe("running");
    // Several ticks in, with the crawl not yet having written its portals, still running.
    await tick(3);
    expect(box.value!.state.status).toBe("running");
  });

  // The budget rule. Every module read tool in the app shares one host limit of sixty requests a
  // minute, and this poll ticks ten times a minute, so a tick may spend a fixed small number of
  // requests — never one per page of a board that grows without bound.
  it("uses one count read per tick as the change detector, not the paged board read", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    // One baseline read before the enqueue, then exactly one per tick.
    expect(world.countCalls).toBe(1);
    await tick(4);
    expect(world.countCalls).toBe(5);
    // And not a single whole-board read, because the count never moved. This is the assertion that
    // would have caught the 429 storm: the old poll called this on every tick.
    expect(refresh).not.toHaveBeenCalled();
  });

  // The notice promises new roles will appear below, so a count that moved is fetched at once —
  // that promise is the reason the poll exists at all.
  it("re-reads the board as soon as the count moves", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    world.count = () => ({ active: 6, scored: 5 });
    await tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // The count can stay identical while the rows behind it change — a rescore rewrites Fit and Want
  // without adding a row — so the throttled read is a safety net, not an optimisation to remove.
  it("still refreshes on a slow safety interval when the count never moves", async () => {
    createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    await tick(fullReadInterval(5) - 1);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // The failure mode the count tool was added to end: a rate-limited poll must not answer its own
  // 429s with a seven-request board read. "Read failed" is not "the count moved".
  it("does not re-read the board when the count read itself fails", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    world.count = () => null;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    await tick(4);
    expect(refresh).not.toHaveBeenCalled();
    // And a failed read is not a finished run either.
    expect(box.value!.state.status).toBe("running");
  });

  it("finishes once the portals move and the board goes quiet, reporting what was added", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    // The crawl commits: portal.list now answers with a fresh lastOkAt, and the postings it stored
    // show up in the count.
    world.count = () => ({ active: 9, scored: 9 });
    world.portals = portals("2026-07-29T22:10:44.000Z");
    await tick(STABLE_TICKS + 1);

    expect(box.value!.state).toEqual({ status: "finished", added: 4 });
    // The rows on screen have to match the number in that notice, so the run ends on a board read.
    expect(refresh).toHaveBeenCalled();
  });

  // Scoring runs after the crawl has already written its portals, one match at a time, so the
  // portal signature alone is not the end of the run.
  it("keeps running while scoring is still writing rows", async () => {
    const world = createWorld({ active: 9, scored: 0 });
    let scored = 0;
    world.count = () => ({ active: 9, scored: scored++ });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();
    world.portals = portals("2026-07-29T22:10:44.000Z");

    // Every read differs from the last, so the streak never builds even though the crawl is done.
    await tick(STABLE_TICKS + 4);
    expect(box.value!.state.status).toBe("running");
  });

  // The live regression this rule exists for: on a two-source board the control handed itself back
  // sixteen seconds into a run that was still crawling. One source had finished and written its
  // state, and because postings are not stored until every source has been walked, the board was
  // perfectly still behind it — so "a portal moved and the board is quiet" was true in the middle of
  // the run, not at the end of it.
  it("keeps running while a second source is still being crawled", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    world.portals = twoPortals(null, null);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    // Source one completes and writes. Source two has not, and the board cannot move until it does.
    world.portals = twoPortals("2026-07-29T22:10:44.000Z", null);
    await tick(STABLE_TICKS + 3);
    expect(box.value!.state.status).toBe("running");

    // Source two completes too. Now the crawl is genuinely over, and the quiet window applies.
    world.portals = twoPortals("2026-07-29T22:10:44.000Z", "2026-07-29T22:13:02.000Z");
    await tick(STABLE_TICKS + 1);
    expect(box.value!.state).toEqual({ status: "finished", added: 0 });
  });

  // The crawl stage abandons sources it has no deadline left for, without writing them, so "every
  // source reported" can honestly never come true. A run that goes silent for long enough after at
  // least one write still has to end — otherwise the control stays dead for the full six minutes.
  it("ends on prolonged silence even when a source never reports", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    world.portals = twoPortals(null, null);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    world.portals = twoPortals("2026-07-29T22:10:44.000Z", null);
    await tick(LONG_QUIET_TICKS);
    expect(box.value!.state.status).toBe("running");
    await tick(1);
    expect(box.value!.state).toEqual({ status: "finished", added: 0 });
  });

  it("stops after the window with an honest notice rather than claiming success", async () => {
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();

    // Portals never move — a worker that never picked the job up.
    await tick(MAX_TICKS);
    expect(box.value!.state.status).toBe("still-running");

    // And it really stopped: no further reads of any kind.
    const atStop = world.countCalls;
    await tick(3);
    expect(world.countCalls).toBe(atStop);
  });

  // 404 from the enqueue route means the queue declares allowManualRun:false or the module is not
  // active for this actor. Nothing is running, so nothing should be polled for.
  it("does not poll when the run was refused", async () => {
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "disabled" });
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();
    expect(box.value!.state.status).toBe("disabled");
    // Only the pre-enqueue baseline read happened, and nothing after it.
    expect(world.countCalls).toBe(1);
    await tick(3);
    expect(world.countCalls).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  // The host's five-second manual-run singleton answers 202 with jobId:null for a double-click.
  // There is a run in flight either way, so it is followed exactly like a fresh one.
  it("follows a run the host reports as already queued", async () => {
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "already-queued" });
    createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();
    expect(box.value!.state.status).toBe("running");
  });

  it("reports an enqueue failure as an error and polls nothing", async () => {
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "error", message: "Network error" });
    const world = createWorld({ active: 5, scored: 5 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { Harness, box } = createHarness(refresh);
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      box.value!.start();
    });
    await settle();
    expect(box.value!.state).toEqual({ status: "error", message: "Network error" });
    expect(world.countCalls).toBe(1);
    await tick(3);
    expect(world.countCalls).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  // The throttle has to stay cheap as the board grows: one page's worth of requests per tick, so a
  // bigger board waits longer rather than costing more.
  it("scales the safety-refresh interval with the board so its cost stays flat", () => {
    expect(fullReadInterval(0)).toBe(5);
    expect(fullReadInterval(25)).toBe(5);
    // 167 rows is seven pages, which is the board that earned the 429s.
    expect(fullReadInterval(167)).toBe(7);
    // Capped, so even an enormous board never goes more than two minutes without a refresh.
    expect(fullReadInterval(10_000)).toBe(20);
  });
});
