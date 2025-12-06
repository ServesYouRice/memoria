/**
 * Collaboration Types
 *
 * Type definitions for real-time collaboration features:
 * - Cursor presence
 * - Quick reactions
 * - Follow mode
 * - Cursor chat
 *
 * @module types/collaboration
 */

/**
 * Quick emoji reactions (like FigJam stamps)
 */
export type ReactionEmoji = '👍' | '❤️' | '🎉' | '🤔' | '👀' | '🔥' | '✅' | '❌';

export interface Reaction {
    id: string;
    emoji: ReactionEmoji;
    userId: string;
    position: { x: number; y: number };
    createdAt: Date;
    expiresAt: Date; // Auto-remove after 5 seconds
}

/**
 * Cursor chat message (ephemeral messages shown near cursor)
 */
export interface CursorChat {
    id: string;
    userId: string;
    message: string;
    position: { x: number; y: number };
    timestamp: Date;
    expiresAfterMs: number; // Show for 3 seconds
}

/**
 * Follow mode state
 */
export interface FollowMode {
    isFollowing: boolean;
    targetUserId: string | null;
    targetUserName: string | null;
}

/**
 * Presentation mode state
 */
export interface PresentationState {
    isPresenting: boolean;
    presenterId: string | null;
    presenterName: string | null;
    currentFrameIndex: number;
    totalFrames: number;
}

/**
 * Collaboration user presence
 */
export interface UserPresence {
    userId: string;
    email: string;
    name?: string;
    color: string;
    cursor?: {
        x: number;
        y: number;
        lastUpdate: Date;
    };
    chatMessage?: CursorChat;
    isActive: boolean;
    lastSeen: Date;
}

/**
 * WebSocket message types for collaboration
 */
export type CollaborationMessageType =
    | 'CURSOR_MOVE'
    | 'CURSOR_LEAVE'
    | 'REACTION'
    | 'CURSOR_CHAT'
    | 'FOLLOW_START'
    | 'FOLLOW_STOP'
    | 'SYNC_REQUEST'
    | 'SYNC_RESPONSE'
    | 'ITEM_UPDATE'
    | 'ITEM_CREATE'
    | 'ITEM_DELETE'
    | 'USER_JOIN'
    | 'USER_LEAVE'
    | 'PRESENCE_UPDATE';

export interface CollaborationMessage {
    type: CollaborationMessageType;
    userId: string;
    canvasId: string;
    timestamp: Date;
    payload: unknown;
}

/**
 * Cursor move message
 */
export interface CursorMovePayload {
    x: number;
    y: number;
    userId: string;
    color: string;
    name?: string;
}

/**
 * Reaction message
 */
export interface ReactionPayload {
    reaction: Reaction;
}

/**
 * Follow mode message
 */
export interface FollowPayload {
    targetUserId: string;
    targetViewport?: {
        x: number;
        y: number;
        zoom: number;
    };
}
