export function isPinnableHost(host: string): boolean {
  if (host.length === 0 || host !== host.toLowerCase() || host.includes(":")) return false;
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function assertValidFetchHosts(sourceId: string, hosts: readonly string[]): void {
  if (hosts.length === 0) throw new Error(`External source "${sourceId}" declares no fetchHosts`);
  for (const host of hosts) {
    if (!isPinnableHost(host)) {
      throw new Error(
        `External source "${sourceId}" declares an invalid fetchHost "${host}" ` +
          "(must be a lowercase hostname, no port, no IP literal)"
      );
    }
  }
}
