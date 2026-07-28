# Spec review log — #1270 provider sign-in shared surface

- **Spec:** `docs/superpowers/specs/2026-07-27-1270-provider-signin-shared-design.md`
- **Builder:** Claude (Opus 5)
- **Critic:** Codex `gpt-5.6-sol` at `high` reasoning, read-only sandbox, thread
  `019fa51b-7048-7d62-9781-0de64dfe2804`
- **Grounded on:** `main` @ `73e50847`. Tree verified unchanged after each Codex round.
- **MAX_ROUNDS:** 5

---

## Round 1 — Codex — VERDICT: REVISE

Eleven findings. Claude independently verified nine against the source before acting; the remaining
two were corroborated by code read while checking the others. **All eleven were accepted.** Two were
more serious than the critique stated.

1. **Persisted `ready` is not proof of authentication.** `onboarding-install.ts:174` surfaces
   persisted state directly ("no probe, no write"), and `ready` is written only when a login settles
   — so expired credentials stay `ready` indefinitely. Labelling that "Signed in" reintroduces the
   very overclaim the spec set out to remove.
2. **Owner gate vs. admin visibility mismatch.** Login routes call `assertBootstrapOwnerAdminUser`
   (`onboarding-routes.ts:717`), but the AI pane renders for any `isInstanceAdmin`
   (`settings-page.tsx:290`). Non-owner admins would get controls that always 403.
3. **Provider-kind vocabularies do not line up.** Settings creates catalog entries with
   `authMethod: "cli"` for kinds with no CLI login adapter; "unreachable by construction" was wrong.
4. **The status endpoint cannot supply settings.** `ONBOARDING_LOGINABLE_PROVIDER_KINDS = ["anthropic"]`
   (`repository.ts:131`) — the response projects Anthropic only, by design.
5. **"Move it whole" conflicts with embedding in the settings action row.** The onboarding card owns
   its own tile chrome (`cli-auth-step.tsx:264-292`: `onb-cli`, radio, name, detect badge), so it
   cannot nest inside the settings provider card without duplicated chrome.
6. **`cancel` cannot "move verbatim".** The client has install/begin/submit/poll only
   (`onboarding-connect-client.ts`); no browser caller invokes the cancel route. It is new code.
7. **No poll cleanup on unmount.** `pollLoop` (`cli-auth-step.tsx:126`) is fire-and-forget. A
   settings pane can unmount at any time, stranding the instance-wide login slot until the 10-minute
   server timeout (`login-service.ts:83`).
8. **The submit shape was stated wrongly.** The frozen contract (`…login-contract.md:555`) says
   `submit-token` returns `{ providerKind, loginId, status, installState, message? }` — no
   `authorizationUrl`, no `userCode`. The spec said "same shape" and specified a UI test for an input
   the contract makes impossible.
9. **Two more false claims beyond the badge.** `settings-ai-admin-pane.tsx:293` states "Signed in via
   the … CLI" unconditionally, and `:298` is a **Re-authenticate button whose entire handler is a
   success toast** — it authenticates nothing and reports success.
10. **The CSS surface is larger than 19 rules.** The card also renders `onb-cli`, `onb-cli__*`, and
    `onb-detect*` (`onboarding-design.css:246`, `:320`).
11. **One flow per config is wrong.** Settings renders per configuration, configurations are not
    unique by kind, but the login session and persisted lifecycle are instance-global per kind.

### Claude's response

Accepted all eleven. Three of the fixes were **refined rather than taken as proposed**, and the
review surfaced one thing neither party had stated:

- **On (1) and (4)** Codex proposed either a fresh probe or an "unverified" caveat, and separately
  called the status projection an invalid general provider-status API. Both point at the same
  existing route: `POST /api/onboarding/provider-check` is a live presence/auth probe, per-provider,
  any kind, already owner-gated (`onboarding-routes.ts:593`). Adopted as the state source (D4), with
  the stronger rule that no positive authentication claim may ever come from persisted state (D3).
  This keeps "no backend change" true.
- **On (3) and (11)** two separate fixes were proposed (a safe kind mapping; render per kind). One
  rule subsumes both: read loginability from the server's existing gate, which already returns a
  redacted `blockedReason` (`onboarding-routes.ts:262`), and render once per loginable kind (D9, D7).
  A hardcoded frontend list would drift the day a provider becomes loginable.
- **On (5)** the finding reverses decision D2 as originally written. Accepted: the shared piece is
  the sign-in **flow and controls**, and card chrome stays caller-owned. This still satisfies the
  owner's constraint — the flow exists once and both surfaces call it — the original cut line was
  simply in the wrong place.
- **Escalated beyond the finding:** the reason the status route projects Anthropic only is that
  Codex (`openai-compatible`) headless login **cannot complete on a server and bricked chat via the
  single-active gate during the v0.1.2 live test** (`repository.ts:120-130`). Neither the spec nor
  the critique said this. It scopes the feature: settings sign-in covers Claude; Codex re-auth stays
  in the terminal until its headless login is real. Recorded in Context and Non-goals, and flagged to
  the owner as a scope change rather than absorbed silently.

