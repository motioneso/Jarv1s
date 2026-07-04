import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PrioritySettings } from "@jarv1s/settings-ui";

describe("PrioritySettings", () => {
  it("renders its loading state inside a query client", () => {
    const queryClient = new QueryClient();

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <PrioritySettings />
      </QueryClientProvider>
    );

    expect(html).toContain("Loading priority settings");
    expect(html).toContain("pane__title");
    expect(html).toContain("pane__card");
    expect(html).not.toContain('class="loading"');
  });
});
