import { ApiError, readErrorBody } from "./client";

/**
 * Personal data export (#238): GET /api/settings/me/data-export returns the
 * authenticated user's archive as a JSON attachment (Content-Disposition). Unlike
 * requestJson, the body is a file payload — consume it as a Blob and trigger a
 * browser download rather than parsing JSON. Authenticated via the same cookie
 * session as the rest of the client (credentials: "include").
 */
export async function downloadMyDataExport(): Promise<void> {
  const response = await fetch("/api/settings/me/data-export", {
    credentials: "include",
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    const { message } = await readErrorBody(response);
    throw new ApiError(response.status, message);
  }

  const blob = await response.blob();
  triggerBlobDownload(blob, parseExportFilename(response.headers.get("content-disposition")));
}

function parseExportFilename(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "jarvis-archive.json";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
