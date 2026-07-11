import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList } from "node:net";

import { assertValidFetchHosts } from "./policy.js";

export type HostPinnedFetchErrorCode =
  | "host_not_declared"
  | "blocked_address"
  | "response_too_large"
  | "fetch_timeout"
  | "invalid_request";

export class HostPinnedFetchError extends Error {
  constructor(readonly code: HostPinnedFetchErrorCode) {
    super(code);
    this.name = "HostPinnedFetchError";
  }
}

export class HostPinningViolationError extends HostPinnedFetchError {
  constructor(
    readonly host: string,
    codeOrMessage: "host_not_declared" | "blocked_address" | string = "host_not_declared"
  ) {
    const code = codeOrMessage === "blocked_address" ? "blocked_address" : "host_not_declared";
    super(code);
    this.name = "HostPinningViolationError";
    if (codeOrMessage !== "host_not_declared" && codeOrMessage !== "blocked_address") {
      this.message = codeOrMessage;
    }
  }
}

export interface PinnedRequest {
  readonly address: string;
  readonly servername: string;
  readonly host: string;
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
}

export interface PinnedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly abort?: () => void;
}

export interface HostPinnedFetchOptions {
  readonly resolve?: (
    hostname: string
  ) => Promise<readonly { readonly address: string; readonly family: 4 | 6 }[]>;
  readonly request?: (request: PinnedRequest, signal: AbortSignal) => Promise<PinnedResponse>;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
}

const HOP_HEADERS = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const)
  BLOCKED.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const)
  BLOCKED.addSubnet(network, prefix, "ipv6");

export function createHostPinnedFetch(
  allowedHosts: readonly string[],
  options: HostPinnedFetchOptions | typeof fetch = {},
  legacyTimeoutMs?: number
): typeof fetch {
  assertValidFetchHosts("host-fetch", allowedHosts);
  if (typeof options === "function") {
    return createInjectedFetch(allowedHosts, options, legacyTimeoutMs ?? 15_000);
  }
  const allowed = new Set(allowedHosts);
  const resolve = options.resolve ?? defaultResolve;
  const request = options.request ?? defaultRequest;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    init?.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      let url = new URL(
        input instanceof URL ? input : typeof input === "string" ? input : input.url
      );
      let method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      let headers = requestHeaders(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      let body = await requestBody(init?.body, options.maxRequestBytes ?? 1_048_576);
      for (let hop = 0; ; hop += 1) {
        validateUrl(url, allowed);
        if (method !== "GET" && method !== "POST")
          throw new HostPinnedFetchError("invalid_request");
        if (method === "GET" && body) throw new HostPinnedFetchError("invalid_request");
        const answers = await withAbort(resolve(url.hostname), controller.signal);
        if (!answers.length || answers.some(({ address, family }) => isBlocked(address, family))) {
          throw new HostPinningViolationError(url.hostname, "blocked_address");
        }
        const response = await withAbort(
          request(
            {
              address: answers[0]!.address,
              servername: url.hostname,
              host: url.hostname,
              path: `${url.pathname}${url.search}`,
              method: method as "GET" | "POST",
              headers: { ...headers, host: url.hostname },
              ...(body ? { body } : {})
            },
            controller.signal
          ),
          controller.signal
        );
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.location;
          response.abort?.();
          if (!location || hop >= (options.maxRedirects ?? 5)) {
            throw new HostPinnedFetchError("invalid_request");
          }
          const next = new URL(location, url);
          if (next.origin !== url.origin) headers = {};
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === "POST")
          ) {
            method = "GET";
            body = undefined;
          }
          url = next;
          continue;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        const iterator = response.body[Symbol.asyncIterator]();
        for (;;) {
          const next = await withAbort(iterator.next(), controller.signal);
          if (next.done) break;
          const chunk = next.value;
          size += chunk.byteLength;
          if (size > (options.maxResponseBytes ?? 5 * 1024 * 1024)) {
            response.abort?.();
            throw new HostPinnedFetchError("response_too_large");
          }
          chunks.push(chunk);
        }
        return new Response(
          [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks),
          {
            status: response.status,
            headers: response.headers
          }
        );
      }
    } catch (error) {
      if (timedOut) throw new HostPinnedFetchError("fetch_timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function createInjectedFetch(
  allowedHosts: readonly string[],
  fetchFn: typeof fetch,
  timeoutMs: number
): typeof fetch {
  const allowed = new Set(allowedHosts);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = new URL(input instanceof URL ? input : typeof input === "string" ? input : input.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let currentInit = { ...init, signal: controller.signal };
    let method = (init?.method ?? "GET").toUpperCase();
    try {
      for (let hop = 0; ; hop += 1) {
        validateLegacyUrl(url, allowed);
        const response = await fetchFn(url, { ...currentInit, redirect: "manual" });
        if (!REDIRECTS.has(response.status)) return response;
        const location = response.headers.get("location");
        if (!location) return response;
        if (hop >= 5) throw new Error("Dataset runtime host pinning: exceeded 5 redirects");
        const next = new URL(location, url);
        if (next.hostname !== url.hostname) {
          const nextHeaders = new Headers(currentInit.headers);
          nextHeaders.delete("authorization");
          currentInit = { ...currentInit, headers: nextHeaders };
        }
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method !== "GET" &&
            method !== "HEAD")
        ) {
          const { body: _body, ...rest } = currentInit;
          currentInit = { ...rest, method: "GET" };
          method = "GET";
        }
        url = next;
      }
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

function validateLegacyUrl(url: URL, allowed: ReadonlySet<string>): void {
  if (url.protocol !== "https:" || !allowed.has(url.hostname)) {
    throw new HostPinningViolationError(url.hostname);
  }
}

function validateUrl(url: URL, allowed: ReadonlySet<string>): void {
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new HostPinnedFetchError("invalid_request");
  }
  if (!allowed.has(url.hostname)) throw new HostPinningViolationError(url.hostname);
}

function requestHeaders(input?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(input).forEach((value, name) => {
    if (HOP_HEADERS.has(name)) throw new HostPinnedFetchError("invalid_request");
    result[name] = value;
  });
  return result;
}

async function requestBody(
  input: BodyInit | null | undefined,
  max: number
): Promise<Uint8Array | undefined> {
  if (input == null) return undefined;
  let body: Uint8Array;
  if (typeof input === "string") body = Buffer.from(input);
  else if (input instanceof ArrayBuffer) body = new Uint8Array(input);
  else if (ArrayBuffer.isView(input))
    body = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else if (input instanceof Blob) body = new Uint8Array(await input.arrayBuffer());
  else throw new HostPinnedFetchError("invalid_request");
  if (body.byteLength > max) throw new HostPinnedFetchError("invalid_request");
  return body;
}

function isBlocked(address: string, family: 4 | 6): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function defaultResolve(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true }) as Promise<
    { address: string; family: 4 | 6 }[]
  >;
}

function defaultRequest(input: PinnedRequest, signal: AbortSignal): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: input.address,
        port: 443,
        servername: input.servername,
        path: input.path,
        method: input.method,
        headers: input.headers,
        signal
      },
      (response) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({
          status: response.statusCode ?? 500,
          headers,
          body: response,
          abort: () => response.destroy()
        });
      }
    );
    req.once("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

export { assertValidFetchHosts, isPinnableHost } from "./policy.js";
