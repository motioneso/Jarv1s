// @vitest-environment jsdom
// Task 18 (#1302): the real hook, api.ts mocked. Needs jsdom (real document.hidden +
// visibilitychange dispatch — jsdom does not change document.hidden for you, tests must stub
// it and dispatch the event themselves, per the part file). This is the first suite in the repo
// to require a DOM environment; every other test uses react-test-renderer against a plain node
// environment (see tests/unit/google-connect-invalidation.test.tsx's "no DOM/renderHook
// environment exists" note) or renderToString. The per-file pragma above opts in without
// touching vitest.config.ts's global (node) default.
import "./helpers/install-module-runtime";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  POLL_WINDOW_MS,
  useProfiles,
  type Profile,
  type ProfilesState,
  type UseProfilesOptions
} from "../../external-modules/job-search/src/web/use-profiles";
import * as api from "../../external-modules/job-search/src/web/api";

vi.mock("../../external-modules/job-search/src/web/api", () => ({ invokeTool: vi.fn() }));

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

type HookValue = ProfilesState & { refetch(): void; select(id: string): void };

function createHarness() {
  const box: { value: HookValue | null } = { value: null };
  function Harness(props: UseProfilesOptions) {
    box.value = useProfiles(props);
    return null;
  }
  return { Harness, box };
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function setHidden(hidden: boolean): Promise<void> {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useProfiles", () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.invokeTool).mockReset();
    try {
      window.localStorage.clear();
    } catch {
      /* not relevant here */
    }
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
    vi.useRealTimers();
  });

  it("polls every interval while armed and empty; first non-empty switches to ready and stops", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool)
      .mockResolvedValueOnce({ profiles: [] }) // mount fetch
      .mockResolvedValueOnce({ profiles: [] }) // tick @3s
      .mockResolvedValueOnce({ profiles: [] }) // tick @6s
      .mockResolvedValueOnce({ profiles: [profile()] }); // tick @9s

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();
    expect(box.value?.status).toBe("empty");

    await advance(POLL_INTERVAL_MS);
    expect(box.value?.status).toBe("empty");
    await advance(POLL_INTERVAL_MS);
    expect(box.value?.status).toBe("empty");
    await advance(POLL_INTERVAL_MS);
    expect(box.value?.status).toBe("ready");
    expect(api.invokeTool).toHaveBeenCalledTimes(4);

    await advance(30_000);
    expect(api.invokeTool).toHaveBeenCalledTimes(4);
    expect(onPollExpired).not.toHaveBeenCalled();
  });

  it("polls zero times while not armed", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: false, onPollExpired }));
    });
    await settle();
    expect(box.value?.status).toBe("empty");
    vi.mocked(api.invokeTool).mockClear();

    await advance(30_000);
    expect(api.invokeTool).not.toHaveBeenCalled();
    expect(onPollExpired).not.toHaveBeenCalled();
  });

  it("expires after POLL_WINDOW_MS of all-empty polling and stops", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();

    await advance(POLL_WINDOW_MS);
    expect(onPollExpired).toHaveBeenCalledOnce();
    expect(box.value?.status).toBe("empty");
    const callsAtExpiry = vi.mocked(api.invokeTool).mock.calls.length;

    await advance(60_000);
    expect(onPollExpired).toHaveBeenCalledOnce();
    expect(api.invokeTool).toHaveBeenCalledTimes(callsAtExpiry);
  });

  it("expires at POLL_MAX_ATTEMPTS even though it coincides with the window bound", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();

    // POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS === POLL_WINDOW_MS for the real
    // constants, so the two bounds are reached on the same tick — walk tick
    // by tick and assert expiry fires on attempt 40, not before.
    for (let attempt = 1; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await advance(POLL_INTERVAL_MS);
      expect(onPollExpired).not.toHaveBeenCalled();
    }
    await advance(POLL_INTERVAL_MS);
    expect(onPollExpired).toHaveBeenCalledOnce();
  });

  it("resumes polling after re-arming, and a non-empty response still resolves ready", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();
    await advance(POLL_WINDOW_MS);
    expect(onPollExpired).toHaveBeenCalledOnce();

    // Root's retry action: drop the arm, then re-raise it.
    await act(async () => {
      renderer!.update(createElement(Harness, { pollArmed: false, onPollExpired }));
    });
    await act(async () => {
      renderer!.update(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();

    vi.mocked(api.invokeTool).mockResolvedValueOnce({ profiles: [profile()] });
    await advance(POLL_INTERVAL_MS);
    expect(box.value?.status).toBe("ready");
    expect(onPollExpired).toHaveBeenCalledOnce();
  });

  it("suspends the interval and time accrual while the tab is hidden", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();

    await setHidden(true);
    // Far past POLL_WINDOW_MS — every tick's document.hidden check must skip
    // both the fetch and the elapsed-time accrual while hidden.
    await advance(POLL_WINDOW_MS + 30_000);
    expect(onPollExpired).not.toHaveBeenCalled();
    expect(box.value?.status).toBe("empty");

    await setHidden(false);
    expect(onPollExpired).not.toHaveBeenCalled();
  });

  it("fetches once immediately on becoming visible, ahead of the next tick", async () => {
    const onPollExpired = vi.fn();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [] });

    const { Harness } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: true, onPollExpired }));
    });
    await settle();
    vi.mocked(api.invokeTool).mockClear();

    await setHidden(true);
    expect(api.invokeTool).not.toHaveBeenCalled();
    await setHidden(false);
    expect(api.invokeTool).toHaveBeenCalledTimes(1);
  });

  it("tracks selection across profile counts and persists it across a remount", async () => {
    const onPollExpired = vi.fn();
    const three = [
      profile({ profileId: "p1", name: "One" }),
      profile({ profileId: "p2", name: "Two" }),
      profile({ profileId: "p3", name: "Three" })
    ];
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: [three[0]] });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: false, onPollExpired }));
    });
    await settle();
    expect(box.value?.status).toBe("ready");
    expect(box.value?.status === "ready" && box.value.selectedId).toBe("p1");

    renderer!.unmount();
    vi.mocked(api.invokeTool).mockResolvedValue({ profiles: three });
    const second = createHarness();
    await act(async () => {
      renderer = create(createElement(second.Harness, { pollArmed: false, onPollExpired }));
    });
    await settle();
    expect(second.box.value?.status === "ready" && second.box.value.profiles.length).toBe(3);

    await act(async () => {
      second.box.value?.select("p3");
    });
    expect(second.box.value?.status === "ready" && second.box.value.selectedId).toBe("p3");

    renderer!.unmount();
    const third = createHarness();
    await act(async () => {
      renderer = create(createElement(third.Harness, { pollArmed: false, onPollExpired }));
    });
    await settle();
    expect(third.box.value?.status === "ready" && third.box.value.selectedId).toBe("p3");
  });

  it("falls back to the first profile when the stored selectedId no longer exists", async () => {
    const onPollExpired = vi.fn();
    try {
      window.localStorage.setItem("job-search:selected-profile-id", "stale-id");
    } catch {
      /* jsdom always supports localStorage; guard mirrors the hook's own try/catch */
    }
    vi.mocked(api.invokeTool).mockResolvedValue({
      profiles: [profile({ profileId: "p1" }), profile({ profileId: "p2" })]
    });

    const { Harness, box } = createHarness();
    await act(async () => {
      renderer = create(createElement(Harness, { pollArmed: false, onPollExpired }));
    });
    await settle();
    expect(box.value?.status === "ready" && box.value.selectedId).toBe("p1");
  });
});
