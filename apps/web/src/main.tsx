import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { registerServiceWorker } from "./pwa/register-service-worker";
import "./styles/tokens.css";
import "./styles.css";
import "./tasks/tasks.css";

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
if (import.meta.env.DEV) {
  void import("agentation").then(({ Agentation }) => {
    const mount = document.createElement("div");
    mount.id = "agentation-root";
    document.body.appendChild(mount);
    createRoot(mount).render(<Agentation endpoint="http://localhost:4747" />);
  });
}
