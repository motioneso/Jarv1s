// external-modules/job-search/src/worker/handlers/capture.ts
//
// JS-04 (#933) Task 9: sources.list + manual capture tools. Capture handlers
// are zero-network BY CONSTRUCTION: they are factories over WorkerPorts
// (kv + ai + now) and this file must never name a network primitive — a
// source-grep test enforces that. The capture.url tool stores text the
// assistant already retrieved through its governed web.read flow; the module
// itself performs no retrieval. All pasted/extracted prose is sanitized to
// inert plain text before storage, and every response envelope carries ids
// and flags only — captured content is data, never an echo surface.
import { sanitizeInlineField, stripHtmlToText } from "../../adapters/index.js";
import { COMPANY_MAX_CHARS, TITLE_MAX_CHARS } from "../../adapters/types.js";
import { listSourceAdapters } from "../../adapters/registry.js";
import {
  canonicalJson,
  contentHash,
  opportunityIdentity,
  upsertOpportunity
} from "../../domain/index.js";
import type { OpportunityInput } from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { InputError, readString } from "../validate.js";

export const MANUAL_PASTE_ADAPTER_ID = "manual-paste";
export const MANUAL_URL_ADAPTER_ID = "manual-url";

// Input cap for pasted/extracted text. Rejection messages name the key and
// limit only (readString's fixed copy) — never the content or its real size.
const CAPTURE_TEXT_MAX_BYTES = 65_536;

export function listSourcesHandler(_ports: WorkerPorts) {
  return async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // Metadata only: the registry listing is already a plain-data projection
    // (no adapter functions), including the coordinator-mandated automated
    // review attribution.
    return { status: "ok", sources: listSourceAdapters().map((info) => ({ ...info })) };
  };
}

/**
 * Canonicalize a user-supplied posting URL for identity: https only,
 * credentials rejected (they'd be secrets in key material), fragment
 * stripped, host lowercased by the URL parser. Errors name the constraint —
 * never the URL, which is caller-controlled prose.
 */
function canonicalizeCaptureUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError("url must be a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new InputError("url must use https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new InputError("url must not contain credentials");
  }
  url.hash = "";
  return url.toString();
}

async function storeCapture(
  ports: WorkerPorts,
  input: OpportunityInput
): Promise<Record<string, unknown>> {
  // Identity is computed up front so a tombstone-suppressed capture still
  // reports which record it would have refreshed.
  const identityHash = opportunityIdentity(input);
  const result = await upsertOpportunity(ports.kv, input, ports.now());
  return { status: "ok", identityHash, suppressed: result.suppressed };
}

export function pasteCaptureHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const title = sanitizeInlineField(
      readString(input, "title", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES }),
      TITLE_MAX_CHARS
    );
    const company = sanitizeInlineField(
      readString(input, "company", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES }),
      COMPANY_MAX_CHARS
    );
    const description = stripHtmlToText(
      readString(input, "description", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES })
    );
    const rawUrl = readString(input, "url", { maxBytes: CAPTURE_TEXT_MAX_BYTES });
    const canonicalUrl = rawUrl !== undefined ? canonicalizeCaptureUrl(rawUrl) : undefined;

    const opportunity: OpportunityInput = {
      adapterId: MANUAL_PASTE_ADAPTER_ID,
      // With a URL the canonical URL is the identity; without one, a
      // deterministic hash of the sanitized content makes double-paste
      // idempotent (same text → same record).
      ...(canonicalUrl !== undefined
        ? { canonicalUrl }
        : {
            externalId: `paste-${contentHash(canonicalJson({ title, company, description }))}`
          }),
      posting: {
        title,
        company,
        description,
        ...(canonicalUrl !== undefined ? { url: canonicalUrl } : {})
      }
    };
    return storeCapture(ports, opportunity);
  };
}

export function urlCaptureHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const canonicalUrl = canonicalizeCaptureUrl(
      readString(input, "url", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES })
    );
    const title = sanitizeInlineField(
      readString(input, "title", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES }),
      TITLE_MAX_CHARS
    );
    const company = sanitizeInlineField(
      readString(input, "company", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES }),
      COMPANY_MAX_CHARS
    );
    const description = stripHtmlToText(
      readString(input, "extractedText", { required: true, maxBytes: CAPTURE_TEXT_MAX_BYTES })
    );

    return storeCapture(ports, {
      adapterId: MANUAL_URL_ADAPTER_ID,
      canonicalUrl,
      posting: { title, company, description, url: canonicalUrl }
    });
  };
}
