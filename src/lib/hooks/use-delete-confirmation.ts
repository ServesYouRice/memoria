/**
 * Delete Confirmation Hook
 *
 * Provides a consistent delete confirmation dialog across the app.
 * Replaces inline confirm() calls with a better UX.
 *
 * @module lib/hooks/use-delete-confirmation
 */

import { useState, useCallback } from 'react';

export interface DeleteConfirmationOptions {
    /** Title for the confirmation dialog */
    title?: string;
    /** Message to display */
    message?: string;
    /** Confirm button text */
    confirmText?: string;
    /** Cancel button text */
    cancelText?: string;
    /** Callback when confirmed */
    onConfirm: () => void | Promise<void>;
    /** Callback when cancelled */
    onCancel?: () => void;
}

export interface DeleteConfirmationState {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    isLoading: boolean;
}

export interface DeleteConfirmationActions {
    /** Open the confirmation dialog */
    openConfirmation: () => void;
    /** Confirm the deletion */
    confirm: () => Promise<void>;
    /** Cancel the deletion */
    cancel: () => void;
    /** Close the dialog */
    close: () => void;
}

export function useDeleteConfirmation(
    options: DeleteConfirmationOptions
): [DeleteConfirmationState, DeleteConfirmationActions] {
    const {
        title = 'Delete Item',
        message = 'Are you sure you want to delete this item? This action cannot be undone.',
        confirmText = 'Delete',
        cancelText = 'Cancel',
        onConfirm,
        onCancel,
    } = options;

    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const openConfirmation = useCallback(() => {
        setIsOpen(true);
    }, []);

    const confirm = useCallback(async () => {
        setIsLoading(true);
        try {
            await onConfirm();
            setIsOpen(false);
        } finally {
            setIsLoading(false);
        }
    }, [onConfirm]);

    const cancel = useCallback(() => {
        onCancel?.();
        setIsOpen(false);
    }, [onCancel]);

    const close = useCallback(() => {
        if (!isLoading) {
            setIsOpen(false);
        }
    }, [isLoading]);

    return [
        {
            isOpen,
            title,
            message,
            confirmText,
            cancelText,
            isLoading,
        },
        {
            openConfirmation,
            confirm,
            cancel,
            close,
        },
    ];
}
