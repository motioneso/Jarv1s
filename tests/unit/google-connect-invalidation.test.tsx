/**
 * Unit test for the Google-connect-success query invalidation set (v0.1.4 deploy fix).
 *
 * `connectors.done` ⇔ a connector account exists (settings repository assembler). The
 * Google connect-success path previously invalidated ONLY queryKeys.connectors.accounts,
 * never queryKeys.onboarding.status — so founderSteps.connectors.done stayed stale-false and
 * the Finish recap wrongly showed "skipped" after a successful connect. The success path must
 * refresh BOTH so the recap re-reads connectors.done.
 *
 * No DOM/renderHook environment exists in this suite, so the invalidation key set is a pure
 * exported helper and is asserted directly.
 */
import { describe, expect, it } from "vitest";

import { GOOGLE_CONNECT_SUCCESS_QUERY_KEYS } from "../../apps/web/src/connectors/use-google-connect-flow.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

describe("GOOGLE_CONNECT_SUCCESS_QUERY_KEYS", () => {
  it("invalidates the connector accounts list", () => {
    expect(GOOGLE_CONNECT_SUCCESS_QUERY_KEYS).toContainEqual(queryKeys.connectors.accounts);
  });

  it("invalidates the onboarding status so the Finish recap stops saying 'skipped'", () => {
    expect(GOOGLE_CONNECT_SUCCESS_QUERY_KEYS).toContainEqual(queryKeys.onboarding.status);
  });
});
