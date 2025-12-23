'use client';

import React, { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Stage, Layer } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import { NoteAdd, Bookmark, Image, Poll } from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { useCanvasItems, useDeleteCanvasItem, useCreateCanvasItem, useUpdateCanvasItem, canvasItemKeys } from '@/lib/hooks/use-canvas-items';
import { useQueryClient } from '@tanstack/react-query';
import { useCanvasHistory, Command } from '@/lib/hooks/use-canvas-history';
import { useSelectionBox } from '@/lib/hooks/use-selection-box';
import { useUpdateCanvasThumbnail } from '@/lib/hooks/use-canvases';
import { useCollaboration } from '@/lib/hooks/use-collaboration';
import { useVirtualItems } from '@/lib/hooks/use-virtual-items';
import { useCanvasVersions, useRestoreVersion } from '@/lib/hooks/use-canvas-versions';
import { useDrawingInteraction } from '@/features/canvas/hooks/use-drawing-interaction';
import { TimeMachineControl } from '@/features/canvas/components/TimeMachineControl';
import { SerendipityDialog } from '@/features/canvas/components/SerendipityDialog';
import { TemplatesGallery } from '@/features/canvas/components/TemplatesGallery';
import { WhisperMode } from '@/features/canvas/components/WhisperMode';
import { ARCanvasLayer } from '@/features/canvas/components/ARCanvasLayer';
import { calculateAutopilotLayout } from '@/lib/ai/autopilot-service';
import { stripHtmlTags } from '@/lib/utils/html';
import { useGesture } from '@use-gesture/react';
import { useCanvasKeyboard } from '@/features/canvas/hooks/use-canvas-keyboard';
import Konva from 'konva';

import {
    ItemType,
    CanvasItem,
    isNoteContent,
    isDrawingContent,
    isShapeContent,
    isArrowContent,
    isTextContent,
    isFrameContent,
    isEmbedContent,
    isPollContent
} from '@/types/canvas';

// Components
import { BookmarkItem } from '@/features/canvas/components/BookmarkItem';
import { NoteItem } from '@/features/canvas/components/NoteItem';
import { ImageItem } from '@/features/canvas/components/ImageItem';
import { DrawingItem } from '@/features/canvas/components/DrawingItem';
import { ShapeItem } from '@/features/canvas/components/ShapeItem';
import { ArrowItem } from '@/features/canvas/components/ArrowItem';
import { TextItem } from '@/features/canvas/components/TextItem';
import { FrameItem } from '@/features/canvas/components/FrameItem';
import { EmbedItem } from '@/features/canvas/components/EmbedItem';
import { PollItem } from '@/features/canvas/components/PollItem';
import { SelectionBox } from '@/features/canvas/components/SelectionBox';
import { CanvasContextMenu, ContextMenuPosition } from '@/features/canvas/components/CanvasContextMenu';
import { CommentsPanel } from '@/features/canvas/components/CommentsPanel';
import { DrawingToolbar } from '@/features/canvas/components/DrawingToolbar';
import { CanvasHeader } from '@/features/canvas/components/CanvasHeader';
import { TagFilterPanel } from '@/features/canvas/components/TagFilterPanel';
import { GridOverlay } from '@/features/canvas/components/GridOverlay';
import { CursorChat } from '@/features/canvas/components/CursorChat';
import { ReactionSelector } from '@/features/canvas/components/ReactionSelector';
import { RemoteCursorChat } from '@/features/canvas/components/RemoteCursorChat';
import { RemoteReaction } from '@/features/canvas/components/RemoteReaction';
import { AlignmentToolbar } from '@/features/canvas/components/AlignmentToolbar';
import { MainToolbar } from '@/features/canvas/components/MainToolbar';

// Dialogs
const EditNoteDialog = dynamic(() => import('@/features/canvas/components/EditNoteDialog').then(mod => mod.EditNoteDialog), { ssr: false });
const EditBookmarkDialog = dynamic(() => import('@/features/canvas/components/EditBookmarkDialog').then(mod => mod.EditBookmarkDialog), { ssr: false });
const EditImageDialog = dynamic(() => import('@/features/canvas/components/EditImageDialog').then(mod => mod.EditImageDialog), { ssr: false });
const CreateNoteDialog = dynamic(() => import('@/features/canvas/components/CreateNoteDialog').then(mod => mod.CreateNoteDialog), { ssr: false });
const CreateBookmarkDialog = dynamic(() => import('@/features/canvas/components/CreateBookmarkDialog').then(mod => mod.CreateBookmarkDialog), { ssr: false });
const CreateImageDialog = dynamic(() => import('@/features/canvas/components/CreateImageDialog').then(mod => mod.CreateImageDialog), { ssr: false });
const CreatePollDialog = dynamic(() => import('@/features/canvas/components/CreatePollDialog').then(mod => mod.CreatePollDialog), { ssr: false });
const SaveAsTemplateDialog = dynamic(() => import('@/features/canvas/components/SaveAsTemplateDialog').then(mod => mod.SaveAsTemplateDialog), { ssr: false });
const VersionHistoryDialog = dynamic(() => import('@/features/canvas/components/VersionHistoryDialog').then(mod => mod.VersionHistoryDialog), { ssr: false });
const ExportDialog = dynamic(() => import('@/features/canvas/components/ExportDialog').then(mod => mod.ExportDialog), { ssr: false });
const AIDialog = dynamic(() => import('@/features/canvas/components/AIDialog').then(mod => mod.AIDialog), { ssr: false });

interface CanvasBoardProps {
    canvasId: string;
}

