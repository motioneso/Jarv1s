import type { ChatSkillDto } from "@jarv1s/shared";

/**
 * `/` slash autocomplete + invocation for the chat composer (#760). All parsing/resolution
 * logic is pure and exported so it can be unit-tested directly (no jsdom in this repo — see
 * tests/unit/chat-skill-autocomplete.test.ts). The popover component below is a thin, purely
 * presentational consumer of `filterEnabledSkills`.
 */

// Query text extracted from a leading "/token" the user is actively composing — null once a
// space is typed (leaves compose mode) or the text doesn't start with "/".
export function activeSlashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

export function filterEnabledSkills(
  skills: readonly ChatSkillDto[],
  query: string
): readonly ChatSkillDto[] {
  const needle = query.trim().toLowerCase();
  return skills.filter(
    (s) => s.enabled && (needle === "" || s.name.toLowerCase().includes(needle))
  );
}

// Deterministic bare-name fallback: first enabled match in the list's existing (already
// enabled-first, most-recent) order — matches packages/chat/src/skills/repository.ts ordering.
export function resolveSkillByName(
  skills: readonly ChatSkillDto[],
  name: string
): ChatSkillDto | undefined {
  const needle = name.trim().toLowerCase();
  return needle ? skills.find((s) => s.enabled && s.name.toLowerCase() === needle) : undefined;
}

export function resolveBoundSkill(
  skills: readonly ChatSkillDto[],
  boundSkillId: string | null
): ChatSkillDto | undefined {
  return boundSkillId ? skills.find((s) => s.id === boundSkillId && s.enabled) : undefined;
}

// Splits "/name rest" into token (sans slash) + remainder. null = not slash-prefixed at all
// (including a literal lone "/", which has no name token to resolve).
export function splitBareNameToken(
  text: string
): { readonly name: string; readonly remainder: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return match ? { name: match[1] ?? "", remainder: match[2] ?? "" } : null;
}

// Bound (explicit autocomplete pick, tracked by id) wins; else a still-slash-prefixed message
// resolves by bare name; anything unresolved is sent as plain, unmodified text — including a
// literal lone "/" (escape/no-match must degrade to plain send).
export function resolveTurnInvocation(
  text: string,
  boundSkillId: string | null,
  skills: readonly ChatSkillDto[]
): { readonly skill: ChatSkillDto | undefined; readonly remainder: string } {
  const bound = resolveBoundSkill(skills, boundSkillId);
  if (bound) return { skill: bound, remainder: text };
  const split = splitBareNameToken(text);
  if (!split) return { skill: undefined, remainder: text };
  const named = resolveSkillByName(skills, split.name);
  return named
    ? { skill: named, remainder: split.remainder }
    : { skill: undefined, remainder: text };
}

export function composeTurnText(skill: ChatSkillDto | undefined, remainder: string): string {
  const trimmed = remainder.trim();
  if (!skill) return trimmed;
  return trimmed ? `${skill.body}\n\n${trimmed}` : skill.body;
}

export function SkillAutocomplete(props: {
  readonly skills: readonly ChatSkillDto[];
  readonly query: string;
  readonly onSelect: (skill: ChatSkillDto) => void;
}) {
  const matches = filterEnabledSkills(props.skills, props.query);
  if (matches.length === 0) return null;

  return (
    <div className="chatd-skillac" role="listbox" aria-label="Skills">
      {matches.map((skill) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={false}
          className="chatd-skillac__option"
          onClick={() => props.onSelect(skill)}
        >
          <span className="chatd-skillac__name">/{skill.name}</span>
          {skill.description ? (
            <span className="chatd-skillac__desc">{skill.description}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
