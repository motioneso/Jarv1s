# PR #1117 final exact-head live UAT report

## Verdict

**RED** on exact head `f05d977c186b82b31b42b0d6cff3b98bb1d91b47`.

The onboarding destination and narrow Today regression are fixed, but Activity still fails its
normal, delayed-error, and retry-recovery acceptance paths.

## Release blocker

- **Activity remains stuck in loading.** After four seconds, the normal live path still displayed
  loading. A controlled audit-response delay beyond three seconds displayed neither a truthful
  error nor `Try again`. Removing the delay did not recover the view. See screenshots 04–06 and
  sanitized log steps 4–6.

## Positive exact-head evidence

- Fresh onboarding reaches `Jarvis is ready`; visible `Go to settings` lands on `/settings`
  (screenshots 20–21).
- Desktop Today remains correct, and the separately labeled `390x844` Today has a readable stacked
  masthead and lead copy (screenshots 03 and 09).
- Real login reaches Appearance; Teal accent remains independently selectable with both Dark and
  Light document modes (screenshot 07; log steps 7–8).
- News preserves readable article text when images fail (screenshot 12).
- Calendar grant removal/restoration, model default/binding actions, and skill creation succeed
  through live controls (screenshots 13–15).
- Disposable export reaches a ready archive and downloads nonzero bytes (screenshot 22; log step
  23).

## Direct blockers and gaps

- Microphone transcription is blocked by missing transcription-model configuration; Firefox also
  rejected the permission-grant attempt on a secure localhost context (screenshot 10).
- News freeform topics are gated by missing web search, and the live News page exposes no feedback
  controls (screenshots 11–12).
- No email grant control is exposed. The available Calendar access grant was exercised successfully
  (screenshot 13).
- Skill invocation is blocked by the chat's visible no-provider state, despite successful skill
  creation (screenshots 15–16).
- Account deletion reaches both guarded confirmations, then truthfully blocks deletion because the
  account is the instance owner and ownership must be transferred first (screenshots 24–26).

## Deferred lower-severity residual

- Sports still visibly truncates its desktop hero title (screenshot 17).

## Evidence integrity

The completed `run_1` browser flow was not rerun. All screenshots were individually inspected across
the uninterrupted predecessor/current verification. Product code and the PR head were not changed.
The evidence commit excludes the browser script, credentials, provisioner log, downloaded export,
raw action log, and runtime cache.