export function CanvasBoard({ canvasId }: CanvasBoardProps) {
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [aiDialogOpen, setAiDialogOpen] = useState(false);
    const [tagFilterOpen, setTagFilterOpen] = useState(false);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    // UI State
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    // Store state
    const {
        gridVisible, setGridVisible,
        snapToGrid: snapToGridEnabled, setSnapToGrid: setSnapToGridEnabled,
        activeTool
    } = useCanvasStore();

    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
    const [canvasName, setCanvasName] = useState('Untitled Canvas');
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [isPresentationMode, setIsPresentationMode] = useState(false);
    const [isTimeMachineActive, setTimeMachineActive] = useState(false);

    const [timeMachineIndex, setTimeMachineIndex] = useState(0);
    const [serendipityOpen, setSerendipityOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [whisperOpen, setWhisperOpen] = useState(false);
    const [arOpen, setAROpen] = useState(false);

    const stageRef = useRef<Konva.Stage>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const queryClient = useQueryClient();

    useGesture(
        {
            onPinch: ({ offset: [d] }) => {
                handleZoomChange(d);
            },
        },
        {
            target: containerRef,
            pinch: { scaleBounds: { min: 0.1, max: 5 }, from: () => [zoom, 0] },
            drag: { enabled: false } // We handle drag via Konva
        }
    );

    // Fetch all items
    const { data } = useCanvasItems(canvasId);
    const allItems = data.items;
    const { mutateAsync: deleteItem } = useDeleteCanvasItem();
    const { mutateAsync: createItem } = useCreateCanvasItem();
    const { mutate: updateItem } = useUpdateCanvasItem();

    // Time Machine Data
    const { data: versionsData } = useCanvasVersions(canvasId);
    const { mutateAsync: restoreVersion } = useRestoreVersion();
    const versions = versionsData?.versions || [];

    // Calculate displayed items
    const displayedItems = React.useMemo(() => {
        if (isTimeMachineActive && versions[timeMachineIndex]?.snapshot) {
            return versions[timeMachineIndex].snapshot as CanvasItem[];
        }
        return allItems;
    }, [isTimeMachineActive, versions, timeMachineIndex, allItems]);

    // History manager

    // History manager
    const { addCommand, undo, redo, canUndo, canRedo } = useCanvasHistory();

    // Thumbnail
    const updateThumbnail = useUpdateCanvasThumbnail();

    // Selection box
    const {
        isSelecting,
        selectionBox,
        startSelection,
        updateSelection,
        endSelection,
        isItemInSelection,
    } = useSelectionBox();

    // Remote interaction state
    const [remoteMessages, setRemoteMessages] = useState<any[]>([]);
    const [remoteReactions, setRemoteReactions] = useState<any[]>([]);
    const [followingUserId, setFollowingUserId] = useState<string | null>(null);

    const handleRemoteMessage = (message: any) => {
        if (message.type === 'chat') {
            const id = Date.now().toString() + Math.random().toString();
            setRemoteMessages((prev) => [...prev, { ...message, id }]);
            // Auto-remove after 5 seconds
            setTimeout(() => {
                setRemoteMessages((prev) => prev.filter((m) => m.id !== id));
            }, 5000);
        } else if (message.type === 'reaction') {
            const id = Date.now().toString() + Math.random().toString();
            setRemoteReactions((prev) => [...prev, { ...message, id }]);
            // Auto-remove after 3 seconds
            setTimeout(() => {
                setRemoteReactions((prev) => prev.filter((r) => r.id !== id));
            }, 3000);
        }
    };

    // Collaboration
    const { data: session } = useSession();
    const { users: collaborators, cursors, connected: collaborationConnected, broadcastMessage } = useCollaboration({
        canvasId,
        name: session?.user?.name || 'Anonymous',
        userId: session?.user?.id || 'anon',
        email: session?.user?.email || 'anon@example.com',
        onMessage: handleRemoteMessage,
    });

    // Follow Mode Logic
    React.useEffect(() => {
        if (followingUserId) {
            const targetCursor = cursors.find((c) => c.userId === followingUserId);
            if (targetCursor) {
                // Center viewport on cursor
                // Assuming cursor positions are in canvas coordinates (absolute)
                // Viewport Center = Screen Center
                // New Position = Screen Center - (Target * Zoom)
                const newX = (window.innerWidth / 2) - (targetCursor.position.x * zoom);
                const newY = (window.innerHeight / 2) - (targetCursor.position.y * zoom);
                setPosition({ x: newX, y: newY });
            }
        }
    }, [cursors, followingUserId, zoom]);

    const isDrawing = activeTool === 'draw';

    // Drawing interaction
    const {
        handleMouseDown: handleDrawingMouseDown,
        handleMouseMove: handleDrawingMouseMove,
        handleMouseUp: handleDrawingMouseUp
    } = useDrawingInteraction({
        canvasId
    });

    // Handle space key
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                setIsSpacePressed(e.type === 'keydown');
            }
        };
        window.addEventListener('keydown', handleKey);
        window.addEventListener('keyup', handleKey);
        return () => {
            window.removeEventListener('keydown', handleKey);
            window.removeEventListener('keyup', handleKey);
        };
    }, []);

    // Extract tags
    const { allTags, tagCounts } = React.useMemo(() => {
        const counts: Record<string, number> = {};
        allItems.forEach((item) => {
            if (item.tags && Array.isArray(item.tags)) {
                item.tags.forEach((tag) => {
                    counts[tag] = (counts[tag] || 0) + 1;
                });
            }
        });
        return {
            allTags: Object.keys(counts).sort(),
            tagCounts: counts,
        };
    }, [allItems]);

    // Filter items
    const items = React.useMemo(() => {
        let filtered = allItems;
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter((item) => {
                if (item.type === ItemType.NOTE) {
                    const noteContent = item.content as { text: string };
                    const plainText = stripHtmlTags(noteContent.text || '');
                    return plainText.toLowerCase().includes(query);
                } else if (item.type === ItemType.BOOKMARK) {
                    const bookmarkContent = item.content as any;
                    return (
                        bookmarkContent.url?.toLowerCase().includes(query) ||
                        bookmarkContent.title?.toLowerCase().includes(query) ||
                        bookmarkContent.description?.toLowerCase().includes(query) ||
                        bookmarkContent.siteName?.toLowerCase().includes(query)
                    );
                } else if (item.type === ItemType.IMAGE) {
                    const imageContent = item.content as any;
                    return (
                        imageContent.filename?.toLowerCase().includes(query) ||
                        imageContent.alt?.toLowerCase().includes(query)
                    );
                }
                return false;
            });
        }
        if (selectedTags.length > 0) {
            filtered = filtered.filter((item) => {
                if (!item.tags || !Array.isArray(item.tags)) return false;
                return selectedTags.every((tag) => item.tags.includes(tag));
            });
        }
        return filtered;
    }, [allItems, searchQuery, selectedTags]);

    // Fetch canvas details
    // Fetch canvas details - optimized to fetch single canvas
    React.useEffect(() => {
        const fetchCanvas = async () => {
            try {
                const response = await fetch(`/api/v1/canvases/${canvasId}`);
                if (response.ok) {
                    const canvas = await response.json();
                    setCanvasName(canvas.name);
                    setZoom(canvas.zoomLevel || 1);
                    setPosition({ x: canvas.panX || 0, y: canvas.panY || 0 });
                }
            } catch (err) {
                // Silent fail - canvas name will use default
            }
        };
        fetchCanvas();
    }, [canvasId]);

    // Update size
    React.useEffect(() => {
        const HEADER_HEIGHT = 64;
        const updateSize = () => {
            setStageSize({
                width: window.innerWidth,
                height: window.innerHeight - HEADER_HEIGHT,
            });
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Cursor Chat & Reactions
    const [chatOpen, setChatOpen] = useState(false);
    const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
    const [reactionOpen, setReactionOpen] = useState(false);
    const [reactionPosition, setReactionPosition] = useState({ x: 0, y: 0 });

    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
    const [noteDialogOpen, setNoteDialogOpen] = useState(false);
    const [imageDialogOpen, setImageDialogOpen] = useState(false);
    const [pollDialogOpen, setPollDialogOpen] = useState(false);
    const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false);
    const [editingNoteItem, setEditingNoteItem] = useState<CanvasItem | null>(null);
    const [editBookmarkDialogOpen, setEditBookmarkDialogOpen] = useState(false);
    const [editingBookmarkItem, setEditingBookmarkItem] = useState<CanvasItem | null>(null);
    const [editImageDialogOpen, setEditImageDialogOpen] = useState(false);
    const [editingImageItem, setEditingImageItem] = useState<CanvasItem | null>(null);
    const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);
    const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
    const [commentsItemId, setCommentsItemId] = useState<string | null>(null);
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

    const handleDuplicate = async () => {
        if (!selectedItemId) return;
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
            try {
                await createItem({
                    canvasId,
                    type: selectedItem.type,
                    positionX: selectedItem.positionX + 20,
                    positionY: selectedItem.positionY + 20,
                    width: selectedItem.width,
                    height: selectedItem.height,
                    zIndex: selectedItem.zIndex,
                    content: selectedItem.content,
                    tags: selectedItem.tags || [],
                });
            } catch (err) {
                console.error('Failed to duplicate item:', err);
            }
        }
    };

    const handleCopy = () => {
        if (!selectedItemId) return;
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
            const copyData = {
                type: selectedItem.type,
                content: selectedItem.content,
                width: selectedItem.width,
                height: selectedItem.height,
            };
            navigator.clipboard.writeText(JSON.stringify(copyData));
        }
    };

    const handleAddNoteFromAI = (text: string) => {
        const centerX = (-position.x + stageSize.width / 2) / zoom;
        const centerY = (-position.y + stageSize.height / 2) / zoom;

        createItem({
            canvasId,
            type: ItemType.NOTE,
            positionX: centerX - 150, // Center the 300px wide note
            positionY: centerY - 100, // Center the 200px high note
            width: 300,
            height: 200,
            zIndex: 100,
            tags: ['ai-generated'],
            content: { text: text }
        });
    };

    const handleDelete = async () => {
        if (selectedItemIds.size > 0) {
            try {
                const itemsToDelete = allItems.filter((item) => selectedItemIds.has(item.id));
                const deleteCommand: Command = {
                    type: 'delete',
                    description: `Delete ${itemsToDelete.length} items`,
                    execute: async () => {
                        await Promise.all(
                            itemsToDelete.map((item) =>
                                deleteItem({ itemId: item.id, version: item.version })
                            )
                        );
                    },
                    undo: async () => {
                        await Promise.all(
                            itemsToDelete.map((item) =>
                                createItem({
                                    canvasId,
                                    type: item.type,
                                    positionX: item.positionX,
                                    positionY: item.positionY,
                                    width: item.width,
                                    height: item.height,
                                    zIndex: item.zIndex,
                                    content: item.content,
                                    tags: item.tags || [],
                                })
                            )
                        );
                    },
                };
                await deleteCommand.execute();
                addCommand(deleteCommand);
                setSelectedItemIds(new Set());
            } catch (err) {
                console.error('Failed to bulk delete items:', err);
            }
        } else if (selectedItemId) {
            const selectedItem = allItems.find((item) => item.id === selectedItemId);
            if (selectedItem) {
                try {
                    const deleteCommand: Command = {
                        type: 'delete',
                        description: `Delete ${selectedItem.type}`,
                        execute: async () => {
                            await deleteItem({ itemId: selectedItem.id, version: selectedItem.version });
                        },
                        undo: async () => {
                            await createItem({
                                canvasId,
                                type: selectedItem.type,
                                positionX: selectedItem.positionX,
                                positionY: selectedItem.positionY,
                                width: selectedItem.width,
                                height: selectedItem.height,
                                zIndex: selectedItem.zIndex,
                                content: selectedItem.content,
                                tags: selectedItem.tags || [],
                            });
                        },
                    };
                    await deleteCommand.execute();
                    addCommand(deleteCommand);
                    setSelectedItemId(null);
                } catch (err) {
                    console.error('Failed to delete item:', err);
                }
            }
        }
    };

    const handleSelectAll = () => {
        const allIds = new Set(allItems.map(item => item.id));
        setSelectedItemIds(allIds);
        setSelectedItemId(null);
    };

    const handleEscape = () => {
        setSelectedItemId(null);
        setSelectedItemIds(new Set());
        setContextMenuPosition(null);
    };

    const handlePaste = () => {
        // Paste logic is currently minimal or handled by browser events
    };

    // Use keyboard hook
    useCanvasKeyboard({
        onDelete: handleDelete,
        onUndo: undo,
        onRedo: redo,
        onCopy: handleCopy,
        onPaste: handlePaste,
        onSelectAll: handleSelectAll,
        onDuplicate: handleDuplicate,
        onEscape: handleEscape,
        enabled: !isDrawing
    });

    // Residual keyboard shortcuts (Chat, Reaction, Arrows)
    React.useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.key === '/' && !isDrawing) {
                e.preventDefault();
                const stage = stageRef.current;
                if (stage) {
                    const ptr = stage.getPointerPosition();
                    if (ptr) {
                        setChatPosition({ x: ptr.x, y: ptr.y + 64 });
                    }
                    setChatOpen(true);
                }
            }

            if (e.key === 'e' && !isDrawing && !e.ctrlKey && !e.metaKey) {
                if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
                e.preventDefault();
                const stage = stageRef.current;
                if (stage) {
                    const ptr = stage.getPointerPosition();
                    if (ptr) {
                        setReactionPosition({ x: ptr.x, y: ptr.y + 64 });
                    }
                    setReactionOpen(true);
                }
            }

            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                if ((selectedItemId || selectedItemIds.size > 0) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
                    e.preventDefault();
                    const MOVE_STEP = e.shiftKey ? 10 : 1;
                    const dx = e.key === 'ArrowLeft' ? -MOVE_STEP : e.key === 'ArrowRight' ? MOVE_STEP : 0;
                    const dy = e.key === 'ArrowUp' ? -MOVE_STEP : e.key === 'ArrowDown' ? MOVE_STEP : 0;

                    if (selectedItemId) {
                        const item = allItems.find(i => i.id === selectedItemId);
                        if (item) {
                            updateItem({
                                itemId: selectedItemId,
                                data: {
                                    positionX: item.positionX + dx,
                                    positionY: item.positionY + dy,
                                    version: item.version
                                }
                            });
                        }
                    } else if (selectedItemIds.size > 0) {
                        selectedItemIds.forEach(id => {
                            const item = allItems.find(i => i.id === id);
                            if (item) {
                                updateItem({
                                    itemId: id,
                                    data: {
                                        positionX: item.positionX + dx,
                                        positionY: item.positionY + dy,
                                        version: item.version
                                    }
                                });
                            }
                        });
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDrawing, selectedItemId, selectedItemIds, allItems, updateItem, stageRef]);

    // Context menu
    React.useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            if (stageRef.current?.container().contains(e.target as Node)) {
                e.preventDefault();
            }
        };
        window.addEventListener('contextmenu', handleContextMenu);
        return () => window.removeEventListener('contextmenu', handleContextMenu);
    }, []);

    const handleStageMouseDown = (e: any) => {
        // Draw logic
        if (isDrawing) {
            handleDrawingMouseDown(e);
            return;
        }

        // Only start selection on empty canvas
        if (e.target === e.target.getStage()) {
            const stage = e.target.getStage();
            const pointerPos = stage.getPointerPosition();
            if (pointerPos) {
                startSelection({
                    x: (pointerPos.x - position.x) / zoom,
                    y: (pointerPos.y - position.y) / zoom,
                });
            }
        }
    };

    const handleStageMouseMove = (e: any) => {
        // Draw logic
        if (isDrawing) {
            handleDrawingMouseMove(e);
            return;
        }

        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();

        if (pointerPos) {
            if (isSelecting) {
                updateSelection({
                    x: (pointerPos.x - position.x) / zoom,
                    y: (pointerPos.y - position.y) / zoom,
                });
            }
        }
    };

    const handleStageMouseUp = () => {
        if (isDrawing) {
            handleDrawingMouseUp();
            return;
        }

        if (isSelecting) {
            const finalBox = endSelection();
            if (finalBox && finalBox.width > 5 && finalBox.height > 5) {
                const selected = new Set<string>();
                items.forEach((item) => {
                    if (isItemInSelection({
                        x: item.positionX,
                        y: item.positionY,
                        width: item.width,
                        height: item.height,
                    }, finalBox)) {
                        selected.add(item.id);
                    }
                });
                setSelectedItemIds(selected);
                setSelectedItemId(null);
            } else {
                setSelectedItemId(null);
                setSelectedItemIds(new Set());
            }
        }
    };

    const handleStageClick = (e: any) => {
        if (e.target === e.target.getStage()) {
            setSelectedItemId(null);
            setSelectedItemIds(new Set());
        }
    };

    const handleCanvasNameChange = async (name: string) => {
        setCanvasName(name);
        try {
            await fetch(`/api/v1/canvases/${canvasId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
        } catch (err) {
            console.error('Failed to update canvas name:', err);
        }
    };

    const handleZoomChange = (newZoom: number) => {
        setZoom(newZoom);
        if (stageRef.current) {
            stageRef.current.scale({ x: newZoom, y: newZoom });
        }
    };

    const handleFitToScreen = () => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
        if (stageRef.current) {
            stageRef.current.position({ x: 0, y: 0 });
            stageRef.current.scale({ x: 1, y: 1 });
        }
    };

    const handleContextMenu = (e: React.MouseEvent | any, itemId: string) => {
        e.evt?.preventDefault();
        e.preventDefault?.();
        setSelectedItemId(itemId);
        setContextMenuPosition({ x: (e.clientX || e.evt.clientX), y: (e.clientY || e.evt.clientY) });
    };

    const handleNoteDoubleClick = (item: CanvasItem) => {
        if (item.type === ItemType.NOTE || item.type === ItemType.TEXT) {
            setEditingNoteItem(item);
            setEditNoteDialogOpen(true);
        }
    };

    const handleBookmarkDoubleClick = (item: CanvasItem) => {
        if (item.type === ItemType.BOOKMARK) {
            setEditingBookmarkItem(item);
            setEditBookmarkDialogOpen(true);
        }
    };

    const handleImageDoubleClick = (item: CanvasItem) => {
        if (item.type === ItemType.IMAGE) {
            setEditingImageItem(item);
            setEditImageDialogOpen(true);
        }
    };

    const handleDeleteFromMenu = async () => {
        if (!selectedItemId) return;
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
            try {
                const deleteCommand: Command = {
                    type: 'delete',
                    description: `Delete ${selectedItem.type}`,
                    execute: async () => {
                        await deleteItem({
                            itemId: selectedItem.id,
                            version: selectedItem.version,
                        });
                    },
                    undo: async () => {
                        await createItem({
                            canvasId,
                            type: selectedItem.type,
                            positionX: selectedItem.positionX,
                            positionY: selectedItem.positionY,
                            width: selectedItem.width,
                            height: selectedItem.height,
                            zIndex: selectedItem.zIndex,
                            content: selectedItem.content,
                            tags: selectedItem.tags || [],
                        });
                    },
                };
                await deleteCommand.execute();
                addCommand(deleteCommand);
                setSelectedItemId(null);
            } catch (err) {
                console.error('Failed to delete item:', err);
            }
        }
    };

    const handleOpenComments = () => {
        if (!selectedItemId) return;
        setCommentsItemId(selectedItemId);
        setCommentsPanelOpen(true);
    };

    const handleSelectItem = (id: string, multi: boolean = false) => {
        if (multi) {
            const newSet = new Set(selectedItemIds);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            setSelectedItemIds(newSet);
            setSelectedItemId(null);
        } else {
            setSelectedItemId(id);
            setSelectedItemIds(new Set([id]));
        }
    };

    const handleItemChange = (id: string, data: any) => {
        const item = allItems.find(i => i.id === id);
        if (item) {
            updateItem({
                itemId: id,
                data: {
                    ...data,
                    version: item.version
                }
            });
        }
    };

    const handleDragEnd = (e: any, item: CanvasItem) => {
        updateItem({
            itemId: item.id,
            data: {
                positionX: e.target.x(),
                positionY: e.target.y(),
                version: item.version
            }
        });
    };

    const generateThumbnail = React.useCallback(() => {
        if (!stageRef.current) return;
        try {
            const thumbnail = stageRef.current.toDataURL({
                pixelRatio: 0.3,
                mimeType: 'image/jpeg',
                quality: 0.6,
            });
            updateThumbnail.mutate({ canvasId, thumbnail });
        } catch (err) {
            console.error('Failed to generate thumbnail:', err);
        }
    }, [canvasId, updateThumbnail]);

    React.useEffect(() => {
        if (allItems.length === 0) return;
        const timeoutId = setTimeout(() => {
            generateThumbnail();
        }, 3000);
        return () => clearTimeout(timeoutId);
    }, [allItems, generateThumbnail]);



    const handleAlign = (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        if (selectedItemIds.size < 2) return;
        const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));
        if (selectedItems.length === 0) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        selectedItems.forEach(item => {
            minX = Math.min(minX, item.positionX);
            maxX = Math.max(maxX, item.positionX + item.width);
            minY = Math.min(minY, item.positionY);
            maxY = Math.max(maxY, item.positionY + item.height);
        });

        const centerX = minX + (maxX - minX) / 2;
        const centerY = minY + (maxY - minY) / 2;

        selectedItems.forEach(item => {
            let newX = item.positionX;
            let newY = item.positionY;

            switch (type) {
                case 'left': newX = minX; break;
                case 'center': newX = centerX - item.width / 2; break;
                case 'right': newX = maxX - item.width; break;
                case 'top': newY = minY; break;
                case 'middle': newY = centerY - item.height / 2; break;
                case 'bottom': newY = maxY - item.height; break;
            }

            if (newX !== item.positionX || newY !== item.positionY) {
                updateItem({
                    itemId: item.id,
                    data: { positionX: newX, positionY: newY, version: item.version }
                });
            }
        });
    };

    const handleDistribute = (type: 'horizontal' | 'vertical') => {
        if (selectedItemIds.size < 3) return;
        const selectedItems = allItems.filter(item => selectedItemIds.has(item.id));

        if (type === 'horizontal') {
            selectedItems.sort((a, b) => a.positionX - b.positionX);
            const first = selectedItems[0];
            const last = selectedItems[selectedItems.length - 1];
            if (!first || !last) return;

            const totalWidth = last.positionX + last.width - first.positionX;
            const itemsWidth = selectedItems.reduce((acc, item) => acc + item.width, 0);
            const gap = (totalWidth - itemsWidth) / (selectedItems.length - 1);

            let currentX = first.positionX;
            selectedItems.forEach((item, index) => {
                if (index > 0 && index < selectedItems.length) {
                    updateItem({ itemId: item.id, data: { positionX: currentX, version: item.version } });
                }
                currentX += item.width + gap;
            });
        } else {
            selectedItems.sort((a, b) => a.positionY - b.positionY);
            const first = selectedItems[0];
            const last = selectedItems[selectedItems.length - 1];
            if (!first || !last) return;

            const totalHeight = last.positionY + last.height - first.positionY;
            const itemsHeight = selectedItems.reduce((acc, item) => acc + item.height, 0);
            const gap = (totalHeight - itemsHeight) / (selectedItems.length - 1);

            let currentY = first.positionY;
            selectedItems.forEach((item, index) => {
                if (index > 0 && index < selectedItems.length) {
                    updateItem({ itemId: item.id, data: { positionY: currentY, version: item.version } });
                }
                currentY += item.height + gap;
            });
        }
    };
    const renderedItems = useVirtualItems(displayedItems.map(item => ({
        ...item,
        x: item.positionX,
        y: item.positionY,
    })), {
        viewport: {
            x: position.x,
            y: position.y,
            width: stageSize.width,
            height: stageSize.height,
        },
        zoom,
        padding: 500,
    });

    return (
        <Box ref={containerRef} sx={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            <CanvasHeader
                canvasId={canvasId}
                canvasName={canvasName}
                onCanvasNameChange={handleCanvasNameChange}
                zoom={zoom}
                onZoomChange={handleZoomChange}
                onFitToScreen={handleFitToScreen}
                onExport={() => setExportDialogOpen(true)}
                onSaveAsTemplate={() => setTemplateDialogOpen(true)}
                onVersionHistory={() => setVersionHistoryOpen(true)}
                onTagFilter={() => setTagFilterOpen(true)}
                onAI={() => setAiDialogOpen(true)}
                activeTagCount={selectedTags.length}
                gridVisible={gridVisible}
                onGridToggle={() => setGridVisible(!gridVisible)}
                snapEnabled={snapToGridEnabled}
                onSnapToggle={() => setSnapToGridEnabled(!snapToGridEnabled)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                collaborators={collaborators}
                collaborationConnected={collaborationConnected}
                onFollowUser={(userId: string) => setFollowingUserId(userId === followingUserId ? null : userId)}
                followingUserId={followingUserId}
                onPresentationMode={() => setIsPresentationMode(!isPresentationMode)}
                isPresentationMode={isPresentationMode}
                onTimeMachine={() => {
                    setTimeMachineActive(!isTimeMachineActive);
                    if (!isTimeMachineActive && versions.length > 0) {
                        setTimeMachineIndex(versions.length - 1);
                    }
                }}
                onSerendipity={() => setSerendipityOpen(true)}
                onTemplates={() => setTemplatesOpen(true)}
                onAutopilot={async () => {
                    const actions = await calculateAutopilotLayout(allItems);
                    if (actions.length > 0 && confirm(`Autopilot will reorganize ${actions.length} items. Continue?`)) {
                        for (const action of actions) {
                            const item = allItems.find(i => i.id === action.itemId);
                            if (item) {
                                await updateItem({
                                    itemId: action.itemId,
                                    data: {
                                        version: item.version,
                                        positionX: action.newPosition.x,
                                        positionY: action.newPosition.y
                                    }
                                });
                            }
                        }
                    }
                }}
                onWhisper={() => setWhisperOpen(true)}
                onAR={() => setAROpen(true)}
            />

            {!isPresentationMode && <MainToolbar />}

            {!isPresentationMode && activeTool === 'draw' && <DrawingToolbar />}

            <Box sx={{ flexGrow: 1, position: 'relative', overflow: 'hidden', cursor: isDrawing ? 'crosshair' : 'default', bgcolor: '#f0f2f5' }}>
                {!isDrawing && !isPresentationMode && (
                    <SpeedDial
                        ariaLabel="Add Item"
                        sx={{ position: 'absolute', bottom: 16, right: 16 }}
                        icon={<SpeedDialIcon />}
                    >
                        <SpeedDialAction icon={<NoteAdd />} tooltipTitle="Note" onClick={() => setNoteDialogOpen(true)} />
                        <SpeedDialAction icon={<Bookmark />} tooltipTitle="Bookmark" onClick={() => setBookmarkDialogOpen(true)} />
                        <SpeedDialAction icon={<Image />} tooltipTitle="Image" onClick={() => setImageDialogOpen(true)} />
                        <SpeedDialAction icon={<Poll />} tooltipTitle="Poll" onClick={() => setPollDialogOpen(true)} />
                    </SpeedDial>
                )}

                <Stage
                    width={stageSize.width}
                    height={stageSize.height}
                    scaleX={zoom}
                    scaleY={zoom}
                    x={position.x}
                    y={position.y}

                    draggable={!isDrawing && !isSpacePressed && !isTimeMachineActive}
                    onMouseDown={handleStageMouseDown}
                    onMouseMove={handleStageMouseMove}
                    onMouseUp={handleStageMouseUp}
                    onClick={handleStageClick}
                    ref={stageRef}
                    onContextMenu={(e) => e.evt.preventDefault()}
                >
                    <GridOverlay
                        width={stageSize.width}
                        height={stageSize.height}
                        zoom={zoom}
                        gridSize={20}
                        offset={{ x: -position.x / zoom, y: -position.y / zoom }}
                        visible={gridVisible}
                    />
                    <Layer>
                        {renderedItems.map(item => {
                            const isSelected = selectedItemIds.has(item.id);

                            if (item.type === ItemType.NOTE && isNoteContent(item.content)) {
                                return (
                                    <NoteItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                        onDoubleClick={() => handleNoteDoubleClick(item)}
                                        onDragEnd={(e: any) => handleDragEnd(e, item)}
                                    />
                                );
                            }
                            if (item.type === ItemType.BOOKMARK) {
                                return (
                                    <BookmarkItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                        onDoubleClick={() => handleBookmarkDoubleClick(item)}
                                        onDragEnd={(e: any) => handleDragEnd(e, item)}
                                    />
                                );
                            }
                            if (item.type === ItemType.IMAGE) {
                                return (
                                    <ImageItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                        onDoubleClick={() => handleImageDoubleClick(item)}
                                        onDragEnd={(e: any) => handleDragEnd(e, item)}
                                    />
                                );
                            }
                            if (item.type === ItemType.DRAWING && isDrawingContent(item.content)) {
                                return (
                                    <DrawingItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            if (item.type === ItemType.SHAPE && isShapeContent(item.content)) {
                                return (
                                    <ShapeItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            if (item.type === ItemType.ARROW && isArrowContent(item.content)) {
                                return (
                                    <ArrowItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            if (item.type === ItemType.TEXT && isTextContent(item.content)) {
                                return (
                                    <TextItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                        onChange={(data: any) => handleItemChange(item.id, data)}
                                        onDoubleClick={() => handleNoteDoubleClick(item)}
                                    />
                                );
                            }
                            if (item.type === ItemType.FRAME && isFrameContent(item.content)) {
                                return (
                                    <FrameItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            if (item.type === ItemType.EMBED && isEmbedContent(item.content)) {
                                return (
                                    <EmbedItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            if (item.type === ItemType.POLL && isPollContent(item.content)) {
                                return (
                                    <PollItem
                                        key={item.id}
                                        item={item}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelectItem(item.id, false)}
                                        onContextMenu={(e: any) => handleContextMenu(e, item.id)}
                                    />
                                );
                            }
                            return null;
                        })}
                        {isSelecting && selectionBox && (
                            <SelectionBox
                                x={selectionBox.x}
                                y={selectionBox.y}
                                width={selectionBox.width}
                                height={selectionBox.height}
                            />
                        )}
                    </Layer>
                </Stage>

                {chatOpen && (
                    <CursorChat
                        x={chatPosition.x}
                        y={chatPosition.y}
                        onSendMessage={(msg) => {
                            // Helper to get current cursor position relative to canvas
                            const stage = stageRef.current;
                            if (stage) {
                                const ptr = stage.getPointerPosition();
                                if (ptr) {
                                    const canvasX = (ptr.x - position.x) / zoom;
                                    const canvasY = (ptr.y - position.y) / zoom;

                                    broadcastMessage({
                                        type: 'chat',
                                        content: msg,
                                        x: canvasX,
                                        y: canvasY,
                                        userName: session?.user?.name || 'Anonymous',
                                        userColor: '#f00' // Should get from valid color generator
                                    });
                                }
                            }
                            setChatOpen(false);
                        }}
                        onClose={() => setChatOpen(false)}
                    />
                )}

                {reactionOpen && (
                    <ReactionSelector
                        x={reactionPosition.x}
                        y={reactionPosition.y}
                        onSelect={(emoji) => {
                            const stage = stageRef.current;
                            if (stage) {
                                const ptr = stage.getPointerPosition();
                                if (ptr) {
                                    const canvasX = (ptr.x - position.x) / zoom;
                                    const canvasY = (ptr.y - position.y) / zoom;

                                    broadcastMessage({
                                        type: 'reaction',
                                        emoji: emoji,
                                        x: canvasX,
                                        y: canvasY,
                                        userName: session?.user?.name || 'Anonymous'
                                    });
                                }
                            }
                            setReactionOpen(false);
                        }}
                        onClose={() => setReactionOpen(false)}
                    />
                )}

                {/* Remote Chat Messages */}
                {remoteMessages.map((msg) => {
                    // Convert canvas coordinates to screen coordinates if needed
                    // Logic depends on how coordinates are sent. Assuming sent as canvas absolute.
                    // Screen X = Canvas X * Zoom + Stage X
                    const screenX = msg.x * zoom + position.x;
                    const screenY = msg.y * zoom + position.y;

                    // Simple boundary check or just render
                    return (
                        <RemoteCursorChat
                            key={msg.id}
                            x={screenX}
                            y={screenY}
                            message={msg.content}
                            senderName={msg.userName}
                            color={msg.userColor}
                        />
                    );
                })}

                {/* Remote Reactions */}
                {remoteReactions.map((reaction) => {
                    const screenX = reaction.x * zoom + position.x;
                    const screenY = reaction.y * zoom + position.y;

                    return (
                        <RemoteReaction
                            key={reaction.id}
                            x={screenX}
                            y={screenY}
                            emoji={reaction.emoji}
                            senderName={reaction.userName}
                        />
                    );
                })}

                {selectedItemIds.size > 1 && !isPresentationMode && (
                    <Box sx={{ position: 'absolute', top: 80, display: 'flex', justifyContent: 'center', width: '100%', pointerEvents: 'none', zIndex: 10 }}>
                        <Box sx={{ pointerEvents: 'auto' }}>
                            <AlignmentToolbar onAlign={handleAlign} onDistribute={handleDistribute} />
                        </Box>
                    </Box>
                )}

                {isDrawing && !isPresentationMode && (
                    <Box sx={{ position: 'absolute', top: 140, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                        <DrawingToolbar />
                    </Box>
                )}
            </Box>
            <CreateNoteDialog open={noteDialogOpen} onClose={() => setNoteDialogOpen(false)} canvasId={canvasId} initialPosition={{ x: 100, y: 100 }} />
            <CreateBookmarkDialog open={bookmarkDialogOpen} onClose={() => setBookmarkDialogOpen(false)} canvasId={canvasId} initialPosition={{ x: 100, y: 100 }} />
            <CreateImageDialog open={imageDialogOpen} onClose={() => setImageDialogOpen(false)} canvasId={canvasId} initialPosition={{ x: 100, y: 100 }} />
            <CreatePollDialog open={pollDialogOpen} onClose={() => setPollDialogOpen(false)} canvasId={canvasId} initialPosition={{ x: 100, y: 100 }} />

            <EditNoteDialog open={editNoteDialogOpen} onClose={() => { setEditNoteDialogOpen(false); setEditingNoteItem(null); }} item={editingNoteItem} />
            <EditBookmarkDialog open={editBookmarkDialogOpen} onClose={() => { setEditBookmarkDialogOpen(false); setEditingBookmarkItem(null); }} item={editingBookmarkItem} />
            <EditImageDialog open={editImageDialogOpen} onClose={() => { setEditImageDialogOpen(false); setEditingImageItem(null); }} item={editingImageItem} />

            <SaveAsTemplateDialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} canvasId={canvasId} canvasName={canvasName} />
            <VersionHistoryDialog open={versionHistoryOpen} onClose={() => setVersionHistoryOpen(false)} canvasId={canvasId} />

            <ExportDialog
                open={exportDialogOpen}
                onClose={() => setExportDialogOpen(false)}
                canvasId={canvasId}
                canvasName={canvasName}
                items={allItems}
                stageRef={stageRef}
            />

            <TagFilterPanel
                open={tagFilterOpen}
                onClose={() => setTagFilterOpen(false)}
                allTags={allTags || []}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                tagCounts={tagCounts || {}}
            />

            <CanvasContextMenu
                position={contextMenuPosition}
                onClose={() => setContextMenuPosition(null)}
                onDelete={handleDeleteFromMenu}
                onDuplicate={handleDuplicate}
                onCopy={handleCopy}
                onComments={handleOpenComments}
            />

            {
                commentsItemId && (
                    <CommentsPanel
                        open={commentsPanelOpen}
                        onClose={() => {
                            setCommentsPanelOpen(false);
                            setCommentsItemId(null);
                        }}
                        itemId={commentsItemId}
                        itemType={allItems.find((item) => item.id === commentsItemId)?.type || 'NOTE'}
                        collaborators={collaborators}
                    />
                )
            }
            {aiDialogOpen && (
                <AIDialog
                    open={aiDialogOpen}
                    onClose={() => setAiDialogOpen(false)}
                    canvasId={canvasId}
                    onAddNote={handleAddNoteFromAI}
                    getContext={() => {
                        return allItems
                            .filter(item => isNoteContent(item.content))
                            // @ts-ignore
                            .map(item => item.content.text)
                            .join('\n\n');
                    }}
                />
            )}
            {serendipityOpen && (
                <SerendipityDialog
                    open={serendipityOpen}
                    onClose={() => setSerendipityOpen(false)}
                    canvasId={canvasId}
                    onAddItems={async (items) => {
                        for (const item of items) {
                            await createItem({
                                content: item.content,
                                type: item.type,
                                positionX: -position.x + stageSize.width / 2 + Math.random() * 100,
                                positionY: -position.y + stageSize.height / 2 + Math.random() * 100,
                                width: 300,
                                height: 200,
                                canvasId: canvasId,
                                zIndex: allItems.length + 1,
                                tags: []
                            });
                        }
                    }}
                />
            )}

            {templatesOpen && (
                <TemplatesGallery
                    open={templatesOpen}
                    onClose={() => setTemplatesOpen(false)}
                    onSelectTemplate={async (items) => {
                        for (const item of items) {
                            await createItem({
                                content: item.content,
                                type: item.type,
                                positionX: item.positionX - position.x + stageSize.width / 2,
                                positionY: item.positionY - position.y + stageSize.height / 2,
                                width: item.width,
                                height: item.height,
                                canvasId: canvasId,
                                zIndex: allItems.length + 1,
                                tags: []
                            });
                        }
                    }}
                />
            )}

            {whisperOpen && (
                <WhisperMode
                    open={whisperOpen}
                    onClose={() => setWhisperOpen(false)}
                    onSend={async (text) => {
                        await createItem({
                            content: { text },
                            type: ItemType.NOTE,
                            positionX: -position.x + stageSize.width / 2,
                            positionY: -position.y + stageSize.height / 2,
                            width: 300,
                            height: 200,
                            canvasId: canvasId,
                            zIndex: allItems.length + 1,
                            tags: ['whisper']
                        });
                        setWhisperOpen(false);
                    }}
                />
            )}

            {arOpen && (
                <ARCanvasLayer
                    open={arOpen}
                    onClose={() => setAROpen(false)}
                    items={allItems.map(item => ({
                        id: item.id,
                        type: item.type,
                        content: item.content as { text?: string; title?: string; url?: string },
                        positionX: item.positionX,
                        positionY: item.positionY,
                    }))}
                />
            )}
            {isTimeMachineActive && (
                <TimeMachineControl
                    versions={versions}
                    currentIndex={timeMachineIndex}
                    onChange={setTimeMachineIndex}
                    onExit={() => setTimeMachineActive(false)}
                    onRestore={async (version) => {
                        if (confirm('Restore to this version?')) {
                            await restoreVersion({ canvasId, versionId: version.id });
                            setTimeMachineActive(false);
                            // Invalidate cache to refetch items without full page reload
                            queryClient.invalidateQueries({ queryKey: canvasItemKeys.list(canvasId) });
                        }
                    }}
                />
            )}
        </Box>
    );
}
