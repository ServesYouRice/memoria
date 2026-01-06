/**
 * Canvas AI Handlers Hook
 * Handles AI-related actions: note generation, serendipity, templates, whisper
 */

import { useCallback } from 'react';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { ItemType, isNoteContent, type CanvasItem } from '@/types/canvas';

interface UseCanvasAIHandlersOptions {
    canvasId: string;
    position: { x: number; y: number };
    stageSize: { width: number; height: number };
    zoom: number;
    allItems: CanvasItem[];
}

interface SerendipityItem {
    type: ItemType;
    content: Record<string, unknown>;
}

interface TemplateItem {
    type: ItemType;
    content: Record<string, unknown>;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
}

export function useCanvasAIHandlers({
    canvasId,
    position,
    stageSize,
    zoom,
    allItems,
}: UseCanvasAIHandlersOptions) {
    const { mutateAsync: createItem } = useCreateCanvasItem();

    /**
     * Add a note from AI-generated text
     */
    const handleAddNoteFromAI = useCallback(
        (text: string) => {
            const centerX = (-position.x + stageSize.width / 2) / zoom;
            const centerY = (-position.y + stageSize.height / 2) / zoom;

            createItem({
                canvasId,
                type: ItemType.NOTE,
                positionX: centerX - 150,
                positionY: centerY - 100,
                width: 300,
                height: 200,
                zIndex: 100,
                tags: ['ai-generated'],
                content: { text },
            });
        },
        [canvasId, createItem, position, stageSize, zoom]
    );

    /**
     * Get context from existing notes for AI prompts
     */
    const getAIContext = useCallback(() => {
        return allItems
            .filter((item) => isNoteContent(item.content))
            .map((item) => (item.content as { text?: string }).text || '')
            .filter(Boolean)
            .join('\n\n');
    }, [allItems]);

    /**
     * Add items from serendipity/discovery feature
     */
    const handleAddSerendipityItems = useCallback(
        async (items: SerendipityItem[]) => {
            for (const item of items) {
                await createItem({
                    content: item.content,
                    type: item.type,
                    positionX: -position.x + stageSize.width / 2 + Math.random() * 100,
                    positionY: -position.y + stageSize.height / 2 + Math.random() * 100,
                    width: 300,
                    height: 200,
                    canvasId,
                    zIndex: allItems.length + 1,
                    tags: [],
                });
            }
        },
        [canvasId, createItem, allItems.length, position, stageSize]
    );

    /**
     * Add items from a template selection
     */
    const handleSelectTemplate = useCallback(
        async (items: TemplateItem[]) => {
            for (const item of items) {
                await createItem({
                    content: item.content,
                    type: item.type,
                    positionX: item.positionX - position.x + stageSize.width / 2,
                    positionY: item.positionY - position.y + stageSize.height / 2,
                    width: item.width,
                    height: item.height,
                    canvasId,
                    zIndex: allItems.length + 1,
                    tags: [],
                });
            }
        },
        [canvasId, createItem, allItems.length, position, stageSize]
    );

    /**
     * Create a note from whisper (voice) input
     */
    const handleWhisperSend = useCallback(
        async (text: string) => {
            await createItem({
                content: { text },
                type: ItemType.NOTE,
                positionX: -position.x + stageSize.width / 2,
                positionY: -position.y + stageSize.height / 2,
                width: 300,
                height: 200,
                canvasId,
                zIndex: allItems.length + 1,
                tags: ['whisper'],
            });
        },
        [canvasId, createItem, allItems.length, position, stageSize]
    );

    return {
        handleAddNoteFromAI,
        getAIContext,
        handleAddSerendipityItems,
        handleSelectTemplate,
        handleWhisperSend,
    };
}
