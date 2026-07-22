import { DEFAULT_CHAT_SURFACE, normalizeChatSurface, type ChatSurface } from "@jarv1s/shared";

const SESSION_KEY_DELIMITER = ":";

export { DEFAULT_CHAT_SURFACE, normalizeChatSurface };
export type { ChatSurface };

export function surfaceSessionKey(
  actorUserId: string,
  surface: ChatSurface | string = DEFAULT_CHAT_SURFACE
): string {
  return `${encodeURIComponent(actorUserId)}${SESSION_KEY_DELIMITER}${normalizeChatSurface(surface)}`;
}

export function parseSurfaceSessionKey(sessionKey: string): {
  actorUserId: string;
  surface: ChatSurface;
} {
  const delimiter = sessionKey.lastIndexOf(SESSION_KEY_DELIMITER);
  if (delimiter <= 0 || delimiter === sessionKey.length - 1) {
    throw new Error("Invalid surface session key");
  }

  let actorUserId: string;
  try {
    actorUserId = decodeURIComponent(sessionKey.slice(0, delimiter));
  } catch {
    throw new Error("Invalid surface session key");
  }
  if (!actorUserId) throw new Error("Invalid surface session key");

  return {
    actorUserId,
    surface: normalizeChatSurface(sessionKey.slice(delimiter + 1))
  };
}
