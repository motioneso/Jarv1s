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
 * (apps/web/src/chat/assistant-surface/contracts.ts), holding only the four members this module
 * uses: the two thread-binding methods below, the `Surface` view component onboarding.tsx
 * (Task 19/#1303, widened for #1331) renders, and `submitTurn` (widened for Task 20/#1304's
 * Discuss action). Module isolation (CLAUDE.md's hard invariant) means this module never imports
 * host source paths — the host's real handle object satisfies this interface structurally, which
 * is all TypeScript needs, and a test fixture only has to fake four members instead of the full
 * chat-surface API (seedComposer, uploadAttachment, subscribeRecords are still omitted — nothing
 * here calls them).
 */
export interface AssistantSurfaceHandleV1 {
  /** #1284 semantics apply unmodified here: `null` releases the claim. Call this BEFORE
   * `seedContext` — seeding first frames the drawer instead of this module's own thread, which
   * is the exact leak Ben ruled out. */
  setSurfaceKey(key: string | null): void;
  /** Trust boundary: the seed text this module hands the host enters the model's context with
   * exactly the authority of a user turn — never a system prompt. */
  seedContext(seed: string, idempotencyKey: string): Promise<void>;
  /**
   * The host's real chat-surface view component
   * (`apps/web/src/chat/assistant-surface/surface.tsx`), already curried by the host with
   * whatever surface `setSurfaceKey` last bound (handle.ts:59-62) — this module never passes a
   * `surface` key of its own. Typed `unknown`, like every other component reference this module
   * touches (runtime.ts's `HostReact.createElement`), because the module carries no React types
   * at all; render it with `h(Surface, props)` and let the structural check at that `h()` call
   * stand in for a real `ComponentType`. `props` is a plain object shaped like the host's
   * `AssistantSurfaceViewProps` (contracts.ts) — pass at least `{ composer: {} }`, since
   * `AssistantSurface` renders no input box whatsoever when `composer` is absent.
   */
  readonly Surface: unknown;
  /**
   * Task 20/#1304: Discuss's write to the model. `controlContext` accepts exactly three top-level
   * keys — `step`, `action`, `values` (`packages/chat/src/live/prompt-safety.ts`'s
   * `MODULE_CONTROL_KEYS`) — anything else is silently dropped, never rejected, so a typo here
   * fails quietly rather than loudly. The whole filtered object is capped at 8192 bytes; over that,
   * core rejects the entire turn, not just the oversized key. Untyped beyond `Record<string,
   * unknown>` for the same reason `Surface` is `unknown`: this module carries no host types, and
   * `discuss.tsx`'s own header documents exactly what this module puts in `values`.
   */
  submitTurn(input: {
    readonly text: string;
    readonly controlContext?: Record<string, unknown>;
    readonly attachmentIds?: readonly string[];
  }): Promise<void>;
}

// v2: names the wantNarrative field and the fact that role+want+sources gate the crawl. A live run
// answered every question, had all five chips lit except "want", and sat stopped forever — the model
// had put the person's own words into mustHave, which is a filter, not the Want sentence.
// v3: asks for the résumé outright instead of waiting to be handed one. A live run finished the
// whole interview, crawled, and scored with zero résumé rows on file — every Fit reason on the
// board read "the résumé is entirely blank", and the numbers beside them ranged 5 to 78 on
// identical evidence. Fit has nothing to judge without it, so the interview has to ask.
// v4: record what has already been said BEFORE asking anything. v3 said "ask each in turn", and a
// live run took that literally — the user opened with every answer in one message and an explicit
// "don't ask me anything else first", and the model called criteria.set with an empty object,
// showed "Resolved.", then began "Step 1 of 5 — Role" and asked for the job titles it had just
// been given. Nothing was saved.
const SEED_PROMPT_VERSION = "v4";

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
    `is scoped to that profile alone. ` +
    `Five things are needed: role, want, where, comp, sources. The search stays stopped until ` +
    `role, want and sources are recorded, and "want" means the criteria field wantNarrative in ` +
    `their own words — filling mustHave instead leaves it undone. Before asking anything, write ` +
    `down everything they have already told you with job-search.criteria.set; send only the ` +
    `fields you are setting, never an empty object. Then ask only for what is still missing, one ` +
    `at a time, saving each answer the moment it arrives rather than repeating it back. Ask them ` +
    `to paste their resume too and save it with job-search.resume.set — Fit has nothing to judge ` +
    `against without one. ` +
    `This is a full session: job-search.resume.get, job-search.profile.set-context, ` +
    `job-search.profile.set-briefing-detail, job-search.portal.set-enabled, ` +
    `job-search.portal.list, and job-search.profile.create are all available whenever they're ` +
    `useful.`
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
  // Bind by surfaceKey, not profileId (Task 17/#1301's own constraint): the row id and the
  // thread identity are deliberately independent, so a profile's thread can be rotated without
  // touching the record. Binding by profileId instead would compile, pass every unit test, and
  // quietly remove that independence — the exact deviation this fixes.
  const profileId = profile?.profileId ?? null;
  const surfaceKey = profile?.surfaceKey ?? null;
  // idempotencyKey stays keyed on profileId, not surfaceKey — it identifies which profile's
  // seed text this is, independent of which thread currently carries it.
  const idempotencyKey = profileId ? seedIdempotencyKey(profileId) : null;

  // Latest-profile ref: the effect below keys off surfaceKey/idempotencyKey alone (primitives),
  // matching use-profiles.ts's onPollExpiredRef idiom, so a profile object that's re-created
  // every render with the same id doesn't re-bind/re-seed on every keystroke elsewhere in the
  // tree.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!assistantSurface || !surfaceKey || !idempotencyKey) return;
    assistantSurface.setSurfaceKey(surfaceKey);
    const current = profileRef.current;
    if (current) {
      void assistantSurface.seedContext(buildSeedPrompt(current), idempotencyKey);
    }
    return () => {
      assistantSurface.setSurfaceKey(null);
    };
  }, [assistantSurface, surfaceKey, idempotencyKey]);
}
