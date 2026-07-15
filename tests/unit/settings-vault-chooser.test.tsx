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

function renderChooser(
  mode: "notes" | "people",
  current = "",
  roots: Array<{ readonly name: string; readonly path: string }> = []
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    mode === "people"
      ? queryKeys.people.notesDirectories(null)
      : queryKeys.settings.notesSourceDirectories(null),
    { path: null, directories: roots }
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

  it("discovers children for an existing returned People root", () => {
    const html = renderChooser("people", "People", [{ name: "People", path: "People" }]);
    expect(html).toContain("Loading folders");
    expect(html).not.toContain("This folder has no subfolders");
  });

  it("limits Notes recovery to unavailable or truly empty roots", () => {
    expect(shouldShowNotesRootRecovery(undefined, 0)).toBe(true);
    expect(shouldShowNotesRootRecovery(undefined, 1)).toBe(false);
    expect(shouldShowNotesRootRecovery(new ApiError(503, "Notes roots unavailable"), 0)).toBe(true);
    expect(shouldShowNotesRootRecovery(new ApiError(500, "unexpected"), 0)).toBe(false);
  });
});
