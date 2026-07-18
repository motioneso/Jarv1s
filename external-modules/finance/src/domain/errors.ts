// external-modules/finance/src/domain/errors.ts
//
// FIN-01 (#1146): typed, scrubbed domain errors, same contract as
// job-search's JobSearchKvError. Messages must NEVER embed record content
// (payees, amounts, account names, institution ids) — they can end up in
// logs and job outputs, which are outside the owner-private boundary.

export type FinanceKvErrorCode =
  | "invalid_record"
  | "oversize_value"
  | "missing_record"
  | "corrupt_index";

export class FinanceKvError extends Error {
  readonly code: FinanceKvErrorCode;

  constructor(code: FinanceKvErrorCode, message: string) {
    super(message);
    this.name = "FinanceKvError";
    this.code = code;
  }
}
