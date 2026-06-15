import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Inline the key constants rather than importing from the web app source,
// which requires a browser environment for the hook portions.
const PREFS_KEY = "jarvis.wellness.prefs";
const PREFS_EVENT = "jarvis:wellness-prefs";

type StorageMap = Map<string, string>;

function makeStorage(map: StorageMap) {
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null
  } satisfies Storage;
}

// Minimal EventTarget that records dispatched events and supports add/remove listener.
function makeEventBus() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const dispatched: Event[] = [];

  return {
    dispatched,
    addEventListener(type: string, handler: EventListenerOrEventListenerObject) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: Event) {
      dispatched.push(event);
      const set = listeners.get(event.type);
      if (set) {
        for (const h of set) {
          if (typeof h === "function") h(event);
          else h.handleEvent(event);
        }
      }
      return true;
    }
  };
}

describe("wellness-prefs — reactive event bridge", () => {
  let storageMap: StorageMap;
  let bus: ReturnType<typeof makeEventBus>;

  beforeEach(() => {
    storageMap = new Map();
    bus = makeEventBus();

    vi.stubGlobal("window", {
      localStorage: makeStorage(storageMap),
      addEventListener: bus.addEventListener.bind(bus),
      removeEventListener: bus.removeEventListener.bind(bus),
      dispatchEvent: bus.dispatchEvent.bind(bus),
      CustomEvent: class extends Event {
        constructor(type: string) {
          super(type);
        }
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writePrefs persists the pref and dispatches the custom event", async () => {
    const { writePrefs } = await import("../../apps/web/src/wellness/wellness-prefs.js");

    writePrefs({ radial: true });

    expect(storageMap.get(PREFS_KEY)).toBe(JSON.stringify({ radial: true }));
    expect(bus.dispatched).toHaveLength(1);
    expect(bus.dispatched[0]?.type).toBe(PREFS_EVENT);
  });

  it("readPrefs sees value written by writePrefs without remount", async () => {
    const { writePrefs, readPrefs } = await import("../../apps/web/src/wellness/wellness-prefs.js");

    expect(readPrefs().radial).toBe(false);
    writePrefs({ radial: true });
    expect(readPrefs().radial).toBe(true);
  });

  it("event listener receives update when writePrefs fires", async () => {
    const { writePrefs, readPrefs } = await import("../../apps/web/src/wellness/wellness-prefs.js");

    // Simulate a second hook instance subscribing to the custom event.
    let seenRadial = readPrefs().radial;
    bus.addEventListener(PREFS_EVENT, () => {
      seenRadial = readPrefs().radial;
    });

    writePrefs({ radial: true });

    expect(seenRadial).toBe(true);
  });
});
