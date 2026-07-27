// external-modules/job-search/src/domain/seed-prompt.ts
//
// Task 17 (#1301): the seed prompt that frames the module's per-profile chat thread, and the
// hook that binds a profile to that thread the moment the host hands this module a surface.
//
// buildSeedPrompt is pure domain logic (no SDK, no React) and belongs here per the file list.
// useProfileThread does not — it is a React effect, and this file has no other framework
// dependency — but the task's own contract puts both in this one file, and the two are tested
// as a pair (a seed prompt with no caller is dead code, per the task's own constraint), so the
// hook imports its host-react accessors from the web layer's runtime shim rather than living in
// web/ itself. That is a deliberate, narrow exception to this module's domain/worker/web split,
// not a precedent for other domain files to start depending on web/.
import { useEffect, useRef } from "../web/runtime.js";
import type { Profile } from "../web/use-profiles.js";

/**
 * A narrow, LOCAL mirror of the host's real `AssistantSurfaceHandleV1`
 * (apps/web/src/chat/assistant-surface/contracts.ts), holding only the two methods this module
 * calls. Module isolation (CLAUDE.md's hard invariant) means this module never imports host
 * source paths — the host's real handle object satisfies this interface structurally, which is
 * all TypeScript needs, and a test fixture only has to fake two methods instead of the full
 * chat-surface API (Surface, seedComposer, submitTurn, uploadAttachment, subscribeRecords).
 */
export interface AssistantSurfaceHandleV1 {
  /** #1284 semantics apply unmodified here: `null` releases the claim. Call this BEFORE
   * `seedContext` — seeding first frames the drawer instead of this module's own thread, which
   * is the exact leak Ben ruled out. */
  setSurfaceKey(key: string | null): void;
  /** Trust boundary: the seed text this module hands the host enters the model's context with
   * exactly the authority of a user turn — never a system prompt. */
  seedContext(seed: string, idempotencyKey: string): Promise<void>;
}

const SEED_PROMPT_VERSION = "v1";

/** `job-search:${profileId}:v1` — bump the version suffix whenever the prompt text below
 * changes. The host dedupes seedContext calls on this key (chat-session-manager.ts:384), so an
 * existing session keeps whatever text it was framed with until the key changes. */
export function seedIdempotencyKey(profileId: string): string {
  return `job-search:${profileId}:${SEED_PROMPT_VERSION}`;
}

/**
 * Assembled from the profile's own fields only (N4-adjacent: render from records, never model
 * prose) — the only "content" here is the profile's name, echoed back verbatim. Every tool name
 * cited below must exist in the manifest's declared `assistantTools` (N23); nothing else in the
 * stack validates a tool name written in prose, so a rename here fails silently at runtime.
 *
 * Capped at 150 words (guidance-text constraint) and deliberately never tells the model to
 * withhold a capability — this is a full session, not a restricted one.
 */
export function buildSeedPrompt(profile: Profile): string {
  return (
    `You're continuing the job search interview for the profile "${profile.name}". This thread ` +
    `is scoped to that profile alone; nothing you learn here reaches any other conversation. ` +
    `The interview has five steps: role, want, where, comp, and sources. Ask about each in turn, ` +
    `and as soon as the user answers one, record it immediately with job-search.criteria.set ` +
    `instead of repeating it back to them; treat every answer as something to write, not ` +
    `something to remember for later. If the user shares a resume, save its text with ` +
    `job-search.resume.set; job-search.resume.get returns whatever version is currently on ` +
    `file. This is a full session: job-search.profile.set-context, ` +
    `job-search.profile.set-briefing-detail, job-search.portal.set-enabled, ` +
    `job-search.portal.list, and job-search.profile.create are all available whenever they're ` +
    `useful, none of them held back for later.`
  );
}

/**
 * Bind the module's chat surface to the active profile and frame it once.
 *
 * Order matters: `setSurfaceKey` FIRST, because `seedContext` is curried with whatever surface
 * the handle currently holds — seeding first would frame the drawer, exactly the leak Ben ruled
 * out ("if the user is in the job search and they open the drawer, I don't want that job search
 * to show up in the drawer"). `setSurfaceKey(null)` on unmount hands the drawer back — returning
 * it is the shell's job too (Task 2c), but a module that navigates away must not leave the
 * drawer pointed at its own transcript.
 *
 * A `null` profile (loading/empty/onboarding-incomplete... no, ANY null, including simply "no
 * profile selected yet") releases the surface rather than binding one — there is nothing to
 * frame a thread around yet.
 */
export function useProfileThread(
  assistantSurface: AssistantSurfaceHandleV1 | undefined,
  profile: Profile | null
): void {
  const profileId = profile?.profileId ?? null;

  // Latest-profile ref: the effect below keys off profileId alone (a primitive), matching
  // use-profiles.ts's onPollExpiredRef idiom, so a profile object that's re-created every render
  // with the same id doesn't re-bind/re-seed on every keystroke elsewhere in the tree.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!assistantSurface || !profileId) return;
    assistantSurface.setSurfaceKey(profileId);
    const current = profileRef.current;
    if (current) {
      void assistantSurface.seedContext(buildSeedPrompt(current), seedIdempotencyKey(profileId));
    }
    return () => {
      assistantSurface.setSurfaceKey(null);
    };
  }, [assistantSurface, profileId]);
}
