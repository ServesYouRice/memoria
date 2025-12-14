/**
 * Canvas Export Utilities
 *
 * Provides multiple export formats for canvases: JSON, Markdown, PNG.
 * PDF export is excluded as jspdf was removed for bundle size.
 *
 * @module lib/export/canvas-export
 */

import type { Canvas, CanvasItem } from '@prisma/client';

export type ExportFormat = 'json' | 'markdown' | 'png';

interface CanvasWithItems extends Canvas {
    items: CanvasItem[];
}

/**
 * Export canvas to JSON format
 */
export function exportToJSON(canvas: CanvasWithItems): string {
    const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        canvas: {
            id: canvas.id,
            name: canvas.name,
            zoomLevel: canvas.zoomLevel,
            panX: canvas.panX,
            panY: canvas.panY,
            createdAt: canvas.createdAt,
            updatedAt: canvas.updatedAt,
        },
        items: canvas.items.map((item) => ({
            id: item.id,
            type: item.type,
            x: item.positionX,
            y: item.positionY,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            content: item.content,
            tags: item.tags,
            createdAt: item.createdAt,
        })),
        meta: {
            itemCount: canvas.items.length,
            types: countItemTypes(canvas.items),
        },
    };

    return JSON.stringify(exportData, null, 2);
}

/**
 * Export canvas to Markdown format
 */
export function exportToMarkdown(canvas: CanvasWithItems): string {
    const lines: string[] = [];

    // Header
    lines.push(`# ${canvas.name || 'Untitled Canvas'}`);
    lines.push('');

    lines.push(`*Exported on ${new Date().toLocaleDateString()}*`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Group items by type
    const notes = canvas.items.filter((i) => i.type === 'NOTE');
    const bookmarks = canvas.items.filter((i) => i.type === 'BOOKMARK');
    const images = canvas.items.filter((i) => i.type === 'IMAGE');

    // Notes section
    if (notes.length > 0) {
        lines.push('## Notes');
        lines.push('');
        for (const note of notes) {
            const content = note.content as { text?: string; title?: string } | null;
            if (content?.title) {
                lines.push(`### ${content.title}`);
            }
            if (content?.text) {
                lines.push(content.text);
            }
            lines.push('');
        }
    }

    // Bookmarks section
    if (bookmarks.length > 0) {
        lines.push('## Bookmarks');
        lines.push('');
        for (const bookmark of bookmarks) {
            const content = bookmark.content as { url?: string; title?: string; description?: string } | null;
            if (content?.url) {
                const title = content.title || content.url;
                lines.push(`- [${title}](${content.url})`);
                if (content.description) {
                    lines.push(`  - ${content.description}`);
                }
            }
        }
        lines.push('');
    }

    // Images section
    if (images.length > 0) {
        lines.push('## Images');
        lines.push('');
        for (const image of images) {
            const content = image.content as { url?: string; alt?: string; caption?: string } | null;
            if (content?.url) {
                const alt = content.alt || content.caption || 'Image';
                lines.push(`![${alt}](${content.url})`);
                if (content.caption) {
                    lines.push(`*${content.caption}*`);
                }
                lines.push('');
            }
        }
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push(`*Canvas ID: ${canvas.id}*`);

    return lines.join('\n');
}

/**
 * Count items by type
 */
function countItemTypes(items: CanvasItem[]): Record<string, number> {
    return items.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
}

/**
 * Generate download for export
 */
export function downloadExport(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Export canvas in specified format
 */
export function exportCanvas(
    canvas: CanvasWithItems,
    format: 'json' | 'markdown'
): { content: string; filename: string; mimeType: string } {
    const safeName = (canvas.name || 'canvas').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const date = new Date().toISOString().split('T')[0];

    switch (format) {
        case 'json':
            return {
                content: exportToJSON(canvas),
                filename: `${safeName}_${date}.json`,
                mimeType: 'application/json',
            };
        case 'markdown':
            return {
                content: exportToMarkdown(canvas),
                filename: `${safeName}_${date}.md`,
                mimeType: 'text/markdown',
            };
    }
}
