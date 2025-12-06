/**
 * Branded Types for Type-Safe IDs
 *
 * Branded types prevent accidentally passing the wrong type of ID
 * to functions, even though they're all strings at runtime.
 *
 * @module types/branded
 *
 * @example
 * ```typescript
 * function getCanvas(id: CanvasId): Promise<Canvas> { ... }
 *
 * const canvasId = 'abc123' as CanvasId;
 * const userId = 'user456' as UserId;
 *
 * getCanvas(canvasId); // ✅ OK
 * getCanvas(userId);   // ❌ TypeScript error
 * ```
 */

declare const __brand: unique symbol;

/**
 * Creates a branded type by intersecting a base type with a unique symbol
 */
type Brand<T, B extends string> = T & { [__brand]: B };

// Canvas-related IDs
export type CanvasId = Brand<string, 'CanvasId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type CommentId = Brand<string, 'CommentId'>;
export type VersionId = Brand<string, 'VersionId'>;

// User-related IDs
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type AccountId = Brand<string, 'AccountId'>;

// Template-related IDs
export type TemplateId = Brand<string, 'TemplateId'>;
export type CategoryId = Brand<string, 'CategoryId'>;

// Collaboration IDs
export type CollaboratorId = Brand<string, 'CollaboratorId'>;
export type ShareLinkId = Brand<string, 'ShareLinkId'>;

/**
 * Type guard to create a branded ID from a string
 */
export function asCanvasId(id: string): CanvasId {
    return id as CanvasId;
}

export function asItemId(id: string): ItemId {
    return id as ItemId;
}

export function asUserId(id: string): UserId {
    return id as UserId;
}

export function asTemplateId(id: string): TemplateId {
    return id as TemplateId;
}

/**
 * Extract the raw string value from a branded type
 */
export function unwrapId<T extends Brand<string, string>>(id: T): string {
    return id as string;
}
