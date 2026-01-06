/**
 * Canvas Collaboration UI Hook
 * Handles collaboration-specific UI state: remote messages, reactions, follow mode
 */

import { useState, useEffect, useCallback } from 'react';
import type { CursorPosition } from '@/lib/hooks/use-collaboration';

interface RemoteMessage {
    id: string;
    type: 'chat';
    userId: string;
    text: string;
    position: { x: number; y: number };
}

interface RemoteReaction {
    id: string;
    type: 'reaction';
    userId: string;
    emoji: string;
    position: { x: number; y: number };
}

interface UseCanvasCollaborationUIOptions {
    cursors: CursorPosition[];
    zoom: number;
    setPosition: (pos: { x: number; y: number }) => void;
}

export function useCanvasCollaborationUI({
    cursors,
    zoom,
    setPosition,
}: UseCanvasCollaborationUIOptions) {
    // Remote messages (chat bubbles)
    const [remoteMessages, setRemoteMessages] = useState<RemoteMessage[]>([]);

    // Remote reactions (floating emojis)
    const [remoteReactions, setRemoteReactions] = useState<RemoteReaction[]>([]);

    // Follow mode - track another user's cursor
    const [followingUserId, setFollowingUserId] = useState<string | null>(null);

    /**
     * Handle incoming collaboration messages
     */
    const handleRemoteMessage = useCallback(
        (message: { type: string; userId?: string; text?: string; emoji?: string; position?: { x: number; y: number } }) => {
            if (message.type === 'chat' && message.userId && message.text && message.position) {
                const id = Date.now().toString() + Math.random().toString();
                const chatMessage: RemoteMessage = {
                    id,
                    type: 'chat',
                    userId: message.userId,
                    text: message.text,
                    position: message.position,
                };
                setRemoteMessages((prev) => [...prev, chatMessage]);
                setTimeout(() => {
                    setRemoteMessages((prev) => prev.filter((m) => m.id !== id));
                }, 5000);
            } else if (message.type === 'reaction' && message.userId && message.emoji && message.position) {
                const id = Date.now().toString() + Math.random().toString();
                const reaction: RemoteReaction = {
                    id,
                    type: 'reaction',
                    userId: message.userId,
                    emoji: message.emoji,
                    position: message.position,
                };
                setRemoteReactions((prev) => [...prev, reaction]);
                setTimeout(() => {
                    setRemoteReactions((prev) => prev.filter((r) => r.id !== id));
                }, 3000);
            }
        },
        []
    );

    /**
     * Toggle following a specific user
     */
    const toggleFollowUser = useCallback((userId: string) => {
        setFollowingUserId((prev) => (prev === userId ? null : userId));
    }, []);

    /**
     * Follow mode effect - pan canvas to follow user's cursor
     */
    useEffect(() => {
        if (followingUserId) {
            const targetCursor = cursors.find((c) => c.userId === followingUserId);
            if (targetCursor) {
                const newX = window.innerWidth / 2 - targetCursor.position.x * zoom;
                const newY = window.innerHeight / 2 - targetCursor.position.y * zoom;
                setPosition({ x: newX, y: newY });
            }
        }
    }, [cursors, followingUserId, zoom, setPosition]);

    return {
        remoteMessages,
        remoteReactions,
        followingUserId,
        handleRemoteMessage,
        toggleFollowUser,
    };
}
