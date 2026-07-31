// "Search now" as a run the browser can actually follow, rather than a fire-and-forget POST.
//
// The enqueue route (POST /api/modules/:id/queues/:queue/run) answers 202 the moment pg-boss
// accepts the job and then says nothing else — there is no host route that reports a job's state
// back to a module's web bundle, and the browser is never told when a worker writes (no push
// channel). So the control used to re-enable itself the instant the POST resolved, roughly a
// hundred milliseconds into a run that takes three minutes, under a notice promising "new matches
// will appear here as they're scored" that nothing was ever going to make true.
//
// This hook closes both halves by polling the module's own read tools, which is the only signal
// available: matches.count as the change detector and portal.list to know when the run is over. A
// crawl always ends by writing its portals — either `last_ok_at` moves forward or a `cause` is
// recorded — so a change in that shape is the module's own "the worker got here" marker. Scoring
// continues after the crawl stage commits, so the run is only called finished once the count has
// also stopped changing.
//
// It is a COUNT and not a board read because every module read tool in the app shares one host
// budget of sixty requests a minute (packages/ai/src/routes.ts). Re-reading the whole board each
// tick costs one request per 25-row page — eighty a minute on a 167-row board — which earned 429s
// mid-crawl, and a failed read looked exactly like a search that had broken. The expensive read
// still happens, but only when the count says there is something new, plus a slow safety refresh
// (see `fullReadInterval`), which holds the total near thirty a minute at any board size.
import { invokeTool, runQueue } from "./api";
import type { PortalListItem } from "./board-types";
import { MATCHES_LIST_MAX_LIMIT } from "../domain/records.js";
import { useCallback, useEffect, useRef, useState } from "./runtime";

/** What the board renders about the current run. `added` is the net new rows the run produced. */
export type SearchRunState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running" }
  | { status: "finished"; added: number }
  | { status: "still-running" }
  | { status: "disabled" }
  | { status: "error"; message: string };

/** A digest of what is on the board, enough to tell "still changing" from "settled". Read from
 * `job-search.matches.count`, which answers it in one request rather than one per page. */
export interface BoardDigest {
  readonly count: number;
  readonly scored: number;
}

// Six seconds is slow enough that a three-minute run costs ~30 reads of two small tools, and fast
// enough that the first postings of a crawl show up while the user is still looking at the screen.
export const TICK_MS = 6_000;

// 60 ticks = six minutes. A measured full run (two titles, five pages each, then AI scoring) takes
// about 200 seconds, so this leaves generous room for a queued start or a slow model without
// polling forever if the worker is down. Expiring is not an error — see `still-running`.
export const MAX_TICKS = 60;

// How many consecutive quiet reads mean "the worker has stopped writing", counted only once the
// crawl has reported (see `crawlReported`). Scoring runs after the crawl and upserts one match at a
// time (worker/stages/score.ts), each row behind its own model call, so this window has to be longer
// than the slowest gap between two rows. Six ticks is ~36s of silence: the finished notice arrives
// up to half a minute late, which is the right trade — a notice that is late still says "Searching…",
// whereas a window that is too short hands the button back while rows are still landing.
export const STABLE_TICKS = 6;

// The fallback end-of-run window, for a crawl whose sources never all report: the stage has a
// deadline and abandons the portals it did not reach without writing them (worker/stages/crawl.ts),
// so "every source reported" can legitimately never become true. Two minutes of total silence after
// at least one write ends the run rather than pinning the control until MAX_TICKS.
export const LONG_QUIET_TICKS = 20;

/**
 * How often the expensive whole-board read happens when the count has NOT moved, in ticks, scaled
 * so its cost stays flat as the board grows.
 *
 * The count is the change detector, so this is only a safety net — it exists because the count can
 * legitimately stay identical while the rows behind it change (a rescore rewrites Fit and Want
 * without adding a row, and a state change swaps one active row for another). One page per tick is
 * the budget: a board of `pages` pages therefore refreshes every `pages` ticks, which is ~10
 * requests a minute whatever the board size, on top of the ~20 the count and portals cost.
 *
 * The floor keeps a small board from refreshing every tick for no reason; the ceiling keeps a very
 * large one from going more than two minutes without a refresh.
 */
export function fullReadInterval(activeRows: number): number {
  const pages = Math.max(1, Math.ceil(activeRows / MATCHES_LIST_MAX_LIMIT));
  return Math.min(20, Math.max(5, pages));
}

/**
 * What the portals say, in the two shapes the poll needs: each source's state as an opaque string
 * (compared, never parsed — any difference is a worker write) and the ids that were enabled, which
 * is the denominator for "has every source reported yet".
 */
interface PortalSnapshot {
  readonly states: ReadonlyMap<string, string>;
  readonly enabledIds: readonly string[];
  readonly signature: string;
}

