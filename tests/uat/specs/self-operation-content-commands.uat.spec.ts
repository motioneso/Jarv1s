import { test } from "@playwright/test";

// #1265: neither scenario below currently runs (see the fixme reasons), so there is no extra
// seed data to provision beyond the default admin+data ladder (news + sports chunks included).
export const uatLevel = { level: "admin+data", without: [] } as const;

// #1265 harness-fit note, same shape as tests/uat/specs/1089-1090-chat-drawer-private.uat.spec.ts:
//
// The approved spec's exit criterion
// (docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md) wants a real
// chat turn: "add a topic for local climate policy to my news" / "Follow the Yankees" / "Stop
// following that source" -> each executes with NO confirmation card, proven end to end against a
// real dev instance. That cannot run for real against THIS harness, for one structural reason:
//
// Driving any of those sentences requires a real model to read the sentence and CHOOSE to call
// the right tool. tests/uat/seed/chunks/ai.ts's seedAiProviderChunk seeds only a deliberately fake
// "UAT Fake Provider" / "UAT Fake JSON Model" bound to `module.news` json capability alone (never
// a real credential — see its own comment) purely to stop the news settings surface 503ing. There
// is no chat-capable entry in UatSeedChunk (tests/uat/seed/types.ts) and tests/uat/provisioner.ts
// stays credential-free by design, so no seed level can make a real model interpret free text and
// invoke sports.followTeam / news add-topic / news unfollow. This is model behavior, not a trust
// boundary the harness owns — tracked by #1121 (reopened by the #1265 coordinator with this
// evidence after it was found closed with the work never done; treat it as reopened-and-open, not
// as the closed issue the older fixmes in this repo still cite).
//
// The security property this spec's exit criterion actually cares about — that a granted tool
// executes without a confirmation card appearing anywhere — is proven in two other places instead:
//
// 1. Backend: which record kind ("action_result" vs "action_request") a self-operation-granted
//    tool emits is proven against a REAL DB + real AssistantToolGateway in
//    tests/integration/mcp-gateway-self-operation.test.ts ("first use after install grant runs
//    without an action card", "install grants for the sports module let sports.followTeam run
//    without an action card").
// 2. Frontend: given those exact record kinds, the UI withholds the card for a self-operation
//    action_result while still rendering one for a tool that needs confirmation, proven with a
//    mocked SSE transport (the same tool this harness cannot use for timing/scripting reasons) in
//    tests/e2e/self-operation-no-confirmation-card.spec.ts — verified mutation-tight by hand:
//    removing the frontend's action_result/action_request discrimination makes that test fail.
//
// Neither proof drives the actual natural-language decision a real model makes. That leg needs a
// hands-on LAN pass against a real chat-capable provider; it is not something this PR's automated
// gate can certify, and the PR body says so plainly rather than claiming the exit criterion met.

test.fixme("adding a news topic by chat executes with no confirmation card (#1265, #1121)", async () => {
  // Blocked: no seeded chat-capable AI provider can interpret "add a topic for local climate
  // policy to my news" and choose to call the news add-topic tool (see file header). Backend
  // proof: tests/integration/mcp-gateway-self-operation.test.ts. Frontend proof:
  // tests/e2e/self-operation-no-confirmation-card.spec.ts.
});

test.fixme('"Follow the Yankees" executes with no confirmation card (#1265, #1121)', async () => {
  // Blocked: no seeded chat-capable AI provider can interpret "Follow the Yankees" and choose to
  // call sports.followTeam (see file header). Backend proof:
  // tests/integration/mcp-gateway-self-operation.test.ts ("install grants for the sports module
  // let sports.followTeam run without an action card"). Frontend proof:
  // tests/e2e/self-operation-no-confirmation-card.spec.ts.
});

test.fixme('"Stop following that source" (unfollow) executes with no confirmation card (#1265, #1121)', async () => {
  // Blocked: no seeded chat-capable AI provider can interpret an unfollow request and choose
  // the right tool (see file header). Frontend proof (differential card rendering):
  // tests/e2e/self-operation-no-confirmation-card.spec.ts.
});
