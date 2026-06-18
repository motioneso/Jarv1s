# Deploy Readiness RFA Order

Date: 2026-06-18
Purpose: coordinator queue for the remaining `RFA` backlog before treating the Docker install as
ready for real deployment.

## Rule

Do not make every `RFA` issue a deploy blocker.

The shortest useful path is:

1. Land the deploy/security/ops blockers.
2. Run the manual deploy checkpoint in #306.
3. Then continue daily-driver/product capability work.

`#306` is the final gate, not an implementation ticket.

## Phase 0: Final Manual Gate

- `#306` Phase 2 deploy checkpoint and final epic gate

Run only after the prerequisite stack below is ready enough. It validates:

- production compose smoke;
- clean bootstrap;
- reboot survival;
- env/secrets sanity;
- minimal daily-driver walkthrough.

## Phase 1: Do Before Real Deployment

These are the highest-priority agent lanes before calling the Docker install deploy-ready.

1. `#117` Production-safe database role bootstrap passwords
   - Hard deploy/security prerequisite.

2. `#114` Secrets & Vault residuals
   - At-rest secret handling before real use.

3. `#207` Route-local junk-credential rate-limit gates
   - Auth/abuse hardening before exposed deployment.

4. `#123` AI gateway confirmation lifecycle + MCP token launch hardening
   - Tool/action safety before relying on agents.

5. `#230` People/access cleanup + revoke sessions UI
   - Admin account control.

6. `#237` Active sessions list/revoke
   - User/operator session control.

7. `#236` Account card real security state
   - Truthful auth/security UX.

8. `#255` Admin host diagnostics
   - Needed to operate/debug the Docker install honestly.

9. `#254` Connector health monitoring
   - Include before #306 if Google sync/email/calendar are part of acceptance.

## Phase 2: Do Before Daily-Driver Use

Important, but not the shortest path to proving the Docker install works.

10. `#156` Typed instance_settings cleanup
    - Reduces settings/config risk.

11. `#151` Notifications actor-scoped hardening
    - Good before notification features matter.

12. `#250` Quiet hours persistence
    - Needed before proactive/notification behavior feels trustworthy.

13. `#252` AI provider test/model detect
    - Makes AI setup/admin verification usable.

14. `#253` AI capability routing persistence
    - Makes model routing intentional instead of computed-only.

15. `#238` Real data export
    - Important data-rights feature, not required to prove install works.

16. `#239` Self-service account deletion
    - Important account lifecycle feature, not required to prove install works.

## Phase 3: Product Capability After Install Is Proven

These expand usefulness after the deploy foundation is accepted.

17. `#248` Notes folder ingest
18. `#31` Web research capability
19. `#34` Tasks agency tools
20. `#218` Chat thread review
21. `#217` Real weather for Today
22. `#299` Remaining thermo-nuclear residuals

For `#299`, split remaining sub-scopes before dispatch. Pull any residual forward only if it blocks
security, deploy operations, or #306 acceptance.

## Recommended Coordinator Start

Start with Phase 1 as parallel lanes where file overlap allows:

- Security/db/secrets: `#117`, `#114`, `#207`
- AI/action safety: `#123`
- Accounts/sessions: `#230`, `#237`, `#236`
- Ops/health: `#255`, optionally `#254`

Then run #306. If #306 fails, file concrete fix issues instead of expanding this queue.

## Non-Goals

- Do not pull product polish forward just because it is `RFA`.
- Do not close epics based only on code merge; close after #306/manual acceptance.
- Do not build deferred issues without their activation trigger.
