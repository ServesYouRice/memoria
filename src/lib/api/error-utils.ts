/**
 * API Error Handling Utilities
 *
 * Standardizes client-side error handling for API responses.
 *
 * @module lib/api/error-utils
 */

import { toast } from 'sonner';

/**
 * RFC 7807 Problem Details structure
 */
export interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
    errors?: Array<{ field: string; message: string }>;
}

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: unknown): string {
    // Handle ProblemDetails from API
    if (isProblemDetails(error)) {
        return error.detail || error.title || 'An error occurred';
    }

    // Handle Response objects
    if (error instanceof Response) {
        return `Request failed with status ${error.status}`;
    }

    // Handle Error objects
    if (error instanceof Error) {
        return error.message;
    }

    // Handle string errors
    if (typeof error === 'string') {
        return error;
    }

    return 'An unknown error occurred';
}

/**
 * Type guard for ProblemDetails
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        'title' in value &&
        'status' in value
    );
}

/**
 * Handle API errors with toast notification
 */
export function handleApiError(error: unknown, context?: string): void {
    const message = getErrorMessage(error);
    const fullMessage = context ? `${context}: ${message}` : message;

    toast.error(fullMessage);

    // Log for debugging
    console.error('API Error:', error);
}

/**
 * Parse API response and throw on error
 */
export async function parseApiResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        let errorData: unknown;
        try {
            errorData = await response.json();
        } catch {
            throw new Error(`Request failed with status ${response.status}`);
        }

        if (isProblemDetails(errorData)) {
            throw errorData;
        }

        throw new Error(getErrorMessage(errorData));
    }

    return response.json();
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('fetch')) {
        return true;
    }
    if (error instanceof Error && error.message.includes('network')) {
        return true;
    }
    return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
    if (isProblemDetails(error)) {
        return error.status === 401 || error.status === 403;
    }
    if (error instanceof Response) {
        return error.status === 401 || error.status === 403;
    }
    return false;
}

/**
 * Get user-friendly error message for common scenarios
 */
export function getFriendlyErrorMessage(error: unknown): string {
    if (isNetworkError(error)) {
        return 'Unable to connect. Please check your internet connection.';
    }

    if (isAuthError(error)) {
        return 'Your session has expired. Please log in again.';
    }

    return getErrorMessage(error);
}
