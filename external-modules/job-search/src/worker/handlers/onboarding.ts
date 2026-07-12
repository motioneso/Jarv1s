// external-modules/job-search/src/worker/handlers/onboarding.ts
//
// JS-03 (#932) Task 5: onboarding.get-state — the assistant's progress view.
// Gates are DERIVED from the actual records (active pointers, any enabled
// monitor), not trusted from the stored step/flags, so the response can never
// claim an approval that doesn't exist. Responses carry ids and flags only —
// never resume text, profile field values, or monitor queries.
import {
  getActiveProfile,
  getActiveResume,
  getMonitor,
  getOnboardingState,
  listMonitorIds
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { STEP_ORDER } from "./flow.js";

export function getStateHandler(ports: WorkerPorts) {
  return async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const state = (await getOnboardingState(ports.kv)) ?? {
      schemaVersion: 1 as const,
      step: STEP_ORDER[0],
      completed: {}
    };
    const resumeApproved = (await getActiveResume(ports.kv)) !== null;
    const profileApproved = (await getActiveProfile(ports.kv)) !== null;
    let monitorEnabled = false;
    for (const monitorId of await listMonitorIds(ports.kv)) {
      const monitor = await getMonitor(ports.kv, monitorId);
      if (monitor?.enabled === true) {
        monitorEnabled = true;
        break;
      }
    }
    const response: Record<string, unknown> = {
      status: "ok",
      step: state.step,
      completed: state.completed,
      gates: { resumeApproved, profileApproved, monitorEnabled }
    };
    if (state.approvedResumeRevisionId !== undefined) {
      response.approvedResumeRevisionId = state.approvedResumeRevisionId;
    }
    if (state.approvedProfileRevisionId !== undefined) {
      response.approvedProfileRevisionId = state.approvedProfileRevisionId;
    }
    return response;
  };
}
