/**
 * Event Emitter
 *
 * Simple typed event emitter for cross-component communication.
 *
 * @module lib/utils/event-emitter
 */

export type EventHandler<T = unknown> = (data: T) => void;

export class EventEmitter<Events extends object> {
    private handlers: Map<keyof Events, Set<EventHandler<any>>> = new Map();

    /**
     * Subscribe to an event
     */
    on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);

        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Subscribe to an event once
     */
    once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
        const onceHandler: EventHandler<Events[K]> = (data) => {
            handler(data);
            this.off(event, onceHandler);
        };
        return this.on(event, onceHandler);
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
        const eventHandlers = this.handlers.get(event);
        if (eventHandlers) {
            eventHandlers.delete(handler);
        }
    }

    /**
     * Emit an event
     */
    emit<K extends keyof Events>(event: K, data: Events[K]): void {
        const eventHandlers = this.handlers.get(event);
        if (eventHandlers) {
            eventHandlers.forEach((handler) => handler(data));
        }
    }

    /**
     * Remove all handlers for an event
     */
    removeAllListeners<K extends keyof Events>(event?: K): void {
        if (event) {
            this.handlers.delete(event);
        } else {
            this.handlers.clear();
        }
    }

    /**
     * Get listener count for an event
     */
    listenerCount<K extends keyof Events>(event: K): number {
        return this.handlers.get(event)?.size ?? 0;
    }
}

/**
 * Canvas event types
 */
export interface CanvasEvents {
    'item:created': { id: string; type: string };
    'item:updated': { id: string; changes: Record<string, unknown> };
    'item:deleted': { id: string };
    'item:selected': { ids: string[] };
    'canvas:saved': { id: string };
    'canvas:zoomed': { zoom: number };
    'canvas:panned': { x: number; y: number };
    'cursor:moved': { userId: string; x: number; y: number };
    'user:joined': { userId: string; name: string };
    'user:left': { userId: string };
}

/**
 * Global canvas event emitter
 */
export const canvasEvents = new EventEmitter<CanvasEvents>();
