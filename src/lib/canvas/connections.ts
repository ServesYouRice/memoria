/**
 * Canvas Connections
 *
 * Manages connections/arrows between canvas items.
 *
 * @module lib/canvas/connections
 */

export type ConnectionStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectionType = 'arrow' | 'line' | 'bidirectional';
export type AnchorPosition = 'top' | 'right' | 'bottom' | 'left' | 'center';

export interface Connection {
    id: string;
    fromItemId: string;
    toItemId: string;
    fromAnchor: AnchorPosition;
    toAnchor: AnchorPosition;
    style: ConnectionStyle;
    type: ConnectionType;
    color: string;
    label?: string;
    strokeWidth: number;
}

export interface ConnectionPoint {
    x: number;
    y: number;
}

export interface ItemBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Get anchor point coordinates for an item
 */
export function getAnchorPoint(bounds: ItemBounds, anchor: AnchorPosition): ConnectionPoint {
    const { x, y, width, height } = bounds;

    switch (anchor) {
        case 'top':
            return { x: x + width / 2, y };
        case 'right':
            return { x: x + width, y: y + height / 2 };
        case 'bottom':
            return { x: x + width / 2, y: y + height };
        case 'left':
            return { x, y: y + height / 2 };
        case 'center':
            return { x: x + width / 2, y: y + height / 2 };
    }
}

/**
 * Find best anchor points between two items
 */
export function findBestAnchors(
    fromBounds: ItemBounds,
    toBounds: ItemBounds
): { from: AnchorPosition; to: AnchorPosition } {
    const fromCenter = getAnchorPoint(fromBounds, 'center');
    const toCenter = getAnchorPoint(toBounds, 'center');

    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;

    let from: AnchorPosition;
    let to: AnchorPosition;

    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal connection
        from = dx > 0 ? 'right' : 'left';
        to = dx > 0 ? 'left' : 'right';
    } else {
        // Vertical connection
        from = dy > 0 ? 'bottom' : 'top';
        to = dy > 0 ? 'top' : 'bottom';
    }

    return { from, to };
}

/**
 * Generate SVG path for a curved connection
 */
export function generateConnectionPath(
    from: ConnectionPoint,
    to: ConnectionPoint,
    curvature = 0.5
): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Control point offsets
    const cx = dx * curvature;
    const cy = dy * curvature;

    // Cubic bezier curve
    return `M ${from.x} ${from.y} C ${from.x + cx} ${from.y}, ${to.x - cx} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * Generate SVG path for a straight connection
 */
export function generateStraightPath(from: ConnectionPoint, to: ConnectionPoint): string {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * Generate SVG path for an orthogonal (right-angle) connection
 */
export function generateOrthogonalPath(
    from: ConnectionPoint,
    to: ConnectionPoint,
    fromAnchor: AnchorPosition,
    toAnchor: AnchorPosition
): string {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    if (fromAnchor === 'left' || fromAnchor === 'right') {
        return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
    }

    return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

/**
 * Get SVG arrow marker
 */
export function getArrowMarker(color: string, id: string): string {
    return `
    <marker id="${id}" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="${color}" />
    </marker>
  `;
}

/**
 * Create a new connection
 */
export function createConnection(
    fromItemId: string,
    toItemId: string,
    options?: Partial<Omit<Connection, 'id' | 'fromItemId' | 'toItemId'>>
): Connection {
    return {
        id: crypto.randomUUID(),
        fromItemId,
        toItemId,
        fromAnchor: options?.fromAnchor ?? 'right',
        toAnchor: options?.toAnchor ?? 'left',
        style: options?.style ?? 'solid',
        type: options?.type ?? 'arrow',
        color: options?.color ?? '#666666',
        label: options?.label,
        strokeWidth: options?.strokeWidth ?? 2,
    };
}

/**
 * Get connections for an item
 */
export function getItemConnections(connections: Connection[], itemId: string): Connection[] {
    return connections.filter(
        (c) => c.fromItemId === itemId || c.toItemId === itemId
    );
}

/**
 * Remove connections for deleted items
 */
export function cleanupConnections(
    connections: Connection[],
    existingItemIds: Set<string>
): Connection[] {
    return connections.filter(
        (c) => existingItemIds.has(c.fromItemId) && existingItemIds.has(c.toItemId)
    );
}
