// JS-06 (#935): unit-test twin of installModuleHostRuntime (apps/web
// external-modules/loader.ts) — the external web source captures the runtime
// global at import time, so this module must be imported before any module
// web file in a test's import list (ESM evaluation order guarantees it).
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";

const scope = globalThis as { __JARVIS_MODULE_RUNTIME__?: unknown };
if (!scope.__JARVIS_MODULE_RUNTIME__) {
  scope.__JARVIS_MODULE_RUNTIME__ = Object.freeze({
    contractVersion: 1,
    react: React,
    reactDomClient: ReactDOMClient
  });
}
