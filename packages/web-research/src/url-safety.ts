import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type HostResolver = (
  hostname: string
) => Promise<readonly { readonly address: string; readonly family: number }[]>;

let testHostResolver: HostResolver | undefined;

export function setWebHostResolverForTests(resolver: HostResolver | undefined): void {
  testHostResolver = resolver;
}

async function defaultResolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return false;
}

export function parseHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only HTTP(S) URLs are supported" };
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isBlockedIp(hostname)) {
    return { ok: false, reason: "Local/private network targets are blocked" };
  }
  return { ok: true, url };
}

export async function validateHttpUrl(
  raw: string,
  resolveHost: HostResolver = testHostResolver ?? defaultResolveHost
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  const parsed = parseHttpUrl(raw);
  if (!parsed.ok) return parsed;
  if (isIP(parsed.url.hostname)) return parsed;
  let addresses: readonly { readonly address: string; readonly family: number }[];
  try {
    addresses = await resolveHost(parsed.url.hostname);
  } catch {
    return { ok: false, reason: "Host could not be resolved" };
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    return { ok: false, reason: "Local/private network targets are blocked" };
  }
  return parsed;
}
