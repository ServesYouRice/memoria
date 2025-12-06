/**
 * Accessibility Utilities
 *
 * Helpers for ensuring accessible canvas interactions.
 *
 * @module lib/utils/accessibility
 */

/**
 * Announce a message to screen readers
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    if (typeof document === 'undefined') return;

    const announcer = getOrCreateAnnouncer(priority);
    announcer.textContent = message;
}

/**
 * Get or create the live region announcer element
 */
function getOrCreateAnnouncer(priority: 'polite' | 'assertive'): HTMLElement {
    const id = `sr-announcer-${priority}`;
    let announcer = document.getElementById(id);

    if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = id;
        announcer.setAttribute('role', 'status');
        announcer.setAttribute('aria-live', priority);
        announcer.setAttribute('aria-atomic', 'true');
        announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
        document.body.appendChild(announcer);
    }

    return announcer;
}

/**
 * Generate accessible label for canvas items
 */
export function getItemLabel(item: { type: string; content?: unknown }): string {
    const typeLabel = getItemTypeLabel(item.type);
    const content = item.content as Record<string, unknown> | null;

    if (!content) return typeLabel;

    switch (item.type) {
        case 'NOTE':
            return content.title
                ? `${typeLabel}: ${content.title}`
                : typeLabel;
        case 'BOOKMARK':
            return content.title
                ? `${typeLabel}: ${content.title}`
                : content.url
                    ? `${typeLabel}: ${content.url}`
                    : typeLabel;
        case 'IMAGE':
            return content.alt
                ? `${typeLabel}: ${content.alt}`
                : content.caption
                    ? `${typeLabel}: ${content.caption}`
                    : typeLabel;
        default:
            return typeLabel;
    }
}

/**
 * Get human-readable label for item type
 */
export function getItemTypeLabel(type: string): string {
    const labels: Record<string, string> = {
        NOTE: 'Note',
        BOOKMARK: 'Bookmark',
        IMAGE: 'Image',
        SHAPE: 'Shape',
        TEXT: 'Text',
    };
    return labels[type] || 'Item';
}

/**
 * Keyboard navigation helpers for canvas items
 */
export interface FocusableItem {
    id: string;
    x: number;
    y: number;
}

/**
 * Find the next item to focus based on arrow key direction
 */
export function findNextFocusable(
    items: FocusableItem[],
    currentId: string,
    direction: 'up' | 'down' | 'left' | 'right'
): FocusableItem | null {
    const current = items.find((i) => i.id === currentId);
    if (!current) return items[0] || null;

    const candidates = items.filter((item) => {
        if (item.id === currentId) return false;

        switch (direction) {
            case 'up':
                return item.y < current.y;
            case 'down':
                return item.y > current.y;
            case 'left':
                return item.x < current.x;
            case 'right':
                return item.x > current.x;
        }
    });

    if (candidates.length === 0) return null;

    // Find the closest item in the specified direction
    return candidates.reduce((closest, item) => {
        const currentDistance = getDistance(current, item);
        const closestDistance = getDistance(current, closest);
        return currentDistance < closestDistance ? item : closest;
    });
}

function getDistance(a: FocusableItem, b: FocusableItem): number {
    return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/**
 * Generate ARIA props for a canvas item
 */
export function getItemAriaProps(item: {
    id: string;
    type: string;
    content?: unknown;
    isSelected?: boolean;
}) {
    return {
        role: 'button',
        'aria-label': getItemLabel(item),
        'aria-selected': item.isSelected,
        tabIndex: item.isSelected ? 0 : -1,
    };
}

/**
 * Skip link for keyboard users
 */
export function createSkipLink(targetId: string, label = 'Skip to canvas'): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = `#${targetId}`;
    link.textContent = label;
    link.className = 'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:p-2 focus:rounded';
    return link;
}