/**
 * `cause` is part of a source's state because a crawl that fails still records one, and a run that
 * only ever fails must still end. `enabled` is part of it because the login-required case turns a
 * source off, which is that source's way of reporting.
 */
function snapshotPortals(portals: readonly PortalListItem[]): PortalSnapshot {
  const entries = portals
    .map(
      (portal) =>
        [portal.sourceId, JSON.stringify([portal.enabled, portal.lastOkAt, portal.cause])] as const
    )
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return {
    states: new Map(entries),
    enabledIds: portals.filter((portal) => portal.enabled).map((portal) => portal.sourceId),
    // Sorted before stringifying so a reordered response is not mistaken for a write.
    signature: JSON.stringify(entries)
  };
}

/**
 * The board's size in one request. `null` on a failed or unrecognisable read, which is treated as
 * "don't know" rather than "nothing changed" — see the tick's quiet-streak handling.
 *
 * The shape is checked rather than trusted: the response crosses the host's tool-result route,
 * which strips any field the manifest's `outputSchema` does not declare `required`, so a missing
 * number here would otherwise arrive as `NaN` comparisons that always look like a change.
 */
async function readDigest(profileId: string): Promise<BoardDigest | null> {
  try {
    const result = (await invokeTool("job-search.matches.count", { profileId })) as {
      active?: unknown;
      scored?: unknown;
    } | null;
    if (typeof result?.active !== "number" || typeof result?.scored !== "number") return null;
    return { count: result.active, scored: result.scored };
  } catch {
    // A failed read is not a finished run — the next tick tries again.
    return null;
  }
}

async function readPortals(profileId: string): Promise<PortalSnapshot | null> {
  try {
    const result = (await invokeTool("job-search.portal.list", { profileId })) as {
      portals?: PortalListItem[];
    } | null;
    const portals = result?.portals;
    return Array.isArray(portals) ? snapshotPortals(portals) : null;
  } catch {
    // A failed read is not a finished run — the next tick tries again.
    return null;
  }
}

/**
 * Whether every source that was enabled when the run started has since been written.
 *
 * This is the crawl's real finish line, and getting it wrong is what handed the control back sixteen
 * seconds into a three-minute run. The crawl walks its sources one at a time and writes each one's
 * state as that source completes (worker/stages/crawl.ts), so the first source's write is not the end
 * of anything — and because postings are only stored after the whole loop, the board sits perfectly
 * still while the remaining sources are crawled. "One portal moved and the board has been quiet
 * since" therefore described the middle of a run exactly as well as the end of one.
 *
 * An empty enabled set answers true: no sources means nothing to crawl, and such a run should end on
 * the quiet window rather than be followed for six minutes.
 */
function everySourceReported(baseline: PortalSnapshot, current: PortalSnapshot): boolean {
  return baseline.enabledIds.every(
    (sourceId) => current.states.get(sourceId) !== baseline.states.get(sourceId)
  );
}

/**
 * @param profileId the profile whose crawl this starts.
 * @param refreshBoard re-reads the whole board. The board owns the matches state, so this hook
 *   never touches it directly, and it no longer reads the answer either: whether things are still
 *   moving is decided by the count tool, and this is called only when that says there is something
 *   new to fetch (or on the slow safety interval). Its return value is ignored, which is why it is
 *   typed loosely — the board's own fetch happens to return a digest, and nothing here depends on
 *   that staying true.
 */
