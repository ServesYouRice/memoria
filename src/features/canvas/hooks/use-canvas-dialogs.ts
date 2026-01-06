'use client';

import { useState } from 'react';
import { type CanvasItem } from '@/types/canvas';

/**
 * Dialog State Hook
 * 
 * Manages all dialog open/close states for the canvas board.
 * Extracted from CanvasBoard.tsx to reduce component complexity.
 */
export function useCanvasDialogs() {
    // Feature Dialogs
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [aiDialogOpen, setAiDialogOpen] = useState(false);
    const [tagFilterOpen, setTagFilterOpen] = useState(false);
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
    const [serendipityOpen, setSerendipityOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [whisperOpen, setWhisperOpen] = useState(false);
    const [arOpen, setAROpen] = useState(false);

    // Create Item Dialogs
    const [noteDialogOpen, setNoteDialogOpen] = useState(false);
    const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
    const [imageDialogOpen, setImageDialogOpen] = useState(false);
    const [pollDialogOpen, setPollDialogOpen] = useState(false);

    // Edit Item Dialogs
    const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false);
    const [editingNoteItem, setEditingNoteItem] = useState<CanvasItem | null>(null);
    const [editBookmarkDialogOpen, setEditBookmarkDialogOpen] = useState(false);
    const [editingBookmarkItem, setEditingBookmarkItem] = useState<CanvasItem | null>(null);
    const [editImageDialogOpen, setEditImageDialogOpen] = useState(false);
    const [editingImageItem, setEditingImageItem] = useState<CanvasItem | null>(null);

    // Comments Panel
    const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
    const [commentsItemId, setCommentsItemId] = useState<string | null>(null);

    // Helpers for opening edit dialogs
    const openEditNote = (item: CanvasItem) => {
        setEditingNoteItem(item);
        setEditNoteDialogOpen(true);
    };

    const openEditBookmark = (item: CanvasItem) => {
        setEditingBookmarkItem(item);
        setEditBookmarkDialogOpen(true);
    };

    const openEditImage = (item: CanvasItem) => {
        setEditingImageItem(item);
        setEditImageDialogOpen(true);
    };

    const openComments = (itemId: string) => {
        setCommentsItemId(itemId);
        setCommentsPanelOpen(true);
    };

    return {
        // Feature Dialogs
        exportDialogOpen, setExportDialogOpen,
        aiDialogOpen, setAiDialogOpen,
        tagFilterOpen, setTagFilterOpen,
        templateDialogOpen, setTemplateDialogOpen,
        versionHistoryOpen, setVersionHistoryOpen,
        serendipityOpen, setSerendipityOpen,
        templatesOpen, setTemplatesOpen,
        whisperOpen, setWhisperOpen,
        arOpen, setAROpen,

        // Create Item Dialogs
        noteDialogOpen, setNoteDialogOpen,
        bookmarkDialogOpen, setBookmarkDialogOpen,
        imageDialogOpen, setImageDialogOpen,
        pollDialogOpen, setPollDialogOpen,

        // Edit Item Dialogs
        editNoteDialogOpen, setEditNoteDialogOpen,
        editingNoteItem, setEditingNoteItem,
        editBookmarkDialogOpen, setEditBookmarkDialogOpen,
        editingBookmarkItem, setEditingBookmarkItem,
        editImageDialogOpen, setEditImageDialogOpen,
        editingImageItem, setEditingImageItem,

        // Comments Panel
        commentsPanelOpen, setCommentsPanelOpen,
        commentsItemId, setCommentsItemId,

        // Helpers
        openEditNote,
        openEditBookmark,
        openEditImage,
        openComments,
    };
}

export type CanvasDialogsState = ReturnType<typeof useCanvasDialogs>;
