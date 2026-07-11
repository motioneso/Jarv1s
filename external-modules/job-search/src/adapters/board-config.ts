// external-modules/job-search/src/adapters/board-config.ts
//
// JS-04 (#933): shared board-config parsing for all source adapters. The
// board token becomes a URL path segment on an allow-listed host, so this is
// a security boundary: token patterns must exclude every delimiter that could
// smuggle a path hop, query, or encoded byte, and URL inputs are restricted
// to https on exact recognized hosts with no credentials. Errors name the
// key + constraint only — never the (hostile) value.
import { InputError, readString } from "../worker/validate.js";
import { sanitizeInlineField } from "./sanitize.js";
import type { BoardConfig, WorkMode } from "./types.js";
import { COMPANY_MAX_CHARS } from "./types.js";

export interface BoardConfigRules {
  readonly adapterId: string;
  readonly tokenPattern: RegExp;
  readonly urlHosts: readonly string[];
}

/**
 * Board configuration accepts a validated identifier or a recognized public
 * board URL — never an arbitrary recurring target (spec: adapter contract).
 * Tokens become a single URL path segment, so the pattern must exclude every
 * delimiter (/ ? # \ % whitespace); buildUrl still encodeURIComponent()s as
 * defense in depth.
 */
export function parseBoardConfig(
  query: Record<string, unknown>,
  rules: BoardConfigRules
): BoardConfig {
  const board = readString(query, "board", { maxBytes: 512 });
  const url = readString(query, "url", { maxBytes: 2048 });
  const companyRaw = readString(query, "companyName", { maxBytes: 512 });
  if (board !== undefined && url !== undefined) {
    throw new InputError("query accepts board or url, not both");
  }
  let token: string;
  if (board !== undefined) token = board;
  else if (url !== undefined) token = tokenFromUrl(url, rules);
  else throw new InputError("query requires board or url");
  if (!rules.tokenPattern.test(token)) {
    throw new InputError(`board must match ${rules.adapterId} board-identifier pattern`);
  }
  const companyName =
    companyRaw === undefined ? undefined : sanitizeInlineField(companyRaw, COMPANY_MAX_CHARS);
  return { board: token, ...(companyName ? { companyName } : {}) };
}

function tokenFromUrl(raw: string, rules: BoardConfigRules): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError("url must be a valid absolute URL");
  }
  if (parsed.protocol !== "https:") throw new InputError("url must use https");
  if (parsed.username || parsed.password) throw new InputError("url must not contain credentials");
  if (!rules.urlHosts.includes(parsed.hostname.toLowerCase())) {
    throw new InputError(`url host is not a recognized ${rules.adapterId} board host`);
  }
  const segment = parsed.pathname.split("/").find((part) => part.length > 0);
  if (segment === undefined) {
    throw new InputError("url is missing the board identifier path segment");
  }
  // Decode so percent-encoded delimiters can't sneak past the token pattern
  // (the pattern then rejects any delimiter the decode reveals).
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new InputError("url path segment is not decodable");
  }
  return decoded;
}

const WORK_MODES: Record<string, WorkMode> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
  "on-site": "onsite"
};

export function mapWorkMode(value: unknown): WorkMode | undefined {
  return typeof value === "string" ? WORK_MODES[value.toLowerCase()] : undefined;
}

export function parseIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return undefined;
}
