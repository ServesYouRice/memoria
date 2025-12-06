/**
 * Share Service
 *
 * Canvas sharing and permissions utilities.
 *
 * @module lib/services/share
 */

export type Permission = 'VIEW' | 'EDIT' | 'ADMIN';

export interface ShareLink {
    id: string;
    token: string;
    permission: Permission;
    expiresAt?: Date;
    maxUses?: number;
    usageCount: number;
    password?: string;
}

export interface Collaborator {
    id: string;
    userId: string;
    email: string;
    name?: string;
    permission: Permission;
    addedAt: Date;
}

/**
 * Permission hierarchy
 */
const PERMISSION_LEVELS: Record<Permission, number> = {
    VIEW: 1,
    EDIT: 2,
    ADMIN: 3,
};

/**
 * Check if user has at least the required permission
 */
export function hasPermission(userPermission: Permission, required: Permission): boolean {
    return PERMISSION_LEVELS[userPermission] >= PERMISSION_LEVELS[required];
}

/**
 * Check if user can edit
 */
export function canEdit(permission: Permission): boolean {
    return hasPermission(permission, 'EDIT');
}

/**
 * Check if user is admin
 */
export function isAdmin(permission: Permission): boolean {
    return permission === 'ADMIN';
}

/**
 * Get permission label
 */
export function getPermissionLabel(permission: Permission): string {
    const labels: Record<Permission, string> = {
        VIEW: 'Can view',
        EDIT: 'Can edit',
        ADMIN: 'Full access',
    };
    return labels[permission];
}

/**
 * Get permission description
 */
export function getPermissionDescription(permission: Permission): string {
    const descriptions: Record<Permission, string> = {
        VIEW: 'Can view the canvas but cannot make changes',
        EDIT: 'Can view and edit items on the canvas',
        ADMIN: 'Full access including sharing and deleting',
    };
    return descriptions[permission];
}

/**
 * Check if share link is valid
 */
export function isShareLinkValid(link: ShareLink): boolean {
    // Check expiration
    if (link.expiresAt && new Date() > link.expiresAt) {
        return false;
    }

    // Check usage limit
    if (link.maxUses !== undefined && link.usageCount >= link.maxUses) {
        return false;
    }

    return true;
}

/**
 * Generate share URL
 */
export function generateShareUrl(token: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/share/${token}`;
}

/**
 * Parse share token from URL
 */
export function parseShareToken(url: string): string | null {
    const match = url.match(/\/share\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * All permission options
 */
export const PERMISSION_OPTIONS: Array<{ value: Permission; label: string; description: string }> = [
    { value: 'VIEW', label: 'Can view', description: 'View only access' },
    { value: 'EDIT', label: 'Can edit', description: 'Can make changes' },
    { value: 'ADMIN', label: 'Full access', description: 'Can share and manage' },
];

/**
 * Expiration options for share links
 */
export const EXPIRATION_OPTIONS = [
    { value: undefined, label: 'Never' },
    { value: 1, label: '1 hour' },
    { value: 24, label: '1 day' },
    { value: 168, label: '1 week' },
    { value: 720, label: '30 days' },
];

/**
 * Get expiration date from hours
 */
export function getExpirationDate(hours?: number): Date | undefined {
    if (!hours) return undefined;
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return date;
}
