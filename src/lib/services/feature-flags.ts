/**
 * Feature Flags Service
 *
 * Simple feature flag management for gradual rollouts.
 *
 * @module lib/services/feature-flags
 */

/**
 * Available feature flags
 */
export const FEATURE_FLAGS = {
    // Collaboration features
    REALTIME_CURSORS: 'realtime_cursors',
    CURSOR_CHAT: 'cursor_chat',
    FOLLOW_MODE: 'follow_mode',
    REACTIONS: 'reactions',

    // Canvas features
    VIRTUAL_RENDERING: 'virtual_rendering',
    TOUCH_GESTURES: 'touch_gestures',
    CANVAS_FOLDERS: 'canvas_folders',
    CONNECTIONS: 'connections',

    // Export features
    EXPORT_PDF: 'export_pdf',
    EXPORT_MARKDOWN: 'export_markdown',

    // AI features
    AI_SUGGESTIONS: 'ai_suggestions',
    AI_SUMMARIZE: 'ai_summarize',

    // Beta features
    BETA_TEMPLATES: 'beta_templates',
    BETA_PLUGINS: 'beta_plugins',
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Default feature flag states
 */
const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
    [FEATURE_FLAGS.REALTIME_CURSORS]: true,
    [FEATURE_FLAGS.CURSOR_CHAT]: false,
    [FEATURE_FLAGS.FOLLOW_MODE]: false,
    [FEATURE_FLAGS.REACTIONS]: false,
    [FEATURE_FLAGS.VIRTUAL_RENDERING]: true,
    [FEATURE_FLAGS.TOUCH_GESTURES]: true,
    [FEATURE_FLAGS.CANVAS_FOLDERS]: false,
    [FEATURE_FLAGS.CONNECTIONS]: false,
    [FEATURE_FLAGS.EXPORT_PDF]: false,
    [FEATURE_FLAGS.EXPORT_MARKDOWN]: true,
    [FEATURE_FLAGS.AI_SUGGESTIONS]: false,
    [FEATURE_FLAGS.AI_SUMMARIZE]: false,
    [FEATURE_FLAGS.BETA_TEMPLATES]: false,
    [FEATURE_FLAGS.BETA_PLUGINS]: false,
};

// Runtime overrides
let runtimeFlags: Partial<Record<FeatureFlag, boolean>> = {};

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
    // Check runtime override first
    if (flag in runtimeFlags) {
        return runtimeFlags[flag]!;
    }

    // Check environment variable override
    const envKey = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase()}`;
    if (typeof process !== 'undefined' && process.env[envKey]) {
        return process.env[envKey] === 'true';
    }

    // Fall back to default
    return DEFAULT_FLAGS[flag] ?? false;
}

/**
 * Set runtime flag override
 */
export function setFeatureFlag(flag: FeatureFlag, enabled: boolean): void {
    runtimeFlags[flag] = enabled;
}

/**
 * Clear runtime overrides
 */
export function clearFeatureOverrides(): void {
    runtimeFlags = {};
}

/**
 * Get all feature flags with current states
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
    const flags: Partial<Record<FeatureFlag, boolean>> = {};

    for (const flag of Object.values(FEATURE_FLAGS)) {
        flags[flag] = isFeatureEnabled(flag);
    }

    return flags as Record<FeatureFlag, boolean>;
}

/**
 * Hook-friendly check
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
    // In a real implementation, this would be a React hook
    // that subscribes to flag changes
    return isFeatureEnabled(flag);
}
