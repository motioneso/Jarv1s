// external-modules/job-search/src/worker/registry.ts
//
// JS-03 (#932) Task 10: the tool-key → handler-factory registry, split out of
// index.ts because defineModuleWorker attaches a readline on process.stdin at
// import time — tests must be able to pin the full registry (all manifest
// tool keys) without triggering that side effect. index.ts stays a thin
// dispatch shell over this table. JS-08 (#937) wired the last three keys —
// every tool is now a real factory; notImplemented stays exported only for
// any future slice that needs a placeholder.
import type { WorkerPorts } from "./ai-port.js";
import { listSourcesHandler, pasteCaptureHandler, urlCaptureHandler } from "./handlers/capture.js";
import { getMonitorHandler, listMonitorsHandler, saveMonitorHandler } from "./handlers/monitor.js";
import { getStateHandler } from "./handlers/onboarding.js";
import {
  decideOpportunityHandler,
  getOpportunityHandler,
  listOpportunitiesHandler
} from "./handlers/opportunities.js";
import { monitorRunHandler } from "./handlers/run.js";
import {
  approveProfileHandler,
  getProfileHandler,
  saveProfileDraftHandler
} from "./handlers/profile.js";
import {
  approveResumeHandler,
  getResumeHandler,
  saveResumeDraftHandler
} from "./handlers/resume.js";
import type { ToolHandler } from "./wrap.js";

export type ToolFactory = (ports: WorkerPorts) => ToolHandler;

export const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

export const HANDLERS: Readonly<Record<string, ToolFactory>> = {
  "onboarding.get-state": getStateHandler,
  "profile.get": getProfileHandler,
  "profile.save-draft": saveProfileDraftHandler,
  "profile.approve": approveProfileHandler,
  "resume.get": getResumeHandler,
  "resume.save-draft": saveResumeDraftHandler,
  "resume.approve": approveResumeHandler,
  "monitor.list": listMonitorsHandler,
  "monitor.get": getMonitorHandler,
  "monitor.save": saveMonitorHandler,
  "sources.list": listSourcesHandler,
  "capture.paste": pasteCaptureHandler,
  "capture.url": urlCaptureHandler,
  "opportunities.list": listOpportunitiesHandler,
  "opportunities.get": getOpportunityHandler,
  "opportunity.decide": decideOpportunityHandler,
  "monitor.run": monitorRunHandler
};
