
import { CanvasItem } from '@prisma/client';

export interface AutopilotAction {
    itemId: string;
    newPosition: { x: number, y: number };
    reason?: string;
}

/**
 * Canvas Autopilot: Automatically organizes canvas items.
 * Uses a simple clustering algorithm to group items.
 */
export async function calculateAutopilotLayout(
    items: any[]
): Promise<AutopilotAction[]> {
    if (items.length < 2) return [];

    const actions: AutopilotAction[] = [];

    // Simple Grid Layout Strategy for now
    // In a real implementation, this would use clustering (K-Means) or Force-Directed Graph layout
    // based on content similarity or proximity.

    const SPACING = 350; // Horizontal spacing including card width
    const NOTES_PER_ROW = 4;

    // Sort items by creation time (preserving some order)
    const sortedItems = [...items].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    sortedItems.forEach((item, index) => {
        const row = Math.floor(index / NOTES_PER_ROW);
        const col = index % NOTES_PER_ROW;

        const targetX = col * SPACING;
        const targetY = row * 250; // Vertical spacing

        // Only move if significantly different to avoid jitter for small adjustments
        if (Math.abs(item.positionX - targetX) > 10 || Math.abs(item.positionY - targetY) > 10) {
            actions.push({
                itemId: item.id,
                newPosition: { x: targetX, y: targetY },
                reason: 'Grid alignment'
            });
        }
    });

    return actions;
}
