import { createContext, useContext } from "react";

export interface ChatControls {
  /** Open the chat drawer and send `prompt` as a turn. */
  readonly openChatWith: (prompt: string) => void;
}

const ChatControlsContext = createContext<ChatControls | null>(null);

export const ChatControlsProvider = ChatControlsContext.Provider;

export function useChatControls(): ChatControls {
  const ctx = useContext(ChatControlsContext);
  if (!ctx) {
    throw new Error("useChatControls must be used within ChatControlsProvider");
  }
  return ctx;
}
