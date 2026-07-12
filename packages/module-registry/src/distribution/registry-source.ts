// #964: where the registry lives and how we talk to it. The index URL and host list
// are HARDCODED — an env override exists for tests only and is refused outright in
// production so no runtime configuration can redirect module downloads.
import { createHostPinnedFetch } from "@jarv1s/host-fetch";

import { validateRegistryIndex, type ModuleRegistryIndex } from "./index-schema.js";

export const REGISTRY_INDEX_URL =
  "https://github.com/motioneso/jarv1s/releases/download/modules/index.json";

// github.com serves the release URL; the two githubusercontent hosts are where GitHub
// redirects release-asset downloads.
export const REGISTRY_ALLOWED_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
] as const;

export const REGISTRY_INDEX_MAX_BYTES = 1024 * 1024;

export function resolveRegistryIndexUrl(env: NodeJS.ProcessEnv): string {
  const override = env.JARVIS_MODULE_REGISTRY_URL;
  if (override !== undefined && override !== "") {
    if (env.NODE_ENV === "production") {
      throw new Error("JARVIS_MODULE_REGISTRY_URL is test-only and refused in production");
    }
    return override;
  }
  return REGISTRY_INDEX_URL;
}

/**
 * The fetch used for all registry traffic. Default: host-pinned fetch locked to the
 * three GitHub hosts (SSRF/redirect containment + private-IP blocklist). When a
 * test override URL is active — impossible in production, resolveRegistryIndexUrl
 * throws there — we use plain fetch, because the mock registry sits on loopback,
 * which the host-pinned resolver correctly blocks.
 */
export function createRegistryFetch(env: NodeJS.ProcessEnv, fetchFn?: typeof fetch): typeof fetch {
  if (fetchFn) return fetchFn;
  if (env.JARVIS_MODULE_REGISTRY_URL !== undefined && env.JARVIS_MODULE_REGISTRY_URL !== "") {
    if (env.NODE_ENV === "production") {
      throw new Error("JARVIS_MODULE_REGISTRY_URL is test-only and refused in production");
    }
    return fetch;
  }
  return createHostPinnedFetch(REGISTRY_ALLOWED_HOSTS, {
    maxResponseBytes: 50 * 1024 * 1024 + 1024
  });
}

export interface FetchRegistryIndexOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly fetchFn?: typeof fetch;
}

/** Never throws for remote/shape problems — returns { index: null, errors } instead. */
export async function fetchRegistryIndex(
  options: FetchRegistryIndexOptions
): Promise<{ index: ModuleRegistryIndex | null; errors: readonly string[] }> {
  try {
    const url = resolveRegistryIndexUrl(options.env);
    const doFetch = createRegistryFetch(options.env, options.fetchFn);
    const response = await doFetch(url);
    if (!response.ok) return { index: null, errors: [`registry index HTTP ${response.status}`] };
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > REGISTRY_INDEX_MAX_BYTES) {
      return { index: null, errors: ["registry index exceeds 1 MiB cap"] };
    }
    return validateRegistryIndex(JSON.parse(text));
  } catch (error) {
    return { index: null, errors: [`registry index unavailable: ${String(error)}`] };
  }
}

export interface DownloadArtifactOptions {
  readonly url: string;
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
  readonly fetchFn: typeof fetch;
}

/**
 * Download an artifact into memory (≤50 MiB by schema cap — acceptable resident cost
 * for an admin-initiated action) and verify size + sha256 BEFORE anything reaches disk.
 */
export async function downloadArtifactBuffer(options: DownloadArtifactOptions): Promise<Buffer> {
  const response = await options.fetchFn(options.url);
  if (!response.ok) throw new Error(`artifact HTTP ${response.status}`);
  const cap = options.expectedSizeBytes;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const body = response.body;
  if (!body) throw new Error("artifact response has no body");
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    // Abort mid-stream the moment the payload exceeds what the index promised.
    if (received > cap) {
      await reader.cancel();
      throw new Error(`artifact exceeds declared size ${cap}`);
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length !== options.expectedSizeBytes) {
    throw new Error(`artifact size ${buffer.length} != declared ${options.expectedSizeBytes}`);
  }
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (sha256 !== options.expectedSha256) {
    throw new Error("artifact sha256 does not match the registry index");
  }
  return buffer;
}
