import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import { DEFAULT_WEB_RESEARCH_CONFIG } from "./config.js";
import type { HostRateLimiter } from "./rate-limit.js";
import { RateLimitExceededError } from "./rate-limit.js";
import type { RobotsGate } from "./robots.js";
import { type HostResolver, type SafeHttpUrl, validateHttpUrl } from "./url-safety.js";

type WebFetch = typeof fetch;
export interface WebHttpTransportRequest {
  readonly url: URL;
  readonly connectHost: string;
  readonly family: number;
  readonly hostHeader: string;
  readonly servername?: string;
  readonly signal: AbortSignal;
}

export type WebHttpTransport = (request: WebHttpTransportRequest) => Promise<Response>;

let testFetch: WebFetch | undefined;
let testHttpTransport: WebHttpTransport | undefined;

export function setWebFetchForTests(fetchImpl: WebFetch | undefined): void {
  testFetch = fetchImpl;
}

export function setWebHttpTransportForTests(transport: WebHttpTransport | undefined): void {
  testHttpTransport = transport;
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Request aborted"));
  return new Promise((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      cleanup();
      reject(new Error("Request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

async function requestCheckedUrl(checked: SafeHttpUrl, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) throw new Error("Request aborted");
  const hostHeader = checked.url.host;
  const servername =
    checked.url.protocol === "https:" ? stripIpv6Brackets(checked.url.hostname) : undefined;
  const request = {
    url: checked.url,
    connectHost: checked.address,
    family: checked.family,
    hostHeader,
    servername,
    signal
  };
  if (testHttpTransport) return testHttpTransport(request);
  if (testFetch) {
    return testFetch(checked.url, {
      redirect: "manual",
      signal,
      headers: { host: hostHeader }
    });
  }
  return nodeHttpTransport(request);
}

export interface FetchWebResourceOptions {
  readonly requireHttps?: boolean;
  readonly robots?: RobotsGate;
  readonly rateLimiter?: HostRateLimiter;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly resolveHost?: HostResolver;
}

export type FetchWebResourceResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly finalUrl: string;
      readonly contentType: string | null;
      readonly body: string;
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "blocked"
        | "robots"
        | "rate_limited"
        | "not_https"
        | "timeout"
        | "network"
        | "http_error";
      readonly status?: number;
    };

export async function fetchWebResource(
  rawUrl: string,
  options: FetchWebResourceOptions = {}
): Promise<FetchWebResourceResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "blocked" };
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_WEB_RESEARCH_CONFIG.timeoutMs
  );
  try {
    for (
      let redirects = 0;
      redirects <= DEFAULT_WEB_RESEARCH_CONFIG.redirectLimit;
      redirects += 1
    ) {
      const safe = await abortable(
        validateHttpUrl(current.toString(), options.resolveHost),
        controller.signal
      );
      if (!safe.ok) return { ok: false, reason: "blocked" };
      if (options.requireHttps && safe.url.protocol !== "https:") {
        return { ok: false, reason: "not_https" };
      }
      if (options.robots) {
        const allowed = await options.robots.isAllowed(safe.url, async (robotsUrl) => {
          const robotsSafe = await abortable(
            validateHttpUrl(robotsUrl.toString(), options.resolveHost),
            controller.signal
          );
          if (!robotsSafe.ok) return null;
          if (options.rateLimiter) {
            await abortable(
              options.rateLimiter.acquire(robotsSafe.url.hostname),
              controller.signal
            );
          }
          const response = await requestCheckedUrl(robotsSafe, controller.signal);
          const { text: body } = await readCapped(
            response,
            options.maxBytes ?? DEFAULT_WEB_RESEARCH_CONFIG.maxDownloadBytes
          );
          return { status: response.status, body };
        });
        if (!allowed) return { ok: false, reason: "robots" };
      }
      if (options.rateLimiter) {
        await abortable(options.rateLimiter.acquire(safe.url.hostname), controller.signal);
      }
      const response = await requestCheckedUrl(safe, controller.signal);
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "http_error", status: response.status };
        current = new URL(location, current);
        continue;
      }
      if (response.status >= 400) {
        return { ok: false, reason: "http_error", status: response.status };
      }
      const { text: body, truncated } = await readCapped(
        response,
        options.maxBytes ?? DEFAULT_WEB_RESEARCH_CONFIG.maxDownloadBytes
      );
      return {
        ok: true,
        status: response.status,
        finalUrl: response.url || safe.url.toString(),
        contentType: response.headers.get("content-type"),
        body,
        truncated
      };
    }
    return { ok: false, reason: "network" };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: "timeout" };
    if (error instanceof RateLimitExceededError) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function headersFromIncoming(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) out.set(key, value.join(", "));
    else if (value !== undefined) out.set(key, String(value));
  }
  return out;
}

async function nodeHttpTransport(input: WebHttpTransportRequest): Promise<Response> {
  const isHttps = input.url.protocol === "https:";
  const request = isHttps ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: input.url.protocol,
        hostname: input.connectHost,
        port: input.url.port || (isHttps ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: "GET",
        headers: {
          host: input.hostHeader,
          "user-agent": "Jarvis-WebResearch/0.1"
        },
        servername: input.servername,
        lookup: (_hostname, _options, callback) => callback(null, input.connectHost, input.family)
      },
      (res: IncomingMessage) => {
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status: res.statusCode ?? 0,
            headers: headersFromIncoming(res.headers)
          })
        );
      }
    );
    req.on("error", reject);
    input.signal.addEventListener("abort", () => req.destroy(new Error("Request aborted")), {
      once: true
    });
    req.end();
  });
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
  const response = await fetchWebResource(rawUrl);
  if (!response.ok) return { ok: false, url: rawUrl, reason: response.reason };
  try {
    const html = response.body;
    const extracted = extractReadableText(html);
    const cappedText = extracted.text.slice(0, DEFAULT_WEB_RESEARCH_CONFIG.maxExtractedChars);
    return {
      ok: true,
      document: {
        url: response.finalUrl,
        domain: new URL(response.finalUrl).hostname,
        title: extracted.title,
        text: cappedText,
        excerpt: cappedText.slice(0, 500),
        fetchedAt: new Date().toISOString(),
        truncated:
          response.truncated || extracted.text.length > DEFAULT_WEB_RESEARCH_CONFIG.maxExtractedChars,
        status: response.status
      }
    };
  } catch (error) {
    return {
      ok: false,
      url: rawUrl,
      reason: error instanceof Error ? error.message : "Fetch failed"
    };
  }
}
