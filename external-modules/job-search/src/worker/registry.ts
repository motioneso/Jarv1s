import { resetJob } from "./handlers/reset.js";
import { profilesListHandler } from "./handlers/profiles.js";
import {
  resumeCritiqueHandler,
  resumeIntakeHandler,
  resumeReviseHandler
} from "./handlers/resume.js";
import type { WorkerPorts } from "./ports.js";
import type { ToolHandler } from "./wrap.js";

export type ToolFactory = (ports: WorkerPorts) => ToolHandler;

const resetHandler: ToolFactory = (ports) => async () => resetJob(ports.kv);

export const HANDLERS: Readonly<Record<string, ToolFactory>> = {
  "profiles.list": profilesListHandler,
  reset: resetHandler,
  "resume.intake": resumeIntakeHandler,
  "resume.critique": resumeCritiqueHandler,
  "resume-revise": resumeReviseHandler
};
