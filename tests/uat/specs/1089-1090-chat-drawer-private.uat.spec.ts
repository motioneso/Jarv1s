import { test } from "@playwright/test";

// #1089/#1090: lightest level — neither scenario below currently runs (see the fixme reasons),
// so there is no seeded feature data to provision.
export const uatLevel = { level: "solo-admin", without: [] } as const;

// #1089/#1090 harness-fit note (flagged to team-lead per the Lane E brief's explicit fallback:
// "can't run harness -> add spec + manual dev proof and flag it"):
//
// Both scenarios below are blocked from running for real against this harness, for two
// DIFFERENT structural reasons — neither is a Lane E code defect:
//
// 1. "activate-private -> immediate-turn no race" (#1089) needs to prove an ORDERING invariant:
//    the UI must not flip `privateMode`/allow a send until POST /api/chat/clear resolves. Per
//    tests/uat/specs/job-search-install.uat.spec.ts's own comment, this harness's config has
//    "no webServer/mocks" by design (prod-shaped, real network only) — there is no way to inject
//    response latency on the real backend to force the race window open. Against a real, fast
//    local network, clearChat and the state flip can both land inside one tick with no
//    observable intermediate state, so a real-network run could stay green even if the ordering
//    regressed. Timing-control requires a mocked transport; the harness's own design spec
//    (docs/superpowers/specs/2026-07-12-dev-uat-harness.md) reserves it for data-flow-tier bugs
//    and explicitly defers UI-shape/ordering regressions like this one to tests/e2e/*.
//
// 2. "resume-saved-thread-while-private -> banner/state correct" (#1090) needs an EXISTING
//    persisted (non-incognito) chat thread to resume into. Nothing in tests/uat/seed provisions
//    one: there is no "chat" entry in UatSeedChunk (tests/uat/seed/types.ts), and the only seeded
//    AI provider/model (tests/uat/seed/chunks/ai.ts's seedAiProviderChunk) is a deliberately fake
//    provider bound solely to `module.news` capability — no seed level can drive a real chat turn
//    to create a thread, and adding a "chat" seed chunk / wiring a real chat-capable engine into
//    the harness is shared seed infrastructure outside this lane's scope (cross-cuts other
//    in-flight lanes' owned seed files).
//
// Concrete proof in the meantime: tests/e2e/chat-drawer.spec.ts's
// "private activation blocks send until the server confirms, then allows it" (#1089, pre-existing,
// annotated with this issue's citation) and "resuming a History thread while private clears the
// stale privateMode flag" (#1090, added by this PR) — both drive the real UI component against a
// mocked REST layer, which is exactly the tool needed to control timing/seed a resumable thread
// deterministically. See docs/coordination/handoff-efg-frontend-lanes.md Lane E for the brief that
// permits this fallback.

test.fixme("activate-private blocks a turn until the server confirms, no race (#1089)", async () => {
  // Blocked: this harness has no mocked transport to force the clearChat response to lag
  // behind the state flip (see file header, reason 1). Real proof: tests/e2e/chat-drawer.spec.ts.
});

test.fixme("resuming a History thread while private clears the stale privateMode flag (#1090)", async () => {
  // Blocked: no seed level provisions a persisted chat thread or a chat-capable AI provider
  // (see file header, reason 2). Real proof: tests/e2e/chat-drawer.spec.ts.
});
