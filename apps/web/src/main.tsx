import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { ErrorBoundary } from "./shell/error-boundary";
import { registerGlobalErrorHandlers } from "./shell/global-error-handler";
import { registerServiceWorker } from "./pwa/register-service-worker";
import "./styles/index.css";

// Global error capture (#413): wire window.onerror + unhandledrejection BEFORE
// createRoot so a boot-time crash (before React mounts) is still reported to
// /api/errors. The reporter is fire-and-forget and never throws.
registerGlobalErrorHandlers();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000
    }
  }
});

// ---------------------------------------------------------------------------
// PROTOTYPE ROUTE — THROWAWAY. Delete this block together with
// apps/web/src/job-search-prototype/ once the job-search layout question is settled.
//
// Mounted here rather than as a react-router route because App() calls its hooks before a
// chain of early returns (auth, onboarding, fatal state), so a prototype branch inside it
// would still require a session. Intercepting at the root gives a bare page with no auth,
// no shell and no API calls. DEV-guarded, and the import is dynamic, so none of it reaches
// a production bundle.
// ---------------------------------------------------------------------------
const isPrototypeRoute =
  import.meta.env.DEV && window.location.pathname.startsWith("/prototype/job-search");

if (isPrototypeRoute) {
  void import("./job-search-prototype/prototype-page").then(({ JobSearchPrototype }) => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <StrictMode>
        <JobSearchPrototype />
      </StrictMode>
    );
  });
} else {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>
  );

  registerServiceWorker();
}

// Dev-only annotation toolbar (agentation): click any UI element to queue structured
// comments (CSS selector + React component name + your note) for the coding agent.
// Dynamic + DEV-guarded so it is NEVER in the production/deploy bundle. Posts annotations
// to the agentation-mcp server on :4747 (see .mcp.json), which the agent reads over MCP.
// Endpoint host is derived from the page host (not hardcoded localhost) so the toolbar
// connects when the app is opened over the LAN (e.g. 192.168.x.x:5173 on a headless
// box) — localhost would resolve to the *client* device and silently fail to connect.
if (import.meta.env.DEV) {
  void import("agentation").then(({ Agentation }) => {
    const mount = document.createElement("div");
    mount.id = "agentation-root";
    document.body.appendChild(mount);
    const agentationEndpoint = `http://${window.location.hostname}:4747`;
    createRoot(mount).render(<Agentation endpoint={agentationEndpoint} onCopy={legacyCopy} />);
  });
}

// navigator.clipboard only exists in secure contexts (HTTPS or localhost), so the
// toolbar's built-in copy silently fails when the app is opened over plain-HTTP LAN.
// execCommand("copy") still works there.
function legacyCopy(markdown: string): void {
  const textArea = document.createElement("textarea");
  textArea.value = markdown;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}
