// external-modules/job-search/src/worker/index.ts
// JS-01 (#930): contract-proving worker. Every handler id declared in
// jarvis.module.json must resolve here (13 assistant tools + the monitor queue),
// but domain behavior lands in later JS slices — each stub answers
// not-implemented rather than pretending to work.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";

const notImplemented = async (): Promise<{ status: "not-implemented" }> => ({
  status: "not-implemented"
});

defineModuleWorker({
  handlers: {
    "onboarding.get-state": notImplemented,
    "profile.get": notImplemented,
    "profile.save-draft": notImplemented,
    "profile.approve": notImplemented,
    "resume.get": notImplemented,
    "resume.save-draft": notImplemented,
    "resume.approve": notImplemented,
    "monitor.list": notImplemented,
    "monitor.get": notImplemented,
    "monitor.save": notImplemented,
    "opportunities.list": notImplemented,
    "opportunities.get": notImplemented,
    "opportunity.decide": notImplemented,
    "monitor.run": notImplemented
  }
});
