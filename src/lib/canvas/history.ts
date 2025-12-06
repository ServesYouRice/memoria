/**
 * Canvas Undo/Redo History
 *
 * History stack for canvas operations with undo/redo support.
 *
 * @module lib/canvas/history
 */

export interface HistoryEntry<T> {
    action: string;
    before: T;
    after: T;
    timestamp: number;
}

export interface HistoryState<T> {
    past: HistoryEntry<T>[];
    future: HistoryEntry<T>[];
    maxSize: number;
}

/**
 * Create initial history state
 */
export function createHistory<T>(maxSize = 50): HistoryState<T> {
    return { past: [], future: [], maxSize };
}

/**
 * Push a new entry to history
 */
export function pushHistory<T>(
    state: HistoryState<T>,
    entry: Omit<HistoryEntry<T>, 'timestamp'>
): HistoryState<T> {
    const newEntry: HistoryEntry<T> = { ...entry, timestamp: Date.now() };
    const past = [...state.past, newEntry].slice(-state.maxSize);
    return { ...state, past, future: [] };
}

/**
 * Undo last action
 */
export function undo<T>(state: HistoryState<T>): { state: HistoryState<T>; entry: HistoryEntry<T> | null } {
    if (state.past.length === 0) {
        return { state, entry: null };
    }

    const past = [...state.past];
    const entry = past.pop()!;
    const future = [entry, ...state.future];

    return { state: { ...state, past, future }, entry };
}

/**
 * Redo last undone action
 */
export function redo<T>(state: HistoryState<T>): { state: HistoryState<T>; entry: HistoryEntry<T> | null } {
    if (state.future.length === 0) {
        return { state, entry: null };
    }

    const future = [...state.future];
    const entry = future.shift()!;
    const past = [...state.past, entry];

    return { state: { ...state, past, future }, entry };
}

/**
 * Check if undo is available
 */
export function canUndo<T>(state: HistoryState<T>): boolean {
    return state.past.length > 0;
}

/**
 * Check if redo is available
 */
export function canRedo<T>(state: HistoryState<T>): boolean {
    return state.future.length > 0;
}

/**
 * Clear history
 */
export function clearHistory<T>(state: HistoryState<T>): HistoryState<T> {
    return { ...state, past: [], future: [] };
}

/**
 * Get undo action description
 */
export function getUndoDescription<T>(state: HistoryState<T>): string | null {
    if (state.past.length === 0) return null;
    return state.past[state.past.length - 1].action;
}

/**
 * Get redo action description
 */
export function getRedoDescription<T>(state: HistoryState<T>): string | null {
    if (state.future.length === 0) return null;
    return state.future[0].action;
}
