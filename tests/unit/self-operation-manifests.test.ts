import { describe, expect, it } from "vitest";
import { tasksModuleManifest } from "../../packages/tasks/src/manifest.js";
import { commitmentsModuleManifest } from "../../packages/commitments/src/manifest.js";
import { goalsModuleManifest } from "../../packages/goals/src/manifest.js";
import { notesModuleManifest } from "../../packages/notes/src/manifest.js";

const GRANTED_AT_INSTALL_TASK_TOOLS = [
  "tasks.create",
  "tasks.update",
  "tasks.updateStatus",
  "tasks.breakDown",
  "tasks.addActivity",
  "tasks.assignTag",
  "tasks.unassignTag",
  "tasks.createList",
  "tasks.renameList",
  "tasks.createTag",
  "tasks.renameTag",
  "tasks.deleteList",
  "tasks.deleteTag"
];

const GRANTED_AT_INSTALL_COMMITMENT_TOOLS = [
  "commitments.accept",
  "commitments.reject",
  "commitments.snooze"
];

const GRANTED_AT_INSTALL_GOALS_TOOLS = ["goals.create", "goals.update", "goals.addEvidence"];

const GRANTED_AT_INSTALL_NOTES_TOOLS = ["notes.create", "notes.edit"];

describe("Tasks self-operation manifest classification", () => {
  it("classifies all 13 Tasks write tools as granted_at_install", () => {
    const tools = tasksModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_TASK_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });
});

describe("Commitments self-operation manifest classification", () => {
  it("classifies all 3 Commitments write tools as granted_at_install", () => {
    const tools = commitmentsModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_COMMITMENT_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });
});

describe("Goals self-operation manifest classification", () => {
  it("classifies all 3 Goals write tools as granted_at_install", () => {
    const tools = goalsModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_GOALS_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });
});

describe("Notes self-operation manifest classification", () => {
  it("classifies Notes create and edit as granted_at_install", () => {
    const tools = notesModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_NOTES_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });

  it("keeps notes.delete destructive with pending confirm_always", () => {
    const tools = notesModuleManifest.assistantTools ?? [];
    const deleteTool = tools.find((candidate) => candidate.name === "notes.delete");
    expect(deleteTool, "expected tool notes.delete to exist").toBeDefined();
    expect(deleteTool?.risk).toBe("destructive");
    expect(deleteTool?.selfOperationGrant).toBe("confirm_always");
    expect(deleteTool?.executionPolicy).toBeUndefined();
  });

  it("keeps overwrite confirmation conditional while ordinary note writes are auto-capable", () => {
    const tools = notesModuleManifest.assistantTools ?? [];
    const createTool = tools.find((candidate) => candidate.name === "notes.create");
    expect(createTool, "expected tool notes.create to exist").toBeDefined();
    expect(createTool?.executionPolicy).toBe("auto");
    expect(createTool?.requiresConfirmation?.({ overwrite: true })).toBe(true);
    expect(createTool?.requiresConfirmation?.({ overwrite: false })).toBe(false);
  });
});
