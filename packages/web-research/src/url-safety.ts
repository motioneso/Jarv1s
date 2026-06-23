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
// IPv4 private / special-purpose (IANA & RFC)
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4"); // this-network (RFC 1122)
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4"); // private (RFC 1918)
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT (RFC 6598)
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4"); // link-local / instance metadata
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4"); // private (RFC 1918)
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments (RFC 6890)
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4"); // documentation TEST-NET-1 (RFC 5737)
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4"); // private (RFC 1918)
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking (RFC 2544)
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4"); // documentation TEST-NET-2 (RFC 5737)
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4"); // documentation TEST-NET-3 (RFC 5737)
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4"); // reserved Class E (RFC 1112)
// IPv6 private / special-purpose
blockedAddresses.addAddress("::", "ipv6"); // unspecified — routes to loopback on Linux
blockedAddresses.addAddress("::1", "ipv6"); // loopback
blockedAddresses.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 (RFC 6052)
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6"); // documentation (RFC 3849)
blockedAddresses.addSubnet("2002::", 16, "ipv6"); // 6to4 (RFC 3056)
blockedAddresses.addSubnet("fc00::", 7, "ipv6"); // unique local (RFC 4193)
blockedAddresses.addSubnet("fe80::", 10, "ipv6"); // link-local

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
