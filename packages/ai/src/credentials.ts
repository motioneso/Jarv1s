export interface AiApiKeyCredential {
  readonly apiKey: string;
}

export function parseAiApiKeyCredential(value: Record<string, unknown>): AiApiKeyCredential | null {
  return typeof value.apiKey === "string" && value.apiKey.length > 0
    ? { apiKey: value.apiKey }
    : null;
}
