import { DEFAULT_WEB_RESEARCH_CONFIG } from "./config.js";
import { type HostResolver, validateHttpUrl } from "./url-safety.js";

type WebFetch = typeof fetch;

let testFetch: WebFetch | undefined;

export function setWebFetchForTests(fetchImpl: WebFetch | undefined): void {
  testFetch = fetchImpl;
}

function activeFetch(): WebFetch {
  return testFetch ?? fetch;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readCapped(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: await response.text(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, Math.max(0, remaining)));
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

export function extractReadableText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return {
    title: decodeHtml(title).trim(),
    text: decodeHtml(stripped).replace(/\s+/g, " ").trim()
  };
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchWithSafeRedirects(
  startUrl: URL,
  options: { readonly signal: AbortSignal; readonly resolveHost?: HostResolver }
): Promise<Response> {
  let current = startUrl;
  for (let redirects = 0; redirects <= DEFAULT_WEB_RESEARCH_CONFIG.redirectLimit; redirects += 1) {
    const response = await activeFetch()(current, { redirect: "manual", signal: options.signal });
    if (!isRedirect(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = await validateHttpUrl(new URL(location, current).toString(), options.resolveHost);
    if (!next.ok) throw new Error(next.reason);
    current = next.url;
  }
  throw new Error("Redirect limit exceeded");
}

export async function readWebPage(rawUrl: string): Promise<
  | {
      readonly ok: true;
      readonly document: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly url: string;
      readonly reason: string;
    }
> {
  const safe = await validateHttpUrl(rawUrl);
  if (!safe.ok) return { ok: false, url: rawUrl, reason: safe.reason };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_WEB_RESEARCH_CONFIG.timeoutMs);
  try {
    const response = await fetchWithSafeRedirects(safe.url, { signal: controller.signal });
    const { text: html, truncated: byteTruncated } = await readCapped(
      response,
      DEFAULT_WEB_RESEARCH_CONFIG.maxDownloadBytes
    );
    const extracted = extractReadableText(html);
    const cappedText = extracted.text.slice(0, DEFAULT_WEB_RESEARCH_CONFIG.maxExtractedChars);
    return {
      ok: true,
      document: {
        url: response.url || safe.url.toString(),
        domain: safe.url.hostname,
        title: extracted.title,
        text: cappedText,
        excerpt: cappedText.slice(0, 500),
        fetchedAt: new Date().toISOString(),
        truncated:
          byteTruncated || extracted.text.length > DEFAULT_WEB_RESEARCH_CONFIG.maxExtractedChars,
        status: response.status
      }
    };
  } catch (error) {
    return {
      ok: false,
      url: rawUrl,
      reason: error instanceof Error ? error.message : "Fetch failed"
    };
  } finally {
    clearTimeout(timer);
  }
}
