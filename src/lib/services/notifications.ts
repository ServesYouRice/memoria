/**
 * Notification Service
 *
 * Centralized notification handling with toast and push support.
 *
 * @module lib/services/notifications
 */

import { toast } from 'sonner';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationOptions {
    title?: string;
    description?: string;
    duration?: number;
    action?: {
        label: string;
        onClick: () => void;
    };
}

/**
 * Show a toast notification
 */
export function notify(type: NotificationType, message: string, options?: NotificationOptions) {
    const { title, description, duration = 4000, action } = options || {};

    const toastOptions = {
        description: description || message,
        duration,
        action: action ? { label: action.label, onClick: action.onClick } : undefined,
    };

    switch (type) {
        case 'success':
            toast.success(title || message, toastOptions);
            break;
        case 'error':
            toast.error(title || message, toastOptions);
            break;
        case 'warning':
            toast.warning(title || message, toastOptions);
            break;
        case 'info':
            toast.info(title || message, toastOptions);
            break;
    }
}

/**
 * Convenience wrappers
 */
export const notifications = {
    success: (message: string, options?: NotificationOptions) => notify('success', message, options),
    error: (message: string, options?: NotificationOptions) => notify('error', message, options),
    warning: (message: string, options?: NotificationOptions) => notify('warning', message, options),
    info: (message: string, options?: NotificationOptions) => notify('info', message, options),

    // Common notifications
    saved: () => notify('success', 'Changes saved'),
    deleted: (item = 'item') => notify('success', `${item} deleted`),
    copied: () => notify('success', 'Copied to clipboard'),

    networkError: () => notify('error', 'Network error. Please check your connection.'),
    sessionExpired: () => notify('warning', 'Session expired. Please log in again.'),
    unauthorized: () => notify('error', 'You are not authorized to perform this action.'),

    loading: (message = 'Loading...') => toast.loading(message),
    dismiss: (id?: string | number) => toast.dismiss(id),
};

/**
 * Promise-based notification
 */
export async function notifyPromise<T>(
    promise: Promise<T>,
    messages: {
        loading: string;
        success: string | ((data: T) => string);
        error: string | ((error: unknown) => string);
    }
): Promise<T> {
    toast.promise(promise, {
        loading: messages.loading,
        success: typeof messages.success === 'function'
            ? messages.success
            : () => messages.success as string,
        error: typeof messages.error === 'function'
            ? messages.error
            : () => messages.error as string,
    });
    return promise;
}

/**
 * Request browser notification permission
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
        return 'denied';
    }

    if (Notification.permission === 'default') {
        return Notification.requestPermission();
    }

    return Notification.permission;
}

/**
 * Show browser push notification
 */
export async function showPushNotification(
    title: string,
    options?: NotificationOptions
): Promise<void> {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    new Notification(title, {
        body: options?.description,
        icon: '/icons/icon-192.png',
    });
}
