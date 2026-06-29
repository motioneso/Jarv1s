import { describe, it, expect } from "vitest";
import { passesPrefilter } from "@jarv1s/commitments/prefilter";

describe("passesPrefilter", () => {
  it("passes text with deadline trigger phrases", () => {
    expect(passesPrefilter("I need to send the report by Friday")).toBe(true);
    expect(passesPrefilter("Please review this before the deadline")).toBe(true);
    expect(passesPrefilter("I'll get this done by end of week")).toBe(true);
  });

  it("passes text with promise trigger phrases", () => {
    expect(passesPrefilter("I'll send you the files tomorrow")).toBe(true);
    expect(passesPrefilter("I will follow up on that")).toBe(true);
    expect(passesPrefilter("I promise to deliver this by Monday")).toBe(true);
  });

  it("passes text with obligation trigger phrases", () => {
    expect(passesPrefilter("I need to submit the expense report")).toBe(true);
    expect(passesPrefilter("I must complete the review")).toBe(true);
    expect(passesPrefilter("I have to call them back")).toBe(true);
  });

  it("rejects generic chit-chat", () => {
    expect(passesPrefilter("Thanks for the update!")).toBe(false);
    expect(passesPrefilter("Sounds good")).toBe(false);
    expect(passesPrefilter("How are you doing today?")).toBe(false);
  });
});
