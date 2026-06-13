import { describe, expect, it } from "vitest";

import { cronExprFor, timezoneFor } from "../../packages/briefings/src/schedule.js";

describe("cronExprFor", () => {
  it("maps a HH:MM targetTime to a daily cron expression", () => {
    expect(cronExprFor({ targetTime: "06:00" })).toBe("0 6 * * *");
    expect(cronExprFor({ targetTime: "23:45" })).toBe("45 23 * * *");
  });

  it("defaults to 07:00 when targetTime is absent", () => {
    expect(cronExprFor({})).toBe("0 7 * * *");
  });

  it("defaults to 07:00 when targetTime is malformed", () => {
    expect(cronExprFor({ targetTime: "not-a-time" })).toBe("0 7 * * *");
    expect(cronExprFor({ targetTime: "25:00" })).toBe("0 7 * * *");
    expect(cronExprFor({ targetTime: "6" })).toBe("0 7 * * *");
  });
});

describe("timezoneFor", () => {
  it("returns a valid IANA timezone", () => {
    expect(timezoneFor({ timezone: "America/New_York" })).toBe("America/New_York");
  });

  it("defaults to UTC when absent or invalid", () => {
    expect(timezoneFor({})).toBe("UTC");
    expect(timezoneFor({ timezone: "Not/AZone" })).toBe("UTC");
    expect(timezoneFor({ timezone: 42 as unknown as string })).toBe("UTC");
  });
});
