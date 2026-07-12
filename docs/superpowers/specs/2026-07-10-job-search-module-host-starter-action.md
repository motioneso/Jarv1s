# External module host starter action — narrow #916 design

**Status:** Draft — Fable-approved scope; pending Ben's final sign-off

**Date:** 2026-07-10

**Owner:** Ben

**GitHub:** #916, prerequisite for #913

**Grounding:** grounded on `eafa22dd`

---

## Goal

Let an enabled external module ask the Jarv1s web host to open the existing assistant with a stable,
module-authored starter prompt. This is the one generic seam required for job search's one-click
conversational onboarding. It does not embed a chat runtime in the module and contains no
job-search-specific behavior in core.

## Contract

External web contract v1 gains one host action exposed through the existing frozen module runtime:

```ts
interface ExternalModuleHostActionsV1 {
  openAssistant(input: { starterPrompt: string }): void;
}
```

The external module calls the action from a user gesture. The host validates and caps the prompt,
opens the existing Jarv1s assistant surface, and inserts the prompt as an editable draft. The user
submits it; the host action does not silently send a message or execute a tool.

The host binds the calling module id from the loaded contribution. The action is available only
while that external module remains installed, enabled, compatible, and active for the actor. A
disabled/hash-drifted module receives no usable action.

## Safety and privacy

- The starter prompt is static package-authored copy, not resume/profile/job content and not a
  credential.
- Prompt maximum length and character validation are enforced by the host; invalid input fails
  closed without opening the assistant.
- The host treats the prompt as module-authored context, never as authority to bypass confirmation,
  tool permissions, or `AssistantToolGateway`.
- No new persistence, migration, route, provider/model selection, or direct Chat-module import is
  added to the external package.
- The host action never sends private data to a model. Normal chat submission and configured AI
  disclosure begin only after the user reviews and submits the draft.

## Web behavior

The module's “Continue with Jarv1s” button invokes `openAssistant` with a stable onboarding prompt.
On success, focus moves to the assistant composer with the editable draft visible. If the host
action is unavailable, the button shows a clear unavailable state; it does not fall back to a
second chat implementation or direct URL hack.

## Verification

- Enabled fixture module opens the assistant with the exact editable starter draft.
- No message is submitted and no tool executes until the user submits.
- Disabled, inactive, incompatible, malformed, or hash-drifted modules cannot invoke the action.
- Oversize/invalid prompts fail closed.
- Module id is host-bound; one module cannot impersonate another.
- Existing risk, confirmation, audit, and tool-allowlist behavior is unchanged after submission.
- Keyboard activation and focus transfer satisfy accessibility basics.
- Browser bundle still uses the host React instance and imports no Node/server code.

## Explicit non-goals

- No Briefings-capable runtime dispatch in #916 or the job-search MVP.
- No generic deep-link/navigation framework.
- No automatic message submission, background conversation, or always-running agent.
- No module-authored system prompt or ability to alter the assistant's trusted instruction prefix.
- No job-search-specific prompt or action in core.

## Build gate

#916 must be narrowed to this host action. It stays `needs-spec` and no build begins until Ben gives
final spec sign-off. Briefings dispatch may receive a separate future spec/task when product scope
requires it.
