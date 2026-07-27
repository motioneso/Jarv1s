export interface SettingsUndoEntry {
  readonly mutationId: string;
  readonly key: string;
  readonly previousValue: unknown;
  readonly previousRevision: number | null;
  readonly appliedAt: number;
}

const MAX_ENTRIES_PER_CHAT = 20;

export class SettingsUndoStack {
  private readonly stacks = new Map<string, SettingsUndoEntry[]>();

  private stackKey(actorUserId: string, chatId: string): string {
    return `${actorUserId}:${chatId}`;
  }

  push(actorUserId: string, chatId: string, entry: SettingsUndoEntry): void {
    const key = this.stackKey(actorUserId, chatId);
    const stack = this.stacks.get(key) ?? [];
    stack.push(entry);
    if (stack.length > MAX_ENTRIES_PER_CHAT) stack.shift();
    this.stacks.set(key, stack);
  }

  pop(actorUserId: string, chatId: string): SettingsUndoEntry | undefined {
    const key = this.stackKey(actorUserId, chatId);
    const stack = this.stacks.get(key);
    return stack?.pop();
  }

  clear(actorUserId: string, chatId: string): void {
    this.stacks.delete(this.stackKey(actorUserId, chatId));
  }
}

// Package-level singleton — no persistence, cleared on process restart by design. Tool execute
// functions import this directly (same pattern as each file's own `new PreferencesRepository()`);
// no ToolServices/composition-host threading needed since it holds no cross-module state.
export const settingsUndoStack = new SettingsUndoStack();
