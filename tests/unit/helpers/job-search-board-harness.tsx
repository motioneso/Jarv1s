// Shared harness for the BoardScreen suites. This was the top third of
// job-search-web-board.test.tsx until that file crossed the 1000-line gate and had to be split
// into a list half and an inspector half; the two halves need byte-identical fixtures and DOM
// helpers, so they live here rather than being copied.
//
// The transport mock reads from the mutable `fixtures` object below rather than being re-mocked
// per test, which is what lets a single test flip matches.list from rejecting to succeeding
// between a render and a retry click.
//
// Each importing suite still declares its own `vi.mock` of api.ts: vi.mock is hoisted per test
// file, and this module's own `import * as api` resolves through that same mocked registry.
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, vi } from "vitest";

import { BoardScreen } from "../../../external-modules/job-search/src/web/screens/board";
import * as api from "../../../external-modules/job-search/src/web/api";
import type {
  BoardMatch,
  MatchDetail,
  PortalListItem
} from "../../../external-modules/job-search/src/web/board-types";
import type { FailureCause } from "../../../external-modules/job-search/src/domain/records";
import type { AssistantSurfaceHandleV1 } from "../../../external-modules/job-search/src/domain/seed-prompt";

// A minimal, in-memory window stand-in — installed file-wide so latch.ts's real
// window.localStorage calls don't throw under plain node, and so board.tsx's window-focus refetch
// effect (guarded with `typeof window === "undefined"`) has something to attach its no-op listener
// to instead of skipping that branch entirely.
export function installWindowStub(): void {
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

export function match(overrides: Partial<BoardMatch> = {}): BoardMatch {
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
export function matchDetail(overrides: Partial<MatchDetail> = {}): MatchDetail {
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

export function cause(overrides: Partial<FailureCause> = {}): FailureCause {
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

export function portal(overrides: Partial<PortalListItem> = {}): PortalListItem {
  return {
    sourceId: "linkedin",
    label: "LinkedIn",
    enabled: true,
    lastOkAt: null,
    cause: null,
    ...overrides
  };
}

/** The mutable transport fixtures the per-test invokeTool implementation reads from. A single
 *  object rather than loose `let`s so importing suites can assign to its fields — a re-exported
 *  `let` binding is read-only at the import site. */
export interface BoardFixtures {
  matchesShouldReject: boolean;
  matchesItems: BoardMatch[];
  portalsItems: PortalListItem[];
  /** #1330: job-search.match.get's fixture. `undefined` (the default) means "the test never
   *  exercises this path" and throws, same as any other unmapped tool name — a test that opens the
   *  inspector without setting this is deliberately exercising the failure branch, not an
   *  oversight. */
  matchGetResult: { match: MatchDetail | null } | undefined;
  matchGetShouldReject: boolean;
}

export const fixtures: BoardFixtures = {
  matchesShouldReject: false,
  matchesItems: [],
  portalsItems: [],
  matchGetResult: undefined,
  matchGetShouldReject: false
};

function installTransportMock(): void {
  vi.mocked(api.invokeTool).mockImplementation(async (name: string) => {
    if (name === "job-search.matches.list") {
      if (fixtures.matchesShouldReject) throw new Error("Request failed (500)");
      return { items: fixtures.matchesItems };
    }
    if (name === "job-search.portal.list") {
      return { portals: fixtures.portalsItems };
    }
    if (name === "job-search.match.get") {
      if (fixtures.matchGetShouldReject) throw new Error("Request failed (500)");
      if (fixtures.matchGetResult !== undefined) return fixtures.matchGetResult;
      throw new Error(`unexpected invokeTool ${name}`);
    }
    throw new Error(`unexpected invokeTool ${name}`);
  });
}

/** Registers the beforeEach/afterEach both suites share. Called at the top level of each suite so
 *  the hooks land on that file's own runner. */
export function setupBoardHarness(): void {
  beforeEach(() => {
    installWindowStub();
    fixtures.matchesShouldReject = false;
    fixtures.matchesItems = [];
    fixtures.portalsItems = [];
    fixtures.matchGetResult = undefined;
    fixtures.matchGetShouldReject = false;
    vi.mocked(api.invokeTool).mockReset();
    vi.mocked(api.runQueue).mockReset();
    vi.mocked(api.runQueue).mockResolvedValue({ kind: "queued" });
    installTransportMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}

export async function renderBoard(
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
export function fakeAssistantSurface(): AssistantSurfaceHandleV1 {
  return {
    setSurfaceKey: vi.fn(),
    seedContext: vi.fn(async () => undefined),
    submitTurn: vi.fn(async () => undefined),
    Surface: () => null
  };
}

// Flushes the microtask queue a few times over — enough for a mocked invokeTool/runQueue's
// resolved promise to reach its own .then() chain (job-search-web-root.test.tsx's own flush()).
export async function flush(renderer: ReactTestRenderer): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  void renderer;
}

export function flatten(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flatten).join(" ");
  if (typeof node === "object" && "children" in (node as { children?: unknown })) {
    return flatten((node as { children?: unknown }).children);
  }
  return "";
}

export function text(renderer: ReactTestRenderer): string {
  return flatten(renderer.toJSON()).replace(/\s+/g, " ").trim();
}

export function findButton(renderer: ReactTestRenderer, name: RegExp) {
  return renderer.root.findAllByType("button").find((item) => {
    const children = Array.isArray(item.props.children)
      ? item.props.children
      : [item.props.children];
    return children.some((child: unknown) => typeof child === "string" && name.test(child));
  });
}

// Deliberately not scoped to <p> — the error branch's outer container is a <div role="alert">,
// not a paragraph, so this must match on role alone regardless of host element type.
export function findByRole(renderer: ReactTestRenderer, role: string) {
  return renderer.root.findAll((item) => (item.props as { role?: string }).role === role);
}

// Mockup rewrite (task #98): rows are match-row.tsx's own `.jsm-row` now — a single button that
// IS the whole row (no separate title button inside it the way the old two-part `.jsm-krow` row
// had), with the title nested three levels down inside `.jsm-row__main > .jsm-row__heading >
// .jds-card-title`. This helper follows that rewrite: find each row by its own `jsm-row` class,
// then read the title span directly rather than "the row's first button" (there is no second
// button to disambiguate from any more — see findRowButton below for opening a row).
export function rowTitles(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((item) =>
      String((item.props as { className?: string }).className ?? "")
        .split(" ")
        .includes("jsm-row")
    )
    .map((row) => {
      const titleSpan = row.findAllByType("span").find((span) =>
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
export function findRowButton(renderer: ReactTestRenderer, name: RegExp) {
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
export function findByClass(renderer: ReactTestRenderer, className: string) {
  return renderer.root.findAll((item) =>
    String((item.props as { className?: string }).className ?? "")
      .split(" ")
      .includes(className)
  );
}
