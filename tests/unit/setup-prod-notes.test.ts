import { describe, expect, it } from "vitest";

import { deriveNotesEnvLines, NOTES_MOUNT_TARGET } from "../../scripts/setup-prod-notes.js";

// #449: the operator opts into the notes host-folder bind mount at install by setting
// JARVIS_NOTES_VAULT_HOST_PATH. setup-prod.ts must emit JARVIS_NOTES_ROOTS pointing at
// the FIXED neutral mount target so the shipped resolveNotesRoots() allowlist sees the
// mount with no app-code change. Empty/absent host path = no mount = no env lines.
describe("deriveNotesEnvLines (#449)", () => {
  it("emits no lines when the host path is absent (operator did not opt in)", () => {
    expect(deriveNotesEnvLines(undefined)).toEqual([]);
  });

  it("emits no lines when the host path is empty", () => {
    expect(deriveNotesEnvLines("")).toEqual([]);
  });

  it("emits no lines when the host path is whitespace-only", () => {
    expect(deriveNotesEnvLines("   ")).toEqual([]);
  });

  it("emits both vars pointing at the fixed mount target when the host path is set", () => {
    const lines = deriveNotesEnvLines("/home/ben/notes");
    expect(lines).toContain("JARVIS_NOTES_VAULT_HOST_PATH=/home/ben/notes");
    expect(lines).toContain(`JARVIS_NOTES_ROOTS=${NOTES_MOUNT_TARGET}`);
    expect(NOTES_MOUNT_TARGET).toBe("/data/external-notes");
  });

  it("trims surrounding whitespace from the host path", () => {
    const lines = deriveNotesEnvLines("  /srv/vault  ");
    expect(lines).toContain("JARVIS_NOTES_VAULT_HOST_PATH=/srv/vault");
  });

  it("always terminates with a trailing empty line (env-file section separator)", () => {
    const lines = deriveNotesEnvLines("/home/ben/notes");
    expect(lines[lines.length - 1]).toBe("");
  });
});
