### Task 17: Seed prompt for the job-search thread

The thread is a full-capability session — full tool set, no restrictions. It differs from the main
thread only by seed prompt and scope.

**Depends on:** Task 2c (`setSurfaceKey` / `seedContext` on `AssistantSurfaceHandleV1`), Task 16
(the tool names it cites).

**Files**

- Create: `external-modules/job-search/src/domain/seed-prompt.ts`
- Modify: `external-modules/job-search/src/web/use-profiles.ts` — the caller
- Test: `tests/unit/job-search-seed-prompt.test.ts`
- Test: `tests/unit/job-search-web-root.test.tsx` (additions)

**Contracts**

```ts
export function buildSeedPrompt(profile: Profile): string;

/** Bind the module's chat surface to the active profile and frame it once.
 *
 * Order matters: `setSurfaceKey` FIRST, because `seedContext` is curried with whatever surface
 * the handle currently holds — seeding first would frame the *drawer*, which is exactly the leak
 * Ben ruled out ("if the user is in the job search and they open the drawer, I don't want that
 * job search to show up in the drawer").
 *
 * The idempotency key is versioned (`:v1`). The manager dedupes on it
 * (`chat-session-manager.ts:384`), so a remount is a no-op — but editing the prompt text without
 * bumping the version would leave existing sessions framed by the old copy forever. */
export function useProfileThread(
  assistantSurface: AssistantSurfaceHandleV1 | undefined,
  profile: Profile | null
): void;
```

**Constraints**

- **A seed prompt with no caller is dead code.** `useProfileThread` is part of this task, not a later
  one, and the web-root test below is what proves it is wired.
- `setSurfaceKey(profile.id)` before `seedContext(...)`; `setSurfaceKey(null)` on unmount. Returning
  the drawer is the shell's job (Task 2c), but the module says it too — a module that navigates away
  must not leave the drawer pointed at its own transcript.
- Seed key is `job-search:${profile.id}:v1`. Bump the version whenever the prompt text changes.
- **Nothing in the stack validates a tool name written in prose.** A wrong name in the seed text
  fails silently at runtime, and has broken a module before. The prompt must cite the exact
  registered names.
- The prompt must not tell the model to withhold any capability — this is a full session.

**Tests** (`tests/unit/job-search-seed-prompt.test.ts`)

1. **Names the tools that write criteria** — `job-search.criteria.set` and `job-search.resume.set`
   appear verbatim, so the model records rather than narrates.
2. **Every tool name appearing in the prompt exists in `manifest.assistantTools`.** This is the
   generalisation of case 1 and the one that survives a later rename.
3. **Tells the model the interview has a defined end** — the five steps `role`, `want`, `where`,
   `comp`, `sources` all appear.
4. **Does not tell the model to withhold any capability** — asserts the text does not match
   `/only use|do not use|you cannot|not available here/i`.

**Tests** (`tests/unit/job-search-web-root.test.tsx`, additions)

1. **Binds the surface before framing it, and frames it once.** Renders and re-renders with the same
   surface; asserts `setSurfaceKey`'s `invocationCallOrder` is lower than `seedContext`'s, that it
   was called with `"p1"`, that `seedContext` was called exactly once, and that it received a string
   containing `job-search.criteria.set` with key `job-search:p1:v1`. Ordering, not just presence:
   seeding before binding frames the drawer, and a presence-only assertion passes either way.
2. **Works when the host gives it no assistant surface.** `assistantSurface` is optional in the host
   contract (`apps/web/src/external-modules/loader.ts:10-19`); the board must still render.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-seed-prompt.test.ts \
  tests/unit/job-search-web-root.test.tsx   # exit 0
```
