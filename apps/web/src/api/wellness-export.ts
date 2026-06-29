import type { WellnessExportCategory } from "@jarv1s/shared";

import { requestJson } from "./client";
import type { ExportJobStatus } from "./client";

// Wellness selective export (#484).
// POST /api/wellness/export creates an html-format job; status + download reuse the
// shared /api/me/export/* routes (download branches on job.format server-side).

export interface WellnessExportRequest {
  readonly from: string;
  readonly to: string;
  readonly categories: readonly WellnessExportCategory[];
}

export async function requestWellnessExport(body: WellnessExportRequest): Promise<ExportJobStatus> {
  return requestJson<ExportJobStatus>("/api/wellness/export", {
    method: "POST",
    body
  });
}
