// external-modules/job-search/src/adapters/index.ts
//
// JS-04 (#933): public barrel for the adapters layer. Handlers import from
// here only — individual adapter files stay internal to this directory.
export * from "./board-config.js";
export * from "./fetch-board.js";
export * from "./registry.js";
export * from "./sanitize.js";
export * from "./types.js";
export { ashbyAdapter } from "./ashby.js";
export { greenhouseAdapter } from "./greenhouse.js";
export { leverAdapter } from "./lever.js";
// JS-10 (#1229): broad-discovery seam (sibling to the board adapters above).
export * from "./discovery-types.js";
export * from "./discovery-registry.js";
export * from "./fetch-discovery.js";
export { createFreehireProvider, freehireProvider } from "./freehire.js";
