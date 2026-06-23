import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type HostResolver = (
  hostname: string
) => Promise<readonly { readonly address: string; readonly family: number }[]>;
export interface SafeHttpUrl {
  readonly url: URL;
  readonly address: string;
  readonly family: number;
}

let testHostResolver: HostResolver | undefined;
const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4"); // this-network (0.0.0.0/8)
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT (RFC 6598)
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addAddress("::", "ipv6"); // unspecified (::) — was missing, routes to loopback on Linux
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");

export function setWebHostResolverForTests(resolver: HostResolver | undefined): void {
  testHostResolver = resolver;
}

async function defaultResolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export function isBlockedIp(address: string): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);
  if (family !== 4 && family !== 6) return false;
  return blockedAddresses.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
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
  const hostname = stripIpv6Brackets(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isBlockedIp(hostname)) {
    return { ok: false, reason: "Local/private network targets are blocked" };
  }
  return { ok: true, url };
}

export async function validateHttpUrl(
  raw: string,
  resolveHost: HostResolver = testHostResolver ?? defaultResolveHost
): Promise<
  { ok: true; url: URL; address: string; family: number } | { ok: false; reason: string }
> {
  const parsed = parseHttpUrl(raw);
  if (!parsed.ok) return parsed;
  const hostname = stripIpv6Brackets(parsed.url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily) return { ...parsed, address: hostname, family: literalFamily };
  let addresses: readonly { readonly address: string; readonly family: number }[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    return { ok: false, reason: "Host could not be resolved" };
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    return { ok: false, reason: "Local/private network targets are blocked" };
  }
  const [address] = addresses;
  if (!address) return { ok: false, reason: "Host could not be resolved" };
  return { ...parsed, address: address.address, family: address.family };
}
