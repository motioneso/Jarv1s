import { describe, expect, it } from "vitest";
import { tasksModuleManifest } from "../../packages/tasks/src/manifest.js";
import { commitmentsModuleManifest } from "../../packages/commitments/src/manifest.js";

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