export function useSearchRun(
  profileId: string,
  refreshBoard: () => Promise<unknown>
): { readonly state: SearchRunState; readonly start: () => void } {
  const [state, setState] = useState<SearchRunState>({ status: "idle" });

  // The poll's own bookkeeping, in refs rather than state: changing any of it must not re-render,
  // and the interval callback must always see the current values rather than the ones captured
  // when it was scheduled.
  const ticksRef = useRef(0);
  const baselinePortalsRef = useRef<PortalSnapshot | null>(null);
  const lastPortalsRef = useRef<PortalSnapshot | null>(null);
  const sawWriteRef = useRef(false);
  const startDigestRef = useRef<BoardDigest | null>(null);
  const lastDigestRef = useRef<BoardDigest | null>(null);
  const quietTicksRef = useRef(0);
  // Ticks since the last whole-board read, for the slow safety refresh (see fullReadInterval).
  const sinceFullReadRef = useRef(0);
  const refreshRef = useRef(refreshBoard);
  refreshRef.current = refreshBoard;

  // Set while a run is being followed; the effect below owns the interval keyed on it.
  const [polling, setPolling] = useState(false);

  const start = useCallback(() => {
    setState({ status: "starting" });
    void (async () => {
      // Snapshot before enqueueing, so a run that finishes between these two reads still counts as
      // a change rather than being mistaken for the baseline.
      baselinePortalsRef.current = await readPortals(profileId);
      lastPortalsRef.current = baselinePortalsRef.current;
      // The count, not a board read: the board has already loaded itself by the time anyone can
      // press this, so re-reading all of it here would spend seven requests to learn a number one
      // request answers — and it is that number the "added N roles" notice is measured against.
      startDigestRef.current = await readDigest(profileId);
      lastDigestRef.current = startDigestRef.current;
      const outcome = await runQueue("job-search.crawl-run", "crawl.run", { profileId });
      if (outcome.kind === "disabled") {
        setState({ status: "disabled" });
        return;
      }
      if (outcome.kind === "error") {
        setState({ status: "error", message: outcome.message });
        return;
      }
      // "already-queued" is the host's five-second manual-run singleton rejecting a double-click.
      // There is a run in flight either way, which is exactly what this hook follows, so both
      // accepted outcomes are the same state here.
      ticksRef.current = 0;
      quietTicksRef.current = 0;
      sinceFullReadRef.current = 0;
      sawWriteRef.current = false;
      setState({ status: "running" });
      setPolling(true);
    })();
  }, [profileId]);

  useEffect(() => {
    if (!polling) return;
    if (typeof setInterval !== "function") return;

    const finish = (next: SearchRunState): void => {
      setPolling(false);
      setState(next);
    };

    const timer = setInterval(() => {
      void (async () => {
        ticksRef.current += 1;
        const digest = await readDigest(profileId);
        const previous = lastDigestRef.current;
        if (digest !== null) lastDigestRef.current = digest;

        const portals = await readPortals(profileId);
        const lastPortals = lastPortalsRef.current;
        const baseline = baselinePortalsRef.current;
        if (portals !== null) lastPortalsRef.current = portals;

        // A baseline the pre-enqueue read failed to get is adopted from the first successful read
        // instead. That is deliberately late — a source the crawl already wrote will then look like
        // it never reported, and the run will end on the long-quiet window below rather than on
        // `everySourceReported`. Late and honest beats treating an unknown baseline as "everything
        // has already reported", which is the premature-finish bug in a different costume.
        if (baseline === null && portals !== null) baselinePortalsRef.current = portals;

        // Quiet means neither the board nor the portals moved on this tick. Portals count as
        // activity in their own right: during a multi-source crawl they are the ONLY thing moving,
        // because postings are not stored until every source has been walked. A failed read (null)
        // is not evidence of quiet, so it resets the streak rather than extending it.
        const boardUnchanged =
          digest !== null &&
          previous !== null &&
          digest.count === previous.count &&
          digest.scored === previous.scored;

        // The notice promises new roles will appear below, so a count that moved is fetched at
        // once — that promise is the reason the poll exists. Otherwise the whole-board read waits
        // for its slow interval, which is what keeps this poll inside the host's request budget.
        // Keyed on a count that really did change, NOT on `!boardUnchanged`: that would also be
        // true when the count read itself failed, so a rate-limited poll would answer its own 429s
        // with seven more requests a tick — the failure mode this whole change exists to end.
        const countMoved = digest !== null && previous !== null && !boardUnchanged;
        sinceFullReadRef.current += 1;
        const dueForFullRead =
          sinceFullReadRef.current >= fullReadInterval(digest?.count ?? previous?.count ?? 0);
        if (countMoved || dueForFullRead) {
          sinceFullReadRef.current = 0;
          await refreshRef.current();
        }

        const portalsUnchanged =
          portals !== null && lastPortals !== null && portals.signature === lastPortals.signature;
        if (portals !== null && lastPortals !== null && !portalsUnchanged)
          sawWriteRef.current = true;
        quietTicksRef.current = boardUnchanged && portalsUnchanged ? quietTicksRef.current + 1 : 0;

        const reported =
          baseline !== null && portals !== null && everySourceReported(baseline, portals);
        if (reported) sawWriteRef.current = true;

        // Two ways a run ends. The first is the normal one: every enabled source has reported, so the
        // crawl is done, and the board has since been still for long enough that scoring is done too.
        // The second covers a crawl that ran out of deadline and abandoned sources without writing
        // them — `reported` never becomes true there, so total silence after at least one write is
        // the only signal left.
        const settled =
          (reported && quietTicksRef.current >= STABLE_TICKS) ||
          (sawWriteRef.current && quietTicksRef.current >= LONG_QUIET_TICKS);
        if (settled && digest !== null) {
          const before = startDigestRef.current?.count ?? digest.count;
          // One last whole-board read on the way out, unconditionally: the run is over, so this is
          // the moment the rows on screen have to match the number in the notice. Without it a run
          // that settled on a tick between safety refreshes would announce roles the board had not
          // fetched yet.
          await refreshRef.current();
          finish({ status: "finished", added: Math.max(0, digest.count - before) });
          return;
        }

        if (ticksRef.current >= MAX_TICKS) {
          // Deliberately not an error: the run may well still be working. Saying so is honest, and
          // the board keeps its rows either way.
          finish({ status: "still-running" });
        }
      })();
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [polling, profileId]);

  return { state, start };
}
