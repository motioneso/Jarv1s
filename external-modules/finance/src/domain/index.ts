// external-modules/finance/src/domain/index.ts
//
// FIN-01 (#1146): public barrel for the domain layer. Worker code imports
// from here only — individual domain files stay internal to this directory.
export * from "./errors.js";
export * from "./kv-port.js";
