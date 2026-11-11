/**
 * Earlier chat turns sent with a follow-up message. Client-safe (no server
 * imports): AIDialog trims to the same bounds the route validates.
 */
import { z } from "zod";

/** Most prior turns (user and assistant messages) one chat request carries. */
export const AI_CHAT_HISTORY_MAX_TURNS = 20;
/** Longest single prior turn, matching the chat message limit. */
export const AI_CHAT_HISTORY_MAX_CHARS = 5000;

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const chatHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(AI_CHAT_HISTORY_MAX_CHARS),
    }),
  )
  .max(AI_CHAT_HISTORY_MAX_TURNS);

/** The newest turns within the bounds, each cut to the per-turn limit. */
export function boundChatHistory(turns: readonly AiChatTurn[]): AiChatTurn[] {
  return turns
    .filter((turn) => turn.content.trim().length > 0)
    .slice(-AI_CHAT_HISTORY_MAX_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, AI_CHAT_HISTORY_MAX_CHARS),
    }));
}
