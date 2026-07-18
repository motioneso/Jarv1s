import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDebouncedPageContextSync } from "../../apps/web/src/chat/use-page-context-sync.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("debounces repeated changes into one snapshot upload", async () => {
  const upload = vi.fn().mockResolvedValue(undefined);
  const sync = createDebouncedPageContextSync({
    capture: () => ({ route: "/news" }) as never,
    upload,
    delayMs: 250
  });
  sync.schedule();
  sync.schedule();
  await vi.advanceTimersByTimeAsync(249);
  expect(upload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(upload).toHaveBeenCalledTimes(1);
  sync.stop();
});
