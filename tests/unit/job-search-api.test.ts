import { afterEach, expect, it, vi } from "vitest";
import { invokeTool } from "../../external-modules/job-search/src/web/api.js";

afterEach(() => vi.unstubAllGlobals());

it("coalesces identical read-tool calls already in flight", async () => {
  let finishRequest: ((response: unknown) => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        finishRequest = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);

  const first = invokeTool("job-search.matches.list", { profileId: "p1", limit: 25 });
  const duplicate = invokeTool("job-search.matches.list", { profileId: "p1", limit: 25 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  finishRequest?.({
    ok: true,
    status: 200,
    json: async () => ({ invocation: { status: "succeeded", result: { items: [] } } })
  });
  await expect(Promise.all([first, duplicate])).resolves.toEqual([{ items: [] }, { items: [] }]);
});
