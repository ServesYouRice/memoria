"use client";

import { useState, useCallback, useEffect } from "react";
import { nanoid } from "nanoid";

interface ChatMessage {
  id: string;
  type: "chat";
  content: string;
  x: number;
  y: number;
  userName: string;
  userColor: string;
  timestamp: number;
}

interface ReactionMessage {
  id: string;
  type: "reaction";
  emoji: string;
  x: number;
  y: number;
  userName: string;
  timestamp: number;
}

interface UseCanvasChatOptions {
  userName: string;
  userColor?: string;
  broadcastMessage?: (message: ChatMessage | ReactionMessage) => void;
  onMessageReceived?: (
    callback: (message: ChatMessage | ReactionMessage) => void,
  ) => void;
}

/**
 * Canvas Chat/Reaction Hook
 *
 * Manages cursor chat and floating reaction functionality for real-time collaboration.
 * Handles local state and message broadcasting.
 */
export function useCanvasChat({
  userName,
  userColor = "#f00",
  broadcastMessage,
  onMessageReceived,
}: UseCanvasChatOptions) {
  // Chat popup state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });

  // Reaction popup state
  const [reactionOpen, setReactionOpen] = useState(false);
  const [reactionPosition, setReactionPosition] = useState({ x: 0, y: 0 });

  // Remote messages and reactions (with auto-cleanup)
  const [remoteMessages, setRemoteMessages] = useState<ChatMessage[]>([]);
  const [remoteReactions, setRemoteReactions] = useState<ReactionMessage[]>([]);

  // Auto-expire messages after 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRemoteMessages((prev) => prev.filter((m) => now - m.timestamp < 5000));
      setRemoteReactions((prev) =>
        prev.filter((r) => now - r.timestamp < 3000),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for incoming messages
  useEffect(() => {
    if (onMessageReceived) {
      onMessageReceived((message) => {
        if (message.type === "chat") {
          setRemoteMessages((prev) => [...prev, message as ChatMessage]);
        } else if (message.type === "reaction") {
          setRemoteReactions((prev) => [...prev, message as ReactionMessage]);
        }
      });
    }
  }, [onMessageReceived]);

  const openChat = useCallback((position: { x: number; y: number }) => {
    setChatPosition(position);
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const openReaction = useCallback((position: { x: number; y: number }) => {
    setReactionPosition(position);
    setReactionOpen(true);
  }, []);

  const closeReaction = useCallback(() => {
    setReactionOpen(false);
  }, []);

  const sendChatMessage = useCallback(
    (content: string, canvasX: number, canvasY: number) => {
      if (!broadcastMessage) return;

      const message: ChatMessage = {
        id: nanoid(),
        type: "chat",
        content,
        x: canvasX,
        y: canvasY,
        userName,
        userColor,
        timestamp: Date.now(),
      };

      broadcastMessage(message);
      setChatOpen(false);
    },
    [broadcastMessage, userName, userColor],
  );

  const sendReaction = useCallback(
    (emoji: string, canvasX: number, canvasY: number) => {
      if (!broadcastMessage) return;

      const reaction: ReactionMessage = {
        id: nanoid(),
        type: "reaction",
        emoji,
        x: canvasX,
        y: canvasY,
        userName,
        timestamp: Date.now(),
      };

      broadcastMessage(reaction);
      setReactionOpen(false);
    },
    [broadcastMessage, userName],
  );

  return {
    // Chat state
    chatOpen,
    chatPosition,
    openChat,
    closeChat,
    sendChatMessage,

    // Reaction state
    reactionOpen,
    reactionPosition,
    openReaction,
    closeReaction,
    sendReaction,

    // Remote messages (for rendering)
    remoteMessages,
    remoteReactions,
  };
}

export type CanvasChatState = ReturnType<typeof useCanvasChat>;
