import { describe, expect, it } from "vitest";
import { tasksModuleManifest } from "../../packages/tasks/src/manifest.js";
import { commitmentsModuleManifest } from "../../packages/commitments/src/manifest.js";
import { goalsModuleManifest } from "../../packages/goals/src/manifest.js";
import { notesModuleManifest } from "../../packages/notes/src/manifest.js";
import { peopleModuleManifest } from "../../packages/people/src/manifest.js";
import { memoryModuleManifest } from "../../packages/memory/src/manifest.js";
import { newsModuleManifest } from "../../packages/news/src/manifest.js";

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

const GRANTED_AT_INSTALL_NOTES_TOOLS = ["notes.create", "notes.edit", "notes.delete"];

const GRANTED_AT_INSTALL_PEOPLE_TOOLS = ["people.acceptMatch", "people.rejectMatch"];
const CONFIRM_ALWAYS_PEOPLE_TOOLS = ["people.merge", "people.splitIdentity"];

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
  it("classifies Notes create, edit, and delete as granted_at_install", () => {
    const tools = notesModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_NOTES_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });

  it("grants notes.delete at install as an auto-executable write", () => {
    const tools = notesModuleManifest.assistantTools ?? [];
    const deleteTool = tools.find((candidate) => candidate.name === "notes.delete");
    expect(deleteTool, "expected tool notes.delete to exist").toBeDefined();
    expect(deleteTool?.risk).toBe("write");
    expect(deleteTool?.actionFamilyId).toBe("note_changes");
    expect(deleteTool?.executionPolicy).toBe("auto");
    expect(deleteTool?.selfOperationGrant).toBe("granted_at_install");
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

describe("People self-operation manifest classification", () => {
  it("classifies People with exactly two binding confirm_always declarations", () => {
    const tools = peopleModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_PEOPLE_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
    for (const name of CONFIRM_ALWAYS_PEOPLE_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.risk).toBe("destructive");
      expect(tool?.selfOperationGrant, `expected ${name} to be confirm_always`).toBe(
        "confirm_always"
      );
    }
    const confirmAlwaysCount = tools.filter(
      (tool) => tool.selfOperationGrant === "confirm_always"
    ).length;
    expect(confirmAlwaysCount).toBe(2);
  });
});

describe("Memory self-operation manifest classification", () => {
  it("classifies remember as granted and forget as binding confirm_always", () => {
    const tools = memoryModuleManifest.assistantTools ?? [];
    const remember = tools.find((candidate) => candidate.name === "memory.remember");
    expect(remember, "expected tool memory.remember to exist").toBeDefined();
    expect(remember?.risk).toBe("write");
    expect(remember?.actionFamilyId).toBe("memory_management");
    expect(remember?.executionPolicy).toBe("auto");
    expect(remember?.selfOperationGrant).toBe("granted_at_install");

    const forget = tools.find((candidate) => candidate.name === "memory.forget");
    expect(forget, "expected tool memory.forget to exist").toBeDefined();
    expect(forget?.risk).toBe("destructive");
    expect(forget?.selfOperationGrant).toBe("confirm_always");
  });
});

const GRANTED_AT_INSTALL_NEWS_TOOLS = [
  "news.confirmSource",
  "news.removeSource",
  "news.addTopic",
  "news.removeTopic",
  "news.addExclusion"
];

describe("News self-operation manifest classification", () => {
  it("classifies all 5 News personalization writes as granted_at_install", () => {
    const tools = newsModuleManifest.assistantTools ?? [];
    for (const name of GRANTED_AT_INSTALL_NEWS_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected tool ${name} to exist`).toBeDefined();
      expect(tool?.risk).toBe("write");
      expect(tool?.actionFamilyId).toBe("news_personalization");
      expect(tool?.executionPolicy).toBe("auto");
      expect(tool?.selfOperationGrant, `expected ${name} to be granted_at_install`).toBe(
        "granted_at_install"
      );
    }
  });
});
