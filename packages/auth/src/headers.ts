import type { IncomingHttpHeaders } from "node:http";

export function toWebHeaders(headers: Headers | IncomingHttpHeaders): Headers {
  if (headers instanceof Headers) {
    return headers;
  }

  const webHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        webHeaders.append(name, item);
      }
      continue;
    }
    webHeaders.set(name, value);
  }

  return webHeaders;
}

export function readBearerToken(headers: Headers): string | undefined {
  const authorization = readHeader(headers, "authorization");

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  // Total: anything that is not a well-formed `Bearer <token>` (wrong scheme, missing space,
  // empty token) yields `undefined` so the request falls through to cookie auth or produces a
  // single clean 401 — never a thrown control-flow error for a mere header-format failure.
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);

  return value?.trim() || undefined;
}
