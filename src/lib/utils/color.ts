/**
 * Color Utilities
 *
 * Helpers for color manipulation and generation.
 *
 * @module lib/utils/color
 */

/**
 * User colors for collaboration cursors
 */
export const USER_COLORS = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
    '#98D8C8', // Mint
    '#F7DC6F', // Gold
    '#BB8FCE', // Purple
    '#85C1E9', // Sky Blue
    '#F8B500', // Orange
    '#00CED1', // Cyan
] as const;

/**
 * Get a consistent color for a user based on their ID
 */
export function getUserColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * Convert hex to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
        }
        : null;
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Lighten a color
 */
export function lighten(hex: string, amount: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    return rgbToHex(
        Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
        Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
        Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount))
    );
}

/**
 * Darken a color
 */
export function darken(hex: string, amount: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    return rgbToHex(
        Math.max(0, Math.round(rgb.r * (1 - amount))),
        Math.max(0, Math.round(rgb.g * (1 - amount))),
        Math.max(0, Math.round(rgb.b * (1 - amount)))
    );
}

/**
 * Get contrasting text color (black or white)
 */
export function getContrastColor(hex: string): '#000000' | '#ffffff' {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#000000';

    // Calculate relative luminance
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Check if color is valid hex
 */
export function isValidHex(color: string): boolean {
    return /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(color);
}

/**
 * Generate random color
 */
export function randomColor(): string {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

/**
 * Predefined note background colors
 */
export const NOTE_COLORS = {
    yellow: '#FFF9C4',
    green: '#C8E6C9',
    blue: '#BBDEFB',
    pink: '#F8BBD9',
    purple: '#E1BEE7',
    orange: '#FFE0B2',
    gray: '#F5F5F5',
    white: '#FFFFFF',
} as const;

export type NoteColor = keyof typeof NOTE_COLORS;