Spec rewritten: three defects instead of two, decisions D7–D10 added, D2/D3/D4 revised, contract
shapes quoted verbatim instead of paraphrased, cleanup ownership and the CSS split made explicit,
and the HIGH-2 test moved to the service/route boundary where it is actually enforceable.

---

## Round 2 — Codex — VERDICT: REVISE

Nine findings. Codex first confirmed the `provider-check` refinement holds: the route is owner-gated
before execution (`onboarding-routes.ts:603`), accepts all three onboarding kinds (`:868`), and drives
a live CLI presence/auth probe (`packages/chat/src/live/provider-probe.ts:26-31`). All nine findings
were verified and **accepted**. One of them overturns a conclusion Claude had already reported.

1. **Codex is NOT server-blocked — the round-1 escalation was wrong.** ✅ **Overturns round 1.**
   Loginability derives from adapter presence alone (`onboarding-login.ts:72-80`); the Codex adapter
   is present and passes load validation (`login-adapters.ts:160-174`), so `provider-login/begin`
   accepts Codex today. Only `google` (no adapter) is rejected.
   `ONBOARDING_LOGINABLE_PROVIDER_KINDS` is a **presentation filter**, not a gate.
2. **The loginability verdict is not readable from a browser.** `ProviderLoginabilityPort` is an
   internal injected function (`onboarding-routes.ts:262`), not an HTTP route — reachable only by
   calling the _mutating_ begin route, which immediately persists `needs_login` and starts a flow
   (`:718`). D9 as written was unimplementable.
3. **The `blockedReason` path is not owner-gated.** Loginability is checked at `:712`, before
   `assertBootstrapOwnerAdminUser` at `:717`.
4. **Codex out + "show the device code" is self-contradictory.** Anthropic is paste-mode
   (`login-adapters.ts:147-153`); Codex is the only code-producing flow (`:160-172`). With Codex out
   of scope, no live provider can satisfy that exit criterion.
5. **"Once per kind" is undefined inside per-configuration cards.** Two Anthropic configurations
   leave it ambiguous which card owns the single control; choosing the first makes placement depend
   on list order.
6. **Moving `provider-connect-machine.ts` whole contradicts the D2 reversal.** Its `deriveCardModel`
   consumes `installable`, `installState`, and `installing` (`:62`, `:84`, `:89`) — the exact card
   concerns D2 leaves caller-owned.
7. **`not_installed` cannot be repaired by the sign-in button.** `begin` installs nothing (`:718`).
8. **No probe invalidation after a flow settles** — settings would keep showing "Sign-in expired"
   after a successful sign-in. Onboarding already refreshes (`cli-auth-step.tsx:113`, `:138`).
9. **A point-in-time positive label goes stale while the pane stays mounted**, recreating the D3
   overclaim slowly.

### Claude's response

Finding 1 is the one that matters, and it is a **correction of Claude's own round-1 escalation**, not
of Codex's. Round 1 reported that the server independently 400s Codex. It does not. Verified by
reading the adapter registry and the loginability port directly, and settled by history:

| Date       | Commit     | What happened                                                                                                                                             |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-21 | `3c8dc386` | Codex hidden from onboarding (v0.1.3) — its `localhost:1455` OAuth callback cannot be reached headlessly, and it bricked chat via the single-active gate. |
| 2026-06-23 | `bad9c75b` | `fix(cli-runner): use Codex device auth` — switched to `--device-auth`, **fixing exactly that defect**.                                                   |

The hide predates the fix by two days and was never revisited. So the honest position is not "Codex
is impossible" but "the filter is probably stale, and only a live proof settles it." That is an owner
decision, not a spec decision — and because it determines whether Goal 3 has any live provider
(finding 4) and what exit criterion 2 can assert, **it blocks planning**. Escalated rather than
decided.

Refinements rather than straight adoption:

- **On (2)** Codex offered "add a read-only loginability endpoint (revising D6) or use the projected
  list". Took the second: the projected provider list (`repository.ts:789`) is the one server-owned
  kind list a browser can read, and it holds D6 (no backend change). Useful consequence — admitting
  Codex becomes a one-constant server change rather than UI work.
- **On (5)** adopted the stronger form: a separate owner-only "CLI sign-in" section per eligible kind,
  outside the configuration cards. The cards still lose their three false claims.
- **On (7)** kept installing caller-owned rather than folding it into the shared flow, which would
  re-break the D2 boundary that finding 6 protects.

Decisions added: D11 (blocked-verdict gate not claimed), D12 (probe invalidation on every terminal
outcome), D13 (bounded label freshness + "checked at"). Revised: D7, D9, the architecture split, the
state map, and exit criteria 2/6/8.

### Loop stopped at round 2 of 5

Not because the spec converged — because the remaining disagreement is not resolvable by review.
Findings 1, 4, and 5 all reduce to one product question neither model can answer, and further rounds
would re-litigate a premise the owner has not ruled on. This repo has a recorded history of Codex
review loops failing to converge because each rewrite creates new surface (5→4→4→6 blockers over six
rounds); stopping at a genuine blocker is the intended exit, not a concession.
