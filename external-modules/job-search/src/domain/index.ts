// external-modules/job-search/src/domain/index.ts
//
// JS-02 (#931): the domain layer's public surface. JS-03 worker tools and
// JS-05/06 features import from here, never from individual files — the
// per-file module layout stays free to change behind this barrel.
export type { ConfirmationRecord } from "./confirmations.js";
export {
  CONFIRMATION_TEXT_MAX_CHARS,
  confirmationIdFor,
  listConfirmationIds,
  listConfirmations,
  saveConfirmation
} from "./confirmations.js";
export type { DiffHunk } from "./diff.js";
export { diffLines } from "./diff.js";
export type { Freshness, FreshnessCounts, FreshnessRunContext } from "./freshness.js";
export { freshnessOf, markFreshnessAfterRun, transitionFreshness } from "./freshness.js";
export type { GateResult, GateVerdict } from "./gate.js";
export { applyGate } from "./gate.js";
export type {
  MarkdownCoverageVerdict,
  MaterialClaim,
  MaterialClaimKind,
  ParsedCritique,
  ResumeEvidence,
  TruthGuardVerdict
} from "./truth-guard.js";
export {
  CLAIM_QUOTE_MAX_CHARS,
  CLAIM_QUOTE_MIN_CHARS,
  CLAIM_TEXT_MAX_CHARS,
  CRITIQUE_SCHEMA,
  CRITIQUE_SUMMARY_MAX_CHARS,
  MATERIAL_CLAIMS_MAX,
  MATERIAL_CLAIM_KINDS,
  extractMaterialSegments,
  parseCritique,
  verifyClaims,
  verifyMarkdownCoverage
} from "./truth-guard.js";
export { JobSearchKvError } from "./errors.js";
export type { JobSearchKvErrorCode } from "./errors.js";
export type { JobSearchKv, JobSearchNamespace } from "./kv-port.js";
export { NS, kvFromWorkerContext } from "./kv-port.js";
export type {
  EvalBudgetRecord,
  EvaluationConfidence,
  EvaluationEvidence,
  EvaluationInputs,
  EvaluationRecommendation,
  EvaluationRecord,
  FitBand
} from "./evaluations.js";
export {
  budgetDateFor,
  getEvaluation,
  isOutdated,
  readBudgetUsed,
  saveEvaluation,
  takeBudget
} from "./evaluations.js";
export {
  DESCRIPTION_MAX_BYTES,
  EVAL_BUDGET_RETENTION_DAYS,
  EVAL_DAILY_CAP,
  EVALUATION_MAX_BYTES,
  KV_VALUE_MAX_BYTES,
  OPPORTUNITY_TARGET,
  PER_INVOCATION_EVAL_MAX,
  PASSED_STALE_EVICT_DAYS,
  RESUME_INPUT_MAX_BYTES,
  RESUME_TOO_LARGE_MESSAGE,
  RUN_RETENTION_DAYS,
  RUN_RETENTION_MAX,
  TOMBSTONE_TTL_DAYS
} from "./limits.js";
export { canonicalJson, readRecord, writeRecord } from "./records.js";
export {
  assertId,
  contentHash,
  evaluationIdentity,
  keys,
  opportunityIdentity,
  sourceKey
} from "./keys.js";
export type { OnboardingState } from "./onboarding.js";
export { getOnboardingState, saveOnboardingState } from "./onboarding.js";
export type { ProfileRevision } from "./profile.js";
export {
  approveProfile,
  getActiveProfile,
  listProfileRevisionIds,
  saveProfileRevision
} from "./profile.js";
export type { ResumeRevision } from "./resume.js";
export {
  approveResume,
  getActiveResume,
  saveOriginalResume,
  saveResumeRevision
} from "./resume.js";
export type { MonitorConfig, MonitorCursor } from "./monitors.js";
export {
  deleteMonitor,
  getMonitor,
  getMonitorCursor,
  listMonitorIds,
  saveMonitor,
  saveMonitorCursor
} from "./monitors.js";
export type {
  OpportunityInput,
  OpportunityRecord,
  OpportunityStatus,
  OpportunityTombstone,
  UpsertOpportunityResult
} from "./opportunities.js";
export {
  getOpportunity,
  listOpportunities,
  setOpportunityStatus,
  truncateUtf8,
  upsertOpportunity
} from "./opportunities.js";
export {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  DUE_TIME_PATTERN,
  getScheduleState,
  isDue,
  isValidTimeZone,
  localDateAndTime,
  saveScheduleState
} from "./schedule.js";
export type { MonitorScheduleState } from "./schedule.js";
export type { RunRecord, RunSummary } from "./runs.js";
export { getRunSummary, listRuns, recordRun } from "./runs.js";
export type { FeedEntry, FeedIndex } from "./feed.js";
export { readFeed, readFeedOrRebuild, rebuildFeed } from "./feed.js";
export type { RetentionReport } from "./retention.js";
export { runRetentionPass } from "./retention.js";
