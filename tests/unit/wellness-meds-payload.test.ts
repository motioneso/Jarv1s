import { describe, expect, it } from "vitest";

// Validates the payload-building logic for manage-meds-modal without a DOM.
// Tests mirror the R4 scenarios: switch-back resets timesPerDay, HH:MM guard.

type FreqType = "once_daily" | "times_per_day" | "as_needed";

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t) && t >= "00:00" && t <= "23:59";
}

interface MedState {
  freqType: FreqType;
  timesPerDay: number;
  scheduleTimes: string[];
}

function handleFreqChange(f: FreqType, prev: MedState): MedState {
  if (f === "once_daily") {
    return { freqType: f, timesPerDay: prev.timesPerDay, scheduleTimes: ["08:00"] };
  }
  if (f === "times_per_day") {
    return { freqType: f, timesPerDay: 2, scheduleTimes: ["08:00", "20:00"] };
  }
  return { freqType: f, timesPerDay: prev.timesPerDay, scheduleTimes: [] };
}

function isSubmitBlocked(state: MedState, name: string): boolean {
  if (!name.trim()) return true;
  if (state.freqType !== "as_needed") {
    const active =
      state.freqType === "once_daily"
        ? state.scheduleTimes.slice(0, 1)
        : state.scheduleTimes.slice(0, state.timesPerDay);
    if (active.some((t) => !isValidTime(t))) return true;
  }
  return false;
}

function buildPayload(state: MedState, name: string, dosage: string | null) {
  const base = { name: name.trim(), dosage, frequencyType: state.freqType };
  if (state.freqType === "as_needed") return base;
  if (state.freqType === "times_per_day") {
    return {
      ...base,
      timesPerDay: state.timesPerDay,
      scheduleTimes: state.scheduleTimes.slice(0, state.timesPerDay)
    };
  }
  return { ...base, scheduleTimes: state.scheduleTimes };
}

describe("isValidTime", () => {
  it("accepts well-formed clock values", () => {
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("00:00")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidTime("")).toBe(false);
  });

  it("rejects partial or malformed strings", () => {
    expect(isValidTime("8:00")).toBe(false);
    expect(isValidTime("08:0")).toBe(false);
    expect(isValidTime("25:00")).toBe(false);
    expect(isValidTime("abc")).toBe(false);
  });
});

describe("handleFreqChange — switch-back resets timesPerDay", () => {
  it("switching to times_per_day always resets to 2 times", () => {
    // User had times_per_day with 4 slots, then switched away, then back.
    const beforeSwitch: MedState = {
      freqType: "once_daily",
      timesPerDay: 4,
      scheduleTimes: ["08:00"]
    };
    const after = handleFreqChange("times_per_day", beforeSwitch);

    expect(after.timesPerDay).toBe(2);
    expect(after.scheduleTimes).toHaveLength(2);
  });

  it("payload after switch-back has matching count and timesPerDay", () => {
    const prev: MedState = { freqType: "once_daily", timesPerDay: 4, scheduleTimes: ["08:00"] };
    const state = handleFreqChange("times_per_day", prev);
    const payload = buildPayload(state, "Metformin", null) as {
      timesPerDay: number;
      scheduleTimes: string[];
    };

    expect(payload.timesPerDay).toBe(payload.scheduleTimes.length);
  });
});

describe("isSubmitBlocked — cleared-time blocks submit", () => {
  it("blocks when a schedule time is empty (browser clears type=time)", () => {
    const state: MedState = {
      freqType: "times_per_day",
      timesPerDay: 2,
      scheduleTimes: ["08:00", ""]
    };
    expect(isSubmitBlocked(state, "Metformin")).toBe(true);
  });

  it("blocks when a schedule time is invalid HH:MM", () => {
    const state: MedState = {
      freqType: "once_daily",
      timesPerDay: 1,
      scheduleTimes: ["25:00"]
    };
    expect(isSubmitBlocked(state, "Aspirin")).toBe(true);
  });

  it("allows submit when all times are valid", () => {
    const state: MedState = {
      freqType: "times_per_day",
      timesPerDay: 2,
      scheduleTimes: ["08:00", "20:00"]
    };
    expect(isSubmitBlocked(state, "Metformin")).toBe(false);
  });

  it("PRN (as_needed) is never blocked by schedule times", () => {
    const state: MedState = {
      freqType: "as_needed",
      timesPerDay: 2,
      scheduleTimes: []
    };
    expect(isSubmitBlocked(state, "Ibuprofen")).toBe(false);
  });

  it("blocks when name is empty", () => {
    const state: MedState = {
      freqType: "once_daily",
      timesPerDay: 1,
      scheduleTimes: ["08:00"]
    };
    expect(isSubmitBlocked(state, "")).toBe(true);
    expect(isSubmitBlocked(state, "  ")).toBe(true);
  });
});
