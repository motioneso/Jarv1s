// external-modules/job-search/src/domain/errors.ts
//
// JS-02 (#931): typed, scrubbed domain errors. Messages must NEVER embed
// record content (resume text, posting bodies, profile fields) — they can end
// up in logs and job outputs, which are outside the owner-private boundary.

export type JobSearchKvErrorCode =
  | "invalid_schema_version"
  | "invalid_record"
  | "oversize_value"
  | "resume_input_too_large"
  | "missing_active_pointer"
  | "missing_revision"
  | "missing_record"
  | "immutable_revision_conflict"
  | "corrupt_index";

export class JobSearchKvError extends Error {
  readonly code: JobSearchKvErrorCode;

  constructor(code: JobSearchKvErrorCode, message: string) {
    super(message);
    this.name = "JobSearchKvError";
    this.code = code;
  }
}
