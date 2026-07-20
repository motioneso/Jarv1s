import { describe, expect, it } from "vitest";

import {
  clearProfileBuffer,
  readProfileBuffer,
  writeProfileBuffer
} from "../../external-modules/job-search/src/web/screens/onboarding/profile-buffer.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const fields = {
  targetTitles: ["Staff Product Designer"],
  compensation: { currency: "USD" as const, minimum: 195_000 }
};

describe("Job Search onboarding profile buffer (#1213)", () => {
  it("round-trips accumulated profile answers", () => {
    const storage = new MemoryStorage();

    writeProfileBuffer(storage, "actor-a", fields);

    expect(readProfileBuffer(storage, "actor-a")).toEqual(fields);
  });

  it("does not expose one actor's answers through another actor's key", () => {
    const storage = new MemoryStorage();

    writeProfileBuffer(storage, "actor-a", fields);

    expect(readProfileBuffer(storage, "actor-b")).toEqual({});
  });

  it("removes the actor's buffer after profile approval", () => {
    const storage = new MemoryStorage();
    writeProfileBuffer(storage, "actor-a", fields);

    clearProfileBuffer(storage, "actor-a");

    expect(storage.values.has("jobsearch:onboarding:profile:actor-a")).toBe(false);
  });

  it("treats malformed JSON as an empty buffer", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobsearch:onboarding:profile:actor-a", "{not-json");

    expect(readProfileBuffer(storage, "actor-a")).toEqual({});
  });
});
