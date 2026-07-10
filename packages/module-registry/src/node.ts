// Server-only entry for @jarv1s/module-registry (#917). Everything reachable from
// here may use node:* (fs, crypto). The browser-safe surface stays in ./index.ts.
export * from "./external/hash.js";
