import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { registerServiceWorker } from "./pwa/register-service-worker";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000
    }
  }
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

registerServiceWorker();

// Dev-only annotation toolbar (agentation): click any UI element to queue structured
// comments (CSS selector + React component name + your note) for the coding agent.
// Dynamic + DEV-guarded so it is NEVER in the production/deploy bundle. Posts annotations
// to the agentation-mcp server on :4747 (see .mcp.json), which the agent reads over MCP.
// Endpoint host is derived from the page host (not hardcoded localhost) so the toolbar
// connects when the app is opened over the LAN (e.g. 192.168.50.36:5173 on this headless
// box) — localhost would resolve to the *client* device and silently fail to connect.
if (import.meta.env.DEV) {
  void import("agentation").then(({ Agentation }) => {
    const mount = document.createElement("div");
    mount.id = "agentation-root";
    document.body.appendChild(mount);
    const agentationEndpoint = `http://${window.location.hostname}:4747`;
    createRoot(mount).render(<Agentation endpoint={agentationEndpoint} />);
  });
}
