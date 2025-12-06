/**
 * Analytics Service
 *
 * Privacy-respecting analytics for usage tracking.
 *
 * @module lib/services/analytics
 */

import { logger } from '@/lib/logger';

export type AnalyticsEvent =
    | 'canvas_created'
    | 'canvas_deleted'
    | 'canvas_shared'
    | 'item_created'
    | 'item_deleted'
    | 'template_used'
    | 'export_completed'
    | 'collaboration_started'
    | 'search_performed'
    | 'error_occurred';

export interface AnalyticsProperties {
    [key: string]: string | number | boolean | undefined;
}

// Analytics is disabled by default
let analyticsEnabled = false;
let analyticsProvider: 'none' | 'posthog' | 'plausible' = 'none';

/**
 * Initialize analytics
 */
export function initAnalytics(provider: typeof analyticsProvider = 'none'): void {
    analyticsProvider = provider;
    analyticsEnabled = provider !== 'none' && process.env.NODE_ENV === 'production';

    if (analyticsEnabled) {
        logger.info({ provider }, 'Analytics initialized');
    }
}

/**
 * Track an event
 */
export function trackEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
    if (!analyticsEnabled) {
        // Log in development for debugging
        if (process.env.NODE_ENV === 'development') {
            logger.debug({ event, properties }, 'Analytics event (dev)');
        }
        return;
    }

    try {
        switch (analyticsProvider) {
            case 'posthog':
                if (typeof window !== 'undefined' && (window as any).posthog) {
                    (window as any).posthog.capture(event, properties);
                }
                break;
            case 'plausible':
                if (typeof window !== 'undefined' && (window as any).plausible) {
                    (window as any).plausible(event, { props: properties });
                }
                break;
        }
    } catch (error) {
        logger.warn({ error, event }, 'Failed to track analytics event');
    }
}

/**
 * Identify a user (for cohort analysis)
 */
export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
    if (!analyticsEnabled) return;

    try {
        if (analyticsProvider === 'posthog' && typeof window !== 'undefined' && (window as any).posthog) {
            (window as any).posthog.identify(userId, traits);
        }
    } catch (error) {
        logger.warn({ error }, 'Failed to identify user');
    }
}

/**
 * Track page view
 */
export function trackPageView(path?: string): void {
    if (!analyticsEnabled) return;

    try {
        if (analyticsProvider === 'posthog' && typeof window !== 'undefined' && (window as any).posthog) {
            (window as any).posthog.capture('$pageview', { path: path || window.location.pathname });
        }
    } catch (error) {
        logger.warn({ error }, 'Failed to track page view');
    }
}

/**
 * Convenience tracking methods
 */
export const analytics = {
    canvasCreated: (canvasId: string) => trackEvent('canvas_created', { canvasId }),
    canvasDeleted: (canvasId: string) => trackEvent('canvas_deleted', { canvasId }),
    canvasShared: (canvasId: string, permission: string) => trackEvent('canvas_shared', { canvasId, permission }),
    itemCreated: (type: string) => trackEvent('item_created', { type }),
    templateUsed: (templateId: string) => trackEvent('template_used', { templateId }),
    exportCompleted: (format: string) => trackEvent('export_completed', { format }),
    searchPerformed: (queryLength: number) => trackEvent('search_performed', { queryLength }),
    errorOccurred: (errorType: string) => trackEvent('error_occurred', { errorType }),
};
