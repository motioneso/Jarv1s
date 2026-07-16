import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteCustomTheme,
  listThemes,
  putCustomTheme,
  setActiveTheme,
  setColorMode
} from "../../apps/web/src/api/client.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

describe("theme API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the settings themes query key", () => {
    expect(queryKeys.settings.themes).toEqual(["settings", "themes"]);
  });

  it("calls theme endpoints with expected methods", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await listThemes();
    await setActiveTheme({ id: "my-blue" });
    await setColorMode({ mode: "dark" });
    await putCustomTheme("my blue", { name: "My Blue" });
    await deleteCustomTheme("my blue");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/me/themes",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/themes/active",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ id: "my-blue" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/me/themes/mode",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ mode: "dark" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/me/themes/my%20blue",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "My Blue" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/me/themes/my%20blue",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
