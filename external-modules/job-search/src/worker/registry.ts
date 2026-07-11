// external-modules/job-search/src/worker/registry.ts
//
// JS-03 (#932) Task 10: the tool-key → handler-factory registry, split out of
// index.ts because defineModuleWorker attaches a readline on process.stdin at
// import time — tests must be able to pin the full registry (all 14 manifest
// tool keys, stubs included) without triggering that side effect. index.ts
// stays a thin dispatch shell over this table. JS-05/06 tools and the
// monitor.run queue handler remain not-implemented stubs until their slices.
import type { WorkerPorts } from "./ai-port.js";
import { listSourcesHandler, pasteCaptureHandler, urlCaptureHandler } from "./handlers/capture.js";
import { getMonitorHandler, listMonitorsHandler, saveMonitorHandler } from "./handlers/monitor.js";
import { getStateHandler } from "./handlers/onboarding.js";
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
  "opportunities.list": notImplemented,
  "opportunities.get": notImplemented,
  "opportunity.decide": notImplemented,
  "monitor.run": notImplemented
};
