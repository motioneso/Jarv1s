import type { ChangeEvent } from "react";

export type GoogleClientCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type GoogleCredentialsImportResult =
  | GoogleClientCredentials
  | { readonly error: string };

export async function importCredentialsJson(
  event: ChangeEvent<HTMLInputElement>
): Promise<GoogleCredentialsImportResult | null> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return null;

  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const credentials = extractGoogleClientCredentials(payload);
    return credentials ?? { error: "That file does not look like a Google OAuth client JSON file." };
  } catch {
    return { error: "Could not read that JSON file." };
  }
}

export function extractGoogleClientCredentials(payload: unknown): GoogleClientCredentials | null {
  if (!isRecord(payload)) return null;
  const root = isRecord(payload.installed)
    ? payload.installed
    : isRecord(payload.web)
      ? payload.web
      : payload;
  const clientId = root.client_id;
  const clientSecret = root.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return null;
  if (!clientId.trim() || !clientSecret.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
