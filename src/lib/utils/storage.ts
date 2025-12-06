/**
 * Local Storage Utilities
 *
 * Type-safe local storage with expiration support.
 *
 * @module lib/utils/storage
 */

interface StorageItem<T> {
    value: T;
    expiresAt?: number;
}

/**
 * Get item from local storage with type safety
 */
export function getStorageItem<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;

    try {
        const item = localStorage.getItem(key);
        if (!item) return null;

        const parsed: StorageItem<T> = JSON.parse(item);

        // Check expiration
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
            localStorage.removeItem(key);
            return null;
        }

        return parsed.value;
    } catch {
        return null;
    }
}

/**
 * Set item in local storage with optional expiration
 */
export function setStorageItem<T>(key: string, value: T, ttlMs?: number): void {
    if (typeof window === 'undefined') return;

    try {
        const item: StorageItem<T> = {
            value,
            expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
        };
        localStorage.setItem(key, JSON.stringify(item));
    } catch (error) {
        console.warn('Failed to save to localStorage:', error);
    }
}

/**
 * Remove item from local storage
 */
export function removeStorageItem(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
}

/**
 * Clear all items with a specific prefix
 */
export function clearStoragePrefix(prefix: string): void {
    if (typeof window === 'undefined') return;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/**
 * Storage keys enum for type safety
 */
export const STORAGE_KEYS = {
    THEME: 'canvas-collect-theme',
    SIDEBAR_COLLAPSED: 'canvas-collect-sidebar-collapsed',
    RECENT_CANVASES: 'canvas-collect-recent',
    DRAFT_CANVAS: 'canvas-collect-draft',
    USER_PREFERENCES: 'canvas-collect-preferences',
    LAST_CANVAS_ID: 'canvas-collect-last-canvas',
    TOUR_COMPLETED: 'canvas-collect-tour-completed',
} as const;

/**
 * User preferences type
 */
export interface UserPreferences {
    showGrid: boolean;
    snapToGrid: boolean;
    gridSize: number;
    defaultZoom: number;
    autoSave: boolean;
    notifications: boolean;
}

/**
 * Default user preferences
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
    showGrid: true,
    snapToGrid: true,
    gridSize: 20,
    defaultZoom: 1,
    autoSave: true,
    notifications: true,
};

/**
 * Get user preferences with defaults
 */
export function getUserPreferences(): UserPreferences {
    const stored = getStorageItem<Partial<UserPreferences>>(STORAGE_KEYS.USER_PREFERENCES);
    return { ...DEFAULT_PREFERENCES, ...stored };
}

/**
 * Save user preferences
 */
export function saveUserPreferences(preferences: Partial<UserPreferences>): void {
    const current = getUserPreferences();
    setStorageItem(STORAGE_KEYS.USER_PREFERENCES, { ...current, ...preferences });
}

/**
 * Add to recent canvases list
 */
export function addRecentCanvas(canvasId: string, name: string): void {
    const recent = getStorageItem<Array<{ id: string; name: string; accessedAt: number }>>(
        STORAGE_KEYS.RECENT_CANVASES
    ) || [];

    // Remove if already exists
    const filtered = recent.filter((c) => c.id !== canvasId);

    // Add to front
    filtered.unshift({ id: canvasId, name, accessedAt: Date.now() });

    // Keep only last 10
    setStorageItem(STORAGE_KEYS.RECENT_CANVASES, filtered.slice(0, 10));
}

/**
 * Get recent canvases
 */
export function getRecentCanvases(): Array<{ id: string; name: string; accessedAt: number }> {
    return getStorageItem(STORAGE_KEYS.RECENT_CANVASES) || [];
}
