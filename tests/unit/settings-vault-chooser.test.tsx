import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { ApiError } from "../../apps/web/src/api/client.js";
import {
  shouldShowNotesRootRecovery,
  VaultChooser
} from "../../apps/web/src/settings/settings-vault-chooser.js";

function renderChooser(mode: "notes" | "people", current = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    mode === "people"
      ? queryKeys.people.notesDirectories(null)
      : queryKeys.settings.notesSourceDirectories(null),
    { path: null, directories: [] }
  );
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(VaultChooser, { mode, current, onCancel: () => {}, onChoose: () => {} })
    )
  );
}

describe("VaultChooser trust boundaries", () => {
  it("does not render a raw server-path input", () => {
    const html = renderChooser("notes");
    expect(html).not.toContain("Type a path on the server");
    expect(html).not.toContain('placeholder="/data/external-notes"');
  });

  it("keeps the recommended People destination selectable before creation", () => {
    const html = renderChooser("people");
    expect(html).toContain("People");
    expect(html).toContain("Use this folder");
    expect(html).not.toContain("Loading folders");
  });

  it("recognizes the real Notes-root 503 for deployment recovery", () => {
    expect(shouldShowNotesRootRecovery(new ApiError(503, "Notes roots unavailable"))).toBe(true);
    expect(shouldShowNotesRootRecovery(new ApiError(500, "unexpected"))).toBe(false);
  });
});
