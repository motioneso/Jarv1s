import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { AiProvidersPane } from "../../apps/web/src/settings/settings-ai-admin-pane.js";
import { FeedbackProvider } from "../../apps/web/src/settings/settings-feedback.js";

function renderWithQuery(node: React.ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(FeedbackProvider, null, node))
  );
}

describe("AiProvidersPane", () => {
  it("has no Embeddings group, provider/model controls, or stub copy (#1182)", () => {
    const html = renderWithQuery(createElement(AiProvidersPane));

    expect(html).not.toContain("Embeddings");
    expect(html).not.toContain("stub");
    expect(html).not.toContain('aria-label="Embedding provider"');
    expect(html).not.toContain('aria-label="Embedding model"');
    expect(html).not.toContain("Embedding provider saved");
    expect(html).not.toContain("Embedding model saved");
  });
});
