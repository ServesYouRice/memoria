/**
 * Audit Logging Service
 *
 * Records user actions for security and compliance.
 * Uses database or falls back to structured logging.
 *
 * @module lib/audit/audit-log
 */

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export type AuditAction =
    | 'CREATE'
    | 'UPDATE'
    | 'DELETE'
    | 'VIEW'
    | 'SHARE'
    | 'UNSHARE'
    | 'EXPORT'
    | 'IMPORT'
    | 'LOGIN'
    | 'LOGOUT'
    | 'PASSWORD_CHANGE'
    | 'PASSWORD_RESET';

export type AuditEntity =
    | 'CANVAS'
    | 'CANVAS_ITEM'
    | 'COMMENT'
    | 'TEMPLATE'
    | 'USER'
    | 'SESSION';

export interface AuditLogEntry {
    userId: string;
    action: AuditAction;
    entity: AuditEntity;
    entityId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Record an audit log entry
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
    const { userId, action, entity, entityId, before, after, ip, userAgent, metadata } = entry;

    // Always log to structured logger
    logger.info({
        type: 'audit',
        userId,
        action,
        entity,
        entityId,
        ip,
        userAgent,
        ...metadata,
    }, `${action} ${entity} ${entityId}`);

    // Try to persist to database if AuditLog table exists
    try {
        // Check if AuditLog model exists (it may not be in schema yet)
        if ('auditLog' in prisma) {
            await (prisma as any).auditLog.create({
                data: {
                    userId,
                    action,
                    entity,
                    entityId,
                    before: before ?? undefined,
                    after: after ?? undefined,
                    ip: ip ?? undefined,
                    userAgent: userAgent ?? undefined,
                },
            });
        }
    } catch (error) {
        // Silently fail if table doesn't exist
        logger.debug({ error }, 'AuditLog table not available, using logger only');
    }
}

/**
 * Helper to create before/after snapshots
 */
export function createSnapshot(data: unknown): Record<string, unknown> | undefined {
    if (!data) return undefined;
    if (typeof data !== 'object') return { value: data };

    // Remove sensitive fields
    const snapshot = { ...(data as Record<string, unknown>) };
    delete snapshot['passwordHash'];
    delete snapshot['password'];
    delete snapshot['token'];
    delete snapshot['secret'];

    return snapshot;
}

/**
 * Audit decorator for service functions
 */
export function withAudit<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: {
        action: AuditAction;
        entity: AuditEntity;
        getUserId: (...args: Parameters<T>) => string;
        getEntityId: (...args: Parameters<T>) => string;
        getBefore?: (...args: Parameters<T>) => Promise<Record<string, unknown> | undefined>;
    }
): T {
    return (async (...args: Parameters<T>) => {
        const userId = options.getUserId(...args);
        const entityId = options.getEntityId(...args);
        const before = options.getBefore ? await options.getBefore(...args) : undefined;

        const result = await fn(...args);

        await recordAuditLog({
            userId,
            action: options.action,
            entity: options.entity,
            entityId,
            before,
            after: result ? createSnapshot(result) : undefined,
        });

        return result;
    }) as T;
}

/**
 * Quick audit helpers
 */
export const audit = {
    canvasCreated: (userId: string, canvasId: string) =>
        recordAuditLog({ userId, action: 'CREATE', entity: 'CANVAS', entityId: canvasId }),

    canvasDeleted: (userId: string, canvasId: string) =>
        recordAuditLog({ userId, action: 'DELETE', entity: 'CANVAS', entityId: canvasId }),

    canvasShared: (userId: string, canvasId: string, sharedWith: string) =>
        recordAuditLog({ userId, action: 'SHARE', entity: 'CANVAS', entityId: canvasId, metadata: { sharedWith } }),

    itemCreated: (userId: string, itemId: string, canvasId: string) =>
        recordAuditLog({ userId, action: 'CREATE', entity: 'CANVAS_ITEM', entityId: itemId, metadata: { canvasId } }),

    itemDeleted: (userId: string, itemId: string) =>
        recordAuditLog({ userId, action: 'DELETE', entity: 'CANVAS_ITEM', entityId: itemId }),

    userLogin: (userId: string, ip?: string) =>
        recordAuditLog({ userId, action: 'LOGIN', entity: 'SESSION', entityId: userId, ip }),

    userLogout: (userId: string) =>
        recordAuditLog({ userId, action: 'LOGOUT', entity: 'SESSION', entityId: userId }),

    passwordChanged: (userId: string) =>
        recordAuditLog({ userId, action: 'PASSWORD_CHANGE', entity: 'USER', entityId: userId }),
};
