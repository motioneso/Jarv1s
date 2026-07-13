# True YOLO, approval, and menu hardening (#985)

**Status:** Approved by Fable under Ben's delegated authority (2026-07-12)
**Date:** 2026-07-12
**Tier:** security (approval policy and authenticated native-permission surface)
**Builds on:** #510, #622, #578, #681, `2026-06-29-admin-yolo-auto-approval-mode.md`

## Problem

The gateway honors YOLO for registered MCP/module/skill actions, but Claude-native tool permissions
take a separate path that always creates a pending confirmation. That is the root of the dogfood
"YOLO still asks" behavior. Approval cards are visually dominant, and true menus built with
`<details>` or local state do not share reliable dismissal behavior.

## Decisions

1. **True YOLO covers every supported interactive action path.** When the instance master, account
   eligibility, and user's own toggle are all active, no per-action confirmation is shown for an
   action the user is already authorized to perform, including destructive and externally visible
   actions.
2. **YOLO changes confirmation, never capability.** Token validation, tool availability, per-session
   allowlists, input validation, authentication, authorization, RLS, secrets, provider sandboxing,
   and hard platform policy still run before execution. Codex/Gemini/native tools that are disabled
   or read-only remain disabled/read-only.
3. **Reuse the existing effective-YOLO resolver.** The Claude native-permission bridge consults the
   same `yoloMode` dependency already used by `AssistantToolGateway.callTool`. Do not add provider
   bypass flags such as `--dangerously-skip-permissions` and do not create a second YOLO state model.
   Resolution fails closed: an unavailable resolver, thrown error, or any result other than literal
   `true` follows the normal confirmation path and never auto-grants.
4. **Background behavior is unchanged.** Scheduled, briefing, and other non-interactive execution
   retain their current policy. This issue fixes interactive parity only.
5. **Native auto-grants are described truthfully.** The system records that permission was
   auto-granted by YOLO, with actor, request, tool, risk, and safe input summary. It must not claim the
   native tool executed successfully when Jarv1s cannot observe the final provider-side outcome.
   Chat may show "Allowed by YOLO"; it may show "Executed" only from an observed execution result.
6. **YOLO-off approvals explain the consequence.** A visible card names the action, meaningful
   target/consequence, and safe preview where available. Approve is primary; Reject is secondary;
   both are keyboard accessible and restore focus predictably.
7. **Remove per-card `Always approve`.** It is not present in shipped code and must not be added.
   Blanket autonomy belongs to the explicit YOLO setting; a card-level control would create a hidden
   third trust channel alongside `trusted_auto` and YOLO.
8. **True menus share dismissal behavior.** A small shared, dependency-free menu helper/primitive
   closes on outside pointer interaction, Escape, and single-shot selection, then returns focus to
   its trigger. Multi-select menus may stay open while selecting. Disclosure panels such as activity
   and source details are not menus and are excluded.

## Surface matrix

| Surface                              | YOLO behavior                     | Hard boundary retained                                                 |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| MCP/module/skill action gateway      | Existing auto-run path            | token, allowlist, schema, auth/RLS, tool policy                        |
| Claude native interactive permission | Auto-grant through effective YOLO | authenticated permission token, safe tool parsing, provider capability |
| Codex/Gemini native tools            | No new capability                 | current sandbox/read-only/disabled behavior                            |
| Background/scheduled/briefing work   | No change                         | current non-interactive policy                                         |

## Scope and order

### Slice 1 — shared menu behavior (`routine`)

- Inventory true menus only: chat model/feedback, Today feedback, rail/task action menus, and settings
  menus touched by the dogfood pass.
- Reuse one minimal local primitive/hook; add no dependency and do not convert disclosures.
- Add focused pointer, Escape, selection, and focus-return checks.

### Slice 2 — compact approval card (`routine`)

- Apply the content hierarchy in Decision 6 using existing chat tokens/components.
- Do not introduce `Always approve`.

### Slice 3 — native true-YOLO parity (`security`)

- Resolve effective YOLO before creating/waiting on a native confirmation.
- Preserve every trust-boundary check that is independent of confirmation.
- Persist a truthful YOLO auto-grant decision and emit a truthful chat event.
- Test destructive, external, authority-denied, master-off, account-revoked, and normal-confirm paths.

### Slice 4 — acceptance (`security`)

- Verify the surface matrix with supported engines and live chat.
- Confirm no prompt is hidden when YOLO is off and no prompt is generated when effective YOLO is on.
- Run security-tier adversarial QA and require Ben's merge sign-off.

## Likely path locks

- Policy/native bridge: `~/Jarv1s/packages/ai/src/gateway/gateway.ts`,
  `~/Jarv1s/packages/chat/src/mcp-transport.ts`, chat route composition, and focused gateway/transport
  tests.
- Approval UI: `~/Jarv1s/apps/web/src/chat/action-request-card.tsx` and chat styles/tests.
- Menus: the smallest shared UI helper plus only inventoried menu call sites.

Serialize any `chat-drawer.tsx` work with #984. Coordinate settings AI-pane changes with #991 and
settings-shell changes with #986. #979 remains test-only unless transport tests are restructured.

## Non-goals

- Granting a tool, provider, or user authority it does not already have.
- Changing background/autonomous execution policy.
- Per-tool or per-provider YOLO settings.
- A new menu library, design system, or generic overlay framework.
- Converting disclosure panels into dismissible menus.

## Acceptance

- [ ] Effective YOLO remains off by default and enabling it keeps the existing explicit warning.
- [ ] Effective YOLO produces no per-action approval across every supported interactive surface.
- [ ] Claude-native permissions use the same effective state as gateway actions.
- [ ] If effective-YOLO resolution is unavailable, throws, or returns anything other than literal
      `true`, the native bridge shows the normal confirmation and never auto-grants.
- [ ] Unauthorized, unavailable, malformed, or hard-policy-rejected actions still fail normally.
- [ ] Native YOLO records and UI say "allowed" unless final execution is actually observed.
- [ ] With YOLO off, every approval is visible, compact, readable, and keyboard accessible.
- [ ] `Always approve` remains absent.
- [ ] Inventoried menus close on outside interaction, Escape, and selection with correct focus return.
- [ ] Disclosure panels retain their normal expand/collapse behavior.
- [ ] Automated checks cover destructive/external YOLO, native parity, denied authority, normal
      approvals, and menu dismissal.
- [ ] Security-tier QA posts its verdict; Ben explicitly signs off before merge.
