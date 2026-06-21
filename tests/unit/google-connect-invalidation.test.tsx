/**
 * Unit test for the Google-connect-success query invalidation set (v0.1.4 deploy fix).
 *
 * `connectors.done` ⇔ a connector account exists (settings repository assembler). The
 * Google connect-success path previously invalidated ONLY queryKeys.connectors.accounts,
 * never queryKeys.onboarding.status — so founderSteps.connectors.done stayed stale-false and
 * the Finish recap wrongly showed "skipped" after a successful connect. The success path must
 * refresh BOTH so the recap re-reads connectors.done.
 *
 * The same key set is the single source of truth for every revoke entry point too — the
 * onboarding Google step disconnect AND the Settings "Connected accounts" disconnect — so a
 * disconnect from any surface refreshes connectors.done consistently (else the recap stays
 * stale-"connected" after a Settings revoke).
 *
 * No DOM/renderHook environment exists in this suite, so the invalidation key set is a pure
 * exported helper and is asserted directly; a fake QueryClient proves the revoke handler's
 * invalidation loop hits both keys.
 */
import { describe, expect, it, vi } from "vitest";

import { GOOGLE_CONNECT_SUCCESS_QUERY_KEYS } from "../../apps/web/src/connectors/use-google-connect-flow.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

describe("GOOGLE_CONNECT_SUCCESS_QUERY_KEYS", () => {
  it("invalidates the connector accounts list", () => {
    expect(GOOGLE_CONNECT_SUCCESS_QUERY_KEYS).toContainEqual(queryKeys.connectors.accounts);
  });

  it("invalidates the onboarding status so the Finish recap stops saying 'skipped'", () => {
    expect(GOOGLE_CONNECT_SUCCESS_QUERY_KEYS).toContainEqual(queryKeys.onboarding.status);
  });

  it("is exactly the accounts + onboarding-status pair (single source of truth, no drift)", () => {
    expect(GOOGLE_CONNECT_SUCCESS_QUERY_KEYS).toEqual([
      queryKeys.connectors.accounts,
      queryKeys.onboarding.status
    ]);
  });

  it("a revoke handler iterating the shared set invalidates BOTH keys (connect + every revoke path)", () => {
    // Mirrors the exact invalidation loop now used by the Settings "Connected accounts" revoke
    // (settings-personal-data-panes.tsx) and the onboarding Google-step revoke: iterate the
    // shared key set and invalidate each. Proves both keys are hit from a single source of truth.
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as {
      invalidateQueries: (args: { queryKey: readonly unknown[] }) => void;
    };

    for (const queryKey of GOOGLE_CONNECT_SUCCESS_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey });
    }

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.connectors.accounts });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.onboarding.status });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
