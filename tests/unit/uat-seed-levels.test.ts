import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  migrationDestroy: vi.fn().mockResolvedValue(undefined),
  runtimeDestroy: vi.fn().mockResolvedValue(undefined),
  seedOnboarding: vi.fn().mockRejectedValue(new Error("seed failed"))
}));

vi.mock("../uat/seed/connections.js", () => ({
  createMigrationOwnerDb: () => ({ destroy: mocks.migrationDestroy }),
  createAppRuntimeRunner: () => ({ destroy: mocks.runtimeDestroy })
}));
vi.mock("../uat/seed/admin.js", () => ({
  seedSoloAdmin: vi.fn().mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000001" })
}));
vi.mock("../uat/seed/chunks/onboarding.js", () => ({
  seedOnboardingChunk: mocks.seedOnboarding
}));
vi.mock("../uat/seed/chunks/ai.js", () => ({ seedAiProviderChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/news.js", () => ({ seedNewsChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/sports.js", () => ({ seedSportsChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/tasks.js", () => ({ seedTasksChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/calendar.js", () => ({ seedCalendarChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/notes.js", () => ({ seedNotesChunk: vi.fn() }));
vi.mock("../uat/seed/chunks/job-search.js", () => ({ seedJobSearchChunk: vi.fn() }));

import { seedLevel } from "../uat/seed/levels.js";

describe("seedLevel runtime connection lifecycle", () => {
  it("closes the app-runtime DB when a chunk throws", async () => {
    await expect(seedLevel({ level: "admin+data" })).rejects.toThrow("seed failed");
    expect(mocks.runtimeDestroy).toHaveBeenCalledOnce();
  });
});
