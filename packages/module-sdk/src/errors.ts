// #1110 regression fix: split out of index.ts so @jarv1s/shared can import JarvisError /
// JarvisErrorClass via the ./errors subpath instead of the bare barrel specifier. The barrel's
// module-web-browser-safety walker (tests/unit/module-web-browser-safety.test.ts) resolves bare
// `@jarv1s/*` specifiers to the package's whole `exports["."]` entry, so any type-only
// `export type {...} from "@jarv1s/module-sdk"` reachable from a module's `./web` bundle drags in
// the barrel's rate-limit-key.js/logger.js/route-errors.js re-exports (node:crypto, fastify) too.
// A subpath specifier like `@jarv1s/module-sdk/errors` isn't resolvable by that walker and stays
// invisible to it, matching the existing ai-capabilities.ts leaf pattern. This leaf must stay free
// of node:* and backend-only imports.
export type JarvisErrorClass = "prerequisite" | "transient" | "validation" | "permission" | "bug";

export interface JarvisError {
  readonly code: string;
  readonly class: JarvisErrorClass;
  readonly remediationRef?: string;
}
