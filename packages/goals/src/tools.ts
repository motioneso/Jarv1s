import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { GoalsRepository } from "./repository.js";
import type { JarvisGoalStatus, JarvisGoalReviewCadence, JarvisGoalEvidenceKind, JarvisGoalSourceKind } from "./types.js";

const repository = new GoalsRepository();

export const goalListExecute: ToolExecute = async (scopedDb, _input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const goals = await repository.list(scopedDb);
  return {
    data: { items: goals.map(g => g as unknown as Record<string, unknown>) }
  };
};

export const goalGetExecute: ToolExecute = async (scopedDb, input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { goalId } = input as { goalId: string };
  const goal = await repository.getById(scopedDb, goalId);
  if (!goal) {
    return { data: { error: "Goal not found" } };
  }
  const evidence = await repository.listEvidence(scopedDb, goalId);
  return {
    data: { 
      goal: goal as unknown as Record<string, unknown>, 
      evidence: evidence.map(e => e as unknown as Record<string, unknown>) 
    }
  };
};

export const goalCreateExecute: ToolExecute = async (scopedDb, input, ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const data = input as {
    title: string;
    desiredOutcome: string;
    priority?: 1 | 2 | 3 | 4 | 5;
    reviewCadence?: JarvisGoalReviewCadence;
    targetAt?: string;
  };

  const goal = await repository.create(scopedDb, ctx.actorUserId, {
    title: data.title,
    desiredOutcome: data.desiredOutcome,
    priority: data.priority,
    reviewCadence: data.reviewCadence,
    targetAt: data.targetAt ?? null
  });

  return {
    data: goal as unknown as Record<string, unknown>
  };
};

export const goalUpdateExecute: ToolExecute = async (scopedDb, input, ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { goalId, ...data } = input as {
    goalId: string;
    title?: string;
    desiredOutcome?: string;
    status?: JarvisGoalStatus;
    priority?: 1 | 2 | 3 | 4 | 5;
    reviewCadence?: JarvisGoalReviewCadence;
    targetAt?: string;
  };

  const goal = await repository.update(scopedDb, goalId, data);
  return {
    data: goal as unknown as Record<string, unknown>
  };
};

export const goalAddEvidenceExecute: ToolExecute = async (scopedDb, input, ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { goalId, ...data } = input as {
    goalId: string;
    evidenceKind: JarvisGoalEvidenceKind;
    sourceKind: JarvisGoalSourceKind;
    sourceRef?: string;
    sourceLabel: string;
    summary: string;
    occurredAt?: string;
  };

  const evidence = await repository.addEvidence(scopedDb, ctx.actorUserId, goalId, {
    ...data,
    occurredAt: data.occurredAt ?? null
  });
  
  return {
    data: evidence as unknown as Record<string, unknown>
  };
};
