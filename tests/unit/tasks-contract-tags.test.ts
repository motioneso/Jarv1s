import { describe, expect, it } from "vitest";
import {
  taskDtoSchema,
  assignTaskTagRequestSchema,
  assignTaskTagRouteSchema,
  unassignTaskTagRouteSchema,
  renameTaskListRequestSchema,
  deleteTaskListRequestSchema,
  renameTaskTagRequestSchema,
  taskTagParamsSchema
} from "@jarv1s/shared";
import type { TaskDto } from "@jarv1s/shared";

describe("TaskDto.tags contract", () => {
  it("taskDtoSchema requires tags", () => {
    expect(taskDtoSchema.required).toContain("tags");
    expect(taskDtoSchema.properties).toHaveProperty("tags");
  });
  it("TaskDto type carries tags (compile check)", () => {
    const dto: TaskDto = {
      id: "t",
      ownerUserId: "u",
      listId: "l",
      parentTaskId: null,
      title: "x",
      description: null,
      status: "todo",
      priority: null,
      position: 0,
      dueAt: null,
      doAt: null,
      effort: null,
      source: "manual",
      sourceRef: null,
      completedAt: null,
      createdAt: null,
      updatedAt: null,
      tags: []
    };
    expect(dto.tags).toEqual([]);
  });
});

describe("assign/rename/delete contract schemas", () => {
  it("exposes the assign/rename/delete schemas", () => {
    expect(assignTaskTagRequestSchema.required).toContain("tagId");
    expect(deleteTaskListRequestSchema.properties).toHaveProperty("reassignToListId");
    expect(renameTaskListRequestSchema.required).toContain("name");
    expect(renameTaskTagRequestSchema.required).toContain("name");
    expect(taskTagParamsSchema.required).toEqual(["id", "tagId"]);
    expect(assignTaskTagRouteSchema.response[200]).toBeDefined();
    expect(unassignTaskTagRouteSchema.response[200]).toBeDefined();
  });
});
