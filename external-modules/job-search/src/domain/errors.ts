export type JobSearchKvErrorCode =
  | "invalid_record"
  | "oversize_value"
  | "missing_record"
  | "corrupt_index";

export class JobSearchKvError extends Error {
  constructor(
    readonly code: JobSearchKvErrorCode,
    message: string
  ) {
    super(message);
    this.name = "JobSearchKvError";
  }
}
